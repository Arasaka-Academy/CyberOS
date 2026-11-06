import { Worker } from "node:worker_threads";
import {
  getActivePhotosEmbeddingProfile, getPhotosSemanticSettings, type CyberOsDatabase
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
interface Pending {
  request: PhotosSearchReaderRequest;
  resolve: (value: PhotoQueryPage | PhotoMapQueryResult) => void;
  reject: (error: Error) => void;
  cleanup: () => void;
}
interface TextFetch { promise: Promise<number[]>; controller: AbortController; users: number }

/** Async networking in the API, synchronous native vector work in one reader thread. */
export class PhotosSearchService {
  private reader: Worker | undefined;
  private exited: Promise<void> | undefined;
  private nextId = 0;
  private runningId: number | undefined;
  private inflight = 0;
  private readonly shutdown = new AbortController();
  private readonly pending = new Map<number, Pending>();
  private readonly texts = new Map<string, { vector: number[]; expires: number }>();
  private readonly fetching = new Map<string, TextFetch>();
  private readonly circuits = new Map<number, number>();
  constructor(private readonly db: CyberOsDatabase, private readonly options: { deadlineMs?: number } = {}) {}

  async query(input: Omit<PhotosSearchInput, "search" | "embedding">, signal?: AbortSignal): Promise<PhotoQueryPage> {
    return await this.execute("query", input, signal) as PhotoQueryPage;
  }
  async map(input: Omit<PhotosMapSearchInput, "search" | "embedding">, signal?: AbortSignal): Promise<PhotoMapQueryResult> {
    return await this.execute("map", input, signal) as PhotoMapQueryResult;
  }
  async close(): Promise<void> {
    this.shutdown.abort();
    this.rejectAll(new Error("Photo search reader is closed"));
    this.reader?.postMessage({ type: "close" });
    await this.exited;
  }

  private async execute(type: "query" | "map", input: Omit<PhotosSearchInput | PhotosMapSearchInput, "search" | "embedding">,
    external?: AbortSignal): Promise<PhotoQueryPage | PhotoMapQueryResult> {
    if (this.shutdown.signal.aborted) throw new Error("Photo search reader is closed");
    if (this.inflight >= 32) throw Object.assign(new Error("Photo search is busy; try again shortly"), { statusCode: 503 });
    const signal = AbortSignal.any([this.shutdown.signal, AbortSignal.timeout(this.options.deadlineMs ?? 15_000), ...(external ? [external] : [])]);
    this.inflight++;
    try {
      if (signal.aborted) throw cancelled(signal);
      const context = await this.context(input.request.filters?.text ?? "", signal);
      return await this.send(type, { ...input, ...context }, signal);
    } finally { this.inflight--; }
  }

  private async context(text: string, signal: AbortSignal): Promise<{ search: PhotosSearchInfo; embedding?: number[] }> {
    const settings = getPhotosSemanticSettings(this.db);
    const profile = getActivePhotosEmbeddingProfile(this.db);
    const search: PhotosSearchInfo = { mode: "lexical", semanticState: settings.enabled ? "unavailable" : "disabled",
      indexed: 0, total: 0, embeddingSpaceId: profile?.embeddingSpaceId ?? null };
    if (!settings.enabled || !profile) return { search };
    const normalized = text.normalize("NFKC").trim();
    if (!normalized) return { search };
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
          const controller = new AbortController();
          fetching = { controller, users: 0, promise: new PhotosEmbeddingClient(settings).text(normalized, profile, controller.signal) };
          this.fetching.set(fetchingKey, fetching);
          const current = fetching;
          void fetching.promise.finally(() => { if (this.fetching.get(fetchingKey) === current) this.fetching.delete(fetchingKey); }).catch(() => {});
        }
        fetching.users++;
        try { vector = await waitForSearch(fetching.promise, signal); }
        finally {
          if (--fetching.users === 0 && this.fetching.get(fetchingKey) === fetching) {
            this.fetching.delete(fetchingKey); fetching.controller.abort();
          }
        }
        this.texts.set(key, { vector, expires: Date.now() + 24 * 3600_000 });
        while (this.texts.size > 500) this.texts.delete(this.texts.keys().next().value!);
      } catch {
        if (signal.aborted) throw cancelled(signal);
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

  private send(type: "query" | "map", input: PhotosSearchInput | PhotosMapSearchInput, signal: AbortSignal): Promise<PhotoQueryPage | PhotoMapQueryResult> {
    if (signal.aborted) return Promise.reject(cancelled(signal));
    if (!this.reader) {
      const reader = createReader(this.db.name);
      this.reader = reader;
      this.exited = new Promise((resolve) => reader.once("exit", () => resolve()));
      reader.on("message", (message: PhotosSearchReaderResponse) => {
        if (message.id !== this.runningId) return;
        this.runningId = undefined;
        const pending = this.pending.get(message.id);
        if (pending) {
          this.pending.delete(message.id); pending.cleanup();
          if ("result" in message) pending.resolve(message.result);
          else pending.reject(Object.assign(new Error(message.error), { statusCode: message.statusCode }));
        }
        this.dispatch();
      });
      reader.on("error", (error) => { if (this.reader === reader) this.rejectAll(error); });
      reader.on("exit", () => {
        if (this.reader !== reader) return;
        this.reader = undefined; this.runningId = undefined;
        this.rejectAll(new Error("Photo search reader exited"));
      });
    }
    return new Promise((resolve, reject) => {
      const id = ++this.nextId;
      const abort = () => {
        this.pending.delete(id); signal.removeEventListener("abort", abort); reject(cancelled(signal));
      };
      const request: PhotosSearchReaderRequest = type === "query"
        ? { type, id, input: input as PhotosSearchInput } : { type, id, input: input as PhotosMapSearchInput };
      this.pending.set(id, { request, resolve, reject, cleanup: () => signal.removeEventListener("abort", abort) });
      signal.addEventListener("abort", abort, { once: true });
      this.dispatch();
    });
  }
  private dispatch(): void {
    // Only one message is posted at a time: cancelled queued work never reaches
    // synchronous SQLite. An already running native query finishes, then drops
    // its response; cancellation does not claim to interrupt a native call.
    if (this.runningId !== undefined || this.shutdown.signal.aborted) return;
    const next = this.pending.entries().next().value;
    if (next) { this.runningId = next[0]; this.reader!.postMessage(next[1].request); }
  }
  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) { pending.cleanup(); pending.reject(error); }
    this.pending.clear();
  }
}

