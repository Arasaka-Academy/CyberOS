/**
 * [INPUT]: 依赖已授权运行仓库与能力执行器。
 * [OUTPUT]: 提供 API 内的可停止运行队列。
 * [POS]: 执行 worker 自动授权的运行；关闭时保留未开始的运行。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { listRunnableCapabilityRuns } from "@cyberos/db";
import { executeApprovedCapabilityRun, type CapabilityRuntimeDependencies } from "./orchestrator.js";

export function startCapabilityRunQueue(
  dependencies: CapabilityRuntimeDependencies,
  onError: (error: unknown) => void
): () => Promise<void> {
  let stopped = false;
  let inFlight: Promise<void> | null = null;
  const timer = setInterval(() => {
    if (inFlight) return;
    inFlight = (async () => {
      for (const run of listRunnableCapabilityRuns(dependencies.db)) {
        if (stopped) break;
        await executeApprovedCapabilityRun(dependencies, run.id);
      }
    })().catch(onError).finally(() => { inFlight = null; });
  }, 250);
  timer.unref();
  return async () => {
    stopped = true;
    clearInterval(timer);
    await inFlight;
  };
}
