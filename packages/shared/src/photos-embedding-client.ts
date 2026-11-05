import {
  normalizePhotosEmbedding, validatePhotosEmbeddingModel,
  type PhotosEmbeddingModel, type PhotosEmbeddingResponse
} from "./photos-semantic.js";

export class PhotosEmbeddingApiError extends Error {
  constructor(message: string, readonly kind: "authentication" | "incompatible" | "input" | "unavailable") {
    super(message);
    this.name = "PhotosEmbeddingApiError";
  }
}

type VectorSpace = Pick<PhotosEmbeddingModel, "embeddingSpaceId" | "dimensions">;

export class PhotosEmbeddingClient {
  constructor(private readonly settings: { baseUrl: string; model: string; apiKey: string | null }) {}

  async getModel(signal?: AbortSignal): Promise<PhotosEmbeddingModel> {
    const model = validatePhotosEmbeddingModel(await this.request("v1/model", { method: "GET" }, 5000, signal));
    if (model.model !== this.settings.model) {
      throw new PhotosEmbeddingApiError("The configured embedding model is not loaded by the API", "incompatible");
    }
    return model;
  }

  async text(text: string, expected: VectorSpace, signal?: AbortSignal): Promise<number[]> {
    return this.vector(await this.request("v1/embeddings/text", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: this.settings.model, texts: [text] })
    }, 5000, signal), expected);
  }

  async image(content: Uint8Array, expected: VectorSpace, signal?: AbortSignal): Promise<number[]> {
    if (content.byteLength > 8 * 1024 * 1024) throw new PhotosEmbeddingApiError("Photo preview exceeds the embedding upload limit", "input");
    const body = new FormData();
    body.set("model", this.settings.model);
    body.set("image", new Blob([new Uint8Array(content)], { type: "image/webp" }), "preview.webp");
    return this.vector(await this.request("v1/embeddings/image", { method: "POST", body }, 60_000, signal), expected);
  }

  private vector(value: unknown, expected: VectorSpace): number[] {
    const response = value as Partial<PhotosEmbeddingResponse> | null;
    if (!response || response.embeddingSpaceId !== expected.embeddingSpaceId || response.dimensions !== expected.dimensions ||
        !Array.isArray(response.embeddings) || response.embeddings.length !== 1) {
      throw new PhotosEmbeddingApiError("Embedding API returned an incompatible vector space", "incompatible");
    }
    try { return normalizePhotosEmbedding(response.embeddings[0], expected.dimensions); }
    catch { throw new PhotosEmbeddingApiError("Embedding API returned invalid normalized vectors", "incompatible"); }
  }

  private async request(route: string, init: RequestInit, timeout: number, signal?: AbortSignal): Promise<unknown> {
    try {
      const base = new URL(this.settings.baseUrl);
      if (!["http:", "https:"].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new PhotosEmbeddingApiError("Invalid embedding API URL", "incompatible");
      }
      const headers = new Headers(init.headers);
      if (this.settings.apiKey) headers.set("Authorization", `Bearer ${this.settings.apiKey}`);
      const response = await fetch(new URL(route, `${base.toString().replace(/\/+$/u, "")}/`), {
        ...init, headers, redirect: "error", signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(timeout)]) : AbortSignal.timeout(timeout)
      });
      if (!response.ok) {
        await response.body?.cancel();
        const kind = [401, 403].includes(response.status) ? "authentication" : [404, 409, 422].includes(response.status) ? "incompatible"
          : [400, 413, 415].includes(response.status) ? "input" : "unavailable";
        throw new PhotosEmbeddingApiError(kind === "authentication" ? "Embedding API authentication failed"
          : `Embedding API request failed (HTTP ${response.status})`, kind);
      }
      const reader = response.body?.getReader();
      if (!reader) throw new PhotosEmbeddingApiError("Embedding API returned an empty response", "incompatible");
      const chunks: Uint8Array[] = [];
      let length = 0;
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          length += chunk.value.length;
          if (length > 4 * 1024 * 1024) throw new PhotosEmbeddingApiError("Embedding API response exceeds the size limit", "incompatible");
          chunks.push(chunk.value);
        }
      } finally { await reader.cancel(); }
      const bytes = new Uint8Array(length);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      try { return JSON.parse(new TextDecoder().decode(bytes)) as unknown; }
      catch { throw new PhotosEmbeddingApiError("Embedding API returned invalid JSON", "incompatible"); }
    } catch (error) {
      if (error instanceof PhotosEmbeddingApiError) throw error;
      throw new PhotosEmbeddingApiError("Embedding API is unavailable or timed out", "unavailable");
    }
  }
}
