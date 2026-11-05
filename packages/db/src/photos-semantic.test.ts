import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as sqliteVec from "sqlite-vec";
import {
  openCyberOsDb, savePhotosLibrarySettings,
  getPhotosSemanticSettings, savePhotosSemanticSettings, publicPhotosSemanticSettings,
  activatePhotosEmbeddingModel, reconcilePhotosEmbeddingJobs, claimPhotosEmbeddingJob,
  completePhotosEmbeddingJob, getPhotosSemanticStatus, rebuildPhotosSemanticIndex,
  queryPhotosAssets, rankPhotosSearchMatches,
  type CyberOsDatabase
} from "./index.js";

let directory: string;
let db: CyberOsDatabase;
let library: string;
const model = {
  protocol: "cyberos-photos-embedding/v1" as const,
  model: "Qwen/Qwen3-VL-Embedding-2B", revision: "test", dimensions: 2,
  embeddingSpaceId: "test-space", normalized: true as const, modalities: ["text", "image"] as ("text" | "image")[]
};
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-semantic-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  sqliteVec.load(db);
  library = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" }).updatedAt;
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
function asset(id: string, hash = id) {
  db.prepare(`INSERT INTO photos_assets (id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
    taken_at,taken_at_source,preview_key,status,library_updated_at,indexed_at)
    VALUES (?, 'pool', ?, ?, 'image/jpeg', 100, 0, ?, '2026-01-01', 'file_mtime', ?, 'ready', ?, '2026-01-01')`)
    .run(id, `photos/${id}.jpg`, `${id}.jpg`, hash, `preview/${hash}.webp`, library);
}
function enable() {
  const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "https://example.test", apiKey: "secret" });
  expect(activatePhotosEmbeddingModel(db, model, settings.generation)).toBe(true);
  return settings;
}

