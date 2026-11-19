/**
 * [INPUT]: 依赖已保存 TV 素材来源和安全素材服务。
 * [OUTPUT]: 提供素材分页、图片预览与视频范围读取。
 * [POS]: TV 屏保 HTTP 边界；视频不进入共享播放会话。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createReadStream } from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { defaultTvSettings, getTvSettings } from "@cyberos/db";
import type { ApiRouteContext } from "../context.js";
import { TvScreensaverCatalog, TvScreensaverError } from "../lib/tv-screensaver.js";
import { resolveStoragePoolScope } from "../lib/storage-scope.js";
import { parseRangeHeader } from "../lib/files.js";

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
  server.route<{ Params: { id: string } }>({ method: ["GET", "HEAD"], url: "/api/tv/screensaver/video/:id", handler: async (request, reply) => {
    try {
      const file = await materials().video(settings(), request.params.id);
      try {
        const range = parseRangeHeader(request.headers.range, file.size);
        reply.header("Content-Type", file.mimeType).header("Accept-Ranges", "bytes").header("Cache-Control", "private, no-store").header("X-Content-Type-Options", "nosniff");
        if (range === "invalid") {
          await file.handle.close();
          return reply.header("Content-Range", `bytes */${file.size}`).status(416).send();
        }
        reply.header("Content-Length", String(range ? range.end - range.start + 1 : file.size));
        if (range) reply.header("Content-Range", `bytes ${range.start}-${range.end}/${file.size}`).status(206);
        if (request.method === "HEAD") { await file.handle.close(); return reply.send(); }
        const stream = file.handle.createReadStream({ start: range?.start ?? 0, end: range?.end ?? file.size - 1, autoClose: true });
        reply.raw.once("close", () => stream.destroy());
        return reply.send(stream);
      } catch (error) { await file.handle.close().catch(() => {}); throw error; }
    } catch (error) { return reply.status(error instanceof TvScreensaverError ? error.statusCode : 404).send({ error: "Screensaver video is unavailable" }); }
  } });
}
