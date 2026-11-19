/**
 * [INPUT]: 下载缓存与观察版本契约。
 * [OUTPUT]: 验证乱序响应、删除、窗口校准与筛选。
 * [POS]: 下载同步层回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { describe, expect, it } from "vitest";
import type { DownloadTaskRecord as DownloadTask, DownloadWindowSnapshot } from "@cyberos/shared";
import { advanceDownloadHistoryGap, createDownloadHistoryGap, DownloadGapRequests, resetDownloadHistoryGaps } from "./download-history-gaps.js";
import { DownloadTaskCache } from "./download-task-cache.js";
const observation = (sequence: number, serverId = "api-1") => ({ serverId, sequence });
const baseTask: DownloadTask = {
  id: "task-1",
  url: "https://example.com/archive.zip",
    storagePoolId: "pool-1",
  targetDirectory: "/cyberos/data/data",
  targetFileName: "archive.zip",
  targetPath: "/cyberos/data/data/archive.zip",
  partialPath: "/cyberos/data/data/.task-1.cyberos-download.part",
  status: "running",
  receivedBytes: 25,
  totalBytes: 100,
  speedBytesPerSecond: 10,
  etag: null,
  lastModified: null,
  error: null,
  workerId: "worker-1",
  leaseExpiresAt: null,
  createdAt: "2026-09-24T00:00:00.000Z",
  updatedAt: "2026-09-24T00:00:00.000Z",
  startedAt: "2026-09-24T00:00:00.000Z",
  finishedAt: null,
  lastProgressAt: "2026-09-24T00:00:00.000Z",
  fileOperationId: null,
  phase: "downloading",
  downloadMode: "single",
  expectedSha256: null,
  actualSha256: null,
  errorCode: null,
  errorRetryable: false,
  retryCount: 0,
  nextRetryAt: null,
  controlRequested: null,
  segmentCount: 0,
  sourceKind: "http",
  torrentInfoHash: null,
  torrentName: null,
  selectedFileCount: 0,
  uploadedBytes: 0,
  uploadSpeedBytesPerSecond: 0,
  peerCount: 0,
  seedRatioLimit: 1,
  seedTimeLimitSeconds: 7_200,
  contentCompletedAt: null,
  seedStartedAt: null
};


function task(id: string, status: DownloadTask["status"] = "running"): DownloadTask { return { ...baseTask, id, status }; }
function windowSnapshot(tasks: DownloadTask[], sequence: number): DownloadWindowSnapshot {
  return { filter: "all", headTasks: [], headNextCursor: null, windowTasks: tasks, window: { newest: task("z"), oldest: task("a"), overflow: false }, health: { status: "unavailable", freshWorkers: 0, lastHeartbeatAt: null, activeTasks: 0, queuedTasks: 0, retryWaitTasks: 0 }, summary: { total: 0, active: 0, queued: 0, completed: 0, failed: 0, speedBytesPerSecond: 0 }, observation: observation(sequence) };
}
describe("DownloadTaskCache", () => {
  it("does not let a late page overwrite a newer pause or resume", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("m", "paused")], observation(3));
    cache.merge([task("m", "running"), task("b")], observation(1));
    expect(cache.tasks().map((row) => [row.id, row.status])).toEqual([["m", "paused"], ["b", "running"]]);
    cache.merge([task("m", "queued")], observation(4));
    expect(cache.tasks()[0]?.status).toBe("queued");
  });
  it("does not resurrect deleted rows from an older page", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("m")], observation(1)); cache.remove("m", observation(3));
    cache.merge([task("m")], observation(2)); cache.merge([task("m")], observation(3));
    expect(cache.tasks()).toEqual([]);
  });
  it("replaces only the observed window and retains older history", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("z"), task("m"), task("b"), task("0")], observation(1));
    cache.window(windowSnapshot([task("m", "completed")], 2));
    expect(cache.tasks().map((row) => row.id)).toEqual(["m", "0"]);
    cache.merge([task("z"), task("b")], observation(1));
    expect(cache.tasks().map((row) => row.id)).toEqual(["m", "0"]);
  });
  it("keeps newer action results when a delayed window is missing the task", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("m")], observation(5)); cache.window(windowSnapshot([], 4));
    expect(cache.tasks().map((row) => row.id)).toEqual(["m"]);
  });
  it("calibrates deleted anchors after reconnect", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("z"), task("m"), task("b")], observation(1));
    cache.replaceRange([task("z"), task("b")], task("z"), task("b"), observation(3));
    expect(cache.tasks().map((row) => row.id)).toEqual(["z", "b"]);
  });
  it("accepts a restarted API and rejects late responses from the retired instance", () => {
    const cache = new DownloadTaskCache("all");
    cache.merge([task("m", "running")], observation(100));
    cache.merge([task("m", "paused")], observation(1, "api-2"));
    cache.merge([task("m", "completed")], observation(101));
    expect(cache.tasks()[0]?.status).toBe("paused");
  });
  it("updates filter membership and sorts same-millisecond tasks by ID", () => {
    const cache = new DownloadTaskCache("active");
    cache.merge([task("b"), task("z", "queued"), task("m", "completed")], observation(1));
    expect(cache.tasks().map((row) => row.id)).toEqual(["z", "b"]);
    cache.merge([task("z", "completed"), task("m", "queued")], observation(2));
    expect(cache.tasks().map((row) => row.id)).toEqual(["m", "b"]);
  });
});

describe("download history gaps", () => {
  const ordered = (index: number): DownloadTask => ({ ...baseTask, id: `task-${index}`, createdAt: new Date(Date.UTC(2026, 0, 1) - index * 1000).toISOString() });
  const page = (start: number, end: number) => ({ tasks: Array.from({ length: end - start }, (_, index) => ordered(start + index)), nextCursor: String(end) });
  it("keeps the original older boundary after an anchor refresh preloads part of the gap", () => {
    const gap = createDownloadHistoryGap("gap", page(0, 50).tasks, page(200, 250).tasks, "50");
    expect(gap?.until.id).toBe("task-200");
    // 刷新曾读取 25..74；50..99 的重叠不代表已经接上旧历史。
    const next = advanceDownloadHistoryGap(gap!, page(50, 100));
    expect(next?.cursor).toBe("100");
    expect(next?.until.id).toBe("task-200");
    const later = advanceDownloadHistoryGap(next!, page(100, 200));
    expect(later?.cursor).toBe("200");
    expect(advanceDownloadHistoryGap(later!, page(200, 250))).toBeNull();
  });
  it("closes at the original sort boundary even when its task was deleted", () => {
    const gap = createDownloadHistoryGap("gap", page(0, 50).tasks, page(200, 250).tasks, "50");
    expect(advanceDownloadHistoryGap(gap!, page(201, 250))).toBeNull();
  });
  it("resets an in-flight gap after API restart and keeps its replacement request locked", () => {
    const requests = new DownloadGapRequests();
    const gap = createDownloadHistoryGap("gap", page(0, 50).tasks, page(200, 250).tasks, "50")!;
    const oldRequest = requests.start(gap.id)!;
    expect(requests.start(gap.id)).toBeNull();
    const restored = resetDownloadHistoryGaps([{ ...gap, loading: true }]);
    requests.reset();
    expect(restored[0]?.loading).toBe(false);
    const replacement = requests.start(gap.id)!;
    expect(requests.finish(gap.id, oldRequest)).toBe(false);
    expect(requests.start(gap.id)).toBeNull();
    expect(requests.finish(gap.id, replacement)).toBe(true);
    expect(requests.start(gap.id)).not.toBeNull();
  });
  it("does not add a gap when head and loaded history already overlap", () => {
    expect(createDownloadHistoryGap("gap", page(0, 50).tasks, page(25, 75).tasks, "50")).toBeNull();
  });
});
