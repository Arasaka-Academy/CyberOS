import { PHOTOS_METADATA_SCHEMA_VERSION, type PhotosMetadataIndexStatus, type PhotosQueryFacets } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";

interface CorpusRow {
  id: string;
  name: string;
  sortValue: null;
  cacheId: number | null;
  inputReady: number;
  schemaVersion: number | null;
  metadataStatus: string | null;
  mediaKind: string | null;
  cameraModel: string | null;
  lensModel: string | null;
  rating: number | null;
  ratingText: string | null;
  iso: number | null;
  aperture: number | null;
  exposureTimeSeconds: number | null;
  focalLengthMm: number | null;
}
export interface PhotosSearchCorpus {
  rows: Map<string, CorpusRow>;
  keywords: Map<string, { value: string; normalized: string }[]>;
  vectorIds: string;
  assetsByCache: Map<number, string[]>;
  metadataIndex: PhotosMetadataIndexStatus;
  searchCounts: { indexed: number; total: number };
  allFacets?: PhotosQueryFacets;
}

/** One reader-owned, revision-bound metadata cache. It never retains vector BLOBs. */
export class PhotosSearchCorpusCache {
  constructor(private readonly maxBytes = 64 * 1024 * 1024) {}

  private key = "";
  private corpus: PhotosSearchCorpus | undefined;

  get(db: CyberOsDatabase, library: string, space: string | undefined, dimensions: number | undefined): PhotosSearchCorpus | undefined {
    const revision = db.prepare("SELECT revision FROM photos_search_state WHERE id=1").pluck().get();
    const schema = db.pragma("schema_version", { simple: true });
    const key = JSON.stringify([library, space, dimensions, revision, schema]);
    if (key === this.key) return this.corpus;
    // Release the previous corpus before loading a replacement, including when
    // a large library exceeds the cache budget and uses the streaming SQL path.
    this.key = key;
    this.corpus = undefined;
    const rows = new Map<string, CorpusRow>();
    const keywords: PhotosSearchCorpus["keywords"] = new Map();
    const vectorIds = new Set<number>();
    const assetsByCache = new Map<number, string[]>();
    let bytes = 0, indexed = 0, partial = 0, semanticTotal = 0, semanticIndexed = 0;
    const statement = db.prepare(`SELECT a.id,lower(a.name) AS name,NULL AS sortValue,c.rowid AS cacheId,
      (a.content_hash IS NOT NULL AND a.preview_key IS NOT NULL) AS inputReady,m.schema_version AS schemaVersion,
      m.status AS metadataStatus,m.media_kind AS mediaKind,m.camera_model AS cameraModel,m.lens_model AS lensModel,
      m.rating,CAST(m.rating AS TEXT) AS ratingText,m.iso,m.aperture,m.exposure_time_seconds AS exposureTimeSeconds,m.focal_length_mm AS focalLengthMm
      FROM photos_assets a LEFT JOIN photos_asset_metadata m ON m.asset_id=a.id
      LEFT JOIN photos_asset_embeddings b ON b.asset_id=a.id AND b.embedding_space_id=?
        AND b.input_key=a.content_hash || ':' || a.derivative_schema_version || ':' || a.preview_key
      LEFT JOIN photos_embedding_cache c ON c.embedding_space_id=b.embedding_space_id AND c.input_key=b.input_key AND c.dimensions=?
      WHERE a.library_updated_at=? AND a.status='ready'`);
    for (const row of statement.iterate(space ?? null, dimensions ?? null, library) as Iterable<CorpusRow>) {
      bytes += 400 + 2 * (row.id.length + row.name.length + (row.cameraModel?.length ?? 0) + (row.lensModel?.length ?? 0));
      if (bytes > this.maxBytes) return undefined;
      rows.set(row.id, row);
      if (row.inputReady) semanticTotal++;
      if (row.cacheId !== null) {
        semanticIndexed++;
        vectorIds.add(row.cacheId);
        const assets = assetsByCache.get(row.cacheId) ?? [];
        assets.push(row.id); assetsByCache.set(row.cacheId, assets);
      }
      if (row.schemaVersion === PHOTOS_METADATA_SCHEMA_VERSION) {
        indexed++;
        if (row.metadataStatus === "partial") partial++;
      }
    }
    for (const row of db.prepare(`SELECT k.asset_id AS id,k.keyword AS value,k.normalized_keyword AS normalized
      FROM photos_keywords k JOIN photos_assets a ON a.id=k.asset_id
      WHERE a.library_updated_at=? AND a.status='ready' ORDER BY k.asset_id,k.normalized_keyword`).iterate(library) as Iterable<{ id: string; value: string; normalized: string }>) {
      bytes += 112 + 2 * (row.value.length + row.normalized.length);
      if (bytes > this.maxBytes) return undefined;
      const values = keywords.get(row.id) ?? [];
      values.push({ value: row.value, normalized: row.normalized });
      keywords.set(row.id, values);
    }
    const ids = JSON.stringify([...vectorIds].sort((a, b) => a - b));
    if (bytes + ids.length * 2 > this.maxBytes) return undefined;
    this.corpus = { rows, keywords, vectorIds: ids, assetsByCache, searchCounts: { indexed: semanticIndexed, total: semanticTotal },
      metadataIndex: { schemaVersion: PHOTOS_METADATA_SCHEMA_VERSION, total: rows.size, indexed, partial, pending: rows.size - indexed } };
    this.corpus.allFacets = photosCorpusFacets(this.corpus, [...rows.keys()]);
    return this.corpus;
  }
}

