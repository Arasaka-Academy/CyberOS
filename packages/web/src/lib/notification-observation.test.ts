import { describe, expect, it } from "vitest";
import type { NotificationEventRecord } from "@cyberos/shared";
import { canObserveBrowserNotification } from "./notification-observation.js";

const event: NotificationEventRecord = { id: 1, eventKey: "reply:1", type: "agent.reply", target: { kind: "agent_session", sessionId: "s1", jobId: "j1", transcriptEventId: 11 }, createdAt: "2026-11-19T00:00:00Z", expiresAt: "2026-11-20T00:00:00Z" };
const shown = { sessionId: "s1", focused: true, visible: true, chatVisible: true, rendered: true, inViewport: true, complete: true };

describe("browser notification observation", () => {
  it("confirms only the actual completed content in the focused conversation", () => {
    expect(canObserveBrowserNotification(event, shown)).toBe(true);
    for (const field of ["focused", "visible", "chatVisible", "rendered", "inViewport", "complete"] as const) {
      expect(canObserveBrowserNotification(event, { ...shown, [field]: false })).toBe(false);
    }
    expect(canObserveBrowserNotification(event, { ...shown, sessionId: "another" })).toBe(false);
  });

  it("never suppresses a test or a reply without a transcript reference", () => {
    expect(canObserveBrowserNotification({ ...event, type: "system.test", target: { kind: "home" } }, shown)).toBe(false);
    expect(canObserveBrowserNotification({ ...event, target: { kind: "agent_session", sessionId: "s1", jobId: "j1" } }, shown)).toBe(false);
  });

  it("requires an independent request reference for action notifications", () => {
    expect(canObserveBrowserNotification({ ...event, type: "agent.action_required", target: { kind: "agent_session", sessionId: "s1", jobId: "j1", runId: "r1" } }, shown)).toBe(true);
    expect(canObserveBrowserNotification({ ...event, type: "agent.action_required", target: { kind: "agent_session", sessionId: "s1", jobId: "j1" } }, shown)).toBe(false);
  });
});
