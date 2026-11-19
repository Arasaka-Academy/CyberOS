/**
 * [INPUT]: 依赖 SQLite 连接身份与 TV 配置变更任务。
 * [OUTPUT]: 提供同一数据库内串行的 TV 保存和输出应用。
 * [POS]: TV 设置与输出路由共用的进程内互斥边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { CyberOsDatabase } from "@cyberos/db";

const tails = new WeakMap<CyberOsDatabase, Promise<unknown>>();

export async function withTvSettingsMutation<T>(db: CyberOsDatabase, action: () => Promise<T>): Promise<T> {
  const previous = tails.get(db) ?? Promise.resolve();
  const current = previous.catch(() => {}).then(action);
  tails.set(db, current);
  try { return await current; }
  finally { if (tails.get(db) === current) tails.delete(db); }
}
