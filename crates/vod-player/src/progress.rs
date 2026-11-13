use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};
use std::time::Duration;

use rusqlite::{Connection, OpenFlags, OptionalExtension, params};
use time::OffsetDateTime;
use time::format_description::well_known::Rfc3339;

use crate::error::{ErrorCode, VodError};

const COMPLETED_RATIO: f64 = 0.9;
const PROFILE_ID: &str = "local-admin";
const MAX_PENDING_FILES: usize = 128;
const FLUSH_TIMEOUT: Duration = Duration::from_secs(2);

struct Checkpoint {
    position: f64,
    duration: Option<f64>,
}

#[derive(Default)]
struct Mailbox {
    pending: HashMap<String, Checkpoint>,
    submitted: u64,
    closed: bool,
}

#[derive(Clone, Default)]
struct Completion {
    generation: u64,
    error: Option<String>,
}

/// Coalesces progress per file without waiting for SQLite in the control actor.
pub(crate) struct ProgressWriter {
    mailbox: Arc<(Mutex<Mailbox>, Condvar)>,
    completed: tokio::sync::watch::Receiver<Completion>,
}

impl ProgressWriter {
    pub(crate) fn new(store: ProgressStore) -> Result<Self, VodError> {
        let mailbox = Arc::new((Mutex::new(Mailbox::default()), Condvar::new()));
        let (completion, completed) = tokio::sync::watch::channel(Completion::default());
        let worker = Arc::clone(&mailbox);
        std::thread::Builder::new()
            .name("vod-progress".into())
            .spawn(move || {
                loop {
                    let (lock, wake) = &*worker;
                    let mut state = lock.lock().expect("progress mailbox lock poisoned");
                    while state.pending.is_empty() && !state.closed {
                        state = wake.wait(state).expect("progress mailbox lock poisoned");
                    }
                    if state.pending.is_empty() && state.closed {
                        return;
                    }
                    let pending = std::mem::take(&mut state.pending);
                    let generation = state.submitted;
                    drop(state);
                    let mut error = None;
                    for (file_id, checkpoint) in pending {
                        if let Err(failure) =
                            store.save(&file_id, checkpoint.position, checkpoint.duration)
                        {
                            tracing::warn!(%file_id, %failure, "failed to persist media progress");
                            error = Some(failure.to_string());
                        }
                    }
                    completion.send_replace(Completion { generation, error });
                }
            })
            .map_err(|error| {
                VodError::internal(format!("Cannot start progress writer: {error}"))
            })?;
        Ok(Self { mailbox, completed })
    }

    pub(crate) fn save(
        &self,
        file_id: &str,
        position: f64,
        duration: Option<f64>,
    ) -> Result<(), VodError> {
        let (lock, wake) = &*self.mailbox;
        let mut state = lock.lock().expect("progress mailbox lock poisoned");
        if state.pending.len() >= MAX_PENDING_FILES && !state.pending.contains_key(file_id) {
            return Err(VodError::internal("Media progress queue is full"));
        }
        state
            .pending
            .insert(file_id.to_owned(), Checkpoint { position, duration });
        state.submitted = state.submitted.saturating_add(1);
        wake.notify_one();
        Ok(())
    }

    pub(crate) async fn flush(&self) -> Result<(), VodError> {
        let generation = self
            .mailbox
            .0
            .lock()
            .expect("progress mailbox lock poisoned")
            .submitted;
        let mut completed = self.completed.clone();
        let result = tokio::time::timeout(
            FLUSH_TIMEOUT,
            completed.wait_for(|state| state.generation >= generation),
        )
        .await
        .map_err(|_| VodError::internal("Timed out flushing media progress"))?
        .map_err(|_| VodError::internal("Media progress writer stopped"))?;
        match &result.error {
            Some(error) => Err(VodError::internal(format!(
                "Media progress flush failed: {error}"
            ))),
            None => Ok(()),
        }
    }
}

impl Drop for ProgressWriter {
    fn drop(&mut self) {
        let (lock, wake) = &*self.mailbox;
        lock.lock().expect("progress mailbox lock poisoned").closed = true;
        wake.notify_one();
    }
}

#[derive(Clone)]
pub struct ProgressStore {
    path: PathBuf,
}

impl ProgressStore {
    pub fn new(path: PathBuf) -> Self {
        Self { path }
    }

