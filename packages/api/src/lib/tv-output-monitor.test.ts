/**
 * [INPUT]: 临时 DRM、启动身份快照和串行 TV 设置锁。
 * [OUTPUT]: 验证稳定热插屏重配、会话保护与生命周期。
 * [POS]: 自动输出恢复的隔离行为测试，不调用真实宿主。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { openCyberOsDb } from "@cyberos/db";
import { afterEach, expect, it, vi } from "vitest";
import { TvOutputMonitor } from "./tv-output-monitor.js";
import { withTvSettingsMutation } from "./tv-settings-lock.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(cleanup.splice(0).map(close => close()));
});

function edid(seed = 1): Buffer {
  const data = Buffer.alloc(128);
  Buffer.from("00ffffffffffff00", "hex").copy(data);
  data[10] = seed;
  data[127] = (256 - data.reduce((sum, value) => sum + value, 0) % 256) % 256;
  return data;
}
function hash(data: Buffer): string { return createHash("sha256").update(data).digest("hex"); }

async function fixture(pollMs = 0) {
  const root = await mkdtemp(path.join(os.tmpdir(), "tv-output-monitor-"));
  const db = openCyberOsDb(path.join(root, "test.sqlite"));
  const drmDirectory = path.join(root, "drm");
  const identityFile = path.join(root, "identity.json");
  const appliedConnectorFile = path.join(root, "applied");
  await mkdir(drmDirectory);
  const paths = { drmDirectory, identityFile, appliedConnectorFile };
  const settings = { enabled: true, drmConnector: "HDMI-A-2" };
  let status: { owner: "video" | "music" | null; sessionId: string | null } = { owner: null, sessionId: null };
  const reconfigure = vi.fn(async (_connector: string | null) => {});
  const log = { info: vi.fn(), warn: vi.fn() };
  const monitor = new TvOutputMonitor({ db, paths, pollMs, loadSettings: () => settings,
    playback: { getStatus: async () => status }, tvMode: { reconfigure }, log });
  cleanup.push(async () => { await monitor.close(); db.close(); await rm(root, { recursive: true, force: true }); });
  async function baseline(connector = "auto", heads: Record<string, string | null> = { "card1-HDMI-A-1": null }) {
    await writeFile(identityFile, JSON.stringify({ connector, heads }));
    await writeFile(appliedConnectorFile, connector);
  }
  async function head(name: string, value: Buffer, connected = true) {
    const directory = path.join(drmDirectory, name);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "status"), connected ? "connected" : "disconnected");
    await writeFile(path.join(directory, "edid"), value);
  }
  await baseline();
  await head("card1-HDMI-A-1", edid());
  return { root, db, monitor, settings, reconfigure, log, paths, baseline, head,
    setStatus(value: typeof status) { status = value; } };
}

it("reconfigures stable new EDID using the applied connector and does not repeat", async () => {
  const f = await fixture();
  const before = JSON.stringify(f.settings);
  await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledExactlyOnceWith(null);
  await f.monitor.check();
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(f.settings)).toBe(before);
  await f.baseline("auto", { "card1-HDMI-A-1": hash(edid()) });
  await f.monitor.check();
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
  // 后续无屏重启重新产生 null 快照，同一块屏仍须恢复。
  await f.baseline();
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(2);
});

it("defers both playing and paused sessions until they end", async () => {
  const f = await fixture();
  f.setStatus({ owner: "video", sessionId: "paused-video" });
  await f.monitor.check(); await f.monitor.check();
  f.setStatus({ owner: "music", sessionId: "playing-music" });
  await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  f.setStatus({ owner: null, sessionId: null });
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledExactlyOnceWith(null);
});

it("ignores disconnected, corrupt, missing and transient EDID", async () => {
  const f = await fixture();
  await f.head("card1-HDMI-A-1", edid(), false);
  await f.monitor.check(); await f.monitor.check();
  const invalid = edid(); invalid[20] = 1;
  await f.head("card1-HDMI-A-1", invalid);
  await f.monitor.check(); await f.monitor.check();
  await f.head("card1-HDMI-A-1", Buffer.alloc(0));
  await f.monitor.check(); await f.monitor.check();
  await f.head("card1-HDMI-A-1", edid());
  await f.monitor.check();
  await f.head("card1-HDMI-A-1", edid(2));
  await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledOnce();
});

it("fails closed for disabled TV, invalid snapshots and mismatched applied selector", async () => {
  const f = await fixture();
  f.settings.enabled = false;
  await f.monitor.check(); await f.monitor.check();
  f.settings.enabled = true;
  await writeFile(f.paths.identityFile, "broken-json");
  await f.monitor.check(); await f.monitor.check();
  await f.baseline();
  await writeFile(f.paths.appliedConnectorFile, "HDMI-A-2");
  await f.monitor.check(); await f.monitor.check();
  await rm(f.paths.identityFile);
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
});

it("requires samples at least one polling interval apart and stops its timer on close", async () => {
  const f = await fixture(5_000);
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  f.monitor.start();
  await f.monitor.check();
  await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(4_999);
  await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledExactlyOnceWith(null);
  await f.monitor.close();
  await f.head("card1-HDMI-A-1", edid(2));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
});

it("drops a pending observation if manual application changes the output while queued", async () => {
  const f = await fixture();
  await f.monitor.check();
  let release!: () => void;
  let locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const held = withTvSettingsMutation(f.db, async () => {
    locked(); await new Promise<void>(resolve => { release = resolve; });
  });
  await acquired;
  const pending = f.monitor.check();
  await new Promise(resolve => setImmediate(resolve));
  await f.baseline("HDMI-A-2", {});
  release(); await held; await pending;
  expect(f.reconfigure).not.toHaveBeenCalled();
});

it("ignores other connectors when an explicit output is applied", async () => {
  const f = await fixture();
  await f.baseline("HDMI-A-1", { "card1-HDMI-A-1": hash(edid()) });
  await f.head("card1-HDMI-A-2", edid(2));
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).not.toHaveBeenCalled();
  await f.head("card1-HDMI-A-1", edid(3));
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledExactlyOnceWith("HDMI-A-1");
});

it("rechecks settings and identity after waiting for the shared TV mutation lock", async () => {
  const f = await fixture();
  await f.monitor.check();
  let release!: () => void;
  let locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const held = withTvSettingsMutation(f.db, async () => {
    locked(); await new Promise<void>(resolve => { release = resolve; });
  });
  await acquired;
  const pending = f.monitor.check();
  await new Promise(resolve => setImmediate(resolve));
  f.settings.enabled = false;
  release(); await held; await pending;
  expect(f.reconfigure).not.toHaveBeenCalled();
});

it("backs off failed restarts and retries without changing the baseline", async () => {
  const f = await fixture();
  const baseline = await readFile(f.paths.identityFile, "utf8");
  f.reconfigure.mockRejectedValue(new Error("output unavailable"));
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  cleanup.push(async () => { vi.restoreAllMocks(); });
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
  await f.monitor.check(); await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
  vi.spyOn(Date, "now").mockReturnValue(61_001);
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(2);
  expect(f.log.warn).toHaveBeenCalledTimes(2);
  expect(await readFile(f.paths.identityFile, "utf8")).toBe(baseline);
});

it("coalesces polls and waits for in-flight reconfiguration on close", async () => {
  const f = await fixture();
  let finish!: () => void;
  f.reconfigure.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  await f.monitor.check();
  const pending = f.monitor.check();
  await vi.waitFor(() => expect(f.reconfigure).toHaveBeenCalledOnce());
  const duplicate = f.monitor.check();
  let closed = false;
  const closing = f.monitor.close().then(() => { closed = true; });
  await new Promise(resolve => setImmediate(resolve));
  expect(closed).toBe(false);
  finish(); await pending; await duplicate; await closing;
  await f.monitor.check();
  expect(f.reconfigure).toHaveBeenCalledTimes(1);
});

it("stops without waiting for dispatched work and cancels queued work before dispatch", async () => {
  const f = await fixture();
  await f.monitor.check();
  let release!: () => void;
  let locked!: () => void;
  const acquired = new Promise<void>(resolve => { locked = resolve; });
  const held = withTvSettingsMutation(f.db, async () => {
    locked(); await new Promise<void>(resolve => { release = resolve; });
  });
  await acquired;
  const pending = f.monitor.check();
  await new Promise(resolve => setImmediate(resolve));
  expect(f.monitor.stop()).toBeUndefined();
  release(); await held; await pending;
  expect(f.reconfigure).not.toHaveBeenCalled();

  const dispatched = await fixture();
  let finish!: () => void;
  dispatched.reconfigure.mockImplementation(async () => { await new Promise<void>(resolve => { finish = resolve; }); });
  await dispatched.monitor.check();
  const running = dispatched.monitor.check();
  await vi.waitFor(() => expect(dispatched.reconfigure).toHaveBeenCalledOnce());
  expect(dispatched.monitor.stop()).toBeUndefined();
  await dispatched.monitor.check();
  expect(dispatched.reconfigure).toHaveBeenCalledTimes(1);
  finish(); await running;
});
