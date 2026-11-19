/**
 * [INPUT]: 依赖确认时冻结的任务集合和版本化删除请求。
 * [OUTPUT]: 提供串行删除、批次进度和逐项失败结果。
 * [POS]: 下载批删的执行边界；单删和多选复用同一路径。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export interface DownloadDeleteTarget { id: string; targetFileName: string }
export interface DownloadDeleteProgress { completed: number; total: number; currentId: string | null }
export interface DownloadDeleteResult {
  deletedIds: string[];
  failures: { task: DownloadDeleteTarget; message: string }[];
}

export async function deleteDownloadBatch(
  targets: readonly DownloadDeleteTarget[],
  remove: (task: DownloadDeleteTarget) => Promise<void>,
  onProgress: (progress: DownloadDeleteProgress) => void
): Promise<DownloadDeleteResult> {
  const tasks = [...new Map(targets.map((task) => [task.id, task])).values()];
  const result: DownloadDeleteResult = { deletedIds: [], failures: [] };
  for (const [index, task] of tasks.entries()) {
    onProgress({ completed: index, total: tasks.length, currentId: task.id });
    try {
      await remove(task);
      result.deletedIds.push(task.id);
    } catch (error) {
      result.failures.push({ task, message: error instanceof Error ? error.message : String(error) });
    }
    onProgress({ completed: index + 1, total: tasks.length, currentId: null });
  }
  return result;
}
