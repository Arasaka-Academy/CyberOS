/**
 * [INPUT]: 依赖下载器数据库测试。
 * [OUTPUT]: 提供与业务 schema 对齐的隔离表。
 * [POS]: 供单元测试和本地 peer 测试初始化。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
pub(crate) const TEST_SCHEMA: &str = r#"
CREATE TABLE file_operations (
  id TEXT PRIMARY KEY, operation TEXT NOT NULL, source_path TEXT,
  target_path TEXT, status TEXT NOT NULL, metadata_json TEXT NOT NULL,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE download_tasks (
  id TEXT PRIMARY KEY, url TEXT NOT NULL,
  storage_pool_id TEXT NOT NULL, target_directory TEXT NOT NULL,
  target_file_name TEXT NOT NULL, target_path TEXT NOT NULL, partial_path TEXT NOT NULL,
  status TEXT NOT NULL, received_bytes INTEGER NOT NULL DEFAULT 0, total_bytes INTEGER,
  speed_bytes_per_second INTEGER NOT NULL DEFAULT 0, etag TEXT, last_modified TEXT,
  error TEXT, worker_id TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT, last_progress_at TEXT,
  file_operation_id TEXT, phase TEXT, download_mode TEXT, expected_sha256 TEXT,
  actual_sha256 TEXT, error_code TEXT, error_retryable INTEGER NOT NULL DEFAULT 0,
  retry_count INTEGER NOT NULL DEFAULT 0, next_retry_at TEXT, control_requested TEXT,
  segment_count INTEGER NOT NULL DEFAULT 0,
  source_kind TEXT NOT NULL DEFAULT 'http', torrent_info_hash TEXT, torrent_name TEXT,
  torrent_metainfo BLOB, selected_file_count INTEGER NOT NULL DEFAULT 0,
  uploaded_bytes INTEGER NOT NULL DEFAULT 0, upload_speed_bytes_per_second INTEGER NOT NULL DEFAULT 0,
  peer_count INTEGER NOT NULL DEFAULT 0, seed_ratio_limit REAL NOT NULL DEFAULT 1.0,
  seed_time_limit_seconds INTEGER NOT NULL DEFAULT 7200, content_completed_at TEXT,
  seed_started_at TEXT, engine_torrent_id TEXT
);
CREATE TABLE download_segments (
  task_id TEXT NOT NULL, start_byte INTEGER NOT NULL, end_byte INTEGER NOT NULL,
  next_byte INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (task_id, start_byte)
);
CREATE TABLE download_publish_journal (
  task_id TEXT PRIMARY KEY, operation_id TEXT NOT NULL UNIQUE, worker_id TEXT NOT NULL,
  device INTEGER NOT NULL, inode INTEGER NOT NULL, size_bytes INTEGER NOT NULL,
  sha256 TEXT, created_at TEXT NOT NULL
);
CREATE TABLE download_space_reservations (
  task_id TEXT PRIMARY KEY, storage_pool_id TEXT NOT NULL,
  reserved_bytes INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE download_workers (
  worker_id TEXT PRIMARY KEY, version TEXT NOT NULL,
  started_at TEXT NOT NULL, heartbeat_at TEXT NOT NULL
);
CREATE TABLE index_queue (
  id TEXT PRIMARY KEY, storage_pool_id TEXT NOT NULL, path TEXT NOT NULL,
  recursive INTEGER NOT NULL DEFAULT 0, kind TEXT NOT NULL, generation INTEGER NOT NULL DEFAULT 1,
  priority INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'queued', retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT, worker_id TEXT, lease_expires_at TEXT, error TEXT, error_code TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT, finished_at TEXT,
  UNIQUE(storage_pool_id, path)
);
CREATE TABLE system_settings (
  key TEXT PRIMARY KEY, value_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE torrent_previews (
  id TEXT PRIMARY KEY, source_kind TEXT NOT NULL, source_uri TEXT, metainfo BLOB,
  status TEXT NOT NULL, info_hash TEXT, name TEXT, total_bytes INTEGER,
  file_count INTEGER NOT NULL DEFAULT 0, is_private INTEGER NOT NULL DEFAULT 0,
  error TEXT, worker_id TEXT, lease_expires_at TEXT, created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE torrent_preview_files (
  preview_id TEXT NOT NULL, file_index INTEGER NOT NULL, path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, PRIMARY KEY (preview_id, file_index)
);
CREATE TABLE download_task_files (
  task_id TEXT NOT NULL, file_index INTEGER NOT NULL, path TEXT NOT NULL,
  size_bytes INTEGER NOT NULL, selected INTEGER NOT NULL DEFAULT 1,
  received_bytes INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (task_id, file_index)
);
"#;
