export const PHOTOS_EMBEDDING_PROTOCOL = "cyberos-photos-embedding/v1";
export const PHOTOS_DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-VL-Embedding-2B";

export interface PhotosEmbeddingModel {
  protocol: typeof PHOTOS_EMBEDDING_PROTOCOL;
  model: string;
  revision: string;
  embeddingSpaceId: string;
  dimensions: number;
  normalized: true;
  modalities: ("text" | "image")[];
}

export interface PhotosEmbeddingResponse {
  embeddingSpaceId: string;
  dimensions: number;
  embeddings: number[][];
}

export interface PhotosSemanticSettingsRecord {
  enabled: boolean;
  baseUrl: string;
  model: string;
  apiKey: string | null;
  generation: number;
  updatedAt: string;
}

export interface PhotosSemanticSettingsPatch {
  enabled?: boolean;
  baseUrl?: string;
  model?: string;
  apiKey?: string;
  clearApiKey?: boolean;
  minSimilarity?: number;
}

export interface PhotosSemanticSettings extends Omit<PhotosSemanticSettingsRecord, "apiKey"> {
  apiKeyConfigured: boolean;
  embeddingSpaceId: string | null;
  dimensions: number | null;
  minSimilarity: number | null;
}

export interface PhotosSemanticIndexStatus {
  state: "disabled" | "pending" | "indexing" | "ready" | "degraded" | "blocked";
  total: number;
  indexed: number;
  pending: number;
  failed: number;
  embeddingSpaceId: string | null;
  dimensions: number | null;
  minSimilarity: number | null;
  epoch: number;
  error: string | null;
  lastSuccessAt: string | null;
  workerHeartbeatAt: string | null;
  nextAttemptAt: string | null;
  imagesPerSecond: number | null;
  estimatedRemainingSeconds: number | null;
}

export interface PhotosSearchInfo {
  mode: "hybrid" | "lexical";
  semanticState: "ready" | "unavailable" | "disabled";
  indexed: number;
  total: number;
  embeddingSpaceId: string | null;
}

/** Validates before persistence, transport and native vector operations. */
export function normalizePhotosEmbedding(vector: unknown, dimensions: number): number[] {
  if (!Array.isArray(vector) || vector.length !== dimensions ||
      !vector.every((value: unknown) => typeof value === "number" && Number.isFinite(value))) {
    throw new Error("Embedding dimensions or values are invalid");
  }
  const values = vector as number[];
  const norm = Math.hypot(...values);
  if (!Number.isFinite(norm) || norm < 1e-8 || Math.abs(norm - 1) > 0.05) {
    throw new Error("Embedding must be normalized");
  }
  return values.map((value) => value / norm);
}

export function validatePhotosEmbeddingModel(value: unknown): PhotosEmbeddingModel {
  if (!value || typeof value !== "object") throw new Error("Invalid embedding model manifest");
  const model = value as Partial<PhotosEmbeddingModel>;
  if (model.protocol !== PHOTOS_EMBEDDING_PROTOCOL || model.normalized !== true ||
      !Number.isInteger(model.dimensions) || (model.dimensions ?? 0) < 1 || (model.dimensions ?? 0) > 8192 ||
      typeof model.model !== "string" || !model.model || model.model.length > 256 ||
      typeof model.revision !== "string" || !model.revision || model.revision.length > 256 ||
      typeof model.embeddingSpaceId !== "string" || !/^[A-Za-z0-9_.:-]{1,128}$/u.test(model.embeddingSpaceId) ||
      !Array.isArray(model.modalities) || !model.modalities.includes("text") || !model.modalities.includes("image")) {
    throw new Error("Model must provide normalized text and image embeddings in one vector space");
  }
  return model as PhotosEmbeddingModel;
}
