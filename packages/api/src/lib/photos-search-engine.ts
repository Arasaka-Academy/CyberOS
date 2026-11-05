import { createHash, randomUUID } from "node:crypto";
import {
  getActivePhotosEmbeddingProfile, getPhotosEmbeddingRuntime, getPhotosSemanticSettings, getPhotosMetadataIndexStatus,
  loadPhotosSearchFacets, photosQueryFingerprint, queryPhotosAssets, queryPhotosMap, rankPhotosSearchMatches,
  type CyberOsDatabase
} from "@cyberos/db";
import type { PhotoMapQueryRequest, PhotoMapQueryResult, PhotoQueryPage, PhotoQueryRequest, PhotosSearchInfo } from "@cyberos/shared";

export interface PhotosSearchInput {
  libraryUpdatedAt: string;
  request: PhotoQueryRequest;
  search: PhotosSearchInfo;
  embedding?: number[];
}
export interface PhotosMapSearchInput extends Omit<PhotosSearchInput, "request"> { request: PhotoMapQueryRequest }
interface Snapshot {
  id: string;
  fingerprint: string;
  source: string;
  expires: number;
  matches: { id: string; score: number }[];
  facets: PhotoQueryPage["facets"];
  metadataIndex: PhotoQueryPage["metadataIndex"];
  search: PhotosSearchInfo;
  bytes: number;
}

export class PhotosSearchCursorError extends Error {
  readonly expose = true;
  constructor(message: string, readonly statusCode = 409) { super(message); }
}

/** Owned by the SQLite reader thread. Never retains vectors or hydrated photos. */
export class PhotosSearchEngine {
  private readonly snapshots = new Map<string, Snapshot>();
  private bytes = 0;
  private readonly now: () => number;
  constructor(private readonly db: CyberOsDatabase, options: { now?: () => number } = {}) {
    this.now = options.now ?? Date.now;
  }

  query(input: PhotosSearchInput): PhotoQueryPage {
    // One read transaction keeps source identity, ranking, counts and facets consistent.
    return this.db.transaction(() => { this.checkEmbeddingSpace(input); return this.querySnapshot(input); })();
  }

  map(input: PhotosMapSearchInput): PhotoMapQueryResult {
    return this.db.transaction(() => {
      this.checkEmbeddingSpace(input);
      const { text: _text, ...filters } = input.request.filters ?? {};
      const matches = rankPhotosSearchMatches(this.db, { ...input, request: {
        filters: { ...input.request.filters, location: input.request.bounds }
      } });
      return {
        clusters: queryPhotosMap(this.db, { libraryUpdatedAt: input.libraryUpdatedAt,
          request: { ...input.request, filters }, matchingIds: matches.map(({ id }) => id) }),
        metadataIndex: getPhotosMetadataIndexStatus(this.db, input.libraryUpdatedAt), search: input.search
      };
    })();
  }

  private checkEmbeddingSpace(input: PhotosSearchInput | PhotosMapSearchInput): void {
    if (input.embedding && (!getPhotosSemanticSettings(this.db).enabled ||
        getActivePhotosEmbeddingProfile(this.db)?.embeddingSpaceId !== input.search.embeddingSpaceId)) {
      throw new PhotosSearchCursorError("Photo search model changed; refresh results");
    }
  }

  private querySnapshot(input: PhotosSearchInput): PhotoQueryPage {
    const request = input.request;
    const fingerprint = photosQueryFingerprint({ ...request, sort: request.sort ?? { field: "relevance", direction: "desc" } });
    const runtime = getPhotosEmbeddingRuntime(this.db);
    const profile = getActivePhotosEmbeddingProfile(this.db);
    const source = createHash("sha256").update(JSON.stringify([
      input.libraryUpdatedAt, runtime.asset_revision, runtime.epoch, profile?.embeddingSpaceId, profile?.minSimilarity,
      getPhotosSemanticSettings(this.db).enabled
    ])).digest("base64url");
    let snapshot: Snapshot;
    let offset = 0;
    this.prune();
    if (request.cursor) {
      let cursor: { id: string; offset: number; fingerprint: string };
      try {
        if (request.cursor.length > 2048) throw new Error();
        cursor = JSON.parse(Buffer.from(request.cursor, "base64url").toString()) as typeof cursor;
        if (!cursor || typeof cursor.id !== "string" || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0) throw new Error();
      } catch { throw new PhotosSearchCursorError("Photo search cursor is invalid", 400); }
      if (cursor.fingerprint !== fingerprint) throw new PhotosSearchCursorError("Photo cursor belongs to another query", 400);
      const stored = this.snapshots.get(cursor.id);
      if (!stored || stored.source !== source) throw new PhotosSearchCursorError("Photo search snapshot expired or source changed");
      snapshot = stored;
      offset = cursor.offset;
      if (offset >= snapshot.matches.length) throw new PhotosSearchCursorError("Photo search cursor is invalid", 400);
      // Move to the newest LRU position, without extending its lifetime.
      this.snapshots.delete(snapshot.id); this.snapshots.set(snapshot.id, snapshot);
    } else {
      const matches = rankPhotosSearchMatches(this.db, input).map(({ id, score }) => ({ id, score }));
      const facets = request.includeFacets ? loadPhotosSearchFacets(this.db, matches.map(({ id }) => id)) : null;
      snapshot = { id: randomUUID(), fingerprint, source, expires: this.now() + 300_000, matches, facets,
        metadataIndex: getPhotosMetadataIndexStatus(this.db, input.libraryUpdatedAt), search: input.search,
        bytes: matches.reduce((bytes, match) => bytes + 160 + match.id.length * 2, 0) + Buffer.byteLength(JSON.stringify(facets)) * 2 + 2048 };
      if (snapshot.bytes > 32 * 1024 * 1024) throw new PhotosSearchCursorError("Photo search result exceeds snapshot memory limit", 503);
      this.snapshots.set(snapshot.id, snapshot); this.bytes += snapshot.bytes;
      this.prune();
    }
    const limit = Math.max(1, Math.min(request.limit ?? 60, 100));
    const ids = snapshot.matches.slice(offset, offset + limit).map(({ id }) => id);
    const photos = queryPhotosAssets(this.db, { libraryUpdatedAt: input.libraryUpdatedAt,
      request: { limit: 100 }, matchingIds: ids }).photos;
    if (photos.length !== ids.length) throw new PhotosSearchCursorError("Photo search source changed; refresh results");
    const byId = new Map(photos.map((photo) => [photo.id, photo]));
    const next = offset + ids.length;
    return { photos: ids.map((id) => byId.get(id)!), total: snapshot.matches.length,
      nextCursor: next < snapshot.matches.length ? Buffer.from(JSON.stringify({
        id: snapshot.id, offset: next, fingerprint
      })).toString("base64url") : null,
      facets: snapshot.facets, metadataIndex: snapshot.metadataIndex, search: snapshot.search };
  }

  private prune(): void {
    for (const [id, snapshot] of this.snapshots) {
      if (snapshot.expires <= this.now() || this.bytes > 32 * 1024 * 1024) {
        this.snapshots.delete(id); this.bytes -= snapshot.bytes;
      }
    }
  }
}