describe("Photos semantic index", () => {
  it("finds Chinese filename substrings without a model", () => {
    asset("海边日落");
    expect(queryPhotosAssets(db, { libraryUpdatedAt: library, request: { filters: { text: "日落" } } }).total).toBe(1);
  });

  it("unions lexical and visual matches, applying metadata filters before scoring", () => {
    asset("海边日落"); asset("semantic"); asset("unrelated"); enable();
    db.prepare(`INSERT INTO photos_asset_metadata(asset_id,schema_version,status,media_kind,capture_source,raw_metadata_json,warnings_json,updated_at)
      SELECT id,2,'ready','image','file_mtime','{}','[]','2026-01-01' FROM photos_assets`).run();
    db.prepare("UPDATE photos_assets SET taken_at='2024-01-01' WHERE id='海边日落'").run();
    reconcilePhotosEmbeddingJobs(db);
    for (let n = 0; n < 3; n++) {
      const job = claimPhotosEmbeddingJob(db, "worker", 30_000)!;
      completePhotosEmbeddingJob(db, job, job.assetId === "unrelated" ? [-1, 0] : job.assetId === "semantic" ? [0.8, 0.6] : [1, 0]);
    }
    const request = { filters: { text: "海边" }, sort: { field: "relevance" as const, direction: "desc" as const } };
    const result = rankPhotosSearchMatches(db, { libraryUpdatedAt: library, request, embedding: [1, 0] });
    expect(result.map((entry) => entry.id)).toEqual(["海边日落", "semantic"]);
    expect(rankPhotosSearchMatches(db, { libraryUpdatedAt: library,
      request: { ...request, filters: { text: "海边", capturedAt: { from: "2025-01-01" } } }, embedding: [1, 0] }).map((entry) => entry.id)).toEqual(["semantic"]);
    expect(rankPhotosSearchMatches(db, { libraryUpdatedAt: library,
      request: { ...request, filters: { text: "外星飞船" } }, embedding: [0, -1] })).toEqual([]);
  });
  it("retains omitted credentials and exposes only configured state", () => {
    expect(getPhotosSemanticSettings(db).enabled).toBe(false);
    savePhotosSemanticSettings(db, { baseUrl: "https://example.test/", apiKey: "secret" });
    const saved = savePhotosSemanticSettings(db, { enabled: true });
    expect(saved.apiKey).toBe("secret");
    expect(publicPhotosSemanticSettings(saved)).not.toHaveProperty("apiKey");
    expect(publicPhotosSemanticSettings(saved).apiKeyConfigured).toBe(true);
    expect(savePhotosSemanticSettings(db, { clearApiKey: true }).apiKey).toBeNull();
    expect(() => savePhotosSemanticSettings(db, { baseUrl: "file:///etc/passwd" })).toThrow();
    expect(() => savePhotosSemanticSettings(db, { baseUrl: "https://user:password@example.test" })).toThrow();
  });

  it("recovers leases and rejects a result when the source changes", () => {
    asset("one"); enable();
    reconcilePhotosEmbeddingJobs(db);
    const now = new Date();
    const first = claimPhotosEmbeddingJob(db, "worker", 1000, now)!;
    expect(first.assetId).toBe("one");
    expect(claimPhotosEmbeddingJob(db, "other", 1000, now)).toBeNull();
    const recovered = claimPhotosEmbeddingJob(db, "other", 1000, new Date(now.getTime() + 1001))!;
    expect(completePhotosEmbeddingJob(db, first, [1, 0])).toBe(false);
    db.prepare("UPDATE photos_assets SET content_hash='changed' WHERE id='one'").run();
    expect(completePhotosEmbeddingJob(db, recovered, [1, 0])).toBe(false);
    expect(getPhotosSemanticStatus(db).indexed).toBe(0);
  });

  it("reuses duplicate contents and rejects jobs after rebuild or config changes", () => {
    asset("one", "same"); asset("two", "same"); enable();
    reconcilePhotosEmbeddingJobs(db);
    const job = claimPhotosEmbeddingJob(db, "worker", 30_000)!;
    expect(() => completePhotosEmbeddingJob(db, job, [Number.NaN, 0])).toThrow();
    expect(completePhotosEmbeddingJob(db, job, [1, 0])).toBe(true);
    reconcilePhotosEmbeddingJobs(db);
    const duplicate = claimPhotosEmbeddingJob(db, "worker", 30_000);
    if (duplicate) expect(completePhotosEmbeddingJob(db, duplicate, [1, 0])).toBe(true);
    expect(getPhotosSemanticStatus(db).indexed).toBe(2);
    expect(db.prepare("SELECT COUNT(*) FROM photos_embedding_cache").pluck().get()).toBe(1);
    rebuildPhotosSemanticIndex(db);
    expect(getPhotosSemanticStatus(db).indexed).toBe(0);
    expect(activatePhotosEmbeddingModel(db, model, getPhotosSemanticSettings(db).generation)).toBe(true);
    reconcilePhotosEmbeddingJobs(db);
    const stale = claimPhotosEmbeddingJob(db, "worker", 30_000)!;
    savePhotosSemanticSettings(db, { apiKey: "changed" });
    expect(completePhotosEmbeddingJob(db, stale, [1, 0])).toBe(false);
    db.prepare("DELETE FROM photos_assets").run();
    expect(db.prepare("SELECT COUNT(*) FROM photos_embedding_jobs").pluck().get()).toBe(0);
  });

  it("discards an in-flight response after the library changes, before old assets are retired", () => {
    asset("old-library"); enable(); reconcilePhotosEmbeddingJobs(db);
    const job = claimPhotosEmbeddingJob(db, "worker", 30_000)!;
    savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "another-library" });
    expect(completePhotosEmbeddingJob(db, job, [1, 0])).toBe(false);
    expect(db.prepare("SELECT COUNT(*) FROM photos_embedding_cache").pluck().get()).toBe(0);
  });

  it("retains throughput when only the address changes, and resets it for a new model space", () => {
    asset("one"); enable(); reconcilePhotosEmbeddingJobs(db);
    const job = claimPhotosEmbeddingJob(db, "worker", 30_000)!;
    completePhotosEmbeddingJob(db, job, [1, 0], 1000);
    let settings = savePhotosSemanticSettings(db, { baseUrl: "https://another.example.test" });
    activatePhotosEmbeddingModel(db, model, settings.generation);
    expect(getPhotosSemanticStatus(db).imagesPerSecond).toBe(1);
    settings = savePhotosSemanticSettings(db, { baseUrl: "https://new-version.example.test" });
    activatePhotosEmbeddingModel(db, { ...model, embeddingSpaceId: "new-space", revision: "new" }, settings.generation);
    expect(getPhotosSemanticStatus(db).imagesPerSecond).toBeNull();
    expect(getPhotosSemanticStatus(db).indexed).toBe(0);
  });
});
