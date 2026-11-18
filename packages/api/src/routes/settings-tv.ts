/**
 * [INPUT]: 依赖 TV 设置仓库、存储路径保护与宿主模式控制。
 * [OUTPUT]: 提供整机 TV 设置读取与部分更新接口。
 * [POS]: TV 配置写入边界；空闲策略更新不切换宿主模式。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { stat } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { defaultTvSettings, getTvSettings, saveTvSettings, validateTvSettings } from "@cyberos/db";
import type { TvSettingsRecord } from "@cyberos/shared";
import type { ApiRouteContext } from "../context.js";
import { resolveScopedExistingPath, resolveStoragePoolScope } from "../lib/storage-scope.js";

export function registerTvSettingsRoutes(server: FastifyInstance, { config, db, system, tvMode, tvDisplay }: Pick<ApiRouteContext, "config" | "db" | "system" | "tvMode" | "tvDisplay">): void {
  server.get("/api/settings/tv", async (_request, reply) => {
    try {
      reply.send({ settings: getTvSettings(db) ?? defaultTvSettings() });
    } catch (error) {
      reply.status(409).send({ error: settingError(error), state: "attention" });
    }
  });

  server.patch<{ Body: Partial<Omit<TvSettingsRecord, "updatedAt">> & { confirmed?: boolean } }>("/api/settings/tv", async (request, reply) => {
    if (hasUnknownFields(request.body, ["enabled", "videoOutput", "drmConnector", "audioDevice", "hardwareDecoding", "screensaverSource", "screensaverAfterMinutes", "screenOffAfterMinutes", "confirmed"])) {
      reply.status(400).send({ error: "TV settings contain unknown fields" });
      return;
    }
    const existing = readForRepair(() => getTvSettings(db), defaultTvSettings);
    const { confirmed, ...updates } = request.body;
    let next: Omit<TvSettingsRecord, "updatedAt">;
    try {
      next = validateTvSettings({ ...existing, ...updates });
      if (next.screensaverSource.kind === "directory" && JSON.stringify(next.screensaverSource) !== JSON.stringify(existing.screensaverSource)) {
        const source = next.screensaverSource;
        const scope = await resolveStoragePoolScope(config.paths.dataRoot, system, source.storagePoolId);
        const directory = await resolveScopedExistingPath(scope, source.path);
        if (!(await stat(directory.realPath)).isDirectory()) throw new Error("Screensaver source must be a directory");
        next.screensaverSource = { ...source, path: directory.relativePath };
      }
    } catch (error) {
      reply.status(400).send({ error: settingError(error) });
      return;
    }
    const changingMode = next.enabled !== existing.enabled || (updates.enabled !== undefined && confirmed === true);
    if (changingMode && confirmed !== true) {
      reply.status(400).send({ error: "TV mode changes require confirmation" });
      return;
    }
    if (changingMode && !tvMode) {
      reply.status(503).send({ error: "TV mode control is unavailable" });
      return;
    }
    try {
      if (changingMode) await tvMode!.apply(next.enabled);
    } catch (error) {
      reply.status(hostdSettingStatus(error)).send({ error: settingError(error) });
      return;
    }
    try {
      const settings = saveTvSettings(db, next);
      tvDisplay?.configure(settings);
      reply.send({ settings });
    } catch (error) {
      if (changingMode) {
        try {
          await tvMode!.apply(existing.enabled);
        } catch (rollbackError) {
          reply.status(500).send({
            error: `${settingError(error)}; TV mode rollback failed: ${settingError(rollbackError)}`
          });
          return;
        }
      }
      reply.status(500).send({ error: settingError(error) });
    }
  });


}
function settingError(error: unknown): string { return error instanceof Error ? error.message : "TV settings could not be saved"; }
function hasUnknownFields(value: unknown, keys: readonly string[]): boolean {
  return !value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !keys.includes(key));
}
function readForRepair<T>(read: () => T | null, fallback: () => T): T { try { return read() ?? fallback(); } catch { return fallback(); } }
function hostdSettingStatus(error: unknown): number {
  if (error instanceof Error && "statusCode" in error && typeof error.statusCode === "number") return error.statusCode;
  return 503;
}
