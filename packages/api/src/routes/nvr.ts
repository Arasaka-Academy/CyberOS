import { request as httpRequest } from "node:http";
import type { FastifyInstance } from "fastify";
import { createNvrRuntime, NvrError, nvrSocketPath, type NvrMethod } from "@cyberos/shared";
import type { ApiRouteContext } from "../context.js";
import { registerNvrPreview } from "./nvr-preview.js";

export function registerNvrRoutes(server: FastifyInstance, context: Pick<ApiRouteContext, "config" | "nvr">): void {
  const runtime = context.nvr ?? createNvrRuntime(context.config);
  registerNvrPreview(server, context.config);
  server.route({ method: ["GET", "POST", "PUT", "PATCH", "DELETE"], url: "/api/nvr*",
    bodyLimit: 16384,
    handler: async (request, reply) => {
      const route = request.raw.url?.slice(4) ?? "/nvr";
      if (!/^\/nvr(?:[/?]|$)/u.test(route)) return reply.code(404).send({ error: "NVR route not found" });
      const streaming = request.method === "GET" && /\/(?:preview|snapshot|download|assets\/[^/?]+)(?:\?|$)/u.test(route);
      if (!streaming) {
        try {
          const result = await runtime.command(request.method as NvrMethod, route, request.body);
          return result === undefined ? reply.code(204).send() : reply.code(request.method === "POST" && /\/(devices|sessions)$/u.test(route) ? 201 : 200).send(result);
        } catch (error) {
          return reply.code(error instanceof NvrError ? error.statusCode : 503).send({ error: error instanceof NvrError ? error.message : "NVR service unavailable" });
        }
      }
      return await new Promise((resolve) => {
        const upstream = httpRequest({ socketPath: nvrSocketPath(context.config), path: route,
          headers: request.headers.range ? { range: request.headers.range } : {},
        }, (response) => {
          reply.code(response.statusCode ?? 503);
          for (const key of ["content-type", "content-length", "content-range", "content-disposition", "accept-ranges", "cache-control"])
            if (response.headers[key]) reply.header(key, response.headers[key]!);
          response.once("error", () => reply.raw.destroy());
          resolve(reply.send(response));
        });
        upstream.setTimeout(route.endsWith("/preview") ? 3600000 : 30000, () => upstream.destroy());
        upstream.once("error", () => { if (!reply.sent) resolve(reply.code(503).send({ error: "NVR service unavailable" })); });
        reply.raw.once("close", () => upstream.destroy());
        upstream.end();
      });
    },
  });
}
