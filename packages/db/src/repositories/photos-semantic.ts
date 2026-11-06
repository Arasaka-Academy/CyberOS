import { randomUUID } from "node:crypto";
import {
  PHOTOS_DEFAULT_EMBEDDING_MODEL, normalizePhotosEmbedding, validatePhotosEmbeddingModel,
  type PhotosEmbeddingModel, type PhotosSemanticIndexStatus, type PhotosSemanticSettings,
  type PhotosSemanticSettingsPatch, type PhotosSemanticSettingsRecord
} from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import { getPhotosLibrarySettings } from "./photos.js";

const SETTING_KEY = "photos_semantic_search";
export const photosEmbeddingInputSql = "a.content_hash || ':' || a.derivative_schema_version || ':' || a.preview_key";
const ELIGIBLE = "a.status='ready' AND a.content_hash IS NOT NULL AND a.preview_key IS NOT NULL";

export interface PhotosEmbeddingProfile {
  embeddingSpaceId: string;
  model: string;
  revision: string;
  dimensions: number;
  minSimilarity: number;
}

export interface PhotosEmbeddingRuntime {
  embedding_space_id: string | null;
  config_generation: number;
  epoch: number;
  asset_revision: number;
  connection_state: "pending" | "ready" | "offline" | "blocked";
  error: string | null;
  failures: number;
  next_attempt_at: string | null;
  heartbeat_at: string | null;
  verified_at: string | null;
  last_success_at: string | null;
  total_inference_ms: number;
  completed_images: number;
  cache_maintenance_json: string | null;
}

export interface PhotosEmbeddingJob {
  id: string;
  assetId: string;
  embeddingSpaceId: string;
  inputKey: string;
  libraryUpdatedAt: string;
  contentHash: string;
  previewKey: string;
  derivativeSchemaVersion: number;
  leaseToken: string;
  attempts: number;
  configGeneration: number;
  epoch: number;
}

export function getPhotosSemanticSettings(db: CyberOsDatabase): PhotosSemanticSettingsRecord {
  const json = db.prepare("SELECT value_json FROM system_settings WHERE key=?").pluck().get(SETTING_KEY) as string | undefined;
  if (!json) return { enabled: false, baseUrl: "", model: PHOTOS_DEFAULT_EMBEDDING_MODEL, apiKey: null, generation: 0, updatedAt: new Date(0).toISOString() };
  const record = JSON.parse(json) as PhotosSemanticSettingsRecord;
  if (typeof record.enabled !== "boolean" || typeof record.baseUrl !== "string" || typeof record.model !== "string" ||
      (record.apiKey !== null && typeof record.apiKey !== "string") || !Number.isInteger(record.generation) || typeof record.updatedAt !== "string") {
    throw new Error("Photos semantic settings are invalid");
  }
  return record;
}

export function publicPhotosSemanticSettings(
  record: PhotosSemanticSettingsRecord, profile: PhotosEmbeddingProfile | null = null
): PhotosSemanticSettings {
  return { enabled: record.enabled, baseUrl: record.baseUrl, model: record.model, generation: record.generation,
    updatedAt: record.updatedAt, apiKeyConfigured: Boolean(record.apiKey), embeddingSpaceId: profile?.embeddingSpaceId ?? null,
    dimensions: profile?.dimensions ?? null, minSimilarity: profile?.minSimilarity ?? null };
}

export function normalizePhotosEmbeddingBaseUrl(value: string): string {
  if (!value.trim()) return "";
  let url: URL;
  try { url = new URL(value.trim()); } catch { throw new Error("Embedding API URL must be an absolute HTTP or HTTPS URL"); }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error("Embedding API URL must use HTTP or HTTPS without credentials, query or fragment");
  }
  return url.toString().replace(/\/+$/u, "");
}

