import { afterEach, describe, expect, it, vi } from "vitest";
import { nvrRequest, PtzLease } from "./api.js";
describe("PTZ hold lease", () => {
  afterEach(() => vi.useRealTimers());
  it("coalesces renewals and sends stop after an in-flight move resolves", async () => {
    vi.useFakeTimers();
    let resolveMove: () => void = () => undefined;
    const send = vi.fn().mockImplementationOnce(() => new Promise<void>((resolve) => { resolveMove = resolve; })).mockResolvedValue(undefined);
    const lease = new PtzLease(send, vi.fn());
    lease.start(.4, 0); await vi.advanceTimersByTimeAsync(1600);
    expect(send).toHaveBeenCalledTimes(1);
    lease.stop(); resolveMove(); await vi.advanceTimersByTimeAsync(0);
    expect(send.mock.calls.map((args) => args[0].action)).toEqual(["continuous_move", "stop"]);
    await vi.advanceTimersByTimeAsync(3000); expect(send).toHaveBeenCalledTimes(2);
  });
  it("cancels a move queued behind a preceding stop and stops on transport failure", async () => {
    vi.useFakeTimers(); const failure = vi.fn(); const send = vi.fn().mockRejectedValueOnce(new Error("Disconnected")).mockResolvedValue(undefined);
    const lease = new PtzLease(send, failure); lease.start(0, .4);
    await vi.advanceTimersByTimeAsync(0);
    expect(failure).toHaveBeenCalledTimes(1);
    expect(send.mock.calls.map((args) => args[0].action)).toEqual(["continuous_move", "stop"]);
    await vi.advanceTimersByTimeAsync(2000); expect(send).toHaveBeenCalledTimes(2);
  });
  it("can stop a finite move without a held continuous lease and reports a failed stop", async () => {
    const failure = vi.fn();
    const send = vi.fn().mockRejectedValue(new Error("Stop unconfirmed"));
    const lease = new PtzLease(send, failure);
    await lease.stop();
    expect(send).not.toHaveBeenCalled();
    await lease.stop(true);
    expect(send).toHaveBeenCalledWith({ action: "stop" });
    expect(failure).toHaveBeenCalledWith(expect.objectContaining({ message: "Stop unconfirmed" }));
  });
  it("keeps stop requests alive on page exit without replaying movement requests", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    try {
      await nvrRequest("/devices/camera/ptz", "POST", { action: "stop" });
      await nvrRequest("/devices/camera/ptz", "POST", { action: "continuous_move", pan: 0.4, tilt: 0 });
      expect(fetch).toHaveBeenNthCalledWith(1, "/api/nvr/devices/camera/ptz", expect.objectContaining({ keepalive: true }));
      expect(fetch).toHaveBeenNthCalledWith(2, "/api/nvr/devices/camera/ptz", expect.objectContaining({ keepalive: false }));
      expect(fetch).toHaveBeenCalledTimes(2);
    } finally { fetch.mockRestore(); }
  });
});
