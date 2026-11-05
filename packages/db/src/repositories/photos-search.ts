import { normalizePhotosEmbedding, PHOTOS_METADATA_SCHEMA_VERSION, type PhotosQueryFacets, type PhotosQueryRequest } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import { buildPhotosMetadataQuery, photosFtsQuery } from "./photos-metadata.js";
import { getActivePhotosEmbeddingProfile } from "./photos-semantic.js";

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
}): PhotosSearchMatch[] {
  const { text = "", ...filters } = input.request.filters ?? {};
  const relevance = !input.request.sort || input.request.sort.field === "relevance";
  // Relevance ignores the metadata sort value. Use an asset-only expression so
  // SQLite can omit the metadata join unless a filter actually needs it.
  const query = buildPhotosMetadataQuery(input.libraryUpdatedAt, filters,
    relevance ? { field: "indexed_at", direction: "desc" } : input.request.sort);
  const normalizedText = text.normalize("NFKC").trim().toLowerCase();
  const lexical = db.prepare(`${query.cte}, fts_hits AS MATERIALIZED (
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
    scores.set(row.id, { ...row, score: (scores.get(row.id)?.score ?? 0) + 1 / (60 + index + 1) });
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
    const semantic = db.prepare(`${query.cte}, eligible AS MATERIALIZED (
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
    ) SELECT s.id,s.sort_value AS sortValue FROM distances d JOIN selected s ON s.cache_id=d.cache_id
      WHERE d.similarity>=? ORDER BY d.similarity DESC,s.id ASC`)
      .all(...query.params, ...query.postParams, blob, profile.embeddingSpaceId, profile.dimensions,
        profile.minSimilarity) as Omit<PhotosSearchMatch, "score">[];
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
  const keywords = db.prepare(`SELECT k.keyword AS value,COUNT(DISTINCT k.asset_id) AS count FROM photos_keywords k
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
