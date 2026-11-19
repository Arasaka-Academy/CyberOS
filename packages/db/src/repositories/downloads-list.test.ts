/**
 * [INPUT]: 依赖临时 SQLite 和下载列表仓库。
 * [OUTPUT]: 验证大历史分页、锚点、筛选与权威窗口。
 * [POS]: 下载只读契约回归；不依赖工作进程。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloadTask, openCyberOsDb, type CyberOsDatabase } from "../index.js";
import { getDownloadSummary, listDownloadTaskPage, listDownloadTaskWindow } from "./downloads-list.js";

let directory: string;
let db: CyberOsDatabase;
const now = new Date("2026-11-19T00:00:00.000Z");

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-download-list-"));
  db = openCyberOsDb(path.join(directory, "test.sqlite"));
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

function task(index: number) {
  return createDownloadTask(db, {
    url: "https://example.com/test", storagePoolId: "pool-1", targetDirectory: ".",
    targetFileName: `${index}.bin`, targetPath: `${index}.bin`, now
  });
}

describe("download cursor lists", () => {
  it("paginates more than 500 tasks with identical creation times without omissions", () => {
    const expected = db.transaction(() => Array.from({ length: 1_205 }, (_, i) => task(i).id))().sort().reverse();
    const ids: string[] = [];
    let cursor: { createdAt: string; id: string } | null = null;
    do {
      const page = listDownloadTaskPage(db, { filter: "all", limit: 50, cursor });
      ids.push(...page.tasks.map((item) => item.id));
      const last = page.tasks.at(-1);
      cursor = page.hasMore && last ? { createdAt: last.createdAt, id: last.id } : null;
    } while (cursor);
    expect(ids).toEqual(expected);
    expect(new Set(ids).size).toBe(1_205);
  });

  it("keeps the boundary stable after insertions and deletion of the cursor task", () => {
    const original = Array.from({ length: 7 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const page = listDownloadTaskPage(db, { filter: "all", limit: 3 });
    const cursor = page.tasks.at(-1)!;
    createDownloadTask(db, { ...cursor, targetFileName: "new.bin", targetPath: "new.bin", now: new Date(now.getTime() + 1) });
    db.prepare("DELETE FROM download_tasks WHERE id = ?").run(cursor.id);
    const next = listDownloadTaskPage(db, { filter: "all", limit: 10, cursor });
    expect(next.tasks.map((item) => item.id)).toEqual(original.slice(3).map((item) => item.id));
  });

  it("finds neighbors of a deleted anchor and continues paging after them", () => {
    const tasks = Array.from({ length: 120 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const anchor = tasks[65]!;
    db.prepare("DELETE FROM download_tasks WHERE id = ?").run(anchor.id);
    const page = listDownloadTaskPage(db, { filter: "all", limit: 50, anchor });
    expect(page.tasks).toHaveLength(50);
    expect(page.tasks.some((item) => item.id === anchor.id)).toBe(false);
    expect(page.tasks[24]?.id).toBe(tasks[64]?.id);
    expect(page.tasks[25]?.id).toBe(tasks[66]?.id);
    expect(page.hasMore).toBe(true);
    const next = listDownloadTaskPage(db, { filter: "all", limit: 50, cursor: page.tasks.at(-1)! });
    expect(next.tasks[0]?.id).toBe(tasks[91]?.id);
  });

  it("filters on the server and computes summaries over all history", () => {
    const statuses = ["queued", "running", "paused", "seeding", "completed", "failed", "cancelled"];
    statuses.forEach((status, i) => db.prepare("UPDATE download_tasks SET status = ?, speed_bytes_per_second = 20 WHERE id = ?").run(status, task(i).id));
    expect(listDownloadTaskPage(db, { filter: "active", limit: 50 }).tasks).toHaveLength(4);
    expect(listDownloadTaskPage(db, { filter: "completed", limit: 50 }).tasks).toHaveLength(1);
    expect(listDownloadTaskPage(db, { filter: "failed", limit: 50 }).tasks).toHaveLength(2);
    expect(getDownloadSummary(db)).toEqual({ total: 7, active: 3, queued: 1, completed: 1, failed: 2, speedBytesPerSecond: 20 });
  });

  it("reads authoritative range membership, deletion, and an explicit overflow", () => {
    const tasks = Array.from({ length: 160 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const input = { filter: "all" as const, newest: tasks[0]!, oldest: tasks[159]! };
    expect(listDownloadTaskWindow(db, input)).toMatchObject({ overflow: true, tasks: expect.any(Array) });
    expect(listDownloadTaskWindow(db, input).tasks).toHaveLength(150);
    const key = tasks[30]!;
    db.prepare("UPDATE download_tasks SET status = 'completed' WHERE id = ?").run(key.id);
    expect(listDownloadTaskWindow(db, { ...input, filter: "completed" }).tasks.map((item) => item.id)).toEqual([key.id]);
    db.prepare("DELETE FROM download_tasks WHERE id = ?").run(key.id);
    expect(listDownloadTaskWindow(db, { ...input, filter: "completed" }).tasks).toEqual([]);
  });
});
