import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, expect, it } from "vitest";
import { openCyberOsDb, savePhotosLibrarySettings, savePhotosSemanticSettings, getPhotosSemanticStatus, type CyberOsDatabase } from "@cyberos/db";
import { processPhotosEmbeddingTick } from "./photos-embedding-processor.js";

let directory: string;
let db: CyberOsDatabase | undefined;
let server: Server | undefined;
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
