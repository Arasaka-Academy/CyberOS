import { parentPort, workerData } from "node:worker_threads";
import * as sqliteVec from "sqlite-vec";
import { openCyberOsDbReadOnly } from "@cyberos/db";
import { PhotosSearchEngine } from "./photos-search-engine.js";
import type { PhotosSearchReaderRequest, PhotosSearchReaderResponse } from "./photos-search.js";

if (!parentPort) throw new Error("Photo search requires a reader thread");
const port = parentPort;
const db = openCyberOsDbReadOnly((workerData as { databasePath: string }).databasePath);
sqliteVec.load(db);
const engine = new PhotosSearchEngine(db);
port.on("message", (request: PhotosSearchReaderRequest) => {
  if (request.type === "close") { db.close(); port.close(); return; }
  let response: PhotosSearchReaderResponse;
  try {
    response = { id: request.id, result: request.type === "query" ? engine.query(request.input) : engine.map(request.input) };
  } catch (error) {
    response = { id: request.id, error: error instanceof Error ? error.message : "Photo search failed",
      statusCode: error && typeof error === "object" && "statusCode" in error ? Number(error.statusCode) : 500 };
  }
  port.postMessage(response);
});
