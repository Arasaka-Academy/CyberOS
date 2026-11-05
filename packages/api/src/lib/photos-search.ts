import { Worker } from "node:worker_threads";
import {
  getActivePhotosEmbeddingProfile, getPhotosSemanticSettings, getPhotosSemanticStatus, type CyberOsDatabase
} from "@cyberos/db";
import { PhotosEmbeddingClient, type PhotoQueryPage, type PhotoMapQueryResult, type PhotosSearchInfo } from "@cyberos/shared";
import type { PhotosSearchInput, PhotosMapSearchInput } from "./photos-search-engine.js";

export type PhotosSearchReaderRequest =
  | { type: "query"; id: number; input: PhotosSearchInput }
  | { type: "map"; id: number; input: PhotosMapSearchInput }
  | { type: "close" };
export type PhotosSearchReaderResponse = { id: number } & (
  | { result: PhotoQueryPage | PhotoMapQueryResult }
  | { error: string; statusCode: number }
);
interface Pending { resolve: (value: PhotoQueryPage | PhotoMapQueryResult) => void; reject: (error: Error) => void }

/** Async networking in the API, synchronous native vector work in one reader thread. */
export class PhotosSearchService {
  private reader: Worker | undefined;
  private exited: Promise<void> | undefined;
  private nextId = 0;
  private closed = false;
  private readonly pending = new Map<number, Pending>();
  private readonly texts = new Map<string, { vector: number[]; expires: number }>();
  private readonly fetching = new Map<string, Promise<number[]>>();
  private readonly circuits = new Map<number, number>();
  constructor(private readonly db: CyberOsDatabase) {}

  async query(input: Omit<PhotosSearchInput, "search" | "embedding">): Promise<PhotoQueryPage> {
    return await this.send("query", { ...input, ...await this.context(input.request.filters?.text ?? "") }) as PhotoQueryPage;
  }
  async map(input: Omit<PhotosMapSearchInput, "search" | "embedding">): Promise<PhotoMapQueryResult> {
    return await this.send("map", { ...input, ...await this.context(input.request.filters?.text ?? "") }) as PhotoMapQueryResult;
  }
  async close(): Promise<void> {
    this.closed = true;
    this.rejectAll(new Error("Photo search reader is closed"));
    this.reader?.postMessage({ type: "close" });
    await this.exited;
  }

  private async context(text: string): Promise<{ search: PhotosSearchInfo; embedding?: number[] }> {
    const settings = getPhotosSemanticSettings(this.db);
    const status = getPhotosSemanticStatus(this.db);
    const profile = getActivePhotosEmbeddingProfile(this.db);
    const search: PhotosSearchInfo = { mode: "lexical", semanticState: settings.enabled ? "unavailable" : "disabled",
      indexed: status.indexed, total: status.total, embeddingSpaceId: profile?.embeddingSpaceId ?? null };
    if (!settings.enabled || !profile) return { search };
    const normalized = text.normalize("NFKC").trim();
    const key = JSON.stringify([profile.embeddingSpaceId, normalized]);
    const fetchingKey = JSON.stringify([settings.generation, key]);
    let vector: number[] | undefined;
    const cached = this.texts.get(key);
    if (cached && cached.expires > Date.now()) {
      vector = cached.vector; this.texts.delete(key); this.texts.set(key, cached);
    } else if ((this.circuits.get(settings.generation) ?? 0) < Date.now()) {
      try {
        let fetching = this.fetching.get(fetchingKey);
        if (!fetching) {
          if (this.fetching.size >= 32) return { search };
          fetching = new PhotosEmbeddingClient(settings).text(normalized, profile);
          this.fetching.set(fetchingKey, fetching);
          const pending = fetching;
          void fetching.finally(() => { if (this.fetching.get(fetchingKey) === pending) this.fetching.delete(fetchingKey); }).catch(() => {});
        }
        vector = await fetching;
        this.texts.set(key, { vector, expires: Date.now() + 24 * 3600_000 });
        while (this.texts.size > 500) this.texts.delete(this.texts.keys().next().value!);
      } catch {
        if (getPhotosSemanticSettings(this.db).generation === settings.generation) {
          this.circuits.clear(); this.circuits.set(settings.generation, Date.now() + 30_000);
        }
      }
    }
    // A settings change during inference must not publish an old-space result.
    if (getPhotosSemanticSettings(this.db).generation !== settings.generation ||
        getActivePhotosEmbeddingProfile(this.db)?.embeddingSpaceId !== profile.embeddingSpaceId) return { search };
    return vector ? { search: { ...search, mode: "hybrid", semanticState: "ready" }, embedding: vector } : { search };
  }

  private send(type: "query" | "map", input: PhotosSearchInput | PhotosMapSearchInput): Promise<PhotoQueryPage | PhotoMapQueryResult> {
    if (this.closed) return Promise.reject(new Error("Photo search reader is closed"));
    if (this.pending.size >= 32) return Promise.reject(Object.assign(new Error("Photo search is busy; try again shortly"), { statusCode: 503 }));
    if (!this.reader) {
      const reader = createReader(this.db.name);
      this.reader = reader;
      this.exited = new Promise((resolve) => reader.once("exit", () => resolve()));
      reader.on("message", (message: PhotosSearchReaderResponse) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;
        this.pending.delete(message.id);
        if ("result" in message) pending.resolve(message.result);
        else pending.reject(Object.assign(new Error(message.error), { statusCode: message.statusCode }));
      });
      reader.on("error", (error) => this.rejectAll(error));
      reader.on("exit", () => { if (this.reader === reader) this.reader = undefined;
        this.rejectAll(new Error("Photo search reader exited")); });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      this.pending.set(id, { resolve, reject });
      this.reader!.postMessage({ type, id, input });
    });
  }
  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}

function createReader(databasePath: string): Worker {
  // Bound the reader's V8 heap as well as retained snapshots. The API and this
  // thread share the service's 512 MiB systemd memory budget.
  const resourceLimits = { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16 };
  if (import.meta.url.endsWith(".ts")) {
    const bootstrap = `import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};
      register(); await import(${JSON.stringify(new URL("./photos-search-worker.ts", import.meta.url).href)});`;
    return new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), { workerData: { databasePath }, execArgv: [], resourceLimits });
  }
  return new Worker(new URL("./lib/photos-search-worker.js", import.meta.url), { workerData: { databasePath }, execArgv: [], resourceLimits });
}
