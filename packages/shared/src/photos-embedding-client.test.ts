import { createServer, type RequestListener, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { PhotosEmbeddingClient } from "./photos-embedding-client.js";

let server: Server | undefined;
afterEach(async () => { if (server) await new Promise<void>((resolve) => { server!.closeAllConnections(); server!.close(() => resolve()); }); server = undefined; });
async function start(handler: RequestListener) {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return new PhotosEmbeddingClient({ baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: "model", apiKey: "secret" });
}
describe("embedding API client", () => {
  it("authenticates and verifies image and text vector identity", async () => {
    const paths: string[] = [];
    const client = await start((request, response) => {
      expect(request.headers.authorization).toBe("Bearer secret");
      paths.push(request.url!);
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify(request.url === "/v1/model" ? {
        protocol: "cyberos-photos-embedding/v1", model: "model", revision: "rev", dimensions: 2,
        embeddingSpaceId: "space", modalities: ["text", "image"], normalized: true
      } : { embeddingSpaceId: "space", dimensions: 2, embeddings: [[1, 0]] }));
    });
    const model = await client.getModel();
    expect(await client.text("海边", model)).toEqual([1, 0]);
    expect(await client.image(Buffer.from("image"), model)).toEqual([1, 0]);
    expect(paths).toEqual(["/v1/model", "/v1/embeddings/text", "/v1/embeddings/image"]);
  });
  it("rejects wrong spaces and never echoes upstream credential errors", async () => {
    let status = 200;
    const client = await start((_request, response) => {
      response.statusCode = status;
      response.end(status === 200 ? JSON.stringify({ embeddingSpaceId: "different", dimensions: 2, embeddings: [[1, 0]] }) : "key secret is invalid");
    });
    const model = { embeddingSpaceId: "space", dimensions: 2 };
    await expect(client.text("dog", model)).rejects.toThrow("vector space");
    status = 401;
    await expect(client.text("dog", model)).rejects.toThrow("authentication");
    await expect(client.text("dog", model)).rejects.not.toThrow("secret");
  });
});
