import { EventEmitter } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { openCyberOsDb, savePhotosLibrarySettings, savePhotosSemanticSettings, activatePhotosEmbeddingModel, type CyberOsDatabase } from "@cyberos/db";
import { PhotosSearchService, type PhotosSearchReaderRequest } from "./photos-search.js";

interface Reader extends EventEmitter { messages: PhotosSearchReaderRequest[] }
const state = vi.hoisted(() => ({ readers: [] as Reader[] }));
vi.mock("node:worker_threads", async () => {
  const { EventEmitter } = await import("node:events");
  return { Worker: class extends EventEmitter {
    messages: PhotosSearchReaderRequest[] = [];
    constructor() { super(); state.readers.push(this); }
    postMessage(message: PhotosSearchReaderRequest) {
      this.messages.push(message);
      if (message.type === "close") this.emit("exit", 0);
    }
  } };
});
let directory: string;
let db: CyberOsDatabase;
let service: PhotosSearchService;
let libraryUpdatedAt: string;
const page = { photos: [], total: 0, nextCursor: null, facets: null, metadataIndex: null };
const input = (text = "first") => ({ libraryUpdatedAt, request: { filters: { text } } });
beforeEach(async () => {
  state.readers.length = 0;
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-search-queue-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  libraryUpdatedAt = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" }).updatedAt;
  service = new PhotosSearchService(db);
});
afterEach(async () => { await service.close(); db.close(); vi.unstubAllGlobals(); await rm(directory, { recursive: true, force: true }); });
async function reader(): Promise<Reader> { await vi.waitFor(() => expect(state.readers).toHaveLength(1)); return state.readers[0]!; }
function complete(target: Reader) {
  const message = target.messages.at(-1)!;
  if (message.type === "close") throw new Error("Reader is closed");
  target.emit("message", { id: message.id, result: page });
}
function enable() {
  const settings = savePhotosSemanticSettings(db, { enabled: true, baseUrl: "https://example.test", model: "test/model" });
  activatePhotosEmbeddingModel(db, { protocol: "cyberos-photos-embedding/v1", model: "test/model", revision: "test", dimensions: 2,
    embeddingSpaceId: "test-space", normalized: true, modalities: ["text", "image"] }, settings.generation);
}
const vectorResponse = () => new Response(JSON.stringify({ dimensions: 2, embeddingSpaceId: "test-space", embeddings: [[1, 0]] }));

it.each(["", " \t\u3000"])("keeps blank browsing local and preserves the next semantic query (%j)", async (text) => {
  enable();
  const fetcher = vi.fn().mockResolvedValue(vectorResponse());
  vi.stubGlobal("fetch", fetcher);
  const browsing = service.query(input(text));
  const target = await reader();
  const browseRequest = target.messages[0];
  complete(target); await browsing;
  expect(fetcher).not.toHaveBeenCalled();
  expect(browseRequest).not.toHaveProperty("input.embedding");

  const searching = service.query(input("海边"));
  await vi.waitFor(() => expect(target.messages).toHaveLength(2));
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(target.messages[1]).toMatchObject({ input: { search: { mode: "hybrid", semanticState: "ready" } } });
  complete(target); await searching;
});

it("never posts a cancelled queued query and continues after a cancelled native query finishes", async () => {
  const active = new AbortController(); const queued = new AbortController();
  const first = service.query(input(), active.signal); const firstRejected = expect(first).rejects.toMatchObject({ statusCode: 499 });
  const target = await reader();
  const second = service.query(input("obsolete"), queued.signal); const secondRejected = expect(second).rejects.toMatchObject({ statusCode: 499 });
  const third = service.query(input("latest"));
  await new Promise<void>((resolve) => setImmediate(resolve));
  queued.abort(); active.abort(); await Promise.all([firstRejected, secondRejected]);
  expect(target.messages).toHaveLength(1);
  complete(target);
  expect(target.messages).toHaveLength(2);
  expect(target.messages[1]).toMatchObject({ input: { request: { filters: { text: "latest" } } } });
  complete(target); await expect(third).resolves.toEqual(page);
});