export function mergePhotosSemanticSettings(current: PhotosSemanticSettingsRecord, patch: PhotosSemanticSettingsPatch): PhotosSemanticSettingsRecord {
  if (!patch || typeof patch !== "object" || Array.isArray(patch) ||
      Object.keys(patch).some((key) => !["enabled", "baseUrl", "model", "apiKey", "clearApiKey", "minSimilarity"].includes(key))) {
    throw new Error("Photos semantic settings contain unknown fields");
  }
  if ((patch.enabled !== undefined && typeof patch.enabled !== "boolean") ||
      (patch.baseUrl !== undefined && (typeof patch.baseUrl !== "string" || patch.baseUrl.length > 2048)) ||
      (patch.model !== undefined && (typeof patch.model !== "string" || !patch.model.trim() || patch.model.length > 256)) ||
      (patch.apiKey !== undefined && (typeof patch.apiKey !== "string" || patch.apiKey.length > 16384)) ||
      (patch.clearApiKey !== undefined && typeof patch.clearApiKey !== "boolean") ||
      (patch.minSimilarity !== undefined && (!Number.isFinite(patch.minSimilarity) || patch.minSimilarity < -1 || patch.minSimilarity > 1))) {
    throw new Error("Photos semantic settings are invalid");
  }
    const record: PhotosSemanticSettingsRecord = {
      enabled: patch.enabled ?? current.enabled,
      baseUrl: normalizePhotosEmbeddingBaseUrl(patch.baseUrl ?? current.baseUrl),
      model: patch.model?.trim() ?? current.model,
      apiKey: patch.clearApiKey ? null : patch.apiKey?.trim() || current.apiKey,
      generation: current.generation + 1, updatedAt: new Date().toISOString()
    };
    if (record.enabled && !record.baseUrl) throw new Error("Embedding API URL is required");
    return record;
}

export function savePhotosSemanticSettings(db: CyberOsDatabase, patch: PhotosSemanticSettingsPatch): PhotosSemanticSettingsRecord {
  return db.transaction(() => {
    const current = getPhotosSemanticSettings(db);
    const record = mergePhotosSemanticSettings(current, patch);
    if (patch.minSimilarity !== undefined) {
      const profile = getActivePhotosEmbeddingProfile(db);
      if (!profile || record.model !== profile.model) throw new Error("Connect the model before calibrating its threshold");
      setPhotosEmbeddingThreshold(db, profile.embeddingSpaceId, patch.minSimilarity);
    }
    db.prepare(`INSERT INTO system_settings(key,value_json,updated_at) VALUES(?,?,?)
      ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json,updated_at=excluded.updated_at`)
      .run(SETTING_KEY, JSON.stringify(record), record.updatedAt);
    db.prepare(`UPDATE photos_embedding_runtime SET config_generation=?,connection_state='pending',error=NULL,
      failures=0,next_attempt_at=NULL,embedding_space_id=CASE WHEN ? THEN NULL ELSE embedding_space_id END WHERE id=1`)
      .run(record.generation, current.model !== record.model ? 1 : 0);
    return record;
  }).immediate();
}

export function getPhotosEmbeddingRuntime(db: CyberOsDatabase): PhotosEmbeddingRuntime {
  return db.prepare("SELECT * FROM photos_embedding_runtime WHERE id=1").get() as PhotosEmbeddingRuntime;
}

export function getActivePhotosEmbeddingProfile(db: CyberOsDatabase): PhotosEmbeddingProfile | null {
  return db.prepare(`SELECT p.embedding_space_id AS embeddingSpaceId,p.model,p.revision,p.dimensions,p.min_similarity AS minSimilarity
    FROM photos_embedding_profiles p JOIN photos_embedding_runtime r ON r.embedding_space_id=p.embedding_space_id WHERE r.id=1`)
    .get() as PhotosEmbeddingProfile | undefined ?? null;
}

