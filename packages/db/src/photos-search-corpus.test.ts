import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, expect, it } from "vitest";
import type { PhotosQueryRequest } from "@cyberos/shared";
import { activatePhotosEmbeddingModel, openCyberOsDb, savePhotosLibrarySettings, savePhotosSemanticSettings,
  type CyberOsDatabase } from "./index.js";
import { loadPhotosSearchFacets, photosCorpusFacets, PhotosSearchCorpusCache, rankPhotosSearchMatches } from "./repositories/photos-search.js";

let directory: string, db: CyberOsDatabase, library: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-search-corpus-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite")); sqliteVec.load(db);
  library = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" }).updatedAt;
  const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "http://127.0.0.1:1", model: "test" });
  activatePhotosEmbeddingModel(db, { protocol: "cyberos-photos-embedding/v1", model: "test", revision: "1", dimensions: 2,
    normalized: true, modalities: ["text", "image"], embeddingSpaceId: "space" }, settings.generation);
  db.prepare("UPDATE photos_embedding_profiles SET min_similarity=0.25").run();
  const asset = db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
    preview_key,taken_at,taken_at_source,status,library_updated_at,indexed_at)
    VALUES(?,'pool',?,?,'image/jpeg',100,0,?,?,'2026-01-01','file_mtime','ready',?,'2026-01-01')`);
  const metadata = db.prepare(`INSERT INTO photos_asset_metadata(asset_id,schema_version,status,media_kind,capture_source,
    camera_model,lens_model,rating,iso,gps_latitude,gps_longitude,raw_metadata_json,warnings_json,updated_at)
    VALUES(?,?,'ready','image','file_mtime',?,'Lens',?,?,30,120,'{}','[]','2026-01-01')`);
  const cache = db.prepare("INSERT INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) VALUES('space',?,2,?,'2026-01-01')");
  for (let i = 0; i < 12; i++) {
    const id = `photo-${i}`;
    const content = i === 1 ? "photo-0" : id;
    asset.run(id, `${id}.jpg`, i === 3 ? "ÎSAAB.jpg" : i < 6 ? `海边-${i}.jpg` : `mountain-${i}.jpg`, content, content, library);
    if (i !== 8) metadata.run(id, i === 9 ? 1 : 2, i % 2 ? "Camera B" : "Camera A", i % 6, 100 + i);
    if (i !== 1 && i !== 10) cache.run(`${content}:1:${content}`, Buffer.from(new Float32Array(i < 7 ? [1, 0] : [0, 1]).buffer));
    if (i !== 10) db.prepare("INSERT INTO photos_asset_embeddings VALUES(?, 'space', ?)").run(id, `${content}:1:${content}`);
  }
  db.prepare("UPDATE photos_assets SET preview_key='new-preview' WHERE id='photo-11'").run();
  db.prepare("UPDATE photos_assets SET status='failed' WHERE id='photo-6'").run();
  db.prepare("INSERT INTO photos_keywords VALUES('photo-0','trip','trip'),('photo-1','Trip','trip'),('photo-5','海边','海边')").run();
  db.prepare("INSERT INTO photos_metadata_fts(asset_id,name,description) SELECT id,name,'water ocean' FROM photos_assets WHERE id IN ('photo-0','photo-2')").run();
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

it.each<PhotosQueryRequest>([
  { filters: { text: "海边" } }, { filters: { text: "ocean" } }, { filters: { text: "missing" } },
  { filters: { text: "trip" } }, { filters: { text: "îs" } },
  { filters: { text: "海边", cameraModels: ["Camera B"] } },
  { filters: { text: "ocean", rating: { min: 2 }, iso: { max: 109 } } },
  { filters: { text: "ocean" }, sort: { field: "relevance", direction: "asc" } },
  { filters: { text: "海边" }, sort: { field: "name", direction: "asc" } },
  { filters: { text: "海边" }, sort: { field: "rating", direction: "desc" } }
])("keeps complete ranking and facets equivalent to uncached SQL: %j", (request) => {
  const input = { libraryUpdatedAt: library, request, embedding: [1, 0] };
  const original = rankPhotosSearchMatches(db, input);
  const corpus = new PhotosSearchCorpusCache().get(db, library, "space", 2)!;
  const cached = rankPhotosSearchMatches(db, { ...input, corpus });
  expect(cached.map(({ id, score }) => ({ id, score }))).toEqual(original.map(({ id, score }) => ({ id, score })));
  if (request.sort && request.sort.field !== "relevance") expect(cached).toEqual(original);
  expect(photosCorpusFacets(corpus, original.map(({ id }) => id))).toEqual(loadPhotosSearchFacets(db, original.map(({ id }) => id)));
  expect(original.some(({ id }) => ["photo-6", "photo-10", "photo-11"].includes(id))).toBe(false);
});

it("refreshes vector bindings, changed inputs and metadata after committed writes", () => {
  const cache = new PhotosSearchCorpusCache();
  const first = cache.get(db, library, "space", 2)!;
  expect(cache.get(db, library, "space", 2)).toBe(first);
  expect(first.searchCounts).toEqual({ indexed: 9, total: 11 });
  db.prepare("INSERT INTO photos_embedding_cache(embedding_space_id,input_key,dimensions,vector,created_at) SELECT embedding_space_id,'obsolete',dimensions,vector,created_at FROM photos_embedding_cache LIMIT 1").run();
  db.prepare("UPDATE photos_asset_embeddings SET input_key='obsolete' WHERE asset_id='photo-0'").run();
  const second = cache.get(db, library, "space", 2)!;
  expect(second).not.toBe(first);
  const request = { filters: { text: "missing" } };
  expect(rankPhotosSearchMatches(db, { libraryUpdatedAt: library, request, embedding: [1, 0], corpus: second }).map(({ id }) => id)).not.toContain("photo-0");
  db.prepare("UPDATE photos_assets SET content_hash='replacement' WHERE id='photo-1'").run();
  expect(cache.get(db, library, "space", 2)).not.toBe(second);
  const third = cache.get(db, library, "space", 2)!;
  db.prepare("DELETE FROM photos_asset_metadata WHERE asset_id='photo-0'").run();
  expect(cache.get(db, library, "space", 2)!.metadataIndex.indexed).toBe(third.metadataIndex.indexed - 1);
  expect(cache.get(db, 'another-library', "space", 2)!.rows.size).toBe(0);
});

it("uses the complete SQL fallback when the metadata cache budget is exceeded", () => {
  expect(new PhotosSearchCorpusCache(1).get(db, library, "space", 2)).toBeUndefined();
  const input = { libraryUpdatedAt: library, request: { filters: { text: "missing" } }, embedding: [1, 0] };
  expect(rankPhotosSearchMatches(db, input)).toHaveLength(6);
});

it("refreshes cached rowids after VACUUM rebuilds the database", () => {
  const cache = new PhotosSearchCorpusCache();
  const before = cache.get(db, library, "space", 2)!;
  db.exec("VACUUM");
  expect(cache.get(db, library, "space", 2)).not.toBe(before);
});
