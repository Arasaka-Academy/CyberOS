/**
 * [INPUT]: 依赖下载分页、窗口边界和 API 观察版本契约。
 * [OUTPUT]: 提供按任务 ID 合并的历史缓存与版本化删除。
 * [POS]: 下载数据层的纯状态边界；拒绝旧响应并保留已加载历史。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadFilter, DownloadObservation, DownloadTaskKey, DownloadTaskRecord, DownloadWindowSnapshot } from "@cyberos/shared";

type Entry = { task: DownloadTaskRecord; observation: DownloadObservation };
export function compareDownloadKeys(left: DownloadTaskKey, right: DownloadTaskKey): number {
  if (left.createdAt !== right.createdAt) return left.createdAt > right.createdAt ? -1 : 1;
  return left.id === right.id ? 0 : left.id > right.id ? -1 : 1;
}
export function matchesDownloadFilter(task: DownloadTaskRecord, filter: DownloadFilter): boolean {
  if (filter === "active") return ["queued", "running", "paused", "seeding"].includes(task.status);
  if (filter === "completed") return task.status === "completed";
  if (filter === "failed") return task.status === "failed" || task.status === "cancelled";
  return true;
}
export class DownloadTaskCache {
  private entries = new Map<string, Entry>();
  private tombstones = new Map<string, DownloadObservation>();
  private retiredServers = new Set<string>();
  serverId: string | null = null;
  sequence = 0;
  constructor(readonly filter: DownloadFilter) {}

  observe(observation: DownloadObservation): boolean {
    if (this.retiredServers.has(observation.serverId)) return false;
    if (this.serverId !== observation.serverId) {
      if (this.serverId) this.retiredServers.add(this.serverId);
      this.serverId = observation.serverId;
      this.sequence = 0;
      this.tombstones.clear();
    }
    this.sequence = Math.max(this.sequence, observation.sequence);
    return true;
  }
  private newer(observation: DownloadObservation, previous?: DownloadObservation): boolean {
    return !previous || previous.serverId !== observation.serverId || previous.sequence <= observation.sequence;
  }
  merge(tasks: DownloadTaskRecord[], observation: DownloadObservation): boolean {
    if (!this.observe(observation)) return false;
    for (const task of tasks) {
      if (!this.newer(observation, this.tombstones.get(task.id)) || !this.newer(observation, this.entries.get(task.id)?.observation)) continue;
      if (this.tombstones.get(task.id)?.sequence === observation.sequence) continue;
      this.entries.set(task.id, { task, observation });
    }
    return true;
  }
  remove(id: string, observation: DownloadObservation): void {
    if (!this.observe(observation) || !this.newer(observation, this.entries.get(id)?.observation) || !this.newer(observation, this.tombstones.get(id))) return;
    this.entries.delete(id);
    this.tombstones.set(id, observation);
  }
  replaceRange(tasks: DownloadTaskRecord[], newest: DownloadTaskKey, oldest: DownloadTaskKey, observation: DownloadObservation): void {
    if (!this.observe(observation)) return;
    const ids = new Set(tasks.map((task) => task.id));
    for (const { task } of this.entries.values()) {
      if (compareDownloadKeys(task, newest) >= 0 && compareDownloadKeys(task, oldest) <= 0 && !ids.has(task.id)) this.remove(task.id, observation);
    }
    this.merge(tasks, observation);
  }
  window(snapshot: DownloadWindowSnapshot): boolean {
    if (!this.observe(snapshot.observation)) return false;
    const { newest, oldest, overflow } = snapshot.window;
    if (newest && oldest && !overflow) {
      this.replaceRange(snapshot.windowTasks, newest, oldest, snapshot.observation);
    }
    this.merge(snapshot.headTasks, snapshot.observation);
    this.merge(snapshot.windowTasks, snapshot.observation);
    return true;
  }
  tasks(): DownloadTaskRecord[] {
    return [...this.entries.values()].map(({ task }) => task).filter((task) => matchesDownloadFilter(task, this.filter)).sort(compareDownloadKeys);
  }
}
