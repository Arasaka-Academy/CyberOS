import { request as httpRequest } from "node:http";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { CapabilityError, type JsonValue } from "@cyberos/capabilities";
import { createMcpResourceToken, type McpResourceRecord } from "@cyberos/db";
import type { McpRuntimeDependencies } from "@cyberos/mcp";
import { createNvrRuntime, nvrSocketPath, type CyberOsRuntime } from "@cyberos/shared";
import { capabilityHttp, digest, identifier, object, type CapabilityInput } from "./capability-io.js";

function stableCamera(value: CapabilityInput): JsonValue {
  return { id: value.id ?? null, onvifUrl: value.onvifUrl ?? null, removedAt: value.removedAt ?? null };
}
export async function createNvrMcpResource(server: FastifyInstance, dependencies: McpRuntimeDependencies, clientId: string, input: CapabilityInput): Promise<JsonValue> {
  const variant = input.variant;
  const id = identifier(input.id);
  const camera = variant === "snapshot";
  const metadata = object(await capabilityHttp(server, { method: "GET", url: camera ? `/api/nvr/devices/${id}` : `/api/nvr/segments/${id}` }));
  const revision = digest(camera ? stableCamera(metadata) : metadata);
  const created = createMcpResourceToken(dependencies.db, {
    clientId, kind: "file", descriptor: { source: "nvr", variant: String(variant), id: String(input.id) }, revision,
    mimeType: camera ? "image/jpeg" : "video/mp2t", fileName: camera ? "camera-snapshot.jpg" : "camera-recording.ts",
    sizeBytes: typeof metadata.sizeBytes === "number" ? metadata.sizeBytes : null,
    expiresAt: new Date(Date.now() + 60_000).toISOString()
  });
  return { url: `${(dependencies.transferBaseUrl ?? `http://127.0.0.1:${dependencies.config.api.port}`).replace(/\/$/u, "")}/mcp-resource/${created.token}`,
    mimeType: created.resource.mimeType, sizeBytes: created.resource.sizeBytes, fileName: created.resource.fileName, expiresAt: created.resource.expiresAt, oneTime: true };
}
export async function serveNvrMcpResource(config: CyberOsRuntime, resource: McpResourceRecord, request: FastifyRequest, reply: FastifyReply): Promise<unknown> {
  const descriptor = object(resource.descriptor);
  if (descriptor.source !== "nvr" || !["snapshot", "segment"].includes(String(descriptor.variant))) throw new CapabilityError("INVALID_ARGUMENT", "Invalid NVR resource");
  const camera = descriptor.variant === "snapshot";
  const base = camera ? `/nvr/devices/${identifier(descriptor.id)}` : `/nvr/segments/${identifier(descriptor.id)}`;
  const metadata = object(await createNvrRuntime(config).command("GET", base));
  if (digest(camera ? stableCamera(metadata) : metadata) !== resource.revision) return reply.code(409).send({ error: "NVR resource changed" });
  return new Promise((resolve) => {
    const upstream = httpRequest({ socketPath: nvrSocketPath(config), path: `${base}/${camera ? "snapshot" : "download"}`, headers: request.headers.range ? { range: request.headers.range } : {} }, (response) => {
      if ((response.statusCode ?? 503) >= 400) { response.resume(); resolve(reply.code(response.statusCode ?? 503).send({ error: "NVR resource is unavailable" })); return; }
      reply.code(response.statusCode ?? 200).header("cache-control", "private, no-store");
      for (const key of ["content-type", "content-length", "content-range", "accept-ranges"]) if (response.headers[key]) reply.header(key, response.headers[key]!);
      response.once("error", () => reply.raw.destroy());
      resolve(reply.send(response));
    });
    upstream.setTimeout(30_000, () => upstream.destroy());
    upstream.once("error", () => { if (!reply.sent) resolve(reply.code(503).send({ error: "NVR resource is unavailable" })); });
    reply.raw.once("close", () => upstream.destroy());
    upstream.end();
  });
}
