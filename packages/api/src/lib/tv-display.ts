/**
 * [INPUT]: 依赖 Weston 本机 socket 与已保存 TV 策略。
 * [OUTPUT]: 提供显示快照、策略续租和渲染就绪握手。
 * [POS]: API 与非 root Weston 模块的通信边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { TvDisplayStatus, TvSettingsRecord } from "@cyberos/shared";
import net from "node:net";

export interface TvDisplayRuntime {
  status(): TvDisplayStatus;
  configure(settings: TvSettingsRecord): void;
  rendererReady(ready: boolean): void;
  subscribe(listener: () => void): () => void;
}

export class TvDisplayClient {
  private current: TvDisplayStatus = unavailable();
  private settings: TvSettingsRecord | undefined;
  private socket: net.Socket | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;
  private readonly listeners = new Set<() => void>();
  private ready = false;
  private buffer = "";
  constructor(readonly socketPath: string) {}
  start(load: () => TvSettingsRecord): void {
    if (this.timer) return;
    const renew = () => {
      try { this.configure(load()); }
      catch { this.socket?.destroy(); this.update(unavailable("TV settings require attention")); return; }
      if (!this.socket) this.connect();
      else this.send(this.policy());
    };
    renew();
    this.timer = setInterval(renew, 2_000);
    this.timer.unref();
  }
  close(): void {
    clearInterval(this.timer);
    this.timer = undefined;
    this.socket?.destroy();
    this.socket = undefined;
    this.listeners.clear();
  }
  configure(settings: TvSettingsRecord): void {
    const changed = JSON.stringify(this.settings) !== JSON.stringify(settings);
    this.settings = settings;
    if (changed) { this.send(this.policy()); this.emit(); }
  }
  rendererReady(ready: boolean): void { this.ready = ready; this.send(`RENDERER ${Number(ready)}`); }
  policy(): string {
    const milliseconds = (minutes: number | null | undefined) => minutes === null || minutes === undefined || !this.settings?.enabled ? 0 : minutes * 60_000;
    return `POLICY ${milliseconds(this.settings?.screensaverAfterMinutes)} ${milliseconds(this.settings?.screenOffAfterMinutes)}`;
  }
  status(): TvDisplayStatus { return this.current; }
  subscribe(listener: () => void): () => void { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  private emit(): void { for (const listener of this.listeners) listener(); }
  private update(status: TvDisplayStatus): void {
    if (this.current.state === status.state && this.current.supported === status.supported && this.current.reason === status.reason) return;
    this.current = status;
    this.emit();
  }
  private send(command: string): void { if (this.socket && !this.socket.connecting && !this.socket.destroyed) this.socket.write(`${command}\n`); }
  private connect(): void {
    this.buffer = "";
    const socket = net.createConnection({ path: this.socketPath });
    this.socket = socket;
    socket.setEncoding("utf8");
    socket.on("connect", () => { this.send(this.policy()); this.send(`RENDERER ${Number(this.ready)}`); });
    socket.on("data", (chunk: string) => {
      this.buffer += chunk;
      if (Buffer.byteLength(this.buffer) > 16_384) { socket.destroy(); return; }
      let end: number;
      while ((end = this.buffer.indexOf("\n")) !== -1) {
        const line = this.buffer.slice(0, end);
        this.buffer = this.buffer.slice(end + 1);
        try {
          const value: unknown = JSON.parse(line);
          if (!value || typeof value !== "object") throw new Error("Invalid display state");
          const record = value as Record<string, unknown>;
          if (!["active", "screensaver", "off"].includes(String(record.state)) || typeof record.supported !== "boolean" || record.reason !== null && typeof record.reason !== "string") throw new Error("Invalid display state");
          this.update({ state: record.state as TvDisplayStatus["state"], supported: record.supported, reason: record.reason, updatedAt: new Date().toISOString() });
        } catch { socket.destroy(); return; }
      }
    });
    socket.on("error", () => { /* 失联状态由 close 统一发布。 */ });
    socket.on("close", () => {
      if (this.socket !== socket) return;
      this.socket = undefined;
      this.update(unavailable());
    });
  }
}

export function unavailableTvDisplay(): TvDisplayStatus { return unavailable(); }
function unavailable(reason = "TV display control is unavailable"): TvDisplayStatus {
  return { state: "active", supported: false, reason, updatedAt: new Date().toISOString() };
}
