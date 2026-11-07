import { afterEach, describe, expect, it, vi } from "vitest";
import { PtzLease } from "./api.js";
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
});
