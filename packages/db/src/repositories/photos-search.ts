import { normalizePhotosEmbedding, PHOTOS_METADATA_SCHEMA_VERSION, type PhotosQueryFacets, type PhotosQueryRequest } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import { buildPhotosMetadataQuery, photosFtsQuery } from "./photos-metadata.js";
import { getActivePhotosEmbeddingProfile } from "./photos-semantic.js";
import type { PhotosSearchCorpus } from "./photos-search-corpus.js";
export { PhotosSearchCorpusCache, photosCorpusFacets } from "./photos-search-corpus.js";

export interface PhotosSearchMatch {
  id: string;
  sortValue: string | number | null;
  score: number;
}

/** Exact search. Only IDs/scores enter JavaScript; native SQLite streams the vector BLOBs. */
export function rankPhotosSearchMatches(db: CyberOsDatabase, input: {
  libraryUpdatedAt: string;
  request: PhotosQueryRequest;
  embedding?: number[];
  corpus?: PhotosSearchCorpus | undefined;
}): PhotosSearchMatch[] {
  const { text = "", ...filters } = input.request.filters ?? {};
  const relevance = !input.request.sort || input.request.sort.field === "relevance";
  // Relevance ignores the metadata sort value. Use an asset-only expression so
  // SQLite can omit the metadata join unless a filter actually needs it.
  const query = buildPhotosMetadataQuery(input.libraryUpdatedAt, filters,
    relevance ? { field: "indexed_at", direction: "desc" } : input.request.sort);
  const normalizedText = text.normalize("NFKC").trim().toLowerCase();
  const eligible = input.corpus ? (!Object.keys(filters).length && relevance
    ? [...input.corpus.rows.values()]
    : db.prepare(`${query.cte} SELECT id,sort_value AS sortValue FROM matches WHERE ${query.postWhere}`)
      .all(...query.params, ...query.postParams) as Omit<PhotosSearchMatch, "score">[]) : undefined;
  const lexical = input.corpus && eligible ? corpusLexical(db, input.corpus, eligible, text, normalizedText) : db.prepare(`${query.cte}, fts_hits AS MATERIALIZED (
      SELECT asset_id,bm25(photos_metadata_fts) AS rank FROM photos_metadata_fts WHERE photos_metadata_fts MATCH ?
    )
    SELECT q.id,q.sort_value AS sortValue FROM matches q LEFT JOIN fts_hits f ON f.asset_id=q.id
    WHERE ${query.postWhere} AND (f.asset_id IS NOT NULL OR instr(lower(q.name),?)>0
      OR EXISTS(SELECT 1 FROM photos_keywords k WHERE k.asset_id=q.id AND instr(k.normalized_keyword,?)>0))
    ORDER BY CASE WHEN lower(q.name)=? OR EXISTS(SELECT 1 FROM photos_keywords k WHERE k.asset_id=q.id AND k.normalized_keyword=?) THEN 0 ELSE 1 END,
      COALESCE(f.rank,0),q.id`)
    .all(...query.params, photosFtsQuery(text), ...query.postParams, normalizedText, normalizedText, normalizedText, normalizedText) as Omit<PhotosSearchMatch, "score">[];
  const scores = new Map<string, PhotosSearchMatch>();
  const addRanks = (rows: Omit<PhotosSearchMatch, "score">[]) => rows.forEach((row, index) => {
    scores.set(row.id, { id: row.id, sortValue: row.sortValue, score: (scores.get(row.id)?.score ?? 0) + 1 / (60 + index + 1) });
  });
  addRanks(lexical);
  const profile = getActivePhotosEmbeddingProfile(db);
  if (profile && input.embedding) {
    const vector = normalizePhotosEmbedding(input.embedding, profile.dimensions);
    const blob = Buffer.alloc(vector.length * 4);
    vector.forEach((value, index) => blob.writeFloatLE(value, index * 4));
    // Resolve only eligible current-space cache rowids before reading BLOBs.
    // SQLite visits the IN rowid set in storage order and scores shared inputs
    // once, avoiding random vector reads, old spaces and orphaned cache rows.
    const semantic = input.corpus && eligible ? corpusSemantic(db, input.corpus, eligible, blob, profile.minSimilarity,
      !Object.keys(filters).length && relevance) : db.prepare(`${query.cte}, eligible AS MATERIALIZED (
      SELECT id,sort_value,content_hash || ':' || derivative_schema_version || ':' || preview_key AS input_key
      FROM matches WHERE ${query.postWhere}
    ), vector_input AS (SELECT ? AS vector), selected AS MATERIALIZED (
      SELECT q.id,q.sort_value,c.rowid AS cache_id FROM eligible q
      JOIN photos_asset_embeddings b ON b.asset_id=q.id AND b.input_key=q.input_key
      JOIN photos_embedding_cache c ON c.embedding_space_id=b.embedding_space_id AND c.input_key=b.input_key
      WHERE b.embedding_space_id=? AND c.dimensions=?
    ), distances AS MATERIALIZED (
      SELECT c.rowid AS cache_id,1-vec_distance_cosine(c.vector,(SELECT vector FROM vector_input)) AS similarity
      FROM photos_embedding_cache c WHERE c.rowid IN (SELECT cache_id FROM selected)
    ) SELECT s.id,s.sort_value AS sortValue,0 AS score FROM distances d JOIN selected s ON s.cache_id=d.cache_id
      WHERE d.similarity>=? ORDER BY d.similarity DESC,s.id ASC`)
      .all(...query.params, ...query.postParams, blob, profile.embeddingSpaceId, profile.dimensions,
        profile.minSimilarity) as PhotosSearchMatch[];
    if (relevance && input.request.sort?.direction !== "asc" && lexical.length === 0) {
      semantic.forEach((row, index) => { row.score = 1 / (61 + index); });
      return semantic;
    }
    addRanks(semantic);
  }
  const matches = [...scores.values()];
  const direction = input.request.sort?.direction === "asc" ? 1 : -1;
  matches.sort((left, right) => {
    const a = relevance ? left.score : left.sortValue;
    const b = relevance ? right.score : right.sortValue;
    if (a === null && b !== null) return 1;
    if (a !== null && b === null) return -1;
    if (a !== b && a !== null && b !== null) return (a < b ? -1 : 1) * direction;
    return (left.id < right.id ? -1 : left.id > right.id ? 1 : 0) * direction;
  });
  return matches;
}