export function activatePhotosEmbeddingModel(db: CyberOsDatabase, input: PhotosEmbeddingModel, generation: number): boolean {
  const model = validatePhotosEmbeddingModel(input);
  return db.transaction(() => {
    const settings = getPhotosSemanticSettings(db);
    if (!settings.enabled || settings.generation !== generation) return false;
    if (settings.model !== model.model) throw new Error("The configured embedding model is not loaded by the API");
    const runtime = getPhotosEmbeddingRuntime(db);
    if (runtime.embedding_space_id && runtime.embedding_space_id !== model.embeddingSpaceId && runtime.connection_state !== "pending") {
      throw new Error("Embedding model changed; test and save the Photos API settings to activate the new version");
    }
    const existing = db.prepare("SELECT model,revision,dimensions FROM photos_embedding_profiles WHERE embedding_space_id=?")
      .get(model.embeddingSpaceId) as { model: string; revision: string; dimensions: number } | undefined;
    if (existing && (existing.model !== model.model || existing.revision !== model.revision || existing.dimensions !== model.dimensions)) {
      throw new Error("Embedding space identity was reused with an incompatible model");
    }
    db.prepare(`INSERT OR IGNORE INTO photos_embedding_profiles(embedding_space_id,model,revision,dimensions,created_at) VALUES(?,?,?,?,?)`)
      .run(model.embeddingSpaceId, model.model, model.revision, model.dimensions, new Date().toISOString());
    db.prepare(`UPDATE photos_embedding_profiles SET retired_at=CASE WHEN embedding_space_id=? THEN NULL ELSE COALESCE(retired_at,?) END`)
      .run(model.embeddingSpaceId, new Date().toISOString());
    if (runtime.embedding_space_id !== model.embeddingSpaceId) {
      db.prepare("UPDATE photos_embedding_runtime SET total_inference_ms=0,completed_images=0,last_success_at=NULL WHERE id=1").run();
    }
    db.prepare(`UPDATE photos_embedding_runtime SET embedding_space_id=?,connection_state='ready',error=NULL,failures=0,
      next_attempt_at=NULL,config_generation=?,verified_at=? WHERE id=1`).run(model.embeddingSpaceId, generation, new Date().toISOString());
    return true;
  }).immediate();
}

export function setPhotosEmbeddingThreshold(db: CyberOsDatabase, spaceId: string, threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < -1 || threshold > 1) throw new Error("Invalid similarity threshold");
  if (!db.prepare("UPDATE photos_embedding_profiles SET min_similarity=? WHERE embedding_space_id=?").run(threshold, spaceId).changes) {
    throw new Error("Embedding profile not found");
  }
}

export function touchPhotosEmbeddingWorker(db: CyberOsDatabase, now = new Date()): void {
  db.prepare("UPDATE photos_embedding_runtime SET heartbeat_at=? WHERE id=1").run(now.toISOString());
}

export function recordPhotosEmbeddingServiceFailure(db: CyberOsDatabase, generation: number, error: string, blocked: boolean): void {
  const runtime = getPhotosEmbeddingRuntime(db);
  const delay = Math.min(30 * 60_000, 30_000 * 2 ** Math.min(runtime.failures, 6));
  db.prepare(`UPDATE photos_embedding_runtime SET connection_state=?,error=?,failures=failures+1,next_attempt_at=?
    WHERE id=1 AND config_generation=?`).run(blocked ? "blocked" : "offline", error.slice(0, 1000),
    blocked ? null : new Date(Date.now() + delay).toISOString(), generation);
}

