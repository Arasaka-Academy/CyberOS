import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import * as sqliteVec from "sqlite-vec";
import { openCyberOsDb, openCyberOsDbReadOnly, getPhotosLibrarySettings, savePhotosLibrarySettings, savePhotosSemanticSettings, activatePhotosEmbeddingModel } from "@cyberos/db";
import { PhotosSearchEngine } from "./lib/photos-search-engine.js";

const directory = process.argv[2];
if (!directory) throw new Error("Usage: node photos-search-benchmark.js <new isolated directory> [count=100000]");
const reuse = process.argv[4] === "--reuse";
if (!reuse) await mkdir(directory, { recursive: false });
const count = Number(process.argv[3] ?? 100_000);
if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error("Count must be 1..100000");
const db = (reuse ? openCyberOsDbReadOnly : openCyberOsDb)(path.join(directory, "benchmark.sqlite")); sqliteVec.load(db);
if (reuse && getPhotosLibrarySettings(db)?.storagePoolId !== "benchmark") throw new Error("Only synthetic benchmark databases can be reused");
let library = getPhotosLibrarySettings(db)!;
if (!reuse) {
library = savePhotosLibrarySettings(db, { storagePoolId: "benchmark", path: "synthetic" });
const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "http://127.0.0.1:1", model: "benchmark" });
activatePhotosEmbeddingModel(db, { protocol: "cyberos-photos-embedding/v1", model: "benchmark", revision: "synthetic-only",
  embeddingSpaceId: "benchmark-2048", dimensions: 2048, normalized: true, modalities: ["text", "image"] }, settings.generation);
const asset = db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
  preview_key,taken_at,taken_at_source,status,library_updated_at,indexed_at) VALUES(?,'benchmark',?,?,'image/jpeg',1,0,?,?,'2026-01-01','file_mtime','ready',?,'2026-01-01')`);
const cache = db.prepare("INSERT INTO photos_embedding_cache VALUES('benchmark-2048',?,2048,?,'2026-01-01')");
const bind = db.prepare("INSERT INTO photos_asset_embeddings VALUES(?,'benchmark-2048',?)");
let seed = 42;
const vector = new Float32Array(2048);
const started = performance.now();
for (let start = 0; start < count; start += 500) {
  db.transaction(() => {
    for (let index = start; index < Math.min(count, start + 500); index++) {
      let norm = 0;
      for (let d = 0; d < vector.length; d++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; vector[d] = seed / 0xffffffff; norm += vector[d]! ** 2; }
      norm = Math.sqrt(norm);
      for (let d = 0; d < vector.length; d++) vector[d] = vector[d]! / norm;
      const id = randomUUID(); const key = `${id}:1:preview-${id}`;
      asset.run(id, `${id}.jpg`, `${id}.jpg`, id, `preview-${id}`, library.updatedAt);
      cache.run(key, Buffer.from(vector.buffer)); bind.run(id, key);
    }
  })();
}
db.pragma("wal_checkpoint(TRUNCATE)");
console.log(JSON.stringify({ populated: count, milliseconds: performance.now() - started }));
}
const engine = new PhotosSearchEngine(db);
const embedding = Array.from({ length: 2048 }, () => 1 / Math.sqrt(2048));
const samples: number[] = [];
let total = 0;
for (let index = 0; index < 22; index++) {
  const before = performance.now();
  const result = engine.query({ libraryUpdatedAt: library.updatedAt, request: { filters: { text: "海边日落" }, limit: 60, includeFacets: true }, embedding,
    search: { mode: "hybrid", semanticState: "ready", indexed: count, total: count, embeddingSpaceId: "benchmark-2048" } });
  total = result.total;
  if (total !== count) throw new Error(`Invalid benchmark: expected ${count} matched vectors, got ${total}`);
  if (index > 1) samples.push(performance.now() - before);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ count, dimensions: 2048, total, warmRuns: samples.length, p50Ms: samples[Math.floor(samples.length * 0.5)],
  p95Ms: samples[Math.ceil(samples.length * 0.95) - 1], rssMiB: process.memoryUsage().rss / 1024 ** 2,
  peakRssMiB: process.resourceUsage().maxRSS / 1024, samplesMs: samples }, null, 2));
db.close();