/** Aggregate exactly the snapshot's IDs once, instead of materializing them for each facet. */
export function photosCorpusFacets(corpus: PhotosSearchCorpus, ids: readonly string[]): PhotosQueryFacets {
  // Search matches are unique. Equal cardinality means the snapshot contains
  // the complete current corpus; its aggregate remains valid for this revision.
  if (corpus.allFacets && ids.length === corpus.rows.size) return corpus.allFacets;
  const categories = { mediaKinds: new Map<string, number>(), cameraModels: new Map<string, number>(),
    lensModels: new Map<string, number>(), ratings: new Map<string, number>() };
  const keywords = new Map<string, { value: string; count: number }>();
  const result: PhotosQueryFacets = { mediaKinds: [], cameraModels: [], lensModels: [], ratings: [], keywords: [], numeric: {} };
  const numeric = ["iso", "aperture", "exposureTimeSeconds", "focalLengthMm", "rating"] as const;
  for (const key of numeric) result.numeric[key] = { min: null, max: null };
  for (const id of ids) {
    const row = corpus.rows.get(id);
    if (!row || row.schemaVersion !== PHOTOS_METADATA_SCHEMA_VERSION) continue;
    if (row.mediaKind) categories.mediaKinds.set(row.mediaKind, (categories.mediaKinds.get(row.mediaKind) ?? 0) + 1);
    if (row.cameraModel) categories.cameraModels.set(row.cameraModel, (categories.cameraModels.get(row.cameraModel) ?? 0) + 1);
    if (row.lensModel) categories.lensModels.set(row.lensModel, (categories.lensModels.get(row.lensModel) ?? 0) + 1);
    if (row.rating !== null) {
      const rating = row.ratingText!; categories.ratings.set(rating, (categories.ratings.get(rating) ?? 0) + 1);
    }
    for (const key of numeric) {
      const value = row[key], range = result.numeric[key]!;
      if (value !== null) { range.min = range.min === null ? value : Math.min(range.min, value); range.max = range.max === null ? value : Math.max(range.max, value); }
    }
    for (const keyword of corpus.keywords.get(id) ?? []) {
      const entry = keywords.get(keyword.normalized) ?? { value: keyword.value, count: 0 };
      if (Buffer.compare(Buffer.from(keyword.value), Buffer.from(entry.value)) < 0) entry.value = keyword.value;
      entry.count++;
      keywords.set(keyword.normalized, entry);
    }
  }
  const sort = (a: { value: string; count: number }, b: { value: string; count: number }) => b.count - a.count || Buffer.compare(Buffer.from(a.value), Buffer.from(b.value));
  for (const kind of Object.keys(categories) as (keyof typeof categories)[]) {
    result[kind] = [...categories[kind]].map(([value, count]) => ({ value, count })).sort(sort).slice(0, 100);
  }
  result.keywords = [...keywords.values()].sort(sort).slice(0, 100);
  return result;
}
