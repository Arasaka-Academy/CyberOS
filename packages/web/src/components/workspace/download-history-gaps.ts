/**
 * [INPUT]: 依赖下载排序键与游标分页结果。
 * [OUTPUT]: 提供历史缺页推进与带请求归属的重连恢复。
 * [POS]: 下载同步的纯分页规则；只在到达原历史边界时闭合缺页。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadTaskKey, DownloadTaskPage, DownloadTaskRecord } from "@cyberos/shared";
import { compareDownloadKeys } from "./download-task-cache.js";
export interface DownloadGap { id: string; after: DownloadTaskKey; until: DownloadTaskKey; cursor: string; loading: boolean; error: string | null }
export function createDownloadHistoryGap(id: string, head: DownloadTaskRecord[], previous: DownloadTaskRecord[], cursor: string | null): DownloadGap | null {
  const last = head.at(-1);
  if (!last || !cursor) return null;
  const known = new Set(previous.map((task) => task.id));
  if (head.some((task) => known.has(task.id))) return null;
  const boundary = previous.find((task) => compareDownloadKeys(task, last) > 0);
  if (!boundary) return null;
  return { id, after: { createdAt: last.createdAt, id: last.id }, until: { createdAt: boundary.createdAt, id: boundary.id }, cursor, loading: false, error: null };
}
export function advanceDownloadHistoryGap(gap: DownloadGap, page: Pick<DownloadTaskPage, "tasks" | "nextCursor">): DownloadGap | null {
  const last = page.tasks.at(-1);
  if (!last || !page.nextCursor || page.tasks.some((task) => compareDownloadKeys(task, gap.until) >= 0)) return null;
  return { ...gap, cursor: page.nextCursor, after: { createdAt: last.createdAt, id: last.id }, loading: false, error: null };
}

/** 同一个缺页只接收当前请求的完成回调，旧 API 实例不能释放新请求。 */
export class DownloadGapRequests {
  private tokens = new Map<string, symbol>();
  start(id: string): symbol | null {
    if (this.tokens.has(id)) return null;
    const token = Symbol(id); this.tokens.set(id, token); return token;
  }
  finish(id: string, token: symbol): boolean {
    if (this.tokens.get(id) !== token) return false;
    return this.tokens.delete(id);
  }
  reset(): void { this.tokens.clear(); }
}
export function resetDownloadHistoryGaps(gaps: DownloadGap[]): DownloadGap[] {
  return gaps.map((gap) => ({ ...gap, loading: false, error: null }));
}
