/**
 * [INPUT]: 依赖下载数据库行和共享任务类型。
 * [OUTPUT]: 提供下载列投影和统一任务映射。
 * [POS]: 下载生命周期与列表查询共用的数据库转换边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadTaskRecord } from "@cyberos/shared";
import type { DbDownloadTaskRow } from "./repository-rows.js";

export const DOWNLOAD_COLUMNS = `
  id, url, storage_pool_id, target_directory, target_file_name,
  target_path, partial_path, status, received_bytes, total_bytes,
  speed_bytes_per_second, etag, last_modified, error, worker_id,
  lease_expires_at, created_at, updated_at, started_at, finished_at,
  last_progress_at, file_operation_id, phase, download_mode,
  expected_sha256, actual_sha256, error_code, error_retryable,
  retry_count, next_retry_at, control_requested, segment_count,
  source_kind, torrent_info_hash, torrent_name, selected_file_count,
  uploaded_bytes, upload_speed_bytes_per_second, peer_count,
  seed_ratio_limit, seed_time_limit_seconds, content_completed_at,
  seed_started_at
`;

export function mapDownloadTask(row: DbDownloadTaskRow): DownloadTaskRecord {
  return {
    id: row.id,
    url: row.url,
    storagePoolId: row.storage_pool_id,
    targetDirectory: row.target_directory,
    targetFileName: row.target_file_name,
    targetPath: row.target_path,
    partialPath: row.partial_path,
    status: row.status,
    receivedBytes: row.received_bytes,
    totalBytes: row.total_bytes,
    speedBytesPerSecond: row.speed_bytes_per_second,
    etag: row.etag,
    lastModified: row.last_modified,
    error: row.error,
    workerId: row.worker_id,
    leaseExpiresAt: row.lease_expires_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    lastProgressAt: row.last_progress_at,
    fileOperationId: row.file_operation_id,
    phase: row.phase,
    downloadMode: row.download_mode,
    expectedSha256: row.expected_sha256,
    actualSha256: row.actual_sha256,
    errorCode: row.error_code,
    errorRetryable: row.error_retryable === 1,
    retryCount: row.retry_count,
    nextRetryAt: row.next_retry_at,
    controlRequested: row.control_requested,
    segmentCount: row.segment_count,
    sourceKind: row.source_kind,
    torrentInfoHash: row.torrent_info_hash,
    torrentName: row.torrent_name,
    selectedFileCount: row.selected_file_count,
    uploadedBytes: row.uploaded_bytes,
    uploadSpeedBytesPerSecond: row.upload_speed_bytes_per_second,
    peerCount: row.peer_count,
    seedRatioLimit: row.seed_ratio_limit,
    seedTimeLimitSeconds: row.seed_time_limit_seconds,
    contentCompletedAt: row.content_completed_at,
    seedStartedAt: row.seed_started_at
  };
}
