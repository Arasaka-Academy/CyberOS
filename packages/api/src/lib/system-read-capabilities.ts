import type { FastifyInstance } from "fastify";
import { CapabilityError, type JsonValue } from "@cyberos/capabilities";
import { listFileOperations } from "@cyberos/db";
import type { McpRuntimeDependencies } from "@cyberos/mcp";
import { boundedPageItems, capabilityHttp, collectionPage, digest, identifier, json, object, omit, query, safeCapabilityResult, validateCapability, type CapabilityInput } from "./capability-io.js";
import { createNvrMcpResource } from "./nvr-capabilities.js";

async function photoQueryPage(server: FastifyInstance, input: CapabilityInput): Promise<JsonValue> {
  let limit = Number(input.limit ?? 40);
  for (;;) {
    const page = object(await capabilityHttp(server, { method: "POST", url: "/api/photos/query", payload: { ...input, limit } }));
    const photos = Array.isArray(page.photos) ? page.photos : [];
    const bytes = Buffer.byteLength(JSON.stringify(photos));
    if (bytes <= 90_000 || limit === 1 || photos.length <= 1) {
      // Keep pagination ahead of optional facets in the bounded response. Never
      // trim rows after the native cursor has advanced past them.
      return { nextCursor: page.nextCursor ?? null, photos, ...omit(page, "nextCursor", "photos") };
    }
    // Native photo cursors fingerprint filters/sort, so a smaller page can be
    // fetched from the same cursor without changing the query or skipping rows.
    limit = Math.max(1, Math.min(limit - 1, Math.floor(photos.length * 90_000 / bytes)));
  }
}

