/**
 * [INPUT]: 依赖 SQLite、统一任务映射和共享列表契约。
 * [OUTPUT]: 提供稳定游标分页、锚点邻居、窗口快照与全局汇总。
 * [POS]: 下载只读查询边界；不修改任务生命周期。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadFilter, DownloadSummary, DownloadTaskKey, DownloadTaskRecord } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import type { DbDownloadTaskRow } from "./repository-rows.js";
import { DOWNLOAD_COLUMNS, mapDownloadTask } from "./downloads-mapper.js";

const FILTER_SQL: Record<DownloadFilter, string> = {
  all: "1 = 1",
  active: "status IN ('queued', 'running', 'paused', 'seeding')",
  completed: "status = 'completed'",
  failed: "status IN ('failed', 'cancelled')"
};

function readTasks(db: CyberOsDatabase, where: string, params: string[], limit: number, ascending = false): DownloadTaskRecord[] {
  const direction = ascending ? "ASC" : "DESC";
  const rows = db.prepare(`
    SELECT ${DOWNLOAD_COLUMNS} FROM download_tasks WHERE ${where}
    ORDER BY created_at ${direction}, id ${direction} LIMIT ?
  `).all(...params, limit) as DbDownloadTaskRow[];
  return rows.map(mapDownloadTask);
}

export function listDownloadTaskPage(
  db: CyberOsDatabase,
  input: { filter: DownloadFilter; limit: number; cursor?: DownloadTaskKey | null; anchor?: DownloadTaskKey | null }
): { tasks: DownloadTaskRecord[]; hasMore: boolean } {
  const limit = Math.max(1, Math.min(input.limit, 100));
  const filter = FILTER_SQL[input.filter];
  if (input.anchor) {
    const anchor = input.anchor;
    const params = [anchor.createdAt, anchor.id];
    let older = readTasks(db, `${filter} AND (created_at, id) < (?, ?)`, params, Math.floor(limit / 2));
    const newer = readTasks(db, `${filter} AND (created_at, id) >= (?, ?)`, params, limit - older.length, true);
    if (newer.length + older.length < limit) {
      older = readTasks(db, `${filter} AND (created_at, id) < (?, ?)`, params, limit - newer.length);
    }
    const tasks = [...newer.reverse(), ...older];
    const last = tasks.at(-1);
    const hasMore = Boolean(last && db.prepare(`
      SELECT 1 FROM download_tasks WHERE ${filter} AND (created_at, id) < (?, ?) LIMIT 1
    `).get(last.createdAt, last.id));
    return { tasks, hasMore };
  }
  const cursor = input.cursor;
  const tasks = readTasks(db, `${filter}${cursor ? " AND (created_at, id) < (?, ?)" : ""}`,
    cursor ? [cursor.createdAt, cursor.id] : [], limit + 1);
  return { tasks: tasks.slice(0, limit), hasMore: tasks.length > limit };
}

export function listDownloadTaskWindow(
  db: CyberOsDatabase,
  input: { filter: DownloadFilter; newest: DownloadTaskKey; oldest: DownloadTaskKey }
): { tasks: DownloadTaskRecord[]; overflow: boolean } {
  const tasks = readTasks(db, `${FILTER_SQL[input.filter]}
    AND (created_at, id) <= (?, ?) AND (created_at, id) >= (?, ?)`,
  [input.newest.createdAt, input.newest.id, input.oldest.createdAt, input.oldest.id], 151);
  return { tasks: tasks.slice(0, 150), overflow: tasks.length > 150 };
}

export function getDownloadSummary(db: CyberOsDatabase): DownloadSummary {
  const row = db.prepare(`
    SELECT COUNT(*) AS total,
      COALESCE(SUM(status IN ('running', 'paused', 'seeding')), 0) AS active,
      COALESCE(SUM(status = 'queued'), 0) AS queued,
      COALESCE(SUM(status = 'completed'), 0) AS completed,
      COALESCE(SUM(status IN ('failed', 'cancelled')), 0) AS failed,
      COALESCE(SUM(CASE WHEN status = 'running' THEN speed_bytes_per_second ELSE 0 END), 0) AS speedBytesPerSecond
    FROM download_tasks
  `).get() as DownloadSummary;
  return row;
}
