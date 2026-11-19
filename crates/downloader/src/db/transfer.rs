/**
 * [INPUT]: 依赖父模块的 SQLite actor 和任务契约。
 * [OUTPUT]: 提供HTTP 检查点、阶段与分段。
 * [POS]: 作为 Db 的职责分区；共享所有权校验。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
use super::*;

impl Db {
    pub async fn progress(
        &self,
        task_id: &str,
        worker_id: &str,
        lease: Duration,
        progress: Progress<'_>,
    ) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        let etag = progress.etag.map(ToOwned::to_owned);
        let last_modified = progress.last_modified.map(ToOwned::to_owned);
        let phase = progress.phase.to_owned();
        let mode = progress.mode.to_owned();
        let received = i64_from(progress.received_bytes)?;
        let total = progress.total_bytes.map(i64_from).transpose()?;
        let speed = i64_from(progress.speed_bytes_per_second)?;
        let segment_count = i64::from(progress.segment_count);
        self.call(move |connection| {
            let changed = connection.execute(
                "UPDATE download_tasks SET received_bytes = ?, total_bytes = ?, speed_bytes_per_second = ?, \
                   etag = COALESCE(?, etag), last_modified = COALESCE(?, last_modified), phase = ?, \
                   download_mode = ?, segment_count = ?, lease_expires_at = ?, last_progress_at = ?, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL",
                params![received, total, speed, etag, last_modified, phase, mode, segment_count,
                    future_iso(lease), now_iso(), now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            Ok(changed == 1)
        }).await
    }

    pub async fn renew_phase(
        &self,
        task_id: &str,
        worker_id: &str,
        phase: &str,
        lease: Duration,
    ) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        let phase = phase.to_owned();
        self.call(move |connection| {
            let changed = connection.execute(
                "UPDATE download_tasks SET phase = ?, lease_expires_at = ?, last_progress_at = ?, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL",
                params![phase, future_iso(lease), now_iso(), now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            Ok(changed == 1)
        }).await
    }

    pub async fn segments(&self, task_id: &str) -> DbResult<Vec<Segment>> {
        let task_id = task_id.to_owned();
        self.call(move |connection| {
            let mut statement = connection.prepare(
                "SELECT start_byte, end_byte, next_byte FROM download_segments WHERE task_id = ? ORDER BY start_byte"
            ).map_err(DownloadError::database)?;
            let rows = statement.query_map([task_id], |row| {
                Ok(Segment {
                    start: row.get::<_, i64>(0)? as u64,
                    end: row.get::<_, i64>(1)? as u64,
                    next: row.get::<_, i64>(2)? as u64,
                })
            }).map_err(DownloadError::database)?;
            rows.collect::<Result<Vec<_>, _>>().map_err(DownloadError::database)
        }).await
    }

    pub async fn reset_transfer(&self, task_id: &str, worker_id: &str) -> DbResult<()> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET received_bytes = 0, total_bytes = NULL, speed_bytes_per_second = 0, \
                   etag = NULL, last_modified = NULL, actual_sha256 = NULL, download_mode = NULL, segment_count = 0, \
                   phase = 'probing', updated_at = ? WHERE id = ? AND status = 'running' AND worker_id = ? \
                   AND control_requested IS NULL",
                params![now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            ensure_owned(changed)?;
            transaction.execute("DELETE FROM download_segments WHERE task_id = ?", [&task_id])
                .map_err(DownloadError::database)?;
            transaction.execute("DELETE FROM download_space_reservations WHERE task_id = ?", [&task_id])
                .map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn set_actual_checksum(
        &self,
        task_id: &str,
        worker_id: &str,
        checksum: &str,
    ) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        let checksum = checksum.to_owned();
        self.call(move |connection| {
            let changed = connection.execute(
                "UPDATE download_tasks SET phase = 'verifying', actual_sha256 = ?, updated_at = ? \
                 WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL",
                params![checksum, now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            Ok(changed == 1)
        })
        .await
    }

    pub async fn replace_segments(
        &self,
        task_id: &str,
        worker_id: &str,
        segments: &[Segment],
    ) -> DbResult<()> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        let segments = segments.to_vec();
        self.call(move |connection| {
            // Wait for the writer before reading ownership; a WAL read-to-write
            // upgrade can otherwise bypass busy_timeout during normal writes.
            let transaction = connection
                .transaction_with_behavior(TransactionBehavior::Immediate)
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
            transaction.execute("DELETE FROM download_segments WHERE task_id = ?", [&task_id])
                .map_err(DownloadError::database)?;
            let now = now_iso();
            {
                let mut insert = transaction.prepare(
                    "INSERT INTO download_segments (task_id, start_byte, end_byte, next_byte, updated_at) VALUES (?, ?, ?, ?, ?)"
                ).map_err(DownloadError::database)?;
                for segment in &segments {
                    insert.execute(params![task_id, i64_from(segment.start)?, i64_from(segment.end)?, i64_from(segment.next)?, now])
                        .map_err(DownloadError::database)?;
                }
            }
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn checkpoint_segment(
        &self,
        task_id: &str,
        worker_id: &str,
        checkpoint: SegmentCheckpoint,
        lease: Duration,
    ) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction_with_behavior(TransactionBehavior::Immediate)
                .map_err(DownloadError::database)?;
            let owned: bool = transaction.query_row(
                "SELECT EXISTS(SELECT 1 FROM download_tasks WHERE id = ? AND status = 'running' AND worker_id = ? AND control_requested IS NULL)",
                params![task_id, worker_id], |row| row.get(0),
            ).map_err(DownloadError::database)?;
            if !owned {
                return Ok(false);
            }
            transaction.execute(
                "UPDATE download_segments SET next_byte = ?, updated_at = ? WHERE task_id = ? AND start_byte = ?",
                params![i64_from(checkpoint.next)?, now_iso(), task_id, i64_from(checkpoint.start)?],
            ).map_err(DownloadError::database)?;
            let received: i64 = transaction.query_row(
                "SELECT COALESCE(SUM(next_byte - start_byte), 0) FROM download_segments WHERE task_id = ?",
                [&task_id], |row| row.get(0),
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "UPDATE download_tasks SET received_bytes = ?, total_bytes = ?, speed_bytes_per_second = ?, \
                   phase = 'downloading', download_mode = 'segmented', \
                   lease_expires_at = ?, last_progress_at = ?, updated_at = ? WHERE id = ? AND worker_id = ?",
                params![received, i64_from(checkpoint.total)?, i64_from(checkpoint.speed_bytes_per_second)?, future_iso(lease),
                    now_iso(), now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "UPDATE download_space_reservations SET reserved_bytes = MAX(0, ? - ?), updated_at = ? WHERE task_id = ?",
                params![i64_from(checkpoint.total)?, received, now_iso(), task_id],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(true)
        }).await
    }
}