export function getPhotosSemanticStatus(db: CyberOsDatabase, now = new Date()): PhotosSemanticIndexStatus {
  const settings = getPhotosSemanticSettings(db);
  const runtime = getPhotosEmbeddingRuntime(db);
  const profile = getActivePhotosEmbeddingProfile(db);
  const library = getPhotosLibrarySettings(db);
  const counts = db.prepare(`SELECT COUNT(*) AS total,
    COALESCE(SUM(EXISTS(SELECT 1 FROM photos_asset_embeddings b WHERE b.asset_id=a.id AND b.embedding_space_id=? AND b.input_key=${photosEmbeddingInputSql})),0) AS indexed,
    COALESCE(SUM(EXISTS(SELECT 1 FROM photos_embedding_jobs j WHERE j.asset_id=a.id AND j.embedding_space_id=? AND j.input_key=${photosEmbeddingInputSql} AND j.status='failed')),0) AS failed
    FROM photos_assets a WHERE a.library_updated_at=? AND ${ELIGIBLE}`)
    .get(profile?.embeddingSpaceId ?? "", profile?.embeddingSpaceId ?? "", library?.updatedAt ?? "") as { total: number; indexed: number; failed: number };
  const stale = !runtime.heartbeat_at || now.getTime() - Date.parse(runtime.heartbeat_at) > 60_000;
  const pending = Math.max(0, counts.total - counts.indexed - counts.failed);
  const state = !settings.enabled ? "disabled" : runtime.connection_state === "blocked" ? "blocked"
    : runtime.connection_state === "offline" || (profile && stale) || counts.failed ? "degraded"
      : !profile || runtime.connection_state === "pending" ? "pending" : pending ? "indexing" : "ready";
  const speed = runtime.completed_images && runtime.total_inference_ms ? runtime.completed_images * 1000 / runtime.total_inference_ms : null;
  const failedReason = counts.failed ? db.prepare(`SELECT j.error FROM photos_embedding_jobs j JOIN photos_assets a ON a.id=j.asset_id
    WHERE j.status='failed' AND j.embedding_space_id=? AND a.library_updated_at=? ORDER BY j.created_at DESC LIMIT 1`)
    .pluck().get(profile?.embeddingSpaceId ?? "", library?.updatedAt ?? "") as string | undefined : undefined;
  const cache = runtime.cache_maintenance_json;
  return { state, ...counts, pending, embeddingSpaceId: profile?.embeddingSpaceId ?? null, dimensions: profile?.dimensions ?? null,
    ...(cache ? { cache: JSON.parse(cache) as NonNullable<PhotosSemanticIndexStatus["cache"]> } : {}),
    minSimilarity: profile?.minSimilarity ?? null, epoch: runtime.epoch,
    error: runtime.error ?? failedReason ?? (settings.enabled && profile && stale ? "Embedding worker has no recent heartbeat" : null),
    lastSuccessAt: runtime.last_success_at, workerHeartbeatAt: runtime.heartbeat_at, nextAttemptAt: runtime.next_attempt_at,
    imagesPerSecond: speed, estimatedRemainingSeconds: speed ? Math.ceil(pending / speed) : null };
}

interface Candidate { id: string; content_hash: string; preview_key: string; derivative_schema_version: number; input_key: string }

export function reconcilePhotosEmbeddingJobs(db: CyberOsDatabase, limit = 256): number {
  const settings = getPhotosSemanticSettings(db);
  const profile = getActivePhotosEmbeddingProfile(db);
  const library = getPhotosLibrarySettings(db);
  if (!settings.enabled || !profile || !library) return 0;
  return db.transaction(() => {
    const rows = db.prepare(`SELECT a.id,a.content_hash,a.preview_key,a.derivative_schema_version,${photosEmbeddingInputSql} AS input_key
      FROM photos_assets a
      LEFT JOIN photos_asset_embeddings b ON b.asset_id=a.id AND b.embedding_space_id=?
      LEFT JOIN photos_embedding_jobs j ON j.asset_id=a.id AND j.embedding_space_id=?
      WHERE a.library_updated_at=? AND ${ELIGIBLE} AND (b.input_key IS NULL OR b.input_key<>${photosEmbeddingInputSql})
        AND (j.input_key IS NULL OR j.input_key<>${photosEmbeddingInputSql})
      ORDER BY a.indexed_at DESC,a.taken_at DESC,a.id LIMIT ?`)
      .all(profile.embeddingSpaceId, profile.embeddingSpaceId, library.updatedAt, limit) as Candidate[];
    for (const row of rows) {
      const cached = db.prepare("SELECT 1 FROM photos_embedding_cache WHERE embedding_space_id=? AND input_key=?")
        .get(profile.embeddingSpaceId, row.input_key);
      if (cached) {
        bind(db, row.id, profile.embeddingSpaceId, row.input_key);
        db.prepare("DELETE FROM photos_embedding_jobs WHERE asset_id=? AND embedding_space_id=?").run(row.id, profile.embeddingSpaceId);
        continue;
      }
      db.prepare(`INSERT INTO photos_embedding_jobs(id,asset_id,embedding_space_id,input_key,library_updated_at,content_hash,preview_key,derivative_schema_version,created_at)
        VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(asset_id,embedding_space_id) DO UPDATE SET id=excluded.id,input_key=excluded.input_key,
        library_updated_at=excluded.library_updated_at,content_hash=excluded.content_hash,preview_key=excluded.preview_key,
        derivative_schema_version=excluded.derivative_schema_version,status='queued',lease_token=NULL,lease_expires_at=NULL,attempts=0,next_attempt_at=NULL,error=NULL`)
        .run(randomUUID(), row.id, profile.embeddingSpaceId, row.input_key, library.updatedAt, row.content_hash,
          row.preview_key, row.derivative_schema_version, new Date().toISOString());
    }
    // Retire superseded tasks; source publication and file deletion remain independent of inference.
    db.prepare(`DELETE FROM photos_embedding_jobs WHERE library_updated_at<>? OR NOT EXISTS (
      SELECT 1 FROM photos_assets a WHERE a.id=photos_embedding_jobs.asset_id AND ${ELIGIBLE} AND ${photosEmbeddingInputSql}=photos_embedding_jobs.input_key
    )`).run(library.updatedAt);
    return rows.length;
  }).immediate();
}

