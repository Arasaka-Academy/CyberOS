/**
 * [INPUT]: 依赖已保存 TV 素材来源和安全素材服务。
 * [OUTPUT]: 提供只读素材分页与缓存图片接口。
 * [POS]: TV 屏保图片的 HTTP 边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { defaultTvSettings, getTvSettings } from "@cyberos/db";
import type { ApiRouteContext } from "../context.js";
import { TvScreensaverCatalog, TvScreensaverError } from "../lib/tv-screensaver.js";
import { resolveStoragePoolScope } from "../lib/storage-scope.js";

export function registerTvScreensaverRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const settings = () => getTvSettings(context.db) ?? defaultTvSettings();
  let catalog: TvScreensaverCatalog | undefined;
  const materials = () => catalog ??= new TvScreensaverCatalog({ cacheDirectory: path.join(context.config.paths.tvStateDir, "screensaver-cache"), resolveScope: source => resolveStoragePoolScope(context.config.paths.dataRoot, context.system, source.storagePoolId) });
  server.get<{ Querystring: { cursor?: string } }>("/api/tv/screensaver/items", async (request, reply) => {
    try { return await materials().list(settings(), request.query.cursor); }
    catch (error) { return reply.status(error instanceof TvScreensaverError ? error.statusCode : 503).send({ error: "Screensaver materials are unavailable" }); }
  });
  server.get<{ Params: { id: string } }>("/api/tv/screensaver/image/:id", async (request, reply) => {
    try {
      const file = await materials().image(settings(), request.params.id);
      return reply.header("Content-Type", "image/jpeg").header("Cache-Control", "private, max-age=60").header("X-Content-Type-Options", "nosniff").send(createReadStream(file));
    } catch (error) { return reply.status(error instanceof TvScreensaverError ? error.statusCode : 404).send({ error: "Screensaver image is unavailable" }); }
  });
}
