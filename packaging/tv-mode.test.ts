/**
 * [INPUT]: 依赖隔离 systemd、播放器及真实内核文件锁。
 * [OUTPUT]: 验证 TV 启停、重配互斥及失败恢复。
 * [POS]: 宿主 TV 模式固定命令的可执行契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";

const scriptPath = path.resolve("packaging/scripts/cyberos-tv-mode");
const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("cyberos-tv-mode", () => {
  it("uses saved settings on a plain enable instead of forcing automatic output", async () => {
    const fixture = await createFixture("ready");
    await mkdir(path.join(fixture.root, "run/cyberos"), { recursive: true });
    const selector = path.join(fixture.root, "run/cyberos/tv-connector");
    await writeFile(selector, "HDMI-A-1\n");
    expect(run(fixture, "enable").status).toBe(0);
    await expect(readFile(selector, "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(run(fixture, "enable", {}, ["HDMI-A-2"]).status).toBe(0);
    await expect(readFile(selector, "utf8")).resolves.toBe("HDMI-A-2\n");
  });

  it("applies a connector without replacing the desktop snapshot or stopping media", async () => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable").status).toBe(0);
    const snapshot = await readFile(path.join(fixture.stateDirectory, "desktop-state"), "utf8");
    const result = run(fixture, "reconfigure", {}, ["HDMI-A-2"]);
    expect(result.status).toBe(0);
    await expect(readFile(path.join(fixture.root, "run/cyberos/tv-connector"), "utf8")).resolves.toBe("HDMI-A-2\n");
    await expect(readFile(path.join(fixture.stateDirectory, "desktop-state"), "utf8")).resolves.toBe(snapshot);
    const calls = await readFile(fixture.systemctlLog, "utf8");
    expect(calls).toContain("restart cyberos-tv.target");
    expect(calls).not.toContain("stop cyberos-vod-player");
  });

  it("restores the previous selector and runtime when the new output fails", async () => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable").status).toBe(0);
    const result = run(fixture, "reconfigure", { CYBEROS_TEST_FAIL_CONNECTOR: "HDMI-A-2" }, ["HDMI-A-2"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("previous output restored");
    await expect(readFile(path.join(fixture.root, "run/cyberos/tv-connector"), "utf8")).resolves.toBe("auto\n");
    const calls = await readFile(fixture.systemctlLog, "utf8");
    expect(calls.match(/restart cyberos-tv.target/g)).toHaveLength(2);
  });

  it.each([false, true])("holds the output lock through restart and rollback (failure=%s)", async (failure) => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable").status).toBe(0);
    const result = run(fixture, "reconfigure", failure ? { CYBEROS_TEST_FAIL_CONNECTOR: "HDMI-A-2" } : {}, ["HDMI-A-2"]);
    expect(result.status).toBe(failure ? 1 : 0);
    const probes = await readFile(fixture.lockProbeLog, "utf8");
    expect(probes.trim().split("\n")).toEqual(failure ? ["blocked", "blocked"] : ["blocked"]);
    expect(sharedLock(fixture).status).toBe(0);
  });

  it("rejects a second output application before changing the selector", async () => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable", {}, ["HDMI-A-1"]).status).toBe(0);
    const holder = spawn("python3", ["-u", "-c", `import fcntl,sys
file=open(sys.argv[1], 'r')
fcntl.flock(file, fcntl.LOCK_EX)
print('ready', flush=True)
sys.stdin.read()
`, fixture.outputLock]);
    try {
      await once(holder.stdout, "data");
      const result = run(fixture, "reconfigure", {}, ["HDMI-A-2"]);
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("output is already being reconfigured");
      expect(await readFile(path.join(fixture.root, "run/cyberos/tv-connector"), "utf8")).toBe("HDMI-A-1\n");
      expect(await readFile(fixture.systemctlLog, "utf8")).not.toContain("restart cyberos-tv.target");
    } finally {
      holder.stdin.end();
      await once(holder, "exit");
    }
    expect(sharedLock(fixture).status).toBe(0);
  });

  it("fails closed when the deployment lock is missing", async () => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable", {}, ["HDMI-A-1"]).status).toBe(0);
    await rm(fixture.outputLock);
    const result = run(fixture, "reconfigure", {}, ["HDMI-A-2"]);
    expect(result.status).toBe(1);
    expect(await readFile(path.join(fixture.root, "run/cyberos/tv-connector"), "utf8")).toBe("HDMI-A-1\n");
    expect(await readFile(fixture.systemctlLog, "utf8")).not.toContain("restart cyberos-tv.target");
  });

  it("rejects reconfiguration while a paused playback session exists", async () => {
    const fixture = await createFixture("ready");
    expect(run(fixture, "enable").status).toBe(0);
    const result = run(fixture, "reconfigure", { CYBEROS_TEST_SESSION: "paused-session" }, ["HDMI-A-2"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("End the current playback session");
    expect(await readFile(fixture.systemctlLog, "utf8")).not.toContain("restart cyberos-tv.target");
  });

  it("enables the kiosk and restores the previous desktop session", async () => {
    const fixture = await createFixture("ready");
    const enabled = run(fixture, "enable");

    expect(enabled.status).toBe(0);
    await expect(readFile(path.join(fixture.markerDirectory, "enabled"), "utf8")).resolves.toBe("enabled\n");
    await expect(readFile(path.join(fixture.systemdDirectory, "lightdm.service.d", "50-cyberos-tv-mode.conf"), "utf8"))
      .resolves.toContain("ConditionPathExists=!");
    await expect(readFile(path.join(fixture.stateDirectory, "desktop-state"), "utf8"))
      .resolves.toContain("DM_ENABLED=enabled");

    const disabled = run(fixture, "disable");
    expect(disabled.status).toBe(0);
    const calls = await readFile(fixture.systemctlLog, "utf8");
    expect(calls).toContain("stop lightdm.service");
    expect(calls).toContain("start lightdm.service");
    expect(calls).toContain("enable cyberos-tv.target");
    expect(calls).toContain("disable cyberos-tv.target");
    expect(calls).not.toContain("restart cyberos-vod-player.service");
    expect(calls).not.toContain("stop cyberos-vod-player.service");
    await expect(readFile(path.join(fixture.stateDirectory, "desktop-state"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rolls back the desktop and its own drop-ins when readiness fails", async () => {
    const fixture = await createFixture("degraded");
    const result = run(fixture, "enable", {}, ["HDMI-A-2"]);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("startup failed or did not become ready");
    const calls = await readFile(fixture.systemctlLog, "utf8");
    expect(calls).toContain("start lightdm.service");
    await expect(readFile(path.join(fixture.markerDirectory, "enabled"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(path.join(fixture.root, "run/cyberos/tv-connector"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("keeps the desktop snapshot when rollback cannot restore the prior session", async () => {
    const fixture = await createFixture("degraded", { failStartDisplayManager: true });
    const result = run(fixture, "enable");

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("keeping");
    await expect(readFile(path.join(fixture.stateDirectory, "desktop-state"), "utf8"))
      .resolves.toContain("DM_UNIT=lightdm.service");
  });

});

interface Fixture {
  root: string;
  binDirectory: string;
  stateDirectory: string;
  markerDirectory: string;
  systemdDirectory: string;
  systemctlLog: string;
  outputLock: string;
  lockProbeLog: string;
}

async function createFixture(
  tvState: "ready" | "degraded",
  options: { failStartDisplayManager?: boolean } = {}
): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "cyberos-tv-mode-test-"));
  temporaryDirectories.push(root);
  const binDirectory = path.join(root, "bin");
  const stateDirectory = path.join(root, "cyberos/state/tv/control");
  const markerDirectory = path.join(root, "cyberos/state/tv");
  const systemdDirectory = path.join(root, "etc/systemd/system");
  const systemctlLog = path.join(root, "systemctl.log");
  const outputLock = path.join(root, "run/cyberos-tv-output.lock");
  const lockProbeLog = path.join(root, "lock-probe.log");
  await mkdir(binDirectory, { recursive: true });
  await mkdir(path.dirname(outputLock), { recursive: true });
  await writeFile(outputLock, "", { mode: 0o644 });
  await writeFile(lockProbeLog, "");
  await writeFile(systemctlLog, "");
  await executable(path.join(binDirectory, "flock"), `#!/usr/bin/env python3
import fcntl,sys
try:
  fcntl.flock(int(sys.argv[-1]), fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
  sys.exit(1)
`);
  await executable(path.join(binDirectory, "id"), "#!/bin/sh\nprintf '0\\n'\n");
  await executable(path.join(binDirectory, "install"), `#!/bin/sh
set -eu
directories=0
while [ "$#" -gt 0 ]; do
  case "$1" in
    -d) directories=1; shift ;;
    -o|-g|-m) shift 2 ;;
    *) break ;;
  esac
done
[ "$directories" = 1 ] || exit 2
mkdir -p "$@"
`);
  await executable(path.join(binDirectory, "systemctl"), `#!/bin/sh
printf '%s\\n' "$*" >> '${systemctlLog}'
case "$*" in
  'restart cyberos-tv.target')
    python3 - '${outputLock}' '${lockProbeLog}' <<'PY'
import fcntl,sys
with open(sys.argv[1], 'r') as file, open(sys.argv[2], 'a') as log:
  try:
    fcntl.flock(file, fcntl.LOCK_SH | fcntl.LOCK_NB)
    log.write('acquired\\n')
  except BlockingIOError:
    log.write('blocked\\n')
PY
    ;;
  'show display-manager.service --property=Id --value') printf 'lightdm.service\\n' ;;
  'is-enabled lightdm.service') printf 'enabled\\n' ;;
  'is-active --quiet lightdm.service'|'is-active --quiet cyberos-vod-player.service'|'is-active --quiet cyberos-api.service') exit 0 ;;
  'is-active cyberos-tv.target') printf 'active\\n' ;;
  'start lightdm.service') ${options.failStartDisplayManager ? "exit 1" : "exit 0"} ;;
esac
exit 0
`);
  await executable(path.join(binDirectory, "curl"), `#!/bin/sh
case "$*" in
  *'/api/playback/status'*)
    if [ -n "\${CYBEROS_TEST_SESSION:-}" ]; then printf '%s\\n' '{"status":{"owner":"video","sessionId":"paused-session"}}';
    else printf '%s\\n' '{"status":{"owner":null,"sessionId":null}}'; fi
    exit 0 ;;
esac
if [ -n "\${CYBEROS_TEST_FAIL_CONNECTOR:-}" ] && [ -f '${root}/run/cyberos/tv-connector' ] && [ "$(cat '${root}/run/cyberos/tv-connector')" = "$CYBEROS_TEST_FAIL_CONNECTOR" ]; then
  printf '%s\\n' '{"status":{"enabled":true,"state":"degraded"}}'; exit 0
fi
printf '%s\\n' '{"status":{"enabled":true,"state":"${tvState}","weston":{"state":"${tvState}"},"chromium":{"state":"${tvState}"},"vodPlayer":{"state":"${tvState}"},"cec":{"state":"degraded"}}}'
`);
  return { root, binDirectory, stateDirectory, markerDirectory, systemdDirectory, systemctlLog, outputLock, lockProbeLog };
}

function sharedLock(fixture: Fixture) {
  return spawnSync("python3", ["-c", "import fcntl,sys; file=open(sys.argv[1], 'r'); fcntl.flock(file, fcntl.LOCK_SH | fcntl.LOCK_NB)", fixture.outputLock], { encoding: "utf8" });
}

async function executable(filePath: string, content: string): Promise<void> {
  await writeFile(filePath, content);
  await chmod(filePath, 0o755);
}

function run(fixture: Fixture, command: string, environment: NodeJS.ProcessEnv = {}, arguments_: string[] = []) {
  return spawnSync("/bin/sh", [scriptPath, command, ...arguments_], {
    encoding: "utf8",
    env: {
      ...process.env,
      ...environment,
      PATH: `${fixture.binDirectory}:${process.env.PATH ?? ""}`,
      CYBEROS_TEST_ROOT: fixture.root
    }
  });
}