function cancelled(signal: AbortSignal): Error {
  const timedOut = signal.reason instanceof DOMException && signal.reason.name === "TimeoutError";
  return Object.assign(new Error(timedOut ? "Photo search timed out; try again" : "Photo search cancelled"), { statusCode: timedOut ? 504 : 499 });
}
function waitForSearch<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(cancelled(signal));
  return new Promise((resolve, reject) => {
    const abort = () => reject(cancelled(signal));
    signal.addEventListener("abort", abort, { once: true });
    void promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

function createReader(databasePath: string): Worker {
  // Bound metadata/ranking allocations separately from SQLite's reclaimable
  // file mappings. The API unit allows 2 GiB including mapped vector pages;
  // vectors never enter the reader's 256 MiB JavaScript heap.
  const resourceLimits = { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 16 };
  if (import.meta.url.endsWith(".ts")) {
    const bootstrap = `import { register } from ${JSON.stringify(import.meta.resolve("tsx/esm/api"))};
      register(); await import(${JSON.stringify(new URL("./photos-search-worker.ts", import.meta.url).href)});`;
    return new Worker(new URL(`data:text/javascript,${encodeURIComponent(bootstrap)}`), { workerData: { databasePath }, execArgv: [], resourceLimits });
  }
  return new Worker(new URL("./lib/photos-search-worker.js", import.meta.url), { workerData: { databasePath }, execArgv: [], resourceLimits });
}
