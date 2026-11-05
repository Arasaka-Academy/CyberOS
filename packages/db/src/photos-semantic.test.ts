import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as sqliteVec from "sqlite-vec";
import {
  openCyberOsDb, savePhotosLibrarySettings,
  getPhotosSemanticSettings, savePhotosSemanticSettings, publicPhotosSemanticSettings,
  activatePhotosEmbeddingModel, getActivePhotosEmbeddingProfile, reconcilePhotosEmbeddingJobs, claimPhotosEmbeddingJob,
  completePhotosEmbeddingJob, getPhotosSemanticStatus, rebuildPhotosSemanticIndex, prunePhotosEmbeddingCache,
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

  it("scores each eligible shared input once and excludes stale, orphaned and historical vectors", () => {
    asset("one", "same"); asset("two", "same"); asset("stale"); asset("unindexed-海边"); enable();
    reconcilePhotosEmbeddingJobs(db);
    let job;
    while ((job = claimPhotosEmbeddingJob(db, "worker", 30_000))) completePhotosEmbeddingJob(db, job, [1, 0]);
    db.prepare("DELETE FROM photos_asset_embeddings WHERE asset_id='unindexed-海边'").run();
    db.prepare("UPDATE photos_assets SET content_hash='new' WHERE id='stale'").run();
    db.prepare("INSERT INTO photos_embedding_profiles(embedding_space_id,model,revision,dimensions,min_similarity,created_at) VALUES('historical','old','old',2,0.35,'2020-01-01')").run();
    db.prepare("INSERT INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) VALUES('historical','old',2,?,'2020-01-01')").run(Buffer.from(new Float32Array([1, 0]).buffer));
    let scored = 0;
    db.function("vec_distance_cosine", (_left: Buffer, _right: Buffer) => { scored++; return 0; });
    const result = rankPhotosSearchMatches(db, { libraryUpdatedAt: library,
      request: { filters: { text: "海边" }, sort: { field: "name", direction: "asc" } }, embedding: [1, 0] });
    expect(result.map(({ id }) => id)).toEqual(["one", "two", "unindexed-海边"]);
    expect(result[0]!.score).toBeCloseTo(1 / 61);
    expect(scored).toBe(1);
    expect(rankPhotosSearchMatches(db, { libraryUpdatedAt: library,
      request: { filters: { text: "海边", cameraModels: ["missing"] } }, embedding: [1, 0] })).toEqual([]);
    expect(scored).toBe(1);
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

  it("starts the orphan grace period on last-reference removal and resets it on reuse", () => {
    asset("one", "shared"); asset("two", "shared"); enable(); reconcilePhotosEmbeddingJobs(db);
    let job;
    while ((job = claimPhotosEmbeddingJob(db, "worker", 30_000))) completePhotosEmbeddingJob(db, job, [1, 0]);
    const start = new Date(Date.now() + 1000);
    db.prepare("DELETE FROM photos_assets WHERE id='one'").run();
    expect(prunePhotosEmbeddingCache(db, start).removedVectors).toBe(0);
    expect(db.prepare("SELECT unreferenced_at FROM photos_embedding_cache").pluck().get()).toBeNull();
    db.prepare("UPDATE photos_assets SET content_hash='replaced' WHERE id='two'").run();
    prunePhotosEmbeddingCache(db, start);
    expect(db.prepare("SELECT unreferenced_at FROM photos_embedding_cache").pluck().get()).toBe(start.toISOString());
    expect(prunePhotosEmbeddingCache(db, new Date(start.getTime() + 6 * 86400_000)).removedVectors).toBe(0);
    db.prepare("UPDATE photos_assets SET content_hash='shared' WHERE id='two'").run(); reconcilePhotosEmbeddingJobs(db);
    expect(db.prepare("SELECT unreferenced_at FROM photos_embedding_cache").pluck().get()).toBeNull();
    expect(prunePhotosEmbeddingCache(db, new Date(start.getTime() + 8 * 86400_000)).removedVectors).toBe(0);
    db.prepare("DELETE FROM photos_assets").run();
    const lost = new Date(start.getTime() + 9 * 86400_000); prunePhotosEmbeddingCache(db, lost);
    expect(prunePhotosEmbeddingCache(db, new Date(lost.getTime() + 7 * 86400_000))).toEqual({ removedVectors: 1, removedBytes: 8 });
  });

  it("expires old spaces in bounded batches, preserving the active model and live task leases", () => {
    asset("one"); asset("two"); enable(); reconcilePhotosEmbeddingJobs(db);
    const completed = claimPhotosEmbeddingJob(db, "worker", 30_000)!; completePhotosEmbeddingJob(db, completed, [1, 0]);
    const running = claimPhotosEmbeddingJob(db, "worker", 40 * 86400_000)!;
    db.prepare("INSERT INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) VALUES(?,?,?,?,?)")
      .run(model.embeddingSpaceId, running.inputKey, 2, Buffer.from(new Float32Array([1, 0]).buffer), new Date().toISOString());
    const settings = savePhotosSemanticSettings(db, { baseUrl: "https://new.example.test" });
    activatePhotosEmbeddingModel(db, { ...model, embeddingSpaceId: "next-space", revision: "next" }, settings.generation);
    const start = new Date(); prunePhotosEmbeddingCache(db, start);
    expect(prunePhotosEmbeddingCache(db, new Date(start.getTime() + 29 * 86400_000)).removedVectors).toBe(0);
    expect(prunePhotosEmbeddingCache(db, new Date(start.getTime() + 31 * 86400_000), 1).removedVectors).toBe(1);
    expect(db.prepare("SELECT input_key FROM photos_embedding_cache").pluck().get()).toBe(running.inputKey);
    expect(prunePhotosEmbeddingCache(db, new Date(start.getTime() + 41 * 86400_000), 1).removedVectors).toBe(1);
    expect(getActivePhotosEmbeddingProfile(db)?.embeddingSpaceId).toBe("next-space");
    expect(getPhotosSemanticStatus(db).cache).toMatchObject({ vectors: 0, bytes: 0, retiredSpaces: 1 });
  });
});
