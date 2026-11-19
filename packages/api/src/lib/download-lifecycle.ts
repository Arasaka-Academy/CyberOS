/**
 * [INPUT]: 依赖下载仓库的控制请求、任务所有权和租约。
 * [OUTPUT]: 提供每任务命令互斥及有界停止确认。
 * [POS]: 下载路由共用的生命周期边界；不替代 worker 的停止动作。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { getDownloadTask, requestDownloadTaskControl, type CyberOsDatabase } from "@cyberos/db";
import type { DownloadTaskRecord } from "@cyberos/shared";

const STOP_TIMEOUT_MS = 10_000;
const STOP_POLL_MS = 100;
const commandTails = new WeakMap<CyberOsDatabase, Map<string, Promise<unknown>>>();

export async function withDownloadTaskMutation<T>(db: CyberOsDatabase, id: string, action: () => Promise<T>): Promise<T> {
  let tails = commandTails.get(db);
  if (!tails) { tails = new Map(); commandTails.set(db, tails); }
  const previous = tails.get(id) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  tails.set(id, current);
  try { return await current; }
  finally { if (tails.get(id) === current) tails.delete(id); }
}

export async function stopDownloadTaskForRemoval(db: CyberOsDatabase, task: DownloadTaskRecord): Promise<DownloadTaskRecord | null> {
  const leaseDeadline = task.leaseExpiresAt ? Date.parse(task.leaseExpiresAt) : NaN;
  if (!task.workerId || !Number.isFinite(leaseDeadline) || leaseDeadline <= Date.now()) return null;
  const deadline = Math.min(leaseDeadline, Date.now() + STOP_TIMEOUT_MS);
  const request = task.status === "seeding" ? "stop_seeding" : "cancel";
  if (!requestDownloadTaskControl(db, { id: task.id, request })) return null;

  while (Date.now() < deadline) {
    const current = getDownloadTask(db, task.id);
    if (!current || Date.now() >= deadline) return null;
    if (current.status === "completed" || (task.status === "running" && current.status === "cancelled")) {
      return current.workerId === null && current.leaseExpiresAt === null && current.controlRequested === null
        ? current : null;
    }
    const currentLease = current.leaseExpiresAt ? Date.parse(current.leaseExpiresAt) : NaN;
    if ((current.status !== "running" && current.status !== "seeding") || current.workerId !== task.workerId
      || !Number.isFinite(currentLease) || currentLease <= Date.now()) return null;
    // 租约恢复可合成终态；只接受原有效租约截止前的确认。
    await new Promise<void>((resolve) => setTimeout(resolve, Math.min(STOP_POLL_MS, deadline - Date.now())));
  }
  return null;
}