    pub fn next_episode(
        &self,
        file_id: &str,
    ) -> Result<Option<(String, String, String)>, VodError> {
        let connection = open_existing(&self.path)?;
        connection.query_row(
            "SELECT f.id,f.storage_pool_id,f.relative_path FROM media_files current JOIN media_episodes e ON e.id=current.episode_id JOIN media_seasons s ON s.id=e.season_id JOIN media_episodes next ON next.title_id=e.title_id JOIN media_seasons ns ON ns.id=next.season_id JOIN media_files f ON f.episode_id=next.id JOIN media_sources source ON source.id=f.source_id JOIN media_titles title ON title.id=f.title_id WHERE current.id=? AND source.enabled=1 AND title.match_status<>'excluded' AND ns.season_number>0 AND (ns.season_number>s.season_number OR (ns.season_number=s.season_number AND next.episode_number>e.episode_number)) ORDER BY ns.season_number,next.episode_number,f.relative_path LIMIT 1",
            [file_id], |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?))
        ).optional().map_err(database_error)
    }

    pub fn verify_media_file(
        &self,
        file_id: &str,
        storage_pool_id: &str,
        relative_path: &str,
    ) -> Result<(), VodError> {
        let connection = open_existing(&self.path)?;
        let matches = connection
            .query_row(
                "SELECT 1 FROM media_files WHERE id = ? AND storage_pool_id = ? AND relative_path = ?",
                params![file_id, storage_pool_id, relative_path],
                |_| Ok(()),
            )
            .optional()
            .map_err(database_error)?
            .is_some();
        if !matches {
            return Err(VodError::new(
                ErrorCode::InvalidPath,
                "Media file identity does not match the requested path",
                400,
            ));
        }
        Ok(())
    }

    pub fn save(
        &self,
        file_id: &str,
        position_seconds: f64,
        duration_seconds: Option<f64>,
    ) -> Result<(), VodError> {
        if !position_seconds.is_finite() || position_seconds < 0.0 {
            return Err(VodError::internal("Playback position is invalid"));
        }
        let duration_seconds = duration_seconds.filter(|value| value.is_finite() && *value >= 0.0);
        let completed = duration_seconds.is_some_and(|duration| {
            duration > 0.0 && position_seconds / duration >= COMPLETED_RATIO
        });
        let connection = open_existing(&self.path)?;
        connection
            .execute(
                "INSERT INTO media_progress(file_id, profile_id, position_seconds, duration_seconds, completed, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(file_id, profile_id) DO UPDATE SET position_seconds = excluded.position_seconds, duration_seconds = excluded.duration_seconds, completed = excluded.completed, updated_at = excluded.updated_at",
                params![file_id, PROFILE_ID, position_seconds, duration_seconds, completed, now()],
            )
            .map_err(database_error)?;
        Ok(())
    }
}

fn open_existing(path: &Path) -> Result<Connection, VodError> {
    let connection = Connection::open_with_flags(
        path,
        OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )
    .map_err(database_error)?;
    connection
        .pragma_update(None, "foreign_keys", "ON")
        .and_then(|_| connection.pragma_update(None, "busy_timeout", 30_000))
        .map_err(database_error)?;
    Ok(connection)
}

fn database_error(error: rusqlite::Error) -> VodError {
    VodError::new(
        ErrorCode::StorageUnavailable,
        format!("Media progress database is unavailable: {error}"),
        503,
    )
}

fn now() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| OffsetDateTime::now_utc().unix_timestamp().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn database(path: &Path) {
        let connection = Connection::open(path).unwrap();
        connection.execute_batch(
            "CREATE TABLE media_files(id TEXT PRIMARY KEY, storage_pool_id TEXT NOT NULL, relative_path TEXT NOT NULL);\
             CREATE TABLE media_progress(file_id TEXT NOT NULL REFERENCES media_files(id) ON DELETE CASCADE, profile_id TEXT NOT NULL, position_seconds REAL NOT NULL, duration_seconds REAL, completed INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(file_id, profile_id));\
             INSERT INTO media_files VALUES ('file-1', 'pool', 'movies/a.mkv');",
        ).unwrap();
    }

    #[test]
    fn verifies_identity_and_persists_completion_threshold() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cyberos.sqlite");
        database(&path);
        let store = ProgressStore::new(path.clone());
        store
            .verify_media_file("file-1", "pool", "movies/a.mkv")
            .unwrap();
        assert!(
            store
                .verify_media_file("file-1", "pool", "movies/b.mkv")
                .is_err()
        );

        store.save("file-1", 89.0, Some(100.0)).unwrap();
        store.save("file-1", 90.0, Some(100.0)).unwrap();
        let completed: i64 = Connection::open(path)
            .unwrap()
            .query_row(
                "SELECT completed FROM media_progress WHERE file_id = 'file-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(completed, 1);
    }

    #[test]
    fn never_creates_a_missing_database() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.sqlite");
        let error = ProgressStore::new(path.clone())
            .save("file-1", 1.0, None)
            .unwrap_err();
        assert_eq!(error.code, ErrorCode::StorageUnavailable);
        assert!(!path.exists());
    }

    #[tokio::test]
    async fn writer_coalesces_latest_checkpoints_and_flushes_after_contention() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("cyberos.sqlite");
        database(&path);
        let connection = Connection::open(&path).unwrap();
        connection
            .execute(
                "INSERT INTO media_files VALUES ('file-2','pool','movies/b.mkv')",
                [],
            )
            .unwrap();
        connection.execute_batch("BEGIN IMMEDIATE").unwrap();
        let writer = ProgressWriter::new(ProgressStore::new(path.clone())).unwrap();
        for position in 0..1000 {
            writer
                .save("file-1", f64::from(position), Some(1000.0))
                .unwrap();
        }
        writer.save("file-2", 5.0, Some(20.0)).unwrap();
        connection.execute_batch("COMMIT").unwrap();
        writer.flush().await.unwrap();
        let (position, completed): (f64, bool) = connection
            .query_row(
                "SELECT position_seconds, completed FROM media_progress WHERE file_id='file-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(position, 999.0);
        assert!(completed);
        let second: f64 = connection
            .query_row(
                "SELECT position_seconds FROM media_progress WHERE file_id='file-2'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(second, 5.0);
    }

    #[tokio::test]
    async fn writer_reports_persistence_failure_on_flush() {
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("missing.sqlite");
        let writer = ProgressWriter::new(ProgressStore::new(path.clone())).unwrap();
        writer.save("file-1", 1.0, None).unwrap();
        assert!(
            writer
                .flush()
                .await
                .unwrap_err()
                .message
                .contains("flush failed")
        );
        assert!(!path.exists());
    }
}