it("bounds deadlines while preserving the running reader until its native call returns", async () => {
  await service.close(); service = new PhotosSearchService(db, { deadlineMs: 40 });
  const expired = service.query(input());
  const rejected = expect(expired).rejects.toMatchObject({ statusCode: 504 });
  const target = await reader(); await rejected;
  expect(target.messages).toHaveLength(1);
  complete(target);
  const next = service.query(input("next"));
  await vi.waitFor(() => expect(target.messages).toHaveLength(2), { interval: 5 });
  complete(target); await expect(next).resolves.toEqual(page);
});

it("coalesces text inference without letting one subscriber cancel another", async () => {
  enable(); let finish!: (response: Response) => void; let inferenceSignal!: AbortSignal;
  const fetcher = vi.fn((_url: URL, init: RequestInit) => { inferenceSignal = init.signal!; return new Promise<Response>((resolve) => { finish = resolve; }); });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const first = service.query(input("海边"), controller.signal); const rejected = expect(first).rejects.toMatchObject({ statusCode: 499 });
  const second = service.query(input("海边"));
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1));
  controller.abort(); await rejected;
  expect(inferenceSignal.aborted).toBe(false);
  finish(vectorResponse()); const target = await reader(); complete(target); await second;
  const cached = service.query(input("海边"));
  await vi.waitFor(() => expect(target.messages).toHaveLength(2)); complete(target); await cached;
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it("aborts inference when all subscribers leave, without opening the offline circuit", async () => {
  enable(); let inferenceSignal!: AbortSignal;
  const fetcher = vi.fn((_url: URL, init: RequestInit) => {
    inferenceSignal = init.signal!;
    return new Promise<Response>((_resolve, reject) => inferenceSignal.addEventListener("abort", () => reject(inferenceSignal.reason), { once: true }));
  });
  vi.stubGlobal("fetch", fetcher);
  const controller = new AbortController();
  const first = service.query(input("海边"), controller.signal); const rejected = expect(first).rejects.toMatchObject({ statusCode: 499 });
  await vi.waitFor(() => expect(fetcher).toHaveBeenCalledTimes(1)); controller.abort(); await rejected;
  expect(inferenceSignal.aborted).toBe(true);
  fetcher.mockImplementationOnce(async () => vectorResponse());
  const next = service.query(input("海边")); const target = await reader(); complete(target); await next;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("uses cached text vectors offline and falls back to lexical matches for uncached queries", async () => {
  enable(); const fetcher = vi.fn().mockResolvedValueOnce(vectorResponse()).mockRejectedValue(new Error("offline")); vi.stubGlobal("fetch", fetcher);
  const first = service.query(input("海边")); const target = await reader(); complete(target); await first;
  const uncached = service.query(input("山峰"));
  await vi.waitFor(() => expect(target.messages).toHaveLength(2));
  expect(target.messages[1]).toMatchObject({ input: { search: { mode: "lexical", semanticState: "unavailable" } } }); complete(target); await uncached;
  const cached = service.query(input("海边"));
  await vi.waitFor(() => expect(target.messages).toHaveLength(3));
  expect(target.messages[2]).toMatchObject({ input: { search: { mode: "hybrid", semanticState: "ready" }, embedding: [1, 0] } }); complete(target); await cached;
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it("leaves library-wide coverage and failed-task scans to the reader", async () => {
  enable(); vi.stubGlobal("fetch", vi.fn().mockResolvedValue(vectorResponse()));
  const prepare = vi.spyOn(db, "prepare");
  const result = service.query(input("海边"));
  const target = await reader();
  expect(prepare.mock.calls.some(([sql]) => sql.includes("FROM photos_assets"))).toBe(false);
  complete(target); await result; prepare.mockRestore();
});
