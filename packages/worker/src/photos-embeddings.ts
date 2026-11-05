import { randomUUID } from "node:crypto";
import os from "node:os";
import { openCyberOsDb, touchPhotosEmbeddingWorker } from "@cyberos/db";
import { loadCyberOsRuntime } from "@cyberos/shared";
import { processPhotosEmbeddingTick } from "./photos-embedding-processor.js";

const config = loadCyberOsRuntime();
const db = openCyberOsDb(config.paths.databasePath);
const controller = new AbortController();
const workerId = `photos-embeddings:${os.hostname()}:${process.pid}:${randomUUID()}`;
let active = false;
let closed = false;

async function tick(): Promise<void> {
  if (active || controller.signal.aborted) return;
  active = true;
  try {
    const worked = await processPhotosEmbeddingTick({ db, stateDir: config.paths.stateDir, workerId, signal: controller.signal });
    if (worked && !controller.signal.aborted) queueMicrotask(() => void tick());
  } catch (error) {
    console.error("Photos embedding worker failed", error instanceof Error ? error.message : "Unknown error");
  } finally {
    active = false;
    closeWhenIdle();
  }
}

const timer = setInterval(() => { touchPhotosEmbeddingWorker(db); void tick(); }, 5000);
function closeWhenIdle(): void {
  if (controller.signal.aborted && !active && !closed) { closed = true; db.close(); }
}
function shutdown(): void { clearInterval(timer); controller.abort(); closeWhenIdle(); }
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
void tick();
