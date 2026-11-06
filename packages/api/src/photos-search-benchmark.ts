import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import * as sqliteVec from "sqlite-vec";
import type { PhotosQueryRequest } from "@cyberos/shared";
import { openCyberOsDb, openCyberOsDbReadOnly, getPhotosLibrarySettings, savePhotosLibrarySettings, savePhotosSemanticSettings, activatePhotosEmbeddingModel, getActivePhotosEmbeddingProfile } from "@cyberos/db";
import { PhotosSearchEngine } from "./lib/photos-search-engine.js";

const args = parseArgs({ allowPositionals: true, options: {
  reuse: { type: "boolean" }, dimensions: { type: "string" }, filtered: { type: "boolean" },
  partial: { type: "boolean" }, history: { type: "string" },
  runs: { type: "string" }, varied: { type: "boolean" }, literal: { type: "boolean" }, sort: { type: "string" }
} });
const directory = args.positionals[0];
if (!directory) throw new Error("Usage: node photos-search-benchmark.js <new isolated directory> [count=100000]");
const reuse = args.values.reuse ?? false;
if (!reuse) await mkdir(directory, { recursive: false });
const count = Number(args.positionals[1] ?? 100_000);
if (!Number.isInteger(count) || count < 1 || count > 100_000) throw new Error("Count must be 1..100000");
const db = (reuse ? openCyberOsDbReadOnly : openCyberOsDb)(path.join(directory, "benchmark.sqlite")); sqliteVec.load(db);
if (reuse && getPhotosLibrarySettings(db)?.storagePoolId !== "benchmark") throw new Error("Only synthetic benchmark databases can be reused");
const dimensions = Number(args.values.dimensions ?? (reuse ? getActivePhotosEmbeddingProfile(db)?.dimensions : 2048));
if (!Number.isInteger(dimensions) || dimensions < 64 || dimensions > 2048) throw new Error("Dimensions must be 64..2048");
const space = `benchmark-${dimensions}`;
if (reuse && getActivePhotosEmbeddingProfile(db)?.embeddingSpaceId !== space) throw new Error("Reused benchmark has a different vector space");
const history = Number(args.values.history ?? 0);
if (!Number.isInteger(history) || history < 0 || history > 100_000) throw new Error("History must be 0..100000");
let library = getPhotosLibrarySettings(db)!;
if (!reuse) {
library = savePhotosLibrarySettings(db, { storagePoolId: "benchmark", path: "synthetic" });
const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "http://127.0.0.1:1", model: "benchmark" });
activatePhotosEmbeddingModel(db, { protocol: "cyberos-photos-embedding/v1", model: "benchmark", revision: "synthetic-only",
  embeddingSpaceId: space, dimensions, normalized: true, modalities: ["text", "image"] }, settings.generation);
const asset = db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
  preview_key,taken_at,taken_at_source,status,library_updated_at,indexed_at) VALUES(?,'benchmark',?,?,'image/jpeg',1,0,?,?,'2026-01-01','file_mtime','ready',?,'2026-01-01')`);
const cache = db.prepare("INSERT INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) VALUES(?,?,?, ?,'2026-01-01')");
const bind = db.prepare("INSERT INTO photos_asset_embeddings VALUES(?,?,?)");
const metadata = db.prepare(`INSERT INTO photos_asset_metadata(asset_id,schema_version,status,media_kind,capture_source,camera_model,raw_metadata_json,warnings_json,updated_at)
  VALUES(?,2,'ready','image','file_mtime',?,'{}','[]','2026-01-01')`);
let seed = 42;
const vector = new Float32Array(dimensions);
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
      metadata.run(id, index % 100 === 0 ? "subset" : "other");
      if (!args.values.partial || index % 2 === 0) { cache.run(space, key, dimensions, Buffer.from(vector.buffer)); bind.run(id, space, key); }
    }
  })();
}
if (history) {
  db.prepare("INSERT INTO photos_embedding_profiles(embedding_space_id,model,revision,dimensions,created_at) VALUES('historical','benchmark','old',?,'2020-01-01')").run(dimensions);
  for (let offset = 0; offset < history; offset += 500) db.transaction(() => {
    for (let i = offset; i < Math.min(history, offset + 500); i++) cache.run("historical", `old-${i}`, dimensions, Buffer.from(vector.buffer));
  })();
}
db.pragma("wal_checkpoint(TRUNCATE)");
console.log(JSON.stringify({ populated: count, milliseconds: performance.now() - started }));
}
const engine = new PhotosSearchEngine(db);
const embedding = Array.from({ length: dimensions }, () => 1 / Math.sqrt(dimensions));
const expected = args.values.filtered ? Math.ceil(count / 100) : args.values.partial && !args.values.literal ? Math.ceil(count / 2) : count;
const runs = Number(args.values.runs ?? 20);
if (!Number.isInteger(runs) || runs < 20 || runs > 1000) throw new Error("Runs must be 20..1000");
const sort = args.values.sort;
if (sort && sort !== "name" && sort !== "captured_at") throw new Error("Sort must be name or captured_at");
const querySort: PhotosQueryRequest["sort"] = sort === "name" || sort === "captured_at" ? { field: sort, direction: "desc" } : undefined;
const keywords = args.values.literal ? [".jpg"] : args.values.varied ? ["海边日落", "森林徒步", "city skyline", "建筑夜景", "宠物奔跑"] : ["海边日落"];
const embeddings = keywords.map((_, index) => {
  const vector = args.values.varied ? embedding.map((value, d) => value * (1 + ((index + d) % 5) / 10)) : embedding;
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  return vector.map((value) => value / norm);
});
const samples: number[] = [];
let coldFirstPageMs = 0;
let total = 0;
for (let index = 0; index < runs + 2; index++) {
  const before = performance.now();
  const result = engine.query({ libraryUpdatedAt: library.updatedAt, request: { filters: { text: keywords[index % keywords.length]!, ...(args.values.filtered ? { cameraModels: ["subset"] } : {}) }, limit: 60, includeFacets: true, ...(querySort ? { sort: querySort } : {}) },
    embedding: embeddings[index % embeddings.length]!,
    search: { mode: "hybrid", semanticState: "ready", indexed: count, total: count, embeddingSpaceId: space } });
  total = result.total;
  if (total !== expected) throw new Error(`Invalid benchmark: expected ${expected} matched vectors, got ${total}`);
  if (index === 0) coldFirstPageMs = performance.now() - before;
  if (index > 1) samples.push(performance.now() - before);
}
samples.sort((a, b) => a - b);
console.log(JSON.stringify({ count, dimensions, history, filtered: args.values.filtered ?? false, partial: args.values.partial ?? false, total, coldFirstPageMs, varied: args.values.varied ?? false, literal: args.values.literal ?? false, sort: sort ?? "relevance", warmRuns: samples.length, p50Ms: samples[Math.floor(samples.length * 0.5)],
  p95Ms: samples[Math.ceil(samples.length * 0.95) - 1], rssMiB: process.memoryUsage().rss / 1024 ** 2,
  peakRssMiB: process.resourceUsage().maxRSS / 1024, samplesMs: samples }, null, 2));
db.close();