export function createSystemReadAdapters(server: FastifyInstance): NonNullable<McpRuntimeDependencies["readAdapters"]> {
  const get = (url: string) => capabilityHttp(server, { method: "GET", url });
  const adapter = (id: string, read: (input: CapabilityInput) => Promise<JsonValue>) => async (value: JsonValue) => {
    const input = validateCapability(id, value);
    return safeCapabilityResult(await read(input), input);
  };
  const simple: Record<string, string> = {
    "cyberos.system.health": "/api/system/health", "cyberos.system.info": "/api/settings/system-info",
    "cyberos.system.services": "/api/system/services", "cyberos.backup.status": "/api/backup/status",
    "cyberos.photos.semantic-status": "/api/settings/photos/semantic-search",
    "cyberos.tailscale.status": "/api/system/tailscale", "cyberos.iscsi.status": "/api/storage/iscsi",
    "cyberos.settings.proxy": "/api/settings/proxy", "cyberos.backup.coverage": "/api/backup/coverage"
  };
  return {
    ...Object.fromEntries(Object.entries(simple).map(([id, url]) => [id, adapter(id, async (input) => get(query(url, input)))])),
    "cyberos.system.logs": adapter("cyberos.system.logs", async (input) => get(query(`/api/system/services/${identifier(input.unit)}/logs`, omit(input, "unit")))),
    "cyberos.files.history": async (value, _context, dependencies) => {
      const input = validateCapability("cyberos.files.history", value);
      const fingerprint = digest({ storagePoolId: input.storagePoolId ?? null });
      let before: { createdAt: string; id: string } | undefined;
      if (input.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString()) as { fingerprint: string; createdAt: string; id: string };
          if (cursor.fingerprint !== fingerprint || typeof cursor.createdAt !== "string" || typeof cursor.id !== "string") throw new Error();
          before = cursor;
        } catch { throw new CapabilityError("INVALID_ARGUMENT", "Invalid file history cursor"); }
      }
      const limit = Number(input.limit ?? 40);
      const rows = listFileOperations(dependencies.db, { limit: limit + 1, ...(typeof input.storagePoolId === "string" ? { storagePoolId: input.storagePoolId } : {}), ...(before ? { before } : {}) });
      const selected = boundedPageItems(rows, limit);
      const last = selected.at(-1);
      return safeCapabilityResult({ nextCursor: rows.length > selected.length && last ? Buffer.from(JSON.stringify({ fingerprint, createdAt: last.createdAt, id: last.id })).toString("base64url") : null, operations: json(selected) }, input);
    },
    "cyberos.files.batches": adapter("cyberos.files.batches", async (input) => get(query("/api/files/batches", input))),
    "cyberos.photos.query": adapter("cyberos.photos.query", async (input) => input.assetId
      ? get(`/api/photos/${identifier(input.assetId)}/record`)
      : photoQueryPage(server, input)),
    "cyberos.photos.metadata": adapter("cyberos.photos.metadata", async (input) => input.assetId
      ? get(`/api/photos/${identifier(input.assetId)}/metadata`)
      : get(query("/api/photos/metadata/fields", { q: input.query ?? "", limit: input.limit ?? 100 }))),
    "cyberos.downloads.preview": adapter("cyberos.downloads.preview", async (input) => {
      const preview = object(await get(`/api/downloads/torrent-previews/${identifier(input.previewId)}`));
      const data = object(preview.preview);
      return { preview: omit(data, "files"), files: collectionPage(Array.isArray(data.files) ? data.files : [], input, { previewId: input.previewId, updatedAt: data.updatedAt ?? data.expiresAt }) };
    }),
    "cyberos.downloads.files": adapter("cyberos.downloads.files", async (input) => {
      const result = object(await get(`/api/downloads/${identifier(input.taskId)}/files`));
      return collectionPage(Array.isArray(result.files) ? result.files : [], input, { taskId: input.taskId });
    }),
    "cyberos.docker.get": adapter("cyberos.docker.get", async (input) => {
      if (input.entity === "daemon") {
        const result = object(await get("/api/docker/daemon/config"));
        const config = object(result.config);
        let configuration: JsonValue = null;
        try { configuration = JSON.parse(String(config.content)) as JsonValue; } catch { /* Invalid JSON remains hidden. */ }
        return { config: { ...omit(config, "content"), configuration } };
      }
      const base = input.entity === "logs" ? `/api/docker/containers/${identifier(input.id)}/logs` : `/api/docker/${String(input.entity)}s/${identifier(input.id)}`;
      return get(query(base, input.entity === "logs" ? { tail: input.tail ?? 100 } : {}));
    }),
    "cyberos.alerts.get": adapter("cyberos.alerts.get", async (input) => get(input.entity === "smtp" ? "/api/monitoring/alerts/smtp" : `/api/monitoring/alerts/${input.entity === "delivery" ? "deliveries" : "incidents"}/${identifier(input.id)}`)),
    "cyberos.nvr.status": adapter("cyberos.nvr.status", async () => get("/api/nvr")),
    "cyberos.nvr.query": adapter("cyberos.nvr.query", async (input) => {
      if (input.entity === "ptz") return get(`/api/nvr/devices/${identifier(input.deviceId)}/ptz`);
      if (input.entity === "device") {
        return { device: await get(`/api/nvr/devices/${identifier(input.deviceId)}`) };
      }
      if (typeof input.from !== "string" || typeof input.to !== "string") throw new CapabilityError("INVALID_ARGUMENT", "A bounded from/to interval is required");
      const fingerprint = digest(omit(input, "limit", "cursor"));
      let cursor: { time: string; id: string } | null = null;
      if (input.cursor) {
        try {
          const value = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString()) as { fingerprint: string; time: string; id: string };
          if (value.fingerprint !== fingerprint || typeof value.time !== "string" || typeof value.id !== "string") throw new Error();
          cursor = value;
        } catch { throw new CapabilityError("INVALID_ARGUMENT", "Invalid NVR timeline cursor"); }
      }
      const limit = Number(input.limit ?? 40);
      const result = await get(query(`/api/nvr/${String(input.entity)}`, { ...omit(input, "entity", "limit", "cursor"), limit: limit + 1,
        ...(cursor ? { cursorTime: cursor.time, cursorId: cursor.id } : {}) }));
      const rows = Array.isArray(result) ? result : [];
      const selected = boundedPageItems(rows, limit);
      const last = selected.at(-1);
      const time = last ? object(last)[input.entity === "segments" ? "startedAt" : "occurredAt"] : null;
      return { nextCursor: rows.length > selected.length && last ? Buffer.from(JSON.stringify({ fingerprint, time, id: object(last).id })).toString("base64url") : null, items: selected, limit };
    }),
    "cyberos.nvr.resource-link": async (value, context, dependencies) => {
      const input = validateCapability("cyberos.nvr.resource-link", value);
      return createNvrMcpResource(server, dependencies, context.subject.clientId, input);
    },
    "cyberos.bluetooth.status": adapter("cyberos.bluetooth.status", async () => {
      const [status, settings] = await Promise.all([get("/api/system/bluetooth"), get("/api/system/bluetooth/settings")]);
      return { ...object(status), ...object(settings) };
    }),
    "cyberos.bluetooth.transfers": adapter("cyberos.bluetooth.transfers", async (input) => {
      const result = object(await get("/api/system/bluetooth/transfers"));
      return { ...object(collectionPage(Array.isArray(result.transfers) ? result.transfers : [], input, "bluetooth")), health: result.health ?? null };
    }),
    "cyberos.audio.status": adapter("cyberos.audio.status", async (input) => {
      const view = input.view ?? "status";
      return get(view === "settings" ? "/api/settings/audio" : query(`/api/audio/${String(view)}`, omit(input, "view")));
    }),
    "cyberos.backup.snapshots": adapter("cyberos.backup.snapshots", async (input) => {
      const result = object(await get("/api/backup/snapshots"));
      return collectionPage(Array.isArray(result.snapshots) ? result.snapshots : [], input, "backup");
    })
  };
}
