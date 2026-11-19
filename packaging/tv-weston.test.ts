/**
 * [INPUT]: 隔离运行目录、模拟 Weston 进程与真实 Unix socket。
 * [OUTPUT]: 验证合成器就绪后提交 EDID，失败保留确认快照。
 * [POS]: TV Weston 包装脚本的进程生命周期回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawn, type ChildProcess } from "node:child_process";
import { createServer } from "node:net";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const script = path.resolve("packaging/scripts/cyberos-tv-weston");
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });

describe("cyberos-tv-weston", () => {
  it("commits staged identity only after the new compositor exposes its socket", async () => {
    const fixture = await createFixture();
    const run = start(fixture, { CYBEROS_TEST_WAIT_FOR_SOCKET: "1" });
    await vi.waitFor(async () => { expect(await readFile(path.join(fixture.root, "weston-started"), "utf8")).toBe("started"); });
    expect(await readFile(fixture.confirmed, "utf8")).toBe("confirmed-monitor\n");
    expect(await readFile(fixture.statusLog, "utf8")).not.toContain("weston ready");
    await writeFile(path.join(fixture.root, "allow-socket"), "");
    await vi.waitFor(async () => {
      expect(await readFile(fixture.statusLog, "utf8")).toContain("weston ready");
    });
    expect(await readFile(fixture.confirmed, "utf8")).toBe("next-monitor\n");
    await expect(readFile(fixture.staged)).rejects.toMatchObject({ code: "ENOENT" });
    await stop(run.process, run.done);
  }, 10_000);

  it("keeps the confirmed identity when Weston exits before creating a socket", async () => {
    const fixture = await createFixture();
    const run = start(fixture, { CYBEROS_TEST_WESTON_FAIL: "1" });
    expect(await run.done).toBe(7);
    expect(await readFile(fixture.confirmed, "utf8")).toBe("confirmed-monitor\n");
    expect(await readFile(fixture.staged, "utf8")).toBe("next-monitor\n");
    expect(await readFile(fixture.statusLog, "utf8")).not.toContain("weston ready");
  });

  it("rejects a relative test root", async () => {
    const fixture = await createFixture();
    const run = start(fixture, { CYBEROS_TEST_ROOT: "relative" });
    expect(await run.done).toBe(2);
    expect(await readFile(fixture.confirmed, "utf8")).toBe("confirmed-monitor\n");
  });

  it("does not confirm a stale socket when the new Weston fails", async () => {
    const fixture = await createFixture();
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(path.join(fixture.root, "run/cyberos-tv/wayland-0"), resolve);
    });
    cleanup.unshift(async () => { await new Promise<void>(resolve => { server.close(() => { resolve(); }); }); });
    const run = start(fixture, { CYBEROS_TEST_WESTON_FAIL: "1" });
    expect(await run.done).toBe(7);
    expect(await readFile(fixture.confirmed, "utf8")).toBe("confirmed-monitor\n");
    expect(await readFile(fixture.staged, "utf8")).toBe("next-monitor\n");
    expect(await readFile(fixture.statusLog, "utf8")).not.toContain("weston ready");
  });
});

interface Fixture { root: string; bin: string; confirmed: string; staged: string; statusLog: string }
async function createFixture(): Promise<Fixture> {
  const root = await mkdtemp(path.join(os.tmpdir(), "tv-weston-"));
  const bin = path.join(root, "bin");
  const runtime = path.join(root, "run/cyberos-tv");
  const scripts = path.join(root, "usr/lib/cyberos/scripts");
  await mkdir(bin, { recursive: true });
  await mkdir(runtime, { recursive: true });
  await mkdir(scripts, { recursive: true });
  await mkdir(path.join(root, "sys/class/drm/card1-HDMI-A-1"), { recursive: true });
  await writeFile(path.join(root, "sys/class/drm/card1-HDMI-A-1/status"), "connected\n");
  const confirmed = path.join(runtime, "output-identity.json");
  const staged = path.join(runtime, "output-identity.next.json");
  const statusLog = path.join(root, "status.log");
  await writeFile(confirmed, "confirmed-monitor\n");
  await writeFile(staged, "next-monitor\n");
  await writeFile(statusLog, "");
  await executable(path.join(scripts, "cyberos-tv-write-status"), `#!/bin/sh
printf '%s\\n' "$*" >> '${statusLog}'
`);
  await executable(path.join(bin, "weston"), `#!/usr/bin/env python3
import os, pathlib, signal, socket, sys, time
if '--version' in sys.argv:
    print('weston 14.0.2')
    sys.exit(0)
if os.environ.get('CYBEROS_TEST_WESTON_FAIL'):
    sys.exit(7)
pathlib.Path('${root}/weston-started').write_text('started')
while os.environ.get('CYBEROS_TEST_WAIT_FOR_SOCKET') and not pathlib.Path('${root}/allow-socket').exists():
    time.sleep(0.01)
sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
sock.bind('${runtime}/wayland-0')
sock.listen(1)
signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
while True:
    time.sleep(0.01)
`);
  cleanup.push(async () => { await rm(root, { recursive: true, force: true }); });
  return { root, bin, confirmed, staged, statusLog };
}
async function executable(name: string, source: string): Promise<void> {
  await writeFile(name, source); await chmod(name, 0o755);
}
function start(fixture: Fixture, extra: NodeJS.ProcessEnv = {}) {
  const process = spawn("/bin/sh", [script], {
    env: { ...globalThis.process.env, PATH: `${fixture.bin}:${globalThis.process.env.PATH ?? ""}`, CYBEROS_TEST_ROOT: fixture.root, ...extra },
    stdio: "ignore"
  });
  const done = new Promise<number | null>((resolve, reject) => { process.once("error", reject); process.once("exit", resolve); });
  cleanup.unshift(async () => { await stop(process, done); });
  return { process, done };
}
async function stop(process: ChildProcess, done: Promise<number | null>): Promise<void> {
  if (process.exitCode === null && process.signalCode === null) process.kill("SIGTERM");
  await done;
}
