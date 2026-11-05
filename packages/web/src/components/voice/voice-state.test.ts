import { expect, it } from "vitest";
import type { VoiceHistoryTurn } from "@cyberos/shared";
import { mergeVoiceHistory } from "./useVoiceHistory.js";
import { locateVoiceSegment } from "./useVoicePlayback.js";

const turn = (sequence: number, assistantText = ""): VoiceHistoryTurn => ({
  recordingId: `capture-${sequence}`, deviceId: "remote", sessionId: null, messageId: null, jobId: null, status: "completed",
  speechSuppressed: false, error: null, timings: {}, createdAt: "2026-11-05T00:00:00Z", updatedAt: "2026-11-05T00:00:00Z",
  sequence, revision: 1, source: "device", clientId: null, userText: "test", assistantText, awaitingApproval: false, userAudio: [], assistantAudio: [], userAudioState: "unavailable", assistantAudioState: "unavailable"
});
it("merges reconnect snapshots by stable turn identity without losing loaded older pages", () => {
  const history = mergeVoiceHistory([turn(1), turn(2), turn(3)], [turn(3, "reply"), turn(4)]);
  expect(history.map((item) => item.sequence)).toEqual([1, 2, 3, 4]);
  expect(history[2]!.assistantText).toBe("reply");
  const newer = { ...turn(3, "newest reply"), revision: 5 };
  expect(mergeVoiceHistory([newer], [turn(3, "late fetch")])[0]!.assistantText).toBe("newest reply");
});
it("maps cumulative seek positions across sentence clips, including exact boundaries", () => {
  const clips = [{ url: "/first", duration: 2 }, { url: "/second", duration: 3 }];
  expect(locateVoiceSegment(clips, 0)).toEqual({ index: 0, offset: 0 });
  expect(locateVoiceSegment(clips, 2)).toEqual({ index: 1, offset: 0 });
  expect(locateVoiceSegment(clips, 4.5)).toEqual({ index: 1, offset: 2.5 });
  expect(locateVoiceSegment(clips, 100)).toEqual({ index: 1, offset: 3 });
});
