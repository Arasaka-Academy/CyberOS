import { createServer, type Server, type RequestListener } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { openCyberOsDb, savePhotosLibrarySettings, savePhotosSemanticSettings, getPhotosSemanticStatus, retryPhotosEmbeddingJobs, type CyberOsDatabase } from "@cyberos/db";
import { processPhotosEmbeddingTick } from "./photos-embedding-processor.js";

let directory: string;
let db: CyberOsDatabase | undefined;
let server: Server | undefined;
const model = { protocol: "cyberos-photos-embedding/v1", model: "Qwen/Qwen3-VL-Embedding-2B",
  revision: "rev", embeddingSpaceId: "space", dimensions: 2, normalized: true, modalities: ["text", "image"] };
async function fixture(listener: RequestListener): Promise<void> {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-embedding-fault-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  const library = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" });
  await mkdir(path.join(directory, "photos", "preview"), { recursive: true });
  await writeFile(path.join(directory, "photos", "preview", "one.webp"), "preview");
  db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
    taken_at,taken_at_source,preview_key,status,library_updated_at,indexed_at)
    VALUES('one','pool','photos/one.jpg','one.jpg','image/jpeg',100,0,'one','2026-01-01','file_mtime',
      'preview/one.webp','ready',?,'2026-01-01')`).run(library.updatedAt);
  server = createServer(listener);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  savePhotosSemanticSettings(db, { enabled: true, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "secret" });
}
afterEach(async () => {
  if (server) await new Promise<void>((resolve) => { server!.closeAllConnections(); server!.close(() => resolve()); });
  server = undefined; db?.close(); db = undefined;
  if (directory) await rm(directory, { recursive: true, force: true });
});
it("backfills through a real HTTP service, reuses content, and pauses on authentication failure", async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-embedding-worker-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  const library = savePhotosLibrarySettings(db, { storagePoolId: "pool", path: "photos" });
  await mkdir(path.join(directory, "photos", "preview"), { recursive: true });
  await writeFile(path.join(directory, "photos", "preview", "same.webp"), "preview");
  for (const id of ["one", "two"]) db.prepare(`INSERT INTO photos_assets(id,storage_pool_id,path,name,mime_type,size_bytes,mtime_ms,content_hash,
    taken_at,taken_at_source,preview_key,status,library_updated_at,indexed_at)
    VALUES(?, 'pool', ?, ?, 'image/jpeg', 100, 0, 'same', '2026-01-01', 'file_mtime', 'preview/same.webp', 'ready', ?, '2026-01-01')`)
    .run(id, `photos/${id}.jpg`, `${id}.jpg`, library.updatedAt);
  let images = 0;
  let unauthorized = false;
  server = createServer((request, response) => {
    if (unauthorized) { response.statusCode = 401; response.end("secret upstream error"); return; }
    if (request.url === "/v1/model") response.end(JSON.stringify({ protocol: "cyberos-photos-embedding/v1",
      model: "Qwen/Qwen3-VL-Embedding-2B", revision: "rev", embeddingSpaceId: "space", dimensions: 2, normalized: true, modalities: ["text", "image"] }));
    else { images++; response.end(JSON.stringify({ embeddingSpaceId: "space", dimensions: 2, embeddings: [[1, 0]] })); }
  });
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  savePhotosSemanticSettings(db, { enabled: true, baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, apiKey: "secret" });
  for (let n = 0; n < 3; n++) await processPhotosEmbeddingTick({ db, stateDir: directory, workerId: "test" });
  expect(getPhotosSemanticStatus(db).indexed).toBe(2);
  expect(images).toBe(1);
  unauthorized = true;
  savePhotosSemanticSettings(db, { apiKey: "wrong" });
  await processPhotosEmbeddingTick({ db, stateDir: directory, workerId: "test" });
  expect(getPhotosSemanticStatus(db)).toMatchObject({ state: "blocked", indexed: 2 });
  expect(getPhotosSemanticStatus(db).error).not.toContain("secret");
});

it.each(["network", "timeout", "authentication", "space", "dimensions", "non-finite"] as const)(
  "pauses on %s faults without consuming a batch and recovers after explicit retry", async (kind) => {
    let fault = true;
    let requests = 0;
    await fixture((request, response) => {
      requests++;
      if (fault && kind === "network") { request.socket.destroy(); return; }
      if (fault && kind === "timeout") return;
      if (fault && kind === "authentication") { response.statusCode = 401; response.end("private upstream secret"); return; }
      if (request.url === "/v1/model") { response.end(JSON.stringify(model)); return; }
      response.end(JSON.stringify({
        embeddingSpaceId: fault && kind === "space" ? "other-space" : "space",
        dimensions: fault && kind === "dimensions" ? 3 : 2,
        embeddings: [[fault && kind === "non-finite" ? null : 1, 0]]
      }));
    });
    await processPhotosEmbeddingTick({ db: db!, stateDir: directory, workerId: "first" });
    const status = getPhotosSemanticStatus(db!);
    expect(status.state).toBe(kind === "network" || kind === "timeout" ? "degraded" : "blocked");
    expect(status.indexed).toBe(0);
    expect(status.error).not.toContain("secret");
    expect(db!.prepare("SELECT COUNT(*) FROM photos_embedding_cache").pluck().get()).toBe(0);
    const attempted = requests;
    await processPhotosEmbeddingTick({ db: db!, stateDir: directory, workerId: "second" });
    expect(requests).toBe(attempted);

    fault = false;
    retryPhotosEmbeddingJobs(db!);
    // An already queued image retains its backoff; simulate that deadline expiring.
    db!.prepare("UPDATE photos_embedding_jobs SET next_attempt_at='1970-01-01T00:00:00.000Z'").run();
    await processPhotosEmbeddingTick({ db: db!, stateDir: directory, workerId: "recovered" });
    expect(getPhotosSemanticStatus(db!)).toMatchObject({ state: "ready", indexed: 1, pending: 0, failed: 0 });
  }, 15_000
);

it("discards an HTTP response when the image changes during inference", async () => {
  let release!: () => void;
  let received!: () => void;
  const arrived = new Promise<void>((resolve) => { received = resolve; });
  await fixture((request, response) => {
    if (request.url === "/v1/model") { response.end(JSON.stringify(model)); return; }
    release = () => response.end(JSON.stringify({ embeddingSpaceId: "space", dimensions: 2, embeddings: [[1, 0]] }));
    received();
  });
  const pending = processPhotosEmbeddingTick({ db: db!, stateDir: directory, workerId: "old-input" });
  await arrived;
  db!.prepare("UPDATE photos_assets SET content_hash='replacement' WHERE id='one'").run();
  release();
  expect(await pending).toBe(false);
  expect(getPhotosSemanticStatus(db!).indexed).toBe(0);
  expect(db!.prepare("SELECT COUNT(*) FROM photos_embedding_cache").pluck().get()).toBe(0);
});