/** Facets for an already filtered snapshot: every count uses exactly its match IDs. */
export function loadPhotosSearchFacets(db: CyberOsDatabase, ids: readonly string[]): PhotosQueryFacets {
  const matches = JSON.stringify(ids);
  const cte = `WITH matched AS MATERIALIZED (SELECT asset_id,media_kind,camera_model,lens_model,rating,
    iso,aperture,exposure_time_seconds,focal_length_mm FROM photos_asset_metadata
    WHERE schema_version=? AND asset_id IN (SELECT value FROM json_each(?)))`;
  const categories = db.prepare(`${cte} SELECT kind,value,COUNT(*) AS count FROM (
    SELECT 'mediaKinds' AS kind,media_kind AS value FROM matched
    UNION ALL SELECT 'cameraModels',camera_model FROM matched
    UNION ALL SELECT 'lensModels',lens_model FROM matched
    UNION ALL SELECT 'ratings',CAST(rating AS TEXT) FROM matched
  ) WHERE value IS NOT NULL AND value<>'' GROUP BY kind,value ORDER BY count DESC,value ASC`)
    .all(PHOTOS_METADATA_SCHEMA_VERSION, matches) as { kind: "mediaKinds" | "cameraModels" | "lensModels" | "ratings"; value: string; count: number }[];
  const numeric = db.prepare(`${cte} SELECT MIN(iso) AS iso_min,MAX(iso) AS iso_max,
    MIN(aperture) AS aperture_min,MAX(aperture) AS aperture_max,
    MIN(exposure_time_seconds) AS exposure_min,MAX(exposure_time_seconds) AS exposure_max,
    MIN(focal_length_mm) AS focal_min,MAX(focal_length_mm) AS focal_max,
    MIN(rating) AS rating_min,MAX(rating) AS rating_max FROM matched`)
    .get(PHOTOS_METADATA_SCHEMA_VERSION, matches) as Record<string, number | null>;
  const keywords = db.prepare(`SELECT MIN(k.keyword) AS value,COUNT(DISTINCT k.asset_id) AS count FROM photos_keywords k
    JOIN photos_asset_metadata m ON m.asset_id=k.asset_id AND m.schema_version=?
    WHERE k.asset_id IN (SELECT value FROM json_each(?)) GROUP BY k.normalized_keyword ORDER BY count DESC,value ASC LIMIT 100`)
    .all(PHOTOS_METADATA_SCHEMA_VERSION, matches) as { value: string; count: number }[];
  const result: PhotosQueryFacets = { mediaKinds: [], cameraModels: [], lensModels: [], ratings: [], keywords, numeric: {} };
  for (const { kind, value, count } of categories) { if (result[kind].length < 100) result[kind].push({ value, count }); }
  for (const [key, prefix] of Object.entries({ iso: "iso", aperture: "aperture", exposureTimeSeconds: "exposure", focalLengthMm: "focal", rating: "rating" })) {
    result.numeric[key] = { min: numeric[`${prefix}_min`] ?? null, max: numeric[`${prefix}_max`] ?? null };
  }
  return result;
}

