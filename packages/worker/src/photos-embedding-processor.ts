import { constants } from "node:fs";
import { open, realpath } from "node:fs/promises";
import path from "node:path";
import {
  activatePhotosEmbeddingModel, claimPhotosEmbeddingJob, completePhotosEmbeddingJob, failPhotosEmbeddingJob,
  getActivePhotosEmbeddingProfile, getCachedPhotosEmbedding, getPhotosEmbeddingRuntime, getPhotosSemanticSettings,
  reconcilePhotosEmbeddingJobs, recordPhotosEmbeddingServiceFailure, touchPhotosEmbeddingWorker,
  type CyberOsDatabase
} from "@cyberos/db";
import { PhotosEmbeddingApiError, PhotosEmbeddingClient } from "@cyberos/shared";

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith(`..${path.sep}`) && relative !== ".." && !path.isAbsolute(relative);
}

export async function readPhotosEmbeddingPreview(stateDir: string, key: string): Promise<Uint8Array> {
  const root = path.resolve(stateDir, "photos");
  const candidate = path.resolve(root, key);
  if (!inside(root, candidate)) throw new PhotosEmbeddingApiError("Photo preview is outside its cache", "input");
  const [rootReal, fileReal] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!inside(rootReal, fileReal)) throw new PhotosEmbeddingApiError("Photo preview escapes its cache", "input");
  const handle = await open(fileReal, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size > 8 * 1024 * 1024) throw new PhotosEmbeddingApiError("Photo preview is invalid or too large", "input");
    return await handle.readFile();
  } finally { await handle.close(); }
}

export async function processPhotosEmbeddingTick(input: {
  db: CyberOsDatabase; stateDir: string; workerId: string; signal?: AbortSignal
}): Promise<boolean> {
  const { db } = input;
  touchPhotosEmbeddingWorker(db);
  const settings = getPhotosSemanticSettings(db);
  if (!settings.enabled || !settings.baseUrl || input.signal?.aborted) return false;
  const runtime = getPhotosEmbeddingRuntime(db);
  if (runtime.connection_state === "blocked" || (runtime.next_attempt_at && Date.parse(runtime.next_attempt_at) > Date.now())) return false;
  const client = new PhotosEmbeddingClient(settings);
  if (runtime.connection_state !== "ready" || !runtime.verified_at || Date.now() - Date.parse(runtime.verified_at) > 60_000) {
    try {
      if (!activatePhotosEmbeddingModel(db, await client.getModel(input.signal), settings.generation)) return false;
    } catch (error) {
      if (input.signal?.aborted) return false;
      recordPhotosEmbeddingServiceFailure(db, settings.generation,
        error instanceof Error ? error.message : "Embedding API is unavailable",
        !(error instanceof PhotosEmbeddingApiError) || error.kind === "authentication" || error.kind === "incompatible");
      return false;
    }
  }
  reconcilePhotosEmbeddingJobs(db);
  const job = claimPhotosEmbeddingJob(db, input.workerId, 120_000);
  if (!job) return false;
  const profile = getActivePhotosEmbeddingProfile(db);
  if (!profile) return false;
  try {
    const cached = getCachedPhotosEmbedding(db, job);
    if (cached) return completePhotosEmbeddingJob(db, job, cached);
    const content = await readPhotosEmbeddingPreview(input.stateDir, job.previewKey);
    const started = performance.now();
    const vector = await client.image(content, profile, input.signal);
    return completePhotosEmbeddingJob(db, job, vector, performance.now() - started);
  } catch (error) {
    const permanent = !(error instanceof PhotosEmbeddingApiError) || error.kind === "input";
    const message = error instanceof PhotosEmbeddingApiError ? error.message : "Photo preview could not be read";
    failPhotosEmbeddingJob(db, job, message, permanent);
    if (!permanent && error instanceof PhotosEmbeddingApiError && !input.signal?.aborted) {
      recordPhotosEmbeddingServiceFailure(db, settings.generation, message,
        error.kind === "authentication" || error.kind === "incompatible");
    }
    return false;
  }
}