export function claimPhotosEmbeddingJob(db: CyberOsDatabase, workerId: string, leaseMs: number, now = new Date()): PhotosEmbeddingJob | null {
  return db.transaction(() => {
    const settings = getPhotosSemanticSettings(db);
    const runtime = getPhotosEmbeddingRuntime(db);
    const library = getPhotosLibrarySettings(db);
    if (!settings.enabled || !runtime.embedding_space_id || runtime.connection_state !== "ready" || !library) return null;
    const row = db.prepare(`SELECT j.* FROM photos_embedding_jobs j JOIN photos_assets a ON a.id=j.asset_id
      WHERE j.embedding_space_id=? AND j.library_updated_at=? AND ${ELIGIBLE} AND j.input_key=${photosEmbeddingInputSql}
        AND ((j.status='queued' AND (j.next_attempt_at IS NULL OR j.next_attempt_at<=?)) OR (j.status='running' AND j.lease_expires_at<=?))
      ORDER BY a.indexed_at DESC,a.taken_at DESC,j.created_at,j.id LIMIT 1`)
      .get(runtime.embedding_space_id, library.updatedAt, now.toISOString(), now.toISOString()) as {
        id: string; asset_id: string; embedding_space_id: string; input_key: string; library_updated_at: string;
        content_hash: string; preview_key: string; derivative_schema_version: number; attempts: number;
      } | undefined;
    if (!row) return null;
    const leaseToken = `${workerId}:${randomUUID()}`;
    db.prepare("UPDATE photos_embedding_jobs SET status='running',lease_token=?,lease_expires_at=?,attempts=attempts+1 WHERE id=?")
      .run(leaseToken, new Date(now.getTime() + leaseMs).toISOString(), row.id);
    return { id: row.id, assetId: row.asset_id, embeddingSpaceId: row.embedding_space_id, inputKey: row.input_key,
      libraryUpdatedAt: row.library_updated_at, contentHash: row.content_hash, previewKey: row.preview_key,
      derivativeSchemaVersion: row.derivative_schema_version, leaseToken, attempts: row.attempts + 1,
      configGeneration: settings.generation, epoch: runtime.epoch };
  }).immediate();
}

function bind(db: CyberOsDatabase, assetId: string, spaceId: string, inputKey: string): void {
  db.prepare(`INSERT INTO photos_asset_embeddings(asset_id,embedding_space_id,input_key) VALUES(?,?,?)
    ON CONFLICT(asset_id,embedding_space_id) DO UPDATE SET input_key=excluded.input_key`).run(assetId, spaceId, inputKey);
  db.prepare("UPDATE photos_embedding_cache SET unreferenced_at=NULL WHERE embedding_space_id=? AND input_key=? AND unreferenced_at IS NOT NULL")
    .run(spaceId, inputKey);
}

export function getCachedPhotosEmbedding(db: CyberOsDatabase, job: PhotosEmbeddingJob): number[] | null {
  const vector = db.prepare("SELECT vector FROM photos_embedding_cache WHERE embedding_space_id=? AND input_key=?")
    .pluck().get(job.embeddingSpaceId, job.inputKey) as Buffer | undefined;
  return vector ? Array.from({ length: vector.length / 4 }, (_, index) => vector.readFloatLE(index * 4)) : null;
}