function corpusLexical(db: CyberOsDatabase, corpus: PhotosSearchCorpus, eligible: Omit<PhotosSearchMatch, "score">[], text: string, normalized: string): Omit<PhotosSearchMatch, "score">[] {
  const fts = new Map((db.prepare(`SELECT asset_id AS id,bm25(photos_metadata_fts) AS rank
    FROM photos_metadata_fts WHERE photos_metadata_fts MATCH ?`).all(photosFtsQuery(text)) as { id: string; rank: number }[]).map(({ id, rank }) => [id, rank]));
  return eligible.filter(({ id }) => fts.has(id) || corpus.rows.get(id)!.name.includes(normalized) ||
    corpus.keywords.get(id)?.some((keyword) => keyword.normalized.includes(normalized))).map((row) => {
    const exact = corpus.rows.get(row.id)!.name === normalized || corpus.keywords.get(row.id)?.some((keyword) => keyword.normalized === normalized);
    return { id: row.id, sortValue: row.sortValue, exact: exact ? 0 : 1, rank: fts.get(row.id) ?? 0 };
  }).sort((a, b) => a.exact - b.exact || a.rank - b.rank || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function corpusSemantic(db: CyberOsDatabase, corpus: PhotosSearchCorpus, eligible: Omit<PhotosSearchMatch, "score">[], vector: Buffer, threshold: number, all: boolean): PhotosSearchMatch[] {
  const selected = all ? undefined : new Map(eligible.map((row) => [row.id, row]));
  const byCache = all ? corpus.assetsByCache : new Map<number, string[]>();
  if (!all) for (const row of eligible) {
    const cacheId = corpus.rows.get(row.id)?.cacheId;
    if (cacheId === undefined || cacheId === null) continue;
    const entries = byCache.get(cacheId) ?? [];
    entries.push(row.id); byCache.set(cacheId, entries);
  }
  const ids = all ? corpus.vectorIds : JSON.stringify([...byCache.keys()].sort((a, b) => a - b));
  const distances = db.prepare(`WITH distances AS MATERIALIZED (
    SELECT rowid AS cacheId,1-vec_distance_cosine(vector,?) AS similarity
    FROM photos_embedding_cache WHERE rowid IN (SELECT value FROM json_each(?))
  ) SELECT cacheId,similarity FROM distances WHERE similarity>=? ORDER BY similarity DESC`).raw().all(vector, ids, threshold) as [number, number][];
  const matches: PhotosSearchMatch[] = [];
  // Native sorting avoids a second object graph and comparator calls in V8.
  // Equal similarities still use asset IDs, including shared-content bindings.
  for (let index = 0; index < distances.length;) {
    const first = distances[index]!;
    let end = index + 1;
    while (end < distances.length && distances[end]![1] === first[1]) end++;
    const firstIds = byCache.get(first[0])!;
    // The common case needs no temporary group or JavaScript sort.
    if (end === index + 1 && firstIds.length === 1) {
      const id = firstIds[0]!;
      matches.push({ id, sortValue: selected?.get(id)?.sortValue ?? null, score: 0 });
    } else {
      const tiedIds: string[] = [];
      for (let next = index; next < end; next++) for (const id of byCache.get(distances[next]![0])!) tiedIds.push(id);
      tiedIds.sort();
      for (const id of tiedIds) matches.push({ id, sortValue: selected?.get(id)?.sortValue ?? null, score: 0 });
    }
    index = end;
  }
  return matches;
}
