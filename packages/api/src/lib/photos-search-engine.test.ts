import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import * as sqliteVec from "sqlite-vec";
import { afterEach, beforeEach, expect, it } from "vitest";
import { openCyberOsDb, savePhotosLibrarySettings, savePhotosSemanticSettings, activatePhotosEmbeddingModel, type CyberOsDatabase } from "@cyberos/db";
import { PhotosSearchEngine } from "./photos-search-engine.js";

let directory: string;
let db: CyberOsDatabase;
let library: string;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-search-snapshot-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite")); sqliteVec.load(db);
  library = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" }).updatedAt;
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
function add(id: string) {
  db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
    taken_at,taken_at_source,status,library_updated_at,indexed_at)
    VALUES(?,'pool',?,?,'image/jpeg',100,0,?,'2026-01-01','file_mtime','ready',?,'2026-01-01')`).run(id, `photos/${id}.jpg`, `海边-${id}.jpg`, id, library);
}
const search = { mode: "lexical" as const, semanticState: "disabled" as const, indexed: 0, total: 0, embeddingSpaceId: null };
it("keeps pagination stable when new photos arrive and expires bound cursors", () => {
  add("a"); add("b");
  let clock = 1000;
  const engine = new PhotosSearchEngine(db, { now: () => clock });
  const input = { libraryUpdatedAt: library, request: { filters: { text: "海边" }, limit: 1, includeFacets: true }, search };
  const first = engine.query(input);
  expect(first.total).toBe(2);
  expect(first.nextCursor).toBeTruthy();
  add("c");
  const second = engine.query({ ...input, request: { ...input.request, cursor: first.nextCursor } });
  expect(second.total).toBe(2);
  expect(second.photos[0]!.id).not.toBe(first.photos[0]!.id);
  expect(second.nextCursor).toBeNull();
  expect(() => engine.query({ ...input, request: { ...input.request, filters: { text: "其他" }, cursor: first.nextCursor } })).toThrow(/another query/iu);
  clock += 5 * 60_000 + 1;
  expect(() => engine.query({ ...input, request: { ...input.request, cursor: first.nextCursor } })).toThrow(/expired/iu);
});
it("never returns all photos for a missing keyword or a deleted snapshot asset", () => {
  add("a"); add("b");
  const engine = new PhotosSearchEngine(db);
  expect(engine.query({ libraryUpdatedAt: library, request: { filters: { text: "外星飞船" } }, search }).total).toBe(0);
  const input = { libraryUpdatedAt: library, request: { filters: { text: "海边" }, limit: 1 }, search };
  const first = engine.query(input);
  db.prepare("DELETE FROM photos_assets WHERE id=?").run(first.photos[0]!.id);
  expect(() => engine.query({ ...input, request: { ...input.request, cursor: first.nextCursor } })).toThrow(/changed|expired/iu);
});

it("counts facets and map matches from the same filtered keyword result", () => {
  add("a"); add("b"); add("c");
  const insert = db.prepare(`INSERT INTO photos_asset_metadata(asset_id,schema_version,status,media_kind,capture_source,
    camera_model,rating,iso,gps_latitude,gps_longitude,raw_metadata_json,warnings_json,updated_at)
    VALUES(?,2,'ready','image','file_mtime',?,?,?,30,120,'{}','[]','2026-01-01')`);
  insert.run("a", "Camera A", 5, 100); insert.run("b", "Camera B", 3, 400); insert.run("c", "Camera A", 5, 800);
  db.prepare(`INSERT INTO photos_geo_index(metadata_rowid,min_latitude,max_latitude,min_longitude,max_longitude)
    SELECT rowid,30,30,120,120 FROM photos_asset_metadata`).run();
  db.prepare("UPDATE photos_assets SET name='其他.jpg' WHERE id='c'").run();
  db.prepare("INSERT INTO photos_keywords(asset_id,keyword,normalized_keyword) VALUES('a','旅行','旅行')").run();
  const engine = new PhotosSearchEngine(db);
  const first = engine.query({ libraryUpdatedAt: library, request: { filters: { text: "海边" }, limit: 1, includeFacets: true }, search });
  expect(first.total).toBe(2);
  expect(first.facets?.cameraModels).toEqual([{ value: "Camera A", count: 1 }, { value: "Camera B", count: 1 }]);
  expect(first.facets?.numeric.iso).toEqual({ min: 100, max: 400 });
  expect(first.facets?.keywords).toEqual([{ value: "旅行", count: 1 }]);
  const map = engine.map({ libraryUpdatedAt: library, request: { filters: { text: "海边" },
    bounds: { kind: "bounds", north: 40, south: 20, east: 130, west: 110 }, columns: 8, rows: 8 }, search });
  expect(map.clusters.reduce((sum, cluster) => sum + cluster.count, 0)).toBe(first.total);
});

it("rejects text vectors from an obsolete model before scoring", () => {
  add("a");
  const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "https://example.test", model: "test/model" });
  activatePhotosEmbeddingModel(db, { protocol: "cyberos-photos-embedding/v1", model: "test/model", revision: "new",
    dimensions: 2, embeddingSpaceId: "new-space", normalized: true, modalities: ["image", "text"] }, settings.generation);
  const engine = new PhotosSearchEngine(db);
  expect(() => engine.query({ libraryUpdatedAt: library, request: { filters: { text: "海边" } },
    search: { ...search, mode: "hybrid", semanticState: "ready", embeddingSpaceId: "old-space" }, embedding: [1, 0] })).toThrow(/model changed/iu);
});

it("invalidates an existing snapshot when the preview processing version changes", () => {
  add("a"); add("b");
  const engine = new PhotosSearchEngine(db);
  const input = { libraryUpdatedAt: library, request: { filters: { text: "海边" }, limit: 1 }, search };
  const first = engine.query(input);
  expect(first.nextCursor).toBeTruthy();
  db.prepare("UPDATE photos_assets SET derivative_schema_version=derivative_schema_version+1 WHERE id='a'").run();
  expect(() => engine.query({ ...input, request: { ...input.request, cursor: first.nextCursor } })).toThrow(/changed|expired/iu);
});
