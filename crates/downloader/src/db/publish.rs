/**
 * [INPUT]: 依赖父模块的 SQLite actor 和任务契约。
 * [OUTPUT]: 提供空间预留、发布 journal 和恢复。
 * [POS]: 作为 Db 的职责分区；共享所有权校验。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;

impl Db {
    pub async fn reserve_space(
        &self,
        task: &Task,
        required: u64,
        available: u64,
        minimum_free: u64,
    ) -> DbResult<()> {
        let task_id = task.id.clone();
        let pool_id = task.storage_pool_id.clone();
        let worker_id = task.worker_id.clone().unwrap_or_default();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let owned: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM download_tasks WHERE id = ? AND status = 'running' \
                 AND worker_id = ? AND control_requested IS NULL)",
                params![task_id, worker_id],
                |row| row.get(0),
            ).map_err(DownloadError::database)?;
            if !owned {
                return Err(lease_lost());
            }
            let other: i64 = transaction.query_row(
                "SELECT COALESCE(SUM(reserved_bytes), 0) FROM download_space_reservations WHERE storage_pool_id = ? AND task_id <> ?",
                params![pool_id, task_id], |row| row.get(0),
            ).map_err(DownloadError::database)?;
            let needed = required.saturating_add(minimum_free).saturating_add(other.max(0) as u64);
            if needed > available {
                return Err(DownloadError::new(ErrorCode::DiskSpace, "not enough unreserved disk space for download", false));
            }
            transaction.execute(
                "INSERT INTO download_space_reservations (task_id, storage_pool_id, reserved_bytes, updated_at) VALUES (?, ?, ?, ?) \
                 ON CONFLICT(task_id) DO UPDATE SET storage_pool_id = excluded.storage_pool_id, reserved_bytes = excluded.reserved_bytes, updated_at = excluded.updated_at",
                params![task_id, pool_id, i64_from(required)?, now_iso()],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn begin_publish(&self, journal: PublishJournal) -> DbResult<()> {
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET phase = 'publishing', actual_sha256 = ?, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL",
                params![journal.sha256, now_iso(), journal.task_id, journal.worker_id],
            ).map_err(DownloadError::database)?;
            if changed != 1 {
                return Err(DownloadError::new(
                    ErrorCode::Internal,
                    "download task lease was lost before publication",
                    false,
                ));
            }
            transaction.execute(
                "INSERT INTO download_publish_journal \
                 (task_id, operation_id, worker_id, device, inode, size_bytes, sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) \
                 ON CONFLICT(task_id) DO UPDATE SET operation_id = excluded.operation_id, worker_id = excluded.worker_id, \
                   device = excluded.device, inode = excluded.inode, size_bytes = excluded.size_bytes, \
                   sha256 = excluded.sha256, created_at = excluded.created_at",
                params![journal.task_id, journal.operation_id, journal.worker_id, i64_from(journal.device)?,
                    i64_from(journal.inode)?, i64_from(journal.size_bytes)?, journal.sha256, now_iso()],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn journals(&self) -> DbResult<Vec<PublishJournal>> {
        self.call(|connection| {
            let mut statement = connection.prepare(
                "SELECT task_id, operation_id, worker_id, device, inode, size_bytes, sha256 FROM download_publish_journal"
            ).map_err(DownloadError::database)?;
            let rows = statement.query_map([], |row| Ok(PublishJournal {
                task_id: row.get(0)?, operation_id: row.get(1)?, worker_id: row.get(2)?,
                device: row.get::<_, i64>(3)? as u64, inode: row.get::<_, i64>(4)? as u64,
                size_bytes: row.get::<_, i64>(5)? as u64, sha256: row.get(6)?,
            })).map_err(DownloadError::database)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(DownloadError::database)
        }).await
    }

    pub async fn finalize_publish(
        &self,
        journal: &PublishJournal,
        task: &Task,
        mode: &str,
    ) -> DbResult<()> {
        let journal = journal.clone();
        let task = task.clone();
        let mode = mode.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let journal_matches: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM download_publish_journal \
                 WHERE task_id = ? AND operation_id = ? AND worker_id = ? AND device = ? AND inode = ? AND size_bytes = ?)",
                params![journal.task_id, journal.operation_id, journal.worker_id,
                    i64_from(journal.device)?, i64_from(journal.inode)?, i64_from(journal.size_bytes)?],
                |row| row.get(0),
            ).map_err(DownloadError::database)?;
            if !journal_matches {
                let already_completed: bool = transaction.query_row(
                    "SELECT EXISTS(SELECT 1 FROM download_tasks WHERE id = ? AND status = 'completed' AND file_operation_id = ?)",
                    params![journal.task_id, journal.operation_id],
                    |row| row.get(0),
                ).map_err(DownloadError::database)?;
                if already_completed {
                    return Ok(());
                }
                return Err(DownloadError::database(
                    "download publish journal no longer matches the finishing worker",
                ));
            }
            let metadata = serde_json::json!({
                "storagePoolId": task.storage_pool_id,
                "reversible": true,
                "url": task.url,
                "sizeBytes": journal.size_bytes,
                "sha256": journal.sha256,
                "downloadMode": mode
            });
            transaction.execute(
                "INSERT OR IGNORE INTO file_operations (id, operation, source_path, target_path, status, metadata_json, created_at, updated_at) \
                 VALUES (?, 'download', NULL, ?, 'applied', ?, ?, ?)",
                params![journal.operation_id, task.target_path, metadata.to_string(), now, now],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "UPDATE download_tasks SET status = 'completed', received_bytes = ?, total_bytes = ?, speed_bytes_per_second = 0, \
                   worker_id = NULL, lease_expires_at = NULL, error = NULL, error_code = NULL, error_retryable = 0, \
                   phase = NULL, control_requested = NULL, next_retry_at = NULL, actual_sha256 = ?, finished_at = ?, \
                   last_progress_at = ?, file_operation_id = ?, updated_at = ? WHERE id = ?",
                params![i64_from(journal.size_bytes)?, i64_from(journal.size_bytes)?, journal.sha256, now, now,
                    journal.operation_id, now, journal.task_id],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "INSERT INTO index_queue (id, storage_pool_id, path, recursive, kind, generation, priority, status, created_at, updated_at) \
                 VALUES (?, ?, ?, 0, 'incremental', 1, 50, 'queued', ?, ?) \
                 ON CONFLICT(storage_pool_id, path) DO UPDATE SET \
                   generation = index_queue.generation + 1, priority = MAX(index_queue.priority, 50), status = 'queued', \
                   retry_count = 0, next_retry_at = NULL, worker_id = NULL, lease_expires_at = NULL, \
                   error = NULL, error_code = NULL, updated_at = excluded.updated_at, finished_at = NULL",
                params![format!("{}-index", journal.operation_id), task.storage_pool_id, task.target_path, now, now],
            ).map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_publish_journal WHERE task_id = ?", [&journal.task_id])
                .map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_segments WHERE task_id = ?", [&journal.task_id])
                .map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_space_reservations WHERE task_id = ?", [&journal.task_id])
                .map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn recover_unpublished(&self, task_id: &str) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let now = now_iso();
            let changed = transaction.execute(
                "UPDATE download_tasks SET \
                   status = CASE control_requested WHEN 'pause' THEN 'paused' WHEN 'cancel' THEN 'cancelled' ELSE 'queued' END, \
                   phase = NULL, worker_id = NULL, lease_expires_at = NULL, speed_bytes_per_second = 0, \
                   control_requested = NULL, finished_at = CASE WHEN control_requested = 'cancel' THEN ? ELSE NULL END, updated_at = ? \
                 WHERE id = ? AND NOT (status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at > ?)",
                params![now, now, task_id, now],
            ).map_err(DownloadError::database)?;
            if changed == 1 {
                transaction.execute("DELETE FROM download_publish_journal WHERE task_id = ?", [&task_id])
                    .map_err(DownloadError::database)?;
            }
            transaction.commit().map_err(DownloadError::database)?;
            Ok(changed == 1)
        }).await
    }

    pub async fn fail_recovery(&self, task_id: &str, code: &str, message: &str) -> DbResult<()> {
        let task_id = task_id.to_owned();
        let code = code.to_owned();
        let message = message.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_publish_journal WHERE task_id = ?", [&task_id])
                .map_err(DownloadError::database)?;
            transaction.execute(
                "UPDATE download_tasks SET status = 'failed', phase = NULL, error = ?, error_code = ?, error_retryable = 0, \
                   worker_id = NULL, lease_expires_at = NULL, finished_at = ?, updated_at = ? WHERE id = ?",
                params![message, code, now_iso(), now_iso(), task_id],
            ).map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_space_reservations WHERE task_id = ?", [&task_id])
                .map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }
}