export function completePhotosEmbeddingJob(db: CyberOsDatabase, job: PhotosEmbeddingJob, vector: unknown, inferenceMs = 0): boolean {
  const dimensions = db.prepare("SELECT dimensions FROM photos_embedding_profiles WHERE embedding_space_id=?").pluck().get(job.embeddingSpaceId) as number | undefined;
  if (!dimensions) return false;
  const normalized = normalizePhotosEmbedding(vector, dimensions);
  const blob = Buffer.alloc(dimensions * 4);
  normalized.forEach((value, index) => blob.writeFloatLE(value, index * 4));
  return db.transaction(() => {
    const runtime = getPhotosEmbeddingRuntime(db);
    if (getPhotosSemanticSettings(db).generation !== job.configGeneration || runtime.epoch !== job.epoch ||
        runtime.embedding_space_id !== job.embeddingSpaceId || getPhotosLibrarySettings(db)?.updatedAt !== job.libraryUpdatedAt) return false;
    const current = db.prepare(`SELECT 1 FROM photos_embedding_jobs j JOIN photos_assets a ON a.id=j.asset_id
      WHERE j.id=? AND j.lease_token=? AND j.status='running' AND j.lease_expires_at>? AND a.library_updated_at=?
        AND j.input_key=? AND ${ELIGIBLE} AND ${photosEmbeddingInputSql}=?`)
      .get(job.id, job.leaseToken, new Date().toISOString(), job.libraryUpdatedAt, job.inputKey, job.inputKey);
    if (!current) return false;
    db.prepare("INSERT OR IGNORE INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) VALUES(?,?,?,?,?)")
      .run(job.embeddingSpaceId, job.inputKey, dimensions, blob, new Date().toISOString());
    bind(db, job.assetId, job.embeddingSpaceId, job.inputKey);
    db.prepare("DELETE FROM photos_embedding_jobs WHERE id=? AND lease_token=?").run(job.id, job.leaseToken);
    db.prepare(`UPDATE photos_embedding_runtime SET last_success_at=?,total_inference_ms=total_inference_ms+?,
      completed_images=completed_images+? WHERE id=1`).run(new Date().toISOString(), Math.max(0, inferenceMs), inferenceMs > 0 ? 1 : 0);
    return true;
  }).immediate();
}

export function failPhotosEmbeddingJob(db: CyberOsDatabase, job: PhotosEmbeddingJob, error: string, permanent = false): void {
  const delay = Math.min(30 * 60_000, 30_000 * 2 ** Math.min(job.attempts - 1, 6));
  db.prepare(`UPDATE photos_embedding_jobs SET status=?,lease_token=NULL,lease_expires_at=NULL,error=?,next_attempt_at=?
    WHERE id=? AND lease_token=?`).run(permanent && job.attempts >= 3 ? "failed" : "queued", error.slice(0, 1000),
    new Date(Date.now() + delay).toISOString(), job.id, job.leaseToken);
}

export function retryPhotosEmbeddingJobs(db: CyberOsDatabase): void {
  db.transaction(() => {
    db.prepare("UPDATE photos_embedding_jobs SET status='queued',attempts=0,next_attempt_at=NULL,error=NULL WHERE status='failed'").run();
    db.prepare("UPDATE photos_embedding_runtime SET connection_state='pending',error=NULL,next_attempt_at=NULL,failures=0 WHERE id=1").run();
  }).immediate();
}

export function rebuildPhotosSemanticIndex(db: CyberOsDatabase): void {
  db.transaction(() => {
    const space = getPhotosEmbeddingRuntime(db).embedding_space_id;
    if (space) {
      db.prepare("DELETE FROM photos_embedding_jobs WHERE embedding_space_id=?").run(space);
      db.prepare("DELETE FROM photos_embedding_cache WHERE embedding_space_id=?").run(space);
    }
    db.prepare(`UPDATE photos_embedding_runtime SET epoch=epoch+1,error=NULL,failures=0,next_attempt_at=NULL,
      total_inference_ms=0,completed_images=0,connection_state='pending' WHERE id=1`).run();
  }).immediate();
}

/** Bounded derived-cache maintenance. Grace starts when an input loses its last
 * reference (7 days), or when a model space is retired (30 days). */
