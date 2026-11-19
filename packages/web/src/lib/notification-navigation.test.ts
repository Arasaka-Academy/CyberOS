import { describe, expect, it, vi } from "vitest";
import { getTranscript } from "../api.js";
import { loadNotificationSession, notificationSessionId } from "./notification-navigation.js";

vi.mock("../api.js", () => ({ getTranscript: vi.fn() }));

describe("notification session navigation", () => {
  it("loads an older session directly without relying on the recent session list", async () => {
    const session = { id: "old-session", kind: "chat" as const, currentPath: "." };
    const snapshot = { session, transcript: [], activeJob: null, liveEvents: [], lastEventId: 44 };
    vi.mocked(getTranscript).mockResolvedValueOnce(snapshot);
    expect(await loadNotificationSession("old-session")).toEqual({ session, snapshot });
    expect(getTranscript).toHaveBeenCalledWith("old-session");
  });

  it("rejects a missing or different session in the response", async () => {
    vi.mocked(getTranscript).mockResolvedValueOnce({ transcript: [], activeJob: null, liveEvents: [], lastEventId: 0 });
    await expect(loadNotificationSession("missing")).rejects.toThrow();
  });

  it("accepts only a bounded session identifier from the URL", () => {
    expect(notificationSessionId("?session=old-session&x=1")).toBe("old-session");
    expect(notificationSessionId("?session=../../etc")).toBeNull();
    expect(notificationSessionId("?session=" + "x".repeat(129))).toBeNull();
    expect(notificationSessionId("?other=1")).toBeNull();
  });
});
