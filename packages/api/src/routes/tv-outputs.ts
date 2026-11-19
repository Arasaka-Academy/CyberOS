/**
 * [INPUT]: 依赖 TV 设置、输出库存与受限宿主重配运行时。
 * [OUTPUT]: 提供输出候选和显式输出应用接口。
 * [POS]: TV 输出 HTTP 边界；保存配置不触发本接口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { FastifyInstance } from "fastify";
import path from "node:path";
import { defaultTvSettings, getTvSettings } from "@cyberos/db";
import { createPlaybackRuntime } from "@cyberos/shared";
import type { ApiRouteContext } from "../context.js";
import { readTvOutputOptions, type TvOutputPaths } from "../lib/tv-outputs.js";
import { withTvSettingsMutation } from "../lib/tv-settings-lock.js";

type OutputContext = Pick<ApiRouteContext, "config" | "db" | "tvMode" | "audioRuntime"> & {
  playback?: { getStatus(): Promise<{ owner: "music" | "video" | null; sessionId: string | null }> };
};
export function registerTvOutputRoutes(server: FastifyInstance, context: OutputContext, paths?: TvOutputPaths): void {
  const outputPaths = paths ?? {
    drmDirectory: "/sys/class/drm",
    appliedConnectorFile: context.config.environment === "production" ? "/run/cyberos-tv/applied-connector" : path.join(context.config.paths.tvStateDir, "applied-connector")
  };
  const settings = () => getTvSettings(context.db) ?? defaultTvSettings();
  server.get("/api/settings/tv/outputs", async (_request, reply) => {
    try { return await readTvOutputOptions(settings(), context.audioRuntime, outputPaths); }
    catch { return reply.status(409).send({ error: "TV settings could not be read" }); }
  });
  server.post<{ Body: unknown }>("/api/settings/tv/apply-output", async (request, reply) => {
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || !("confirmed" in body) || body.confirmed !== true || Object.keys(body).some(key => key !== "confirmed")) {
      return reply.status(400).send({ error: "TV output application requires confirmation" });
    }
    return withTvSettingsMutation(context.db, async () => {
      try {
        const saved = settings();
        if (!saved.enabled) return reply.status(409).send({ error: "TV mode is disabled" });
        if (!context.tvMode?.reconfigure) return reply.status(503).send({ error: "TV output control is unavailable" });
        const status = await (context.playback ?? createPlaybackRuntime(context.config.vodPlayer)).getStatus();
        if (status.owner !== null || status.sessionId !== null) return reply.status(409).send({ error: "End the current playback session before applying an output" });
        if (saved.drmConnector !== null) {
          const outputs = await readTvOutputOptions(saved, undefined, outputPaths);
          if (outputs.drm.error) return reply.status(503).send({ error: outputs.drm.error });
          if (!outputs.drm.items.some(item => item.id === saved.drmConnector)) return reply.status(400).send({ error: "The selected HDMI output is unavailable" });
        }
        await context.tvMode.reconfigure(saved.drmConnector);
        return { applied: true as const, drmConnector: saved.drmConnector };
      } catch (error) {
        return reply.status(503).send({ error: error instanceof Error ? error.message : "TV output application failed" });
      }
    });
  });
}
