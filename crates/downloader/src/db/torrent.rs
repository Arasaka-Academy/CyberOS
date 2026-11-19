/**
 * [INPUT]: 依赖父模块的 SQLite actor 和任务契约。
 * [OUTPUT]: 提供BT 领取、预览、进度和发布。
 * [POS]: 作为 Db 的职责分区；共享所有权校验。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;

impl Db {
    pub async fn torrent_running_count(&self) -> DbResult<usize> {
        self.call(|connection| {
            let count: i64 = connection.query_row(
                    "SELECT COUNT(*) FROM download_tasks WHERE source_kind <> 'http' AND status = 'running' AND worker_id IS NOT NULL",
                [],
                |row| row.get(0),
            ).map_err(DownloadError::database)?;
            Ok(count.max(0) as usize)
        }).await
    }

    pub async fn claim_torrent(&self, worker_id: &str, lease: Duration) -> DbResult<Option<Task>> {
        let limit = self.settings().await?.bt_concurrency as i64;
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            let lease_expires = future_iso(lease);
            let sql = format!("\
                UPDATE download_tasks SET status = CASE WHEN status = 'queued' THEN 'running' ELSE status END, \
                  worker_id = ?1, lease_expires_at = ?2, started_at = COALESCE(started_at, ?3), \
                  finished_at = NULL, error = NULL, error_code = NULL, error_retryable = 0, \
                  phase = CASE WHEN status = 'seeding' THEN 'seeding' \
                    WHEN phase = 'publishing' THEN 'publishing' ELSE 'downloading' END, \
                  download_mode = 'torrent', next_retry_at = NULL, control_requested = NULL, updated_at = ?3 \
                WHERE id = (SELECT id FROM download_tasks WHERE source_kind <> 'http' \
                  AND ((status = 'queued' AND (next_retry_at IS NULL OR next_retry_at <= ?3) \
                    AND (SELECT COUNT(*) FROM download_tasks active WHERE active.source_kind <> 'http' \
                      AND active.status = 'running' AND active.worker_id IS NOT NULL) < ?4) \
                    OR (status = 'seeding' AND (worker_id IS NULL OR lease_expires_at IS NULL OR lease_expires_at <= ?3))) \
                  ORDER BY CASE status WHEN 'seeding' THEN 0 ELSE 1 END, COALESCE(next_retry_at, created_at), created_at LIMIT 1) \
                RETURNING {}", TASK_COLUMNS.replace("d.", ""));
            let mut task = connection.query_row(&sql, params![worker_id, lease_expires, now, limit], map_task)
                .optional().map_err(DownloadError::database)?;
            if let Some(task) = task.as_mut() {
                let mut statement = connection.prepare(
                    "SELECT file_index FROM download_task_files WHERE task_id = ? AND selected = 1 ORDER BY file_index"
                ).map_err(DownloadError::database)?;
                let rows = statement.query_map([&task.id], |row| row.get::<_, i64>(0))
                    .map_err(DownloadError::database)?;
                task.selected_file_indices = rows
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(DownloadError::database)?
                    .into_iter()
                    .filter_map(|value| usize::try_from(value).ok())
                    .collect();
            }
            Ok(task)
        }).await
    }

    pub async fn claim_torrent_preview(
        &self,
        worker_id: &str,
        lease: Duration,
    ) -> DbResult<Option<TorrentPreview>> {
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            connection.execute(
                "UPDATE torrent_previews SET status = CASE WHEN expires_at <= ? THEN 'expired' ELSE 'queued' END, \
                   worker_id = NULL, lease_expires_at = NULL, updated_at = ? \
                 WHERE status = 'resolving' AND (lease_expires_at IS NULL OR lease_expires_at <= ?)",
                params![now, now, now],
            ).map_err(DownloadError::database)?;
            connection.execute(
                "UPDATE torrent_previews SET status = 'expired', updated_at = ? \
                 WHERE status = 'queued' AND expires_at <= ?",
                params![now, now],
            ).map_err(DownloadError::database)?;
            connection.query_row(
                "UPDATE torrent_previews SET status = 'resolving', worker_id = ?, lease_expires_at = ?, updated_at = ? \
                 WHERE id = (SELECT id FROM torrent_previews WHERE status = 'queued' AND expires_at > ? \
                   ORDER BY created_at LIMIT 1) AND status = 'queued' \
                 RETURNING id, source_kind, source_uri, metainfo",
                params![worker_id, future_iso(lease), now, now],
                |row| Ok(TorrentPreview {
                    id: row.get(0)?,
                    source_kind: row.get(1)?,
                    source_uri: row.get(2)?,
                    metainfo: row.get(3)?,
                }),
            ).optional().map_err(DownloadError::database)
        }).await
    }

    pub async fn renew_torrent_preview_lease(
        &self,
        preview_id: &str,
        worker_id: &str,
        lease: Duration,
    ) -> DbResult<bool> {
        let preview_id = preview_id.to_owned();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            let changed = connection
                .execute(
                    "UPDATE torrent_previews SET lease_expires_at = ?, updated_at = ? \
                 WHERE id = ? AND status = 'resolving' AND worker_id = ? AND expires_at > ?",
                    params![future_iso(lease), now, preview_id, worker_id, now],
                )
                .map_err(DownloadError::database)?;
            Ok(changed == 1)
        })
        .await
    }

    pub async fn complete_torrent_preview(
        &self,
        preview: &TorrentPreview,
        worker_id: &str,
        resolved: &ResolvedTorrentPreview,
    ) -> DbResult<()> {
        let preview = preview.clone();
        let worker_id = worker_id.to_owned();
        let resolved = resolved.clone();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let changed = transaction.execute(
                "UPDATE torrent_previews SET status = 'ready', info_hash = ?, name = ?, metainfo = ?, \
                   total_bytes = ?, file_count = ?, is_private = 0, error = NULL, worker_id = NULL, \
                   lease_expires_at = NULL, updated_at = ? \
                 WHERE id = ? AND status = 'resolving' AND worker_id = ?",
                params![resolved.info_hash, resolved.name, resolved.metainfo,
                    i64_from(resolved.total_bytes)?, i64::try_from(resolved.files.len()).unwrap_or(i64::MAX),
                    now, preview.id, worker_id],
            ).map_err(DownloadError::database)?;
            ensure_owned(changed)?;
            transaction.execute("DELETE FROM torrent_preview_files WHERE preview_id = ?", [&preview.id])
                .map_err(DownloadError::database)?;
            {
                let mut insert = transaction.prepare(
                    "INSERT INTO torrent_preview_files (preview_id, file_index, path, size_bytes) VALUES (?, ?, ?, ?)"
                ).map_err(DownloadError::database)?;
                for file in resolved.files {
                    insert.execute(params![preview.id, i64::try_from(file.file_index).unwrap_or(i64::MAX),
                        file.path, i64_from(file.size_bytes)?]).map_err(DownloadError::database)?;
                }
            }
            transaction.commit().map_err(DownloadError::database)
        }).await
    }

    pub async fn fail_torrent_preview(
        &self,
        preview_id: &str,
        worker_id: &str,
        message: &str,
    ) -> DbResult<()> {
        let preview_id = preview_id.to_owned();
        let worker_id = worker_id.to_owned();
        let message = message.to_owned();
        self.call(move |connection| {
            let changed = connection
                .execute(
                    "UPDATE torrent_previews SET status = 'failed', error = ?, worker_id = NULL, \
                   lease_expires_at = NULL, updated_at = ? \
                 WHERE id = ? AND status = 'resolving' AND worker_id = ?",
                    params![message, now_iso(), preview_id, worker_id],
                )
                .map_err(DownloadError::database)?;
            ensure_owned(changed)
        })
        .await
    }

    /// 保留已确认字节；校验扫描量不进入下载进度。
    pub async fn torrent_checking(
        &self,
        task: &Task,
        worker_id: &str,
        lease: Duration,
        total_bytes: u64,
    ) -> DbResult<TorrentProgressUpdate> {
        let task_id = task.id.clone();
        let worker_id = worker_id.to_owned();
        let total = i64_from(total_bytes)?;
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let changed = transaction.execute(
                "UPDATE download_tasks SET phase = 'verifying', \
                   status = CASE WHEN content_completed_at IS NOT NULL THEN 'seeding' ELSE 'running' END, \
                   received_bytes = CASE WHEN content_completed_at IS NOT NULL THEN ? ELSE MIN(received_bytes, ?) END, \
                   total_bytes = ?, speed_bytes_per_second = 0, upload_speed_bytes_per_second = 0, peer_count = 0, \
                   lease_expires_at = ?, last_progress_at = ?, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ? AND control_requested IS NULL",
                params![total, total, total, future_iso(lease), now, now, task_id, worker_id],
            ).map_err(DownloadError::database)?;
            let outcome = torrent_progress_outcome(&transaction, changed, &task_id, &worker_id)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(outcome)
        }).await
    }

    pub async fn torrent_progress(
        &self,
        task: &Task,
        worker_id: &str,
        lease: Duration,
        progress: &TorrentProgress,
    ) -> DbResult<TorrentProgressUpdate> {
        let task_id = task.id.clone();
        let worker_id = worker_id.to_owned();
        let progress = progress.clone();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let changed = transaction.execute(
                "UPDATE download_tasks SET status = CASE WHEN ? THEN 'seeding' ELSE 'running' END, \
                   received_bytes = ?, total_bytes = ?, speed_bytes_per_second = ?, uploaded_bytes = ?, \
                   upload_speed_bytes_per_second = ?, peer_count = ?, phase = CASE WHEN ? THEN 'seeding' ELSE 'downloading' END, \
                   content_completed_at = CASE WHEN ? THEN COALESCE(content_completed_at, ?) ELSE content_completed_at END, \
                   seed_started_at = CASE WHEN ? THEN COALESCE(seed_started_at, ?) ELSE seed_started_at END, \
                   lease_expires_at = ?, last_progress_at = ?, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ? AND control_requested IS NULL",
                params![progress.seeding, i64_from(progress.received_bytes)?, i64_from(progress.total_bytes)?,
                    i64_from(progress.speed_bytes_per_second)?, i64_from(progress.uploaded_bytes)?,
                    i64_from(progress.upload_speed_bytes_per_second)?, i64::from(progress.peer_count), progress.seeding,
                    progress.seeding, now, progress.seeding, now, future_iso(lease), now, now, task_id, worker_id],
            ).map_err(DownloadError::database)?;
            if changed == 1 {
                transaction.execute(
                    "UPDATE download_space_reservations SET reserved_bytes = MAX(0, ? - ?), updated_at = ? WHERE task_id = ?",
                    params![i64_from(progress.total_bytes)?, i64_from(progress.received_bytes)?, now, task_id],
                ).map_err(DownloadError::database)?;
                let mut update = transaction.prepare(
                    "UPDATE download_task_files SET received_bytes = MIN(size_bytes, ?) WHERE task_id = ? AND file_index = ?"
                ).map_err(DownloadError::database)?;
                for (index, received) in progress.file_progress {
                    update.execute(params![i64_from(received)?, task_id, i64::try_from(index).unwrap_or(i64::MAX)])
                        .map_err(DownloadError::database)?;
                }
            }
            let outcome = torrent_progress_outcome(&transaction, changed, &task_id, &worker_id)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(outcome)
        }).await
    }

    pub async fn complete_torrent(&self, task: &Task, worker_id: &str) -> DbResult<()> {
        let task_id = task.id.clone();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            let changed = connection.execute(
                "UPDATE download_tasks SET status = 'completed', phase = NULL, worker_id = NULL, \
                   lease_expires_at = NULL, speed_bytes_per_second = 0, upload_speed_bytes_per_second = 0, \
                   peer_count = 0, control_requested = NULL, finished_at = ?, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ?",
                params![now, now, task_id, worker_id],
            ).map_err(DownloadError::database)?;
            ensure_owned(changed)
        }).await
    }

    pub async fn begin_torrent_publish(&self, task: &Task, worker_id: &str) -> DbResult<()> {
        let task_id = task.id.clone();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let changed = connection.execute(
                "UPDATE download_tasks SET phase = 'publishing', speed_bytes_per_second = 0, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL",
                params![now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            ensure_owned(changed)
        }).await
    }

    pub async fn publish_torrent(&self, task: &Task, worker_id: &str) -> DbResult<()> {
        let task = task.clone();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let operation_id = format!("download:{}", task.id);
            let metadata = serde_json::json!({
                "storagePoolId": task.storage_pool_id,
                "reversible": true,
                "sourceKind": task.source_kind,
                "infoHash": task.torrent_info_hash,
                "selectedFileCount": task.selected_file_count,
                "downloadMode": "torrent"
            });
            transaction.execute(
                "INSERT OR IGNORE INTO file_operations \
                   (id, operation, source_path, target_path, status, metadata_json, created_at, updated_at) \
                 VALUES (?, 'download', NULL, ?, 'applied', ?, ?, ?)",
                params![operation_id, task.target_path, metadata.to_string(), now, now],
            ).map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET status = 'seeding', phase = 'seeding', download_mode = 'torrent', \
                   received_bytes = COALESCE(total_bytes, received_bytes), speed_bytes_per_second = 0, \
                   content_completed_at = COALESCE(content_completed_at, ?), seed_started_at = COALESCE(seed_started_at, ?), \
                   file_operation_id = ?, last_progress_at = ?, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND phase = 'publishing' \
                   AND worker_id = ? AND control_requested IS NULL",
                params![now, now, operation_id, now, now, task.id, worker_id],
            ).map_err(DownloadError::database)?;
            ensure_owned(changed)?;
            transaction.execute(
                "DELETE FROM download_space_reservations WHERE task_id = ?",
                [&task.id],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "INSERT INTO index_queue \
                   (id, storage_pool_id, path, recursive, kind, generation, priority, status, created_at, updated_at) \
                 VALUES (?, ?, ?, 1, 'incremental', 1, 50, 'queued', ?, ?) \
                 ON CONFLICT(storage_pool_id, path) DO UPDATE SET generation = index_queue.generation + 1, \
                   recursive = 1, priority = MAX(index_queue.priority, 50), status = 'queued', retry_count = 0, \
                   next_retry_at = NULL, worker_id = NULL, lease_expires_at = NULL, error = NULL, error_code = NULL, \
                   updated_at = excluded.updated_at, finished_at = NULL",
                params![format!("{}-index", operation_id), task.storage_pool_id, task.target_path, now, now],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)
        }).await
    }
}

fn torrent_progress_outcome(
    transaction: &rusqlite::Transaction<'_>,
    changed: usize,
    task_id: &str,
    worker_id: &str,
) -> DbResult<TorrentProgressUpdate> {
    if changed == 1 {
        return Ok(TorrentProgressUpdate::Updated);
    }
    let controlled = transaction.query_row(
        "SELECT 1 FROM download_tasks WHERE id = ? AND worker_id = ? AND status IN ('running', 'seeding') AND control_requested IS NOT NULL",
        params![task_id, worker_id], |_| Ok(()),
    ).optional().map_err(DownloadError::database)?.is_some();
    Ok(if controlled {
        TorrentProgressUpdate::ControlPending
    } else {
        TorrentProgressUpdate::LeaseLost
    })
}
