/**
 * [INPUT]: 依赖下载任务和工作进程类型。
 * [OUTPUT]: 提供下载分页、窗口快照和观察版本契约。
 * [POS]: shared 的下载列表同步边界；API 与网页共用。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadTaskRecord, DownloadWorkerHealth } from "./types.js";

export type DownloadFilter = "all" | "active" | "completed" | "failed";

export interface DownloadTaskKey {
  createdAt: string;
  id: string;
}

export interface DownloadObservation {
  serverId: string;
  sequence: number;
}

export interface DownloadSummary {
  total: number;
  active: number;
  queued: number;
  completed: number;
  failed: number;
  speedBytesPerSecond: number;
}

export interface DownloadTaskPage {
  tasks: DownloadTaskRecord[];
  nextCursor: string | null;
  health: DownloadWorkerHealth;
  summary: DownloadSummary;
  observation: DownloadObservation;
}

export interface DownloadWindowSnapshot {
  filter: DownloadFilter;
  headTasks: DownloadTaskRecord[];
  headNextCursor: string | null;
  windowTasks: DownloadTaskRecord[];
  window: {
    newest: DownloadTaskKey | null;
    oldest: DownloadTaskKey | null;
    overflow: boolean;
  };
  health: DownloadWorkerHealth;
  summary: DownloadSummary;
  observation: DownloadObservation;
}
