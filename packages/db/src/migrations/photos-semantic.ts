import type { Migration } from "./types.js";

export const photosSemanticMigrations: Migration[] = [{
  id: "011_photos_semantic_search",
  sql: `
CREATE TABLE photos_embedding_profiles (
  embedding_space_id TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  revision TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK(dimensions BETWEEN 1 AND 8192),
  min_similarity REAL NOT NULL DEFAULT 0.35 CHECK(min_similarity BETWEEN -1 AND 1),
  created_at TEXT NOT NULL
);
CREATE TABLE photos_embedding_runtime (
  id INTEGER PRIMARY KEY CHECK(id=1),
  config_generation INTEGER NOT NULL DEFAULT 0,
  embedding_space_id TEXT REFERENCES photos_embedding_profiles(embedding_space_id),
  epoch INTEGER NOT NULL DEFAULT 0,
  asset_revision INTEGER NOT NULL DEFAULT 0,
  connection_state TEXT NOT NULL DEFAULT 'pending' CHECK(connection_state IN ('pending','ready','offline','blocked')),
  error TEXT,
  failures INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  heartbeat_at TEXT,
  verified_at TEXT,
  last_success_at TEXT,
  total_inference_ms REAL NOT NULL DEFAULT 0,
  completed_images INTEGER NOT NULL DEFAULT 0
);
INSERT INTO photos_embedding_runtime(id) VALUES(1);
CREATE TRIGGER photos_embedding_asset_deleted AFTER DELETE ON photos_assets BEGIN
  UPDATE photos_embedding_runtime SET asset_revision=asset_revision+1 WHERE id=1;
END;
CREATE TRIGGER photos_embedding_asset_changed AFTER UPDATE OF content_hash,preview_key,status,library_updated_at ON photos_assets
WHEN old.content_hash IS NOT new.content_hash OR old.preview_key IS NOT new.preview_key
  OR old.status IS NOT new.status OR old.library_updated_at IS NOT new.library_updated_at BEGIN
  UPDATE photos_embedding_runtime SET asset_revision=asset_revision+1 WHERE id=1;
END;
CREATE TABLE photos_embedding_cache (
  embedding_space_id TEXT NOT NULL REFERENCES photos_embedding_profiles(embedding_space_id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  dimensions INTEGER NOT NULL CHECK(dimensions BETWEEN 1 AND 8192),
  vector BLOB NOT NULL CHECK(typeof(vector)='blob' AND length(vector)=dimensions*4),
  created_at TEXT NOT NULL,
  PRIMARY KEY(embedding_space_id,input_key)
);
CREATE TABLE photos_asset_embeddings (
  asset_id TEXT NOT NULL REFERENCES photos_assets(id) ON DELETE CASCADE,
  embedding_space_id TEXT NOT NULL,
  input_key TEXT NOT NULL,
  PRIMARY KEY(asset_id,embedding_space_id),
  FOREIGN KEY(embedding_space_id,input_key) REFERENCES photos_embedding_cache(embedding_space_id,input_key) ON DELETE CASCADE
);
CREATE INDEX idx_photos_embedding_bindings_cache ON photos_asset_embeddings(embedding_space_id,input_key);
CREATE TABLE photos_embedding_jobs (
  id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES photos_assets(id) ON DELETE CASCADE,
  embedding_space_id TEXT NOT NULL REFERENCES photos_embedding_profiles(embedding_space_id) ON DELETE CASCADE,
  input_key TEXT NOT NULL,
  library_updated_at TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  preview_key TEXT NOT NULL,
  derivative_schema_version INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','failed')),
  lease_token TEXT,
  lease_expires_at TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(asset_id,embedding_space_id)
);
CREATE INDEX idx_photos_embedding_jobs_pending ON photos_embedding_jobs(embedding_space_id,status,next_attempt_at,created_at);
`
}, {
  id: "012_photos_embedding_retention",
  sql: `
ALTER TABLE photos_embedding_profiles ADD COLUMN retired_at TEXT;
ALTER TABLE photos_embedding_cache ADD COLUMN unreferenced_at TEXT;
CREATE INDEX idx_photos_embedding_cache_unreferenced ON photos_embedding_cache(unreferenced_at);
CREATE INDEX idx_photos_embedding_jobs_input ON photos_embedding_jobs(embedding_space_id,input_key);
DROP TRIGGER photos_embedding_asset_changed;
CREATE TRIGGER photos_embedding_asset_changed AFTER UPDATE OF content_hash,preview_key,derivative_schema_version,status,library_updated_at ON photos_assets
WHEN old.content_hash IS NOT new.content_hash OR old.preview_key IS NOT new.preview_key
  OR old.derivative_schema_version IS NOT new.derivative_schema_version
  OR old.status IS NOT new.status OR old.library_updated_at IS NOT new.library_updated_at BEGIN
  UPDATE photos_embedding_runtime SET asset_revision=asset_revision+1 WHERE id=1;
END;
`
}];