export function prunePhotosEmbeddingCache(db: CyberOsDatabase, now = new Date(), limit = 256): { removedVectors: number; removedBytes: number } {
  if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error("Invalid embedding cleanup batch size");
  return db.transaction(() => {
    const space = getPhotosEmbeddingRuntime(db).embedding_space_id;
    const library = getPhotosLibrarySettings(db)?.updatedAt ?? "";
    const timestamp = now.toISOString();
    const orphanBefore = new Date(now.getTime() - 7 * 86400_000).toISOString();
    const retiredBefore = new Date(now.getTime() - 30 * 86400_000).toISOString();
    db.prepare(`UPDATE photos_embedding_profiles SET retired_at=COALESCE(retired_at,?)
      WHERE embedding_space_id<>? AND retired_at IS NULL`).run(timestamp, space ?? "");
    db.prepare(`DELETE FROM photos_asset_embeddings WHERE rowid IN (
      SELECT b.rowid FROM photos_asset_embeddings b WHERE NOT EXISTS (
        SELECT 1 FROM photos_assets a WHERE a.id=b.asset_id AND a.library_updated_at=? AND ${ELIGIBLE}
          AND ${photosEmbeddingInputSql}=b.input_key) LIMIT ?
    )`).run(library, limit);
    // Expired/queued tasks for retired models cannot publish into the current
    // space. Keep a live lease until its worker has returned or it expires.
    db.prepare(`DELETE FROM photos_embedding_jobs WHERE rowid IN (
      SELECT j.rowid FROM photos_embedding_jobs j JOIN photos_embedding_profiles p USING(embedding_space_id)
      WHERE p.embedding_space_id<>? AND p.retired_at<=?
        AND (j.status<>'running' OR j.lease_expires_at<=?) LIMIT ?
    )`).run(space ?? "", retiredBefore, timestamp, limit);
    const referenced = `EXISTS(SELECT 1 FROM photos_asset_embeddings b
        WHERE b.embedding_space_id=c.embedding_space_id AND b.input_key=c.input_key)
      OR EXISTS(SELECT 1 FROM photos_embedding_jobs j
        WHERE j.embedding_space_id=c.embedding_space_id AND j.input_key=c.input_key)`;
    db.prepare(`UPDATE photos_embedding_cache AS c SET unreferenced_at=NULL WHERE unreferenced_at IS NOT NULL AND (${referenced})`).run();
    db.prepare(`UPDATE photos_embedding_cache SET unreferenced_at=? WHERE rowid IN (
      SELECT c.rowid FROM photos_embedding_cache c WHERE c.unreferenced_at IS NULL AND NOT (${referenced}) LIMIT ?
    )`).run(timestamp, limit);
    const removed = db.prepare(`DELETE FROM photos_embedding_cache WHERE rowid IN (
      SELECT c.rowid FROM photos_embedding_cache c JOIN photos_embedding_profiles p USING(embedding_space_id)
      WHERE (c.unreferenced_at<=? OR (p.embedding_space_id<>? AND p.retired_at<=?))
        AND NOT EXISTS(SELECT 1 FROM photos_embedding_jobs j WHERE j.embedding_space_id=c.embedding_space_id
          AND j.input_key=c.input_key AND (j.status<>'running' OR j.lease_expires_at>?))
      LIMIT ?
    ) RETURNING dimensions`).all(orphanBefore, space ?? "", retiredBefore, timestamp, limit) as { dimensions: number }[];
    const result = { removedVectors: removed.length, removedBytes: removed.reduce((sum, row) => sum + row.dimensions * 4, 0) };
    const stats = db.prepare(`SELECT COUNT(*) AS vectors,COALESCE(SUM(p.dimensions*4),0) AS bytes
      FROM photos_embedding_profiles p JOIN photos_embedding_cache c USING(embedding_space_id)`).get() as { vectors: number; bytes: number };
    const retiredSpaces = db.prepare("SELECT COUNT(*) FROM photos_embedding_profiles WHERE retired_at IS NOT NULL").pluck().get() as number;
    db.prepare("UPDATE photos_embedding_runtime SET cache_maintenance_json=? WHERE id=1")
      .run(JSON.stringify({ ...stats, retiredSpaces, lastCleanupAt: timestamp, ...result }));
    return result;
  }).immediate();
}
