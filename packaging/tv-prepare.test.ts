/**
 * [INPUT]: 在临时 DRM 目录中运行 TV 启动准备脚本。
 * [OUTPUT]: 验证 HDMI 配置、配置前 EDID 采样及 HPD 清理。
 * [POS]: TV 启动准备脚本的隔离集成测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve("packaging/scripts/cyberos-tv-prepare");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("cyberos-tv-prepare", () => {
  it("records the startup EDID so a later real monitor can replace the fallback mode", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "disconnected", "1024x768\n");
    expect(run(fixture, "start").status).toBe(0);
    const snapshot = path.join(fixture.runtimeDirectory, "output-identity.next.json");
    expect(JSON.parse(await readFile(snapshot, "utf8"))).toEqual({ connector: "auto", heads: { "card1-HDMI-A-1": null } });
    const edid = Buffer.alloc(128, 7);
    await writeFile(path.join(fixture.drmDirectory, "card1-HDMI-A-1/edid"), edid);
    expect(run(fixture, "start").status).toBe(0);
    expect(JSON.parse(await readFile(snapshot, "utf8"))).toEqual({ connector: "auto", heads: { "card1-HDMI-A-1": createHash("sha256").update(edid).digest("hex") } });
  });

  it("records only the applied connector when another output is connected", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "connected", "1920x1080\n");
    await addConnector(fixture, "card1-HDMI-A-2", "connected", "2560x1600\n");
    expect(run(fixture, "start", { CYBEROS_TEST_SAVED_CONNECTOR: '"HDMI-A-2"' }).status).toBe(0);
    expect(JSON.parse(await readFile(path.join(fixture.runtimeDirectory, "output-identity.next.json"), "utf8")))
      .toEqual({ connector: "HDMI-A-2", heads: { "card1-HDMI-A-2": null } });
  });

  it("stages EDID before reading output configuration and preserves the confirmed snapshot", async () => {
    const fixture = await createFixture();
    const statusPath = await addConnector(fixture, "card1-HDMI-A-1", "connected", "1920x1080\n");
    await mkdir(fixture.runtimeDirectory, { recursive: true });
    const confirmed = path.join(fixture.runtimeDirectory, "output-identity.json");
    await writeFile(confirmed, "confirmed-before-start\n");
    const edidPath = path.join(fixture.drmDirectory, "card1-HDMI-A-1/edid");
    await writeFile(edidPath, "old-monitor");
    const catPath = spawnSync("/bin/sh", ["-c", "command -v cat"], { encoding: "utf8" }).stdout.trim();
    await executable(path.join(fixture.binDirectory, "cat"), `#!/bin/sh
if [ "\${1:-}" = '${statusPath}' ]; then printf new-monitor > '${edidPath}'; fi
exec '${catPath}' "$@"
`);

    expect(run(fixture, "start").status).toBe(0);
    expect(await readFile(confirmed, "utf8")).toBe("confirmed-before-start\n");
    expect(JSON.parse(await readFile(path.join(fixture.runtimeDirectory, "output-identity.next.json"), "utf8")))
      .toEqual({ connector: "auto", heads: { "card1-HDMI-A-1": createHash("sha256").update("old-monitor").digest("hex") } });
    expect(await readFile(edidPath, "utf8")).toBe("new-monitor");
  });

  it("reads the saved connector when no runtime override exists", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "connected", "1920x1080\n");
    await addConnector(fixture, "card1-HDMI-A-2", "connected", "1920x1080\n");
    expect(run(fixture, "start", { CYBEROS_TEST_SAVED_CONNECTOR: '"HDMI-A-2"' }).status).toBe(0);
    const config = await readFile(path.join(fixture.runtimeDirectory, "weston.ini"), "utf8");
    expect(config).toContain("name=HDMI-A-1\nmode=off");
    expect(config).toContain("name=HDMI-A-2\nmode=preferred");
  });

  it("releases forced outputs on stop even with unreadable start settings", async () => {
    const fixture = await createFixture();
    const status = await addConnector(fixture, "card1-HDMI-A-1", "disconnected", "1920x1080\n");
    expect(run(fixture, "start").status).toBe(0);
    await mkdir(path.join(fixture.root, "run/cyberos"), { recursive: true });
    await writeFile(path.join(fixture.root, "run/cyberos/tv-connector"), "invalid\n");
    expect(run(fixture, "stop", { CYBEROS_TEST_SETTINGS_UNAVAILABLE: "1" }).status).toBe(0);
    await expect(readFile(status, "utf8")).resolves.toBe("detect\n");
  });

  it("enables only the explicitly selected HDMI output", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "connected", "1920x1080\n");
    await addConnector(fixture, "card1-HDMI-A-2", "connected", "1920x1080\n");
    await mkdir(path.join(fixture.root, "run/cyberos"), { recursive: true });
    await writeFile(path.join(fixture.root, "run/cyberos/tv-connector"), "HDMI-A-2\n");
    expect(run(fixture, "start").status).toBe(0);
    const config = await readFile(path.join(fixture.runtimeDirectory, "weston.ini"), "utf8");
    expect(config).toContain("name=HDMI-A-1\nmode=off");
    expect(config).toContain("name=HDMI-A-2\nmode=preferred");
    await expect(readFile(path.join(fixture.runtimeDirectory, "applied-connector"), "utf8")).resolves.toBe("HDMI-A-2\n");
  });

  it("forces the selected disconnected connector even when another HDMI is connected", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "connected", "1920x1080\n");
    const selected = await addConnector(fixture, "card1-HDMI-A-2", "disconnected", "1920x1080\n");
    await mkdir(path.join(fixture.root, "run/cyberos"), { recursive: true });
    await writeFile(path.join(fixture.root, "run/cyberos/tv-connector"), "HDMI-A-2\n");
    expect(run(fixture, "start").status).toBe(0);
    await expect(readFile(selected, "utf8")).resolves.toBe("on-digital\n");
  });

  it("configures dedicated HDMI outputs and disables other connectors", async () => {
    const fixture = await createFixture();
    await addConnector(fixture, "card1-HDMI-A-1", "connected", "3840x2160\n1920x1080\n");
    await addConnector(fixture, "card1-Writeback-1", "connected", "4096x2160\n");

    const result = run(fixture, "start");

    expect(result.status).toBe(0);
    const config = await readFile(path.join(fixture.runtimeDirectory, "weston.ini"), "utf8");
    expect(config).toContain("name=HDMI-A-1");
    expect(config).toContain("scale=2");
    expect(config).toContain("name=Writeback-1\nmode=off");
  });

  it("forces and later releases the preferred HDMI connector when HPD is unavailable", async () => {
    const fixture = await createFixture();
    const statusPath = await addConnector(fixture, "card1-HDMI-A-1", "disconnected", "1024x768\n");

    const started = run(fixture, "start");

    expect(started.status).toBe(0);
    await expect(readFile(statusPath, "utf8")).resolves.toBe("on-digital\n");
    await expect(readFile(path.join(fixture.runtimeDirectory, "forced-connectors"), "utf8"))
      .resolves.toBe(`${statusPath}\n`);
    await expect(readFile(path.join(fixture.runtimeDirectory, "weston.ini"), "utf8"))
      .resolves.toContain("name=HDMI-A-1");

    const stopped = run(fixture, "stop");

    expect(stopped.status).toBe(0);
    await expect(readFile(statusPath, "utf8")).resolves.toBe("detect\n");
    await expect(readFile(path.join(fixture.runtimeDirectory, "forced-connectors"), "utf8"))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects a relative test root", async () => {
    const fixture = await createFixture();

    const result = run(fixture, "start", { CYBEROS_TEST_ROOT: "relative" });

    expect(result.status).toBe(2);
    expect(result.stderr).toContain("CYBEROS_TEST_ROOT must be absolute");
  });
});

interface Fixture {
  root: string;
  binDirectory: string;
  drmDirectory: string;
  runtimeDirectory: string;
}

async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyberos-tv-prepare-test-"));
  temporaryDirectories.push(root);
  const binDirectory = path.join(root, "bin");
  const drmDirectory = path.join(root, "sys/class/drm");
  const runtimeDirectory = path.join(root, "run/cyberos-tv");
  await mkdir(binDirectory, { recursive: true });
  await mkdir(drmDirectory, { recursive: true });
  await executable(path.join(binDirectory, "install"), `#!/bin/sh
set -eu
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) shift ;;
    -m|-o|-g) shift 2 ;;
    *) break ;;
  esac
done
mkdir -p "$@"
`);
  await executable(path.join(binDirectory, "chown"), "#!/bin/sh\nexit 0\n");
  await executable(path.join(binDirectory, "curl"), `#!/bin/sh
[ -z "\${CYBEROS_TEST_SETTINGS_UNAVAILABLE:-}" ] || exit 1
printf '{"settings":{"drmConnector":%s}}\\n' "\${CYBEROS_TEST_SAVED_CONNECTOR:-null}"
`);
  return { root, binDirectory, drmDirectory, runtimeDirectory };
}

async function addConnector(
  fixture: Fixture,
  name: string,
  status: "connected" | "disconnected",
  modes: string
): Promise<string> {
  const directory = path.join(fixture.drmDirectory, name);
  await mkdir(directory, { recursive: true });
  const statusPath = path.join(directory, "status");
  await writeFile(statusPath, `${status}\n`);
  await writeFile(path.join(directory, "modes"), modes);
  return statusPath;
}

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

function run(fixture: Fixture, command: "start" | "stop", environment: NodeJS.ProcessEnv = {}) {
  return spawnSync("/bin/sh", [scriptPath, command], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fixture.binDirectory}:${process.env.PATH ?? ""}`,
      CYBEROS_TEST_ROOT: fixture.root,
      ...environment
    }
  });
}
