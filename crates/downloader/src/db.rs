/**
 * [INPUT]: 依赖 rusqlite 和 Tokio 消息通道。
 * [OUTPUT]: 提供下载任务、worker 租约与 SQLite actor。
 * [POS]: 统一队列和控制；细分持久化交给子模块。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
mod publish;
#[cfg(test)]
mod test_schema;
mod torrent;
mod transfer;
#[cfg(test)]
pub(crate) use test_schema::TEST_SCHEMA;
#[cfg(test)]
mod tests;
#[cfg(test)]
mod torrent_tests;

use std::path::Path;
use std::sync::mpsc;
use std::time::Duration;

use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Deserialize;
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;
use tokio::sync::oneshot;

use crate::error::{DownloadError, ErrorCode};

type DbResult<T> = Result<T, DownloadError>;
type DbJob = Box<dyn FnOnce(&mut Connection) + Send + 'static>;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TorrentProgressUpdate {
    Updated,
    ControlPending,
    LeaseLost,
}

const TASK_COLUMNS: &str = "
  d.id, d.url, d.storage_pool_id, d.target_directory,
  d.target_file_name, d.target_path, d.partial_path, d.status,
  d.received_bytes, d.total_bytes, d.speed_bytes_per_second,
  d.etag, d.last_modified, d.worker_id, d.lease_expires_at,
  d.phase, d.download_mode, d.expected_sha256, d.actual_sha256,
  d.retry_count, d.next_retry_at, d.control_requested, d.segment_count,
  d.source_kind, d.torrent_info_hash, d.torrent_name, d.torrent_metainfo,
  d.selected_file_count, d.uploaded_bytes, d.upload_speed_bytes_per_second,
  d.peer_count, d.seed_ratio_limit, d.seed_time_limit_seconds,
  d.content_completed_at, d.seed_started_at, d.engine_torrent_id
";

#[derive(Clone)]
pub struct Db {
    sender: mpsc::Sender<DbJob>,
}

#[derive(Debug, Clone)]
pub struct Task {
    pub id: String,
    pub url: String,
    pub storage_pool_id: String,
    pub target_directory: String,
    pub target_file_name: String,
    pub target_path: String,
    pub partial_path: String,
    pub status: String,
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: u64,
    pub etag: Option<String>,
    pub last_modified: Option<String>,
    pub worker_id: Option<String>,
    pub lease_expires_at: Option<String>,
    pub phase: Option<String>,
    pub download_mode: Option<String>,
    pub expected_sha256: Option<String>,
    pub actual_sha256: Option<String>,
    pub retry_count: u32,
    pub next_retry_at: Option<String>,
    pub control_requested: Option<String>,
    pub segment_count: u32,
    pub source_kind: String,
    pub torrent_info_hash: Option<String>,
    pub torrent_name: Option<String>,
    pub torrent_metainfo: Option<Vec<u8>>,
    pub selected_file_count: u32,
    pub selected_file_indices: Vec<usize>,
    pub uploaded_bytes: u64,
    pub upload_speed_bytes_per_second: u64,
    pub peer_count: u32,
    pub seed_ratio_limit: f64,
    pub seed_time_limit_seconds: u64,
    pub content_completed_at: Option<String>,
    pub seed_started_at: Option<String>,
    pub engine_torrent_id: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Segment {
    pub start: u64,
    pub end: u64,
    pub next: u64,
}

#[derive(Debug, Clone, Copy)]
pub struct SegmentCheckpoint {
    pub start: u64,
    pub next: u64,
    pub total: u64,
    pub speed_bytes_per_second: u64,
}

#[derive(Debug, Clone)]
pub struct PublishJournal {
    pub task_id: String,
    pub operation_id: String,
    pub worker_id: String,
    pub device: u64,
    pub inode: u64,
    pub size_bytes: u64,
    pub sha256: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct DownloadSettings {
    pub concurrency: usize,
    pub bt_concurrency: usize,
    pub parallel_requests_per_task: usize,
    pub segmented_download_min_bytes: u64,
    pub max_auto_retries: u32,
    pub retry_base_delay_ms: u64,
    pub retry_max_delay_ms: u64,
    pub retry_after_max_delay_ms: u64,
    pub connect_timeout_ms: u64,
    pub response_header_timeout_ms: u64,
    pub read_idle_timeout_ms: u64,
    pub min_free_space_bytes: u64,
    pub max_file_size_bytes: Option<u64>,
}

impl Default for DownloadSettings {
    fn default() -> Self {
        Self {
            concurrency: 1,
            bt_concurrency: 3,
            parallel_requests_per_task: 4,
            segmented_download_min_bytes: 64 * 1024 * 1024,
            max_auto_retries: 5,
            retry_base_delay_ms: 2_000,
            retry_max_delay_ms: 300_000,
            retry_after_max_delay_ms: 900_000,
            connect_timeout_ms: 15_000,
            response_header_timeout_ms: 30_000,
            read_idle_timeout_ms: 60_000,
            min_free_space_bytes: 0,
            max_file_size_bytes: None,
        }
    }
}

impl DownloadSettings {
    fn validate(self) -> DbResult<Self> {
        validate_range("concurrency", self.concurrency as u64, 1, 10)?;
        validate_range("btConcurrency", self.bt_concurrency as u64, 1, 10)?;
        validate_range(
            "parallelRequestsPerTask",
            self.parallel_requests_per_task as u64,
            1,
            8,
        )?;
        validate_range(
            "segmentedDownloadMinBytes",
            self.segmented_download_min_bytes,
            1024 * 1024,
            1024_u64.pow(4),
        )?;
        validate_range("maxAutoRetries", u64::from(self.max_auto_retries), 0, 20)?;
        validate_range("retryBaseDelayMs", self.retry_base_delay_ms, 500, 60_000)?;
        validate_range(
            "retryMaxDelayMs",
            self.retry_max_delay_ms,
            self.retry_base_delay_ms,
            1_800_000,
        )?;
        validate_range(
            "retryAfterMaxDelayMs",
            self.retry_after_max_delay_ms,
            1_000,
            3_600_000,
        )?;
        validate_range("connectTimeoutMs", self.connect_timeout_ms, 1_000, 120_000)?;
        validate_range(
            "responseHeaderTimeoutMs",
            self.response_header_timeout_ms,
            5_000,
            300_000,
        )?;
        validate_range(
            "readIdleTimeoutMs",
            self.read_idle_timeout_ms,
            5_000,
            900_000,
        )?;
        if self.max_file_size_bytes == Some(0) {
            return Err(invalid_setting("maxFileSizeBytes"));
        }
        Ok(self)
    }
}

#[derive(Debug, Clone)]
pub struct Progress<'a> {
    pub received_bytes: u64,
    pub total_bytes: Option<u64>,
    pub speed_bytes_per_second: u64,
    pub etag: Option<&'a str>,
    pub last_modified: Option<&'a str>,
    pub phase: &'a str,
    pub mode: &'a str,
    pub segment_count: u32,
}

#[derive(Debug, Clone)]
pub struct TorrentProgress {
    pub received_bytes: u64,
    pub total_bytes: u64,
    pub speed_bytes_per_second: u64,
    pub uploaded_bytes: u64,
    pub upload_speed_bytes_per_second: u64,
    pub peer_count: u32,
    pub file_progress: Vec<(usize, u64)>,
    pub seeding: bool,
}

#[derive(Debug, Clone)]
pub struct TorrentPreview {
    pub id: String,
    pub source_kind: String,
    pub source_uri: Option<String>,
    pub metainfo: Option<Vec<u8>>,
}

#[derive(Debug, Clone)]
pub struct TorrentFile {
    pub file_index: usize,
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone)]
pub struct ResolvedTorrentPreview {
    pub info_hash: String,
    pub name: String,
    pub metainfo: Vec<u8>,
    pub total_bytes: u64,
    pub files: Vec<TorrentFile>,
}

impl Db {
    pub fn open(path: &Path) -> DbResult<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).map_err(DownloadError::storage)?;
        }
        let connection = Connection::open(path).map_err(DownloadError::database)?;
        connection
            .pragma_update(None, "journal_mode", "WAL")
            .map_err(DownloadError::database)?;
        connection
            .pragma_update(None, "foreign_keys", "ON")
            .map_err(DownloadError::database)?;
        connection
            .pragma_update(None, "busy_timeout", 30_000)
            .map_err(DownloadError::database)?;
        connection
            .pragma_update(None, "synchronous", "FULL")
            .map_err(DownloadError::database)?;
        let (sender, receiver) = mpsc::channel::<DbJob>();
        std::thread::Builder::new()
            .name("cyberos-downloader-db".to_owned())
            .spawn(move || {
                let mut connection = connection;
                while let Ok(job) = receiver.recv() {
                    job(&mut connection);
                }
            })
            .map_err(DownloadError::storage)?;
        Ok(Self { sender })
    }

    async fn call<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> DbResult<T> + Send + 'static,
    {
        let (sender, receiver) = oneshot::channel();
        self.sender
            .send(Box::new(move |connection| {
                let _ = sender.send(operation(connection));
            }))
            .map_err(|_| DownloadError::database("database thread stopped"))?;
        receiver
            .await
            .map_err(|_| DownloadError::database("database response channel closed"))?
    }

    #[cfg(test)]
    pub(crate) async fn test_call<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut Connection) -> DbResult<T> + Send + 'static,
    {
        self.call(operation).await
    }

    pub async fn wait_for_schema(&self, timeout: Duration) -> DbResult<()> {
        let started = tokio::time::Instant::now();
        loop {
            let ready = self
                .call(|connection| {
                    let found: Option<i64> = connection
                        .query_row(
                            "SELECT 1 FROM schema_migrations WHERE id = '001_cyberos_2_0'",
                            [],
                            |row| row.get(0),
                        )
                        .optional()
                        .unwrap_or(None);
                    Ok(found.is_some())
                })
                .await
                .unwrap_or(false);
            if ready {
                return Ok(());
            }
            if started.elapsed() >= timeout {
                return Err(DownloadError::new(
                    ErrorCode::Database,
                    "CyberOS 2.0 database schema is not available",
                    true,
                ));
            }
            tokio::time::sleep(Duration::from_secs(1)).await;
        }
    }

    pub async fn settings(&self) -> DbResult<DownloadSettings> {
        self.call(|connection| {
            let json: Option<String> = connection
                .query_row(
                    "SELECT value_json FROM system_settings WHERE key = 'download_settings'",
                    [],
                    |row| row.get(0),
                )
                .optional()
                .map_err(DownloadError::database)?;
            match json {
                Some(json) => serde_json::from_str::<DownloadSettings>(&json)
                    .map_err(|error| {
                        DownloadError::new(
                            ErrorCode::Database,
                            format!("invalid download settings: {error}"),
                            false,
                        )
                    })?
                    .validate(),
                None => Ok(DownloadSettings::default()),
            }
        })
        .await
    }

    pub async fn register_worker(&self, worker_id: &str, version: &str) -> DbResult<()> {
        let worker_id = worker_id.to_owned();
        let version = version.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            connection.execute(
                "INSERT INTO download_workers (worker_id, version, started_at, heartbeat_at) VALUES (?, ?, ?, ?) \
                 ON CONFLICT(worker_id) DO UPDATE SET version = excluded.version, started_at = excluded.started_at, heartbeat_at = excluded.heartbeat_at",
                params![worker_id, version, now, now],
            ).map_err(DownloadError::database)?;
            connection.execute("DELETE FROM download_workers WHERE heartbeat_at < ?", [ago_iso(Duration::from_secs(300))])
                .map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn heartbeat_worker(&self, worker_id: &str) -> DbResult<()> {
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            connection
                .execute(
                    "UPDATE download_workers SET heartbeat_at = ? WHERE worker_id = ?",
                    params![now_iso(), worker_id],
                )
                .map_err(DownloadError::database)?;
            Ok(())
        })
        .await
    }

    pub async fn extend_lease(
        &self,
        task_id: &str,
        worker_id: &str,
        lease: Duration,
    ) -> DbResult<bool> {
        let task_id = task_id.to_owned();
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let changed = connection
                .execute(
                    "UPDATE download_tasks SET lease_expires_at = ?, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ? AND control_requested IS NULL",
                    params![future_iso(lease), now_iso(), task_id, worker_id],
                )
                .map_err(DownloadError::database)?;
            Ok(changed == 1)
        })
        .await
    }

    pub async fn remove_worker(&self, worker_id: &str) -> DbResult<()> {
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            connection
                .execute(
                    "DELETE FROM download_workers WHERE worker_id = ?",
                    [worker_id],
                )
                .map_err(DownloadError::database)?;
            Ok(())
        })
        .await
    }

    pub async fn recover_expired(&self) -> DbResult<usize> {
        self.call(|connection| {
            let now = now_iso();
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET \
                   status = CASE control_requested WHEN 'pause' THEN 'paused' WHEN 'cancel' THEN 'cancelled' \
                     ELSE CASE status WHEN 'seeding' THEN 'seeding' ELSE 'queued' END END, \
                   worker_id = NULL, lease_expires_at = NULL, speed_bytes_per_second = 0, \
                   upload_speed_bytes_per_second = 0, peer_count = 0, \
                   phase = CASE WHEN status = 'seeding' THEN 'seeding' \
                     WHEN source_kind <> 'http' AND phase = 'publishing' THEN 'publishing' ELSE NULL END, \
                   control_requested = NULL, finished_at = CASE WHEN control_requested = 'cancel' THEN ? ELSE NULL END, updated_at = ? \
                 WHERE status IN ('running', 'seeding') AND (lease_expires_at IS NULL OR lease_expires_at <= ?) \
                   AND NOT EXISTS (SELECT 1 FROM download_publish_journal j WHERE j.task_id = download_tasks.id)",
                params![now, now, now],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "DELETE FROM download_space_reservations WHERE task_id IN (SELECT id FROM download_tasks WHERE status <> 'running')",
                [],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(changed)
        }).await
    }

    pub async fn running_count(&self) -> DbResult<usize> {
        self.call(|connection| {
            let count: i64 = connection
                .query_row(
                    "SELECT COUNT(*) FROM download_tasks WHERE status = 'running' AND source_kind = 'http'",
                    [],
                    |row| row.get(0),
                )
                .map_err(DownloadError::database)?;
            Ok(count.max(0) as usize)
        })
        .await
    }

    pub async fn claim(&self, worker_id: &str, lease: Duration) -> DbResult<Option<Task>> {
        let limit = self.settings().await?.concurrency as i64;
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let now = now_iso();
            let lease_expires = future_iso(lease);
            let sql = format!("\
                UPDATE download_tasks SET status = 'running', worker_id = ?1, lease_expires_at = ?2, \
                  started_at = COALESCE(started_at, ?3), finished_at = NULL, error = NULL, error_code = NULL, \
                  error_retryable = 0, phase = 'probing', next_retry_at = NULL, control_requested = NULL, updated_at = ?3 \
                WHERE id = (SELECT id FROM download_tasks WHERE status = 'queued' AND source_kind = 'http' \
                  AND (next_retry_at IS NULL OR next_retry_at <= ?3) \
                  AND (SELECT COUNT(*) FROM download_tasks active \
                    WHERE active.status = 'running' AND active.source_kind = 'http') < ?4 \
                  AND NOT EXISTS (SELECT 1 FROM download_publish_journal j WHERE j.task_id = download_tasks.id) \
                  ORDER BY COALESCE(next_retry_at, created_at), created_at LIMIT 1) \
                AND status = 'queued' \
                RETURNING {}", TASK_COLUMNS.replace("d.", ""));
            connection.query_row(&sql, params![worker_id, lease_expires, now, limit], map_task)
                .optional().map_err(DownloadError::database)
        }).await
    }

    pub async fn get_task(&self, task_id: &str) -> DbResult<Option<Task>> {
        let task_id = task_id.to_owned();
        self.call(move |connection| {
            let sql = format!("SELECT {TASK_COLUMNS} FROM download_tasks d WHERE d.id = ?");
            connection
                .query_row(&sql, [task_id], map_task)
                .optional()
                .map_err(DownloadError::database)
        })
        .await
    }

    pub async fn finish_control(&self, task: &Task, cancelled: bool) -> DbResult<()> {
        let task_id = task.id.clone();
        let worker_id = task.worker_id.clone().unwrap_or_default();
        self.call(move |connection| {
            let status = if cancelled { "cancelled" } else { "paused" };
            let now = now_iso();
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET status = ?, phase = NULL, control_requested = NULL, worker_id = NULL, lease_expires_at = NULL, \
                   speed_bytes_per_second = 0, upload_speed_bytes_per_second = 0, peer_count = 0, \
                   finished_at = CASE WHEN ? THEN ? ELSE NULL END, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ?",
                params![status, cancelled, now, now, task_id, worker_id],
            ).map_err(DownloadError::database)?;
            if changed == 1 {
                transaction.execute("DELETE FROM download_space_reservations WHERE task_id = ?", [task_id])
                    .map_err(DownloadError::database)?;
            }
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }

    pub async fn fail_or_retry(
        &self,
        task: &Task,
        error: &DownloadError,
        settings: &DownloadSettings,
        retry_delay: Option<Duration>,
    ) -> DbResult<bool> {
        let task_id = task.id.clone();
        let worker_id = task.worker_id.clone().unwrap_or_default();
        let code = error.code.as_str().to_owned();
        let message = error.message.clone();
        let error_retryable = error.retryable;
        let retry = error.retryable
            && task.retry_count < settings.max_auto_retries
            && retry_delay.is_some();
        let next_retry_at = retry_delay.map(future_iso);
        self.call(move |connection| {
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            let changed = transaction.execute(
                "UPDATE download_tasks SET status = ?, \
                   phase = CASE WHEN source_kind <> 'http' AND phase = 'publishing' THEN 'publishing' ELSE ? END, \
                   error = ?, error_code = ?, error_retryable = ?, \
                   retry_count = retry_count + ?, next_retry_at = ?, worker_id = NULL, lease_expires_at = NULL, \
                   speed_bytes_per_second = 0, upload_speed_bytes_per_second = 0, peer_count = 0, \
                   control_requested = NULL, finished_at = ?, updated_at = ? \
                 WHERE id = ? AND status IN ('running', 'seeding') AND worker_id = ?",
                params![if retry { "queued" } else { "failed" }, if retry { Some("retry_wait") } else { None },
                    message, code, error_retryable, if retry { 1 } else { 0 }, next_retry_at,
                    if retry { None } else { Some(now_iso()) }, now_iso(), task_id, worker_id],
            ).map_err(DownloadError::database)?;
            if changed == 1 {
                transaction.execute("DELETE FROM download_space_reservations WHERE task_id = ?", [&task_id])
                    .map_err(DownloadError::database)?;
            }
            transaction.commit().map_err(DownloadError::database)?;
            Ok(retry && changed == 1)
        }).await
    }

    pub async fn requeue_owned(&self, worker_id: &str) -> DbResult<()> {
        let worker_id = worker_id.to_owned();
        self.call(move |connection| {
            let transaction = connection.transaction().map_err(DownloadError::database)?;
            let now = now_iso();
            transaction.execute(
                "UPDATE download_tasks SET \
                   status = CASE control_requested WHEN 'pause' THEN 'paused' WHEN 'cancel' THEN 'cancelled' \
                     ELSE CASE status WHEN 'seeding' THEN 'seeding' ELSE 'queued' END END, \
                   phase = CASE WHEN status = 'seeding' THEN 'seeding' \
                     WHEN source_kind <> 'http' AND phase = 'publishing' THEN 'publishing' ELSE NULL END, \
                   worker_id = NULL, lease_expires_at = NULL, speed_bytes_per_second = 0, \
                   upload_speed_bytes_per_second = 0, peer_count = 0, \
                   control_requested = NULL, finished_at = CASE WHEN control_requested = 'cancel' THEN ? ELSE NULL END, updated_at = ? \
                 WHERE status IN ('running', 'seeding') AND worker_id = ?",
                params![now, now, worker_id],
            ).map_err(DownloadError::database)?;
            transaction.execute(
                "DELETE FROM download_space_reservations WHERE task_id IN (SELECT id FROM download_tasks WHERE worker_id IS NULL)",
                [],
            ).map_err(DownloadError::database)?;
            transaction.commit().map_err(DownloadError::database)?;
            Ok(())
        }).await
    }
}

fn map_task(row: &rusqlite::Row<'_>) -> rusqlite::Result<Task> {
    Ok(Task {
        id: row.get(0)?,
        url: row.get(1)?,
        storage_pool_id: row.get(2)?,
        target_directory: row.get(3)?,
        target_file_name: row.get(4)?,
        target_path: row.get(5)?,
        partial_path: row.get(6)?,
        status: row.get(7)?,
        received_bytes: row.get::<_, i64>(8)?.max(0) as u64,
        total_bytes: row
            .get::<_, Option<i64>>(9)?
            .map(|value| value.max(0) as u64),
        speed_bytes_per_second: row.get::<_, i64>(10)?.max(0) as u64,
        etag: row.get(11)?,
        last_modified: row.get(12)?,
        worker_id: row.get(13)?,
        lease_expires_at: row.get(14)?,
        phase: row.get(15)?,
        download_mode: row.get(16)?,
        expected_sha256: row.get(17)?,
        actual_sha256: row.get(18)?,
        retry_count: row.get::<_, i64>(19)?.max(0) as u32,
        next_retry_at: row.get(20)?,
        control_requested: row.get(21)?,
        segment_count: row.get::<_, i64>(22)?.max(0) as u32,
        source_kind: row.get(23)?,
        torrent_info_hash: row.get(24)?,
        torrent_name: row.get(25)?,
        torrent_metainfo: row.get(26)?,
        selected_file_count: row.get::<_, i64>(27)?.max(0) as u32,
        selected_file_indices: Vec::new(),
        uploaded_bytes: row.get::<_, i64>(28)?.max(0) as u64,
        upload_speed_bytes_per_second: row.get::<_, i64>(29)?.max(0) as u64,
        peer_count: row.get::<_, i64>(30)?.max(0) as u32,
        seed_ratio_limit: row.get(31)?,
        seed_time_limit_seconds: row.get::<_, i64>(32)?.max(0) as u64,
        content_completed_at: row.get(33)?,
        seed_started_at: row.get(34)?,
        engine_torrent_id: row.get(35)?,
    })
}

fn ensure_owned(changed: usize) -> DbResult<()> {
    if changed == 1 {
        Ok(())
    } else {
        Err(lease_lost())
    }
}

fn lease_lost() -> DownloadError {
    DownloadError::new(
        ErrorCode::Internal,
        "download task lease or control ownership was lost",
        false,
    )
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .expect("RFC3339 formatting cannot fail")
}

fn future_iso(duration: Duration) -> String {
    (OffsetDateTime::now_utc() + time::Duration::try_from(duration).unwrap_or(time::Duration::MAX))
        .format(&Rfc3339)
        .expect("RFC3339 formatting cannot fail")
}

fn ago_iso(duration: Duration) -> String {
    (OffsetDateTime::now_utc() - time::Duration::try_from(duration).unwrap_or(time::Duration::MAX))
        .format(&Rfc3339)
        .expect("RFC3339 formatting cannot fail")
}

fn i64_from(value: u64) -> DbResult<i64> {
    i64::try_from(value).map_err(|_| {
        DownloadError::new(
            ErrorCode::SizeLimit,
            "download size exceeds SQLite integer range",
            false,
        )
    })
}

fn validate_range(name: &str, value: u64, minimum: u64, maximum: u64) -> DbResult<()> {
    if (minimum..=maximum).contains(&value) {
        Ok(())
    } else {
        Err(invalid_setting(name))
    }
}

fn invalid_setting(name: &str) -> DownloadError {
    DownloadError::new(
        ErrorCode::Database,
        format!("invalid download setting: {name}"),
        false,
    )
}
