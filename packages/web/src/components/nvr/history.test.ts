import { describe, expect, it } from "vitest";
import { dayRange, historyPage, playbackRange, segmentPlaybackAt, segmentPosition } from "./history.js";

describe("NVR history", () => {
  it("paginates returned records without claiming a server total", () => {
    const items = Array.from({ length: 101 }, (_, index) => index);
    expect(historyPage(items, 2)).toEqual({ items: items.slice(50, 100), page: 2, pages: 3, total: 101 });
    expect(historyPage(items, 99).page).toBe(3);
    expect(historyPage([], 0)).toEqual({ items: [], page: 1, pages: 1, total: 0 });
  });
  it("bounds event preroll to its local day", () => {
    const occurredAt = new Date("2026-11-15T00:00:05").toISOString();
    expect(playbackRange("camera", occurredAt)).toEqual({ deviceId: "camera", from: dayRange("2026-11-15").from, to: dayRange("2026-11-15").to });
  });
  it("clips cross-midnight timeline intervals to the selected day", () => {
    const { from, to } = dayRange("2026-11-15");
    const start = Date.parse(from), end = Date.parse(to) + 1;
    expect(segmentPosition({ startedAt: new Date(start - 1000).toISOString(), endedAt: new Date(end + 1000).toISOString() }, "2026-11-15")).toEqual({ left: 0, width: 100 });
    expect(segmentPosition({ startedAt: to, endedAt: from }, "2026-11-15")).toBeNull();
  });
  it("starts cross-midnight recordings inside the selected local day", () => {
    const { from } = dayRange("2026-11-15");
    expect(segmentPlaybackAt({ startedAt: new Date(Date.parse(from) - 60000).toISOString() }, "2026-11-15")).toBe(from);
    const later = new Date(Date.parse(from) + 60000).toISOString();
    expect(segmentPlaybackAt({ startedAt: later }, "2026-11-15")).toBe(later);
  });
});
