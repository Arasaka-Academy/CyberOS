/**
 * [INPUT]: 依赖启动 EDID 快照、实际 DRM 和共享播放器会话。
 * [OUTPUT]: 稳定接屏后以已应用选择器安全重新匹配输出。
 * [POS]: API 后台恢复边界；不改设置，不应用未确认草稿。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { CyberOsDatabase } from "@cyberos/db";
import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { withTvSettingsMutation } from "./tv-settings-lock.js";

export interface TvOutputMonitorOptions {
  db: CyberOsDatabase;
  loadSettings(): { enabled: boolean };
  playback: { getStatus(): Promise<{ owner: "music" | "video" | null; sessionId: string | null }> };
  tvMode: { reconfigure(connector: string | null): Promise<void> };
  log: { info(object: object, message: string): void; warn(object: object, message: string): void };
  paths?: { drmDirectory: string; identityFile: string; appliedConnectorFile: string };
  pollMs?: number;
  retryMs?: number;
}

interface OutputIdentity { connector: string; heads: Record<string, string | null> }
interface Candidate { key: string; connector: string | null }
const CONNECTOR = /^HDMI-A-[1-9]\d*$/u;
const HEAD = /^card\d+-HDMI-A-[1-9]\d*$/u;

export class TvOutputMonitor {
  private readonly paths: NonNullable<TvOutputMonitorOptions["paths"]>;
  private timer: ReturnType<typeof setInterval> | undefined;
  private inflight: Promise<void> | undefined;
  private stopped = false;
  private pending: string | undefined;
  private stableAfter = 0;
  private completed: string | undefined;
  private retryAt = 0;
  constructor(private readonly options: TvOutputMonitorOptions) {
    this.paths = options.paths ?? { drmDirectory: "/sys/class/drm", identityFile: "/run/cyberos-tv/output-identity.json", appliedConnectorFile: "/run/cyberos-tv/applied-connector" };
  }
  start(): void {
    if (this.stopped || this.timer) return;
    void this.check();
    this.timer = setInterval(() => { void this.check(); }, this.options.pollMs ?? 5_000);
    this.timer.unref();
  }
  check(): Promise<void> {
    if (this.stopped) return Promise.resolve();
    if (this.inflight) return this.inflight;
    this.inflight = this.inspect().catch(error => {
      this.retryAt = Date.now() + (this.options.retryMs ?? 60_000);
      this.options.log.warn({ err: error }, "TV output hotplug recovery failed");
    }).finally(() => { this.inflight = undefined; });
    return this.inflight;
  }
  stop(): void {
    this.stopped = true;
    clearInterval(this.timer);
    this.timer = undefined;
  }
  async close(): Promise<void> {
    this.stop();
    await this.inflight;
  }
  private async inspect(): Promise<void> {
    const candidate = await this.candidate();
    if (!candidate) { this.pending = undefined; this.completed = undefined; return; }
    if (this.pending !== candidate.key) {
      this.pending = candidate.key;
      this.stableAfter = Date.now() + (this.options.pollMs ?? 5_000);
      return;
    }
    if (Date.now() < this.stableAfter) return;
    if (this.completed === candidate.key || Date.now() < this.retryAt) return;
    await withTvSettingsMutation(this.options.db, async () => {
      if (this.stopped) return;
      // 排队期间手动应用或插拔均使本次采样失效。
      const current = await this.candidate();
      if (current?.key !== candidate.key) { this.pending = undefined; return; }
      const status = await this.options.playback.getStatus();
      if (status.owner !== null || status.sessionId !== null || this.stopped) return;
      await this.options.tvMode.reconfigure(current.connector);
      this.completed = current.key;
      this.options.log.info({ connector: current.connector }, "TV output matched the connected display");
    });
  }
  private async candidate(): Promise<Candidate | undefined> {
    try {
      if (!this.options.loadSettings().enabled) return;
      const [raw, applied] = await Promise.all([
        readFile(this.paths.identityFile, "utf8"), readFile(this.paths.appliedConnectorFile, "utf8")
      ]);
      if (raw.length > 65_536) return;
      const identity = parseIdentity(JSON.parse(raw));
      if (!identity || identity.connector !== applied.trim()) return;
      const names = (await readdir(this.paths.drmDirectory)).filter(name => HEAD.test(name) &&
        (identity.connector === "auto" || name.replace(/^card\d+-/u, "") === identity.connector)).sort().slice(0, 128);
      const changes: Array<[string, string]> = [];
      for (const name of names) {
        const directory = path.join(this.paths.drmDirectory, name);
        const [status, edid] = await Promise.all([
          readFile(path.join(directory, "status"), "utf8"), readFile(path.join(directory, "edid"))
        ]);
        if (status.trim() !== "connected" || !validEdid(edid)) continue;
        const digest = createHash("sha256").update(edid).digest("hex");
        if (identity.heads[name] !== digest) changes.push([name, digest]);
      }
      if (!changes.length) return;
      const baseline = Object.entries(identity.heads).sort(([a], [b]) => a.localeCompare(b));
      return { key: JSON.stringify([identity.connector, baseline, changes]), connector: identity.connector === "auto" ? null : identity.connector };
    } catch { /* 缺失快照、失联设备和错误设置均不触发重启。 */ }
  }
}

function parseIdentity(value: unknown): OutputIdentity | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const record = value as Record<string, unknown>;
  if (typeof record.connector !== "string" || record.connector !== "auto" && !CONNECTOR.test(record.connector) ||
    !record.heads || typeof record.heads !== "object" || Array.isArray(record.heads)) return;
  const entries = Object.entries(record.heads);
  if (entries.length > 128 || entries.some(([name, digest]) => !HEAD.test(name) || digest !== null && (typeof digest !== "string" || !/^[a-f0-9]{64}$/u.test(digest)))) return;
  return { connector: record.connector, heads: Object.fromEntries(entries) as Record<string, string | null> };
}

function validEdid(edid: Buffer): boolean {
  if (!edid.length || edid.length > 32_768 || edid.length !== (edid[126]! + 1) * 128 || edid.subarray(0, 8).toString("hex") !== "00ffffffffffff00") return false;
  for (let offset = 0; offset < edid.length; offset += 128) {
    let checksum = 0;
    for (let index = offset; index < offset + 128; index++) checksum += edid[index]!;
    if (checksum % 256 !== 0) return false;
  }
  return true;
}
