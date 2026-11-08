import type { NvrPtzCommand } from "@cyberos/shared";
export async function nvrRequest<T>(route: string, method = "GET", body?: unknown, signal?: AbortSignal): Promise<T> {
  const stopping = method === "POST" && body !== null && typeof body === "object" && "action" in body && body.action === "stop";
  const response = await fetch(`/api/nvr${route}`, { method, priority: method === "GET" ? "low" : "high", ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }), ...(signal ? { signal } : {}), keepalive: method === "DELETE" || stopping });
  if (!response.ok) {
    const value: unknown = await response.json().catch(() => null);
    throw new Error(value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : `NVR ${response.status}`);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
/** One in-flight move and one stop barrier; renewals never accumulate. */
export class PtzLease {
  private held: { pan: number; tilt: number } | null = null;
  private timer: ReturnType<typeof setInterval> | undefined;
  private pending = false;
  private tail: Promise<void> = Promise.resolve();
  private generation = 0;
  constructor(private send: (command: NvrPtzCommand) => Promise<void>, private failure: (error: unknown) => void) {}
  start(pan: number, tilt: number): void {
    this.stop(); this.held = { pan, tilt }; const generation = this.generation;
    const renew = () => {
      if (!this.held || generation !== this.generation || this.pending) return;
      const coordinates = this.held; this.pending = true;
      this.tail = this.tail.then(async () => {
        if (!this.held || generation !== this.generation) return;
        try { await this.send({ action: "continuous_move", ...coordinates }); }
        catch (error) { this.failure(error); this.stop(); }
      }).finally(() => { this.pending = false; });
    };
    renew(); this.timer = setInterval(renew, 500);
  }
  stop(force = false): Promise<void> {
    const active = this.held !== null;
    this.held = null; this.generation += 1; clearInterval(this.timer); this.timer = undefined;
    if (active || force) this.tail = this.tail.then(() => this.send({ action: "stop" })).catch(this.failure);
    return this.tail;
  }
}
