import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";
import { HostdClient } from "../lib/hostd-client.js";
import { safeCapabilityResult, json } from "../lib/capability-io.js";

export function registerServiceDiagnosticsRoutes(server: FastifyInstance, { config }: Pick<ApiRouteContext, "config">): void {
  const hostd = new HostdClient(config.hostd.socketPath);
  server.get<{ Querystring: { unit?: string } }>("/api/system/services", async (request, reply) => {
    try {
      return safeCapabilityResult(json(await hostd.request("system.diagnostics", { action: "status", unit: request.query.unit ?? null }, 15_000)), { limit: 64 });
    } catch { return reply.code(503).send({ error: "Service diagnostics are unavailable" }); }
  });
  server.get<{ Params: { unit: string }; Querystring: { limit?: string; since?: string } }>("/api/system/services/:unit/logs", async (request, reply) => {
    const limit = Number(request.query.limit ?? 100);
    if (!Number.isInteger(limit) || limit < 1 || limit > 200 || (request.query.since && !Number.isFinite(Date.parse(request.query.since)))) return reply.code(400).send({ error: "Invalid log limit or start time" });
    try {
      return safeCapabilityResult(json(await hostd.request("system.diagnostics", { action: "logs", unit: request.params.unit, limit, since: request.query.since ?? null }, 15_000)), { limit });
    } catch { return reply.code(503).send({ error: "Service logs are unavailable for this unit" }); }
  });
}
