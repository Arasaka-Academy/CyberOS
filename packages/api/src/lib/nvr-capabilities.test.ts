import { createServer, type Server } from "node:http";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpClient, openCyberOsDb, type CyberOsDatabase } from "@cyberos/db";
import { registerMcp, type McpRuntimeDependencies } from "@cyberos/mcp";
import { loadCyberOsRuntime, nvrSocketPath } from "@cyberos/shared";
import { registerNvrRoutes } from "../routes/nvr.js";
import { createMcpResourceResponder } from "./mcp-resources.js";
import { createNvrMcpResource } from "./nvr-capabilities.js";

let root: string;
let db: CyberOsDatabase;
let app: FastifyInstance;
let daemon: Server;
let dependencies: McpRuntimeDependencies;
let client: ReturnType<typeof createMcpClient>;
let camera: Record<string, unknown>;
let segment: Record<string, unknown>;
let binaryStatus: number;
let lastRange: string | undefined;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "nvr-mcp-"));
  db = openCyberOsDb(path.join(root, "state.sqlite"));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: root, CYBEROS_ENVIRONMENT: "development" }, root);
  await mkdir(config.paths.stateDir, { recursive: true });
  camera = { id: "camera", onvifUrl: "http://camera/onvif", updatedAt: "2026-11-15T00:00:00Z", removedAt: null };
  segment = { id: "segment", deviceId: "camera", sizeBytes: 7 };
  binaryStatus = 200;
  daemon = createServer((request, reply) => {
    if (request.url === "/nvr/devices/camera") reply.end(JSON.stringify(camera));
    else if (request.url === "/nvr/segments/segment") reply.end(JSON.stringify(segment));
    else if (request.url?.endsWith("/snapshot") || request.url?.endsWith("/download")) {
      lastRange = request.headers.range;
      if (binaryStatus >= 400) { reply.writeHead(binaryStatus); reply.end("private backend error"); return; }
      const range = request.headers.range;
      reply.writeHead(range ? 206 : 200, { "content-type": request.url.endsWith("/snapshot") ? "image/jpeg" : "video/mp2t",
        "content-length": range ? 3 : 7, ...(range ? { "content-range": "bytes 0-2/7" } : {}) });
      reply.end(range ? "vid" : "picture");
    } else { reply.writeHead(404); reply.end("{}"); }
  });
  await new Promise<void>((resolve) => daemon.listen(nvrSocketPath(config), resolve));
  app = Fastify();
  await app.register(websocket);
  registerNvrRoutes(app, { config });
  dependencies = { db, config, transferBaseUrl: "http://127.0.0.1:3010", resourceResponder: createMcpResourceResponder({ db, config }) };
  registerMcp(app, dependencies, { enabled: true });
  await app.ready();
  client = createMcpClient(db, { name: "camera client", kind: "local", scopes: ["cyberos:nvr:read"] });
});
afterEach(async () => {
  await app.close();
  await new Promise<void>((resolve, reject) => daemon.close((error) => error ? reject(error) : resolve()));
  db.close();
  await rm(root, { recursive: true, force: true });
});
async function link(variant: "snapshot" | "segment") {
  return await createNvrMcpResource(app, dependencies, client.id, { variant, id: variant === "snapshot" ? "camera" : "segment" }) as { url: string };
}
function download(url: string, token = client.token, range?: string) {
  return app.inject({ method: "GET", url: new URL(url).pathname, headers: { host: "127.0.0.1", authorization: `Bearer ${token}`, ...(range ? { range } : {}) } });
}
describe("NVR authenticated resource transport", () => {
  it("binds one-time snapshots to the requesting client and tolerates heartbeat updates", async () => {
    const resource = await link("snapshot");
    const other = createMcpClient(db, { name: "other", kind: "local", scopes: ["cyberos:nvr:read"] });
    expect((await download(resource.url, other.token)).statusCode).toBe(404);
    camera.updatedAt = "2026-11-15T00:00:01Z";
    const response = await download(resource.url);
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe("picture");
    expect(response.headers["cache-control"]).toBe("private, no-store");
    expect((await download(resource.url)).statusCode).toBe(404);
  });
  it("streams recording ranges and rejects changed metadata", async () => {
    const resource = await link("segment");
    const response = await download(resource.url, client.token, "bytes=0-2");
    expect(response.statusCode).toBe(206);
    expect(response.headers["content-range"]).toBe("bytes 0-2/7");
    expect(response.body).toBe("vid");
    expect(lastRange).toBe("bytes=0-2");
    const stale = await link("segment");
    segment.sizeBytes = 8;
    expect((await download(stale.url)).statusCode).toBe(409);
  });
  it("rejects expired links and changed camera identity", async () => {
    const expired = await link("snapshot");
    db.prepare("UPDATE mcp_resource_tokens SET expires_at='2000-01-01T00:00:00Z'").run();
    expect((await download(expired.url)).statusCode).toBe(404);
    const stale = await link("snapshot");
    camera.onvifUrl = "http://another-camera/onvif";
    expect((await download(stale.url)).statusCode).toBe(409);
  });
  it("returns a controlled stream error without echoing daemon output", async () => {
    const resource = await link("snapshot");
    binaryStatus = 503;
    const response = await download(resource.url);
    expect(response.statusCode).toBe(503);
    expect(response.body).not.toContain("private");
  });
});
