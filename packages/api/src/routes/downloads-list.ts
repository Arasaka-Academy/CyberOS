/**
 * [INPUT]: 依赖下载只读仓库、Fastify 和共享列表契约。
 * [OUTPUT]: 提供兼容列表、游标分页、窗口事件流和观察版本。
 * [POS]: 下载同步适配层；生命周期命令仍由 downloads 注册。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import {
  getDownloadSummary, getDownloadTask, getDownloadWorkerHealth, listDownloadTaskPage,
  listDownloadTasks, listDownloadTaskWindow, type CyberOsDatabase
} from "@cyberos/db";
import type {
  DownloadFilter, DownloadObservation, DownloadTaskKey, DownloadTaskPage, DownloadWindowSnapshot
} from "@cyberos/shared";

export const DOWNLOAD_OBSERVATION_HEADER = "X-CyberOS-Download-Observation";

type DownloadListQuery = {
  mode?: string; filter?: string; limit?: string; cursor?: string; anchor?: string;
  newest?: string; oldest?: string;
};

type PageInput = { filter: DownloadFilter; limit: number; cursor: DownloadTaskKey | null; anchor: DownloadTaskKey | null };
type WindowInput = { filter: DownloadFilter; newest: DownloadTaskKey | null; oldest: DownloadTaskKey | null };

export function createDownloadObserver(db: CyberOsDatabase) {
  const serverId = randomUUID();
  let sequence = 0;
  return {
    read<T extends object>(read: () => T): T & { observation: DownloadObservation } {
      return db.transaction(() => ({ ...read(), observation: { serverId, sequence: ++sequence } }))();
    }
  };
}

export type DownloadObserver = ReturnType<typeof createDownloadObserver>;

export function registerDownloadListRoutes(server: FastifyInstance, db: CyberOsDatabase): void {
  const observer = createDownloadObserver(db);

  server.addHook("preSerialization", (request, reply, payload, done) => {
    if (request.method !== "POST" || !request.url.startsWith("/api/downloads") || reply.statusCode >= 400
      || !payload || typeof payload !== "object" || !("task" in payload)) {
      done(null, payload); return;
    }
    const task = payload.task;
    if (!task || typeof task !== "object" || !("id" in task) || typeof task.id !== "string") {
      done(null, payload); return;
    }
    const result = observer.read(() => ({ ...payload, task: getDownloadTask(db, task.id as string) }));
    if (!result.task) {
      reply.code(409); done(null, { error: "Download task changed before its response" }); return;
    }
    done(null, result);
  });
  server.addHook("onSend", (request, reply, payload, done) => {
    if (request.method === "DELETE" && /^\/api\/downloads\/[^/?]+(?:\?.*)?$/.test(request.url) && reply.statusCode === 204) {
      reply.header(DOWNLOAD_OBSERVATION_HEADER, JSON.stringify(observer.read(() => ({})).observation));
    }
    done(null, payload);
  });

  server.get<{ Querystring: DownloadListQuery }>("/api/downloads", async (request, reply) => {
    if (request.query.mode === undefined) {
      return { tasks: listDownloadTasks(db, { limit: 500 }), health: getDownloadWorkerHealth(db) };
    }
    if (request.query.mode !== "page") return reply.code(400).send({ error: "Download list mode is invalid" });
    try {
      return readDownloadTaskPage(db, observer, parsePageQuery(request.query));
    } catch (error) {
      if (error instanceof DownloadListQueryError) return reply.code(400).send({ error: error.message });
      throw error;
    }
  });

  server.get<{ Querystring: DownloadListQuery }>("/api/downloads/events", async (request, reply) => {
    let input: WindowInput | null = null;
    try {
      if (request.query.mode !== undefined && request.query.mode !== "window") throw new DownloadListQueryError("Download event mode is invalid");
      if (request.query.mode === "window") input = parseWindowQuery(request.query);
    } catch (error) {
      if (error instanceof DownloadListQueryError) return reply.code(400).send({ error: error.message });
      throw error;
    }
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, {
      "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive", "X-Accel-Buffering": "no"
    });
    let lastContent = "";
    const flush = () => {
      if (raw.destroyed) return;
      const snapshot = input
        ? readDownloadWindow(db, observer, input)
        : { tasks: listDownloadTasks(db, { limit: 500 }), health: getDownloadWorkerHealth(db) };
      const { observation: ignored, ...content } = "observation" in snapshot ? snapshot : { ...snapshot, observation: null };
      void ignored;
      const serializedContent = JSON.stringify(content);
      if (serializedContent === lastContent) return;
      lastContent = serializedContent;
      raw.write(`event: ${input ? "window" : "snapshot"}\n`);
      raw.write(`data: ${JSON.stringify(snapshot)}\n\n`);
    };
    raw.write(": connected\n\n");
    flush();
    const timer = setInterval(flush, 1_000);
    request.raw.on("close", () => clearInterval(timer));
  });
}

export function readDownloadTaskPage(db: CyberOsDatabase, observer: DownloadObserver, input: PageInput): DownloadTaskPage {
  return observer.read(() => {
    const result = listDownloadTaskPage(db, input);
    const last = result.tasks.at(-1);
    return {
      tasks: result.tasks,
      nextCursor: result.hasMore && last ? encodeCursor({ createdAt: last.createdAt, id: last.id }, input.filter) : null,
      health: getDownloadWorkerHealth(db), summary: getDownloadSummary(db)
    };
  });
}

export function readDownloadWindow(db: CyberOsDatabase, observer: DownloadObserver, input: WindowInput): DownloadWindowSnapshot {
  return observer.read(() => {
    const head = listDownloadTaskPage(db, { filter: input.filter, limit: 50 });
    const lastHeadTask = head.tasks.at(-1);
    const window = input.newest && input.oldest
      ? listDownloadTaskWindow(db, { filter: input.filter, newest: input.newest, oldest: input.oldest })
      : { tasks: [], overflow: false };
    return {
      filter: input.filter, headTasks: head.tasks,
      headNextCursor: head.hasMore && lastHeadTask ? encodeCursor(lastHeadTask, input.filter) : null,
      windowTasks: window.tasks,
      window: { newest: input.newest, oldest: input.oldest, overflow: window.overflow },
      health: getDownloadWorkerHealth(db), summary: getDownloadSummary(db)
    };
  });
}

class DownloadListQueryError extends Error {}

function parseFilter(value: unknown): DownloadFilter {
  if (value === undefined) return "all";
  if (value === "all" || value === "active" || value === "completed" || value === "failed") return value;
  throw new DownloadListQueryError("Download filter is invalid");
}

function parseKey(value: unknown): DownloadTaskKey | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.length > 512) throw new DownloadListQueryError("Download key is invalid");
  try {
    const key = JSON.parse(value) as Partial<DownloadTaskKey> | null;
    if (!key || typeof key !== "object" || typeof key.id !== "string" || !key.id || key.id.length > 128
      || typeof key.createdAt !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(key.createdAt)
      || !Number.isFinite(Date.parse(key.createdAt))) throw new Error("Invalid key");
    return { createdAt: key.createdAt, id: key.id };
  } catch { throw new DownloadListQueryError("Download key is invalid"); }
}

function encodeCursor(key: DownloadTaskKey, filter: DownloadFilter): string {
  return Buffer.from(JSON.stringify({ createdAt: key.createdAt, id: key.id, filter }), "utf8").toString("base64url");
}

function parsePageQuery(query: DownloadListQuery): PageInput {
  const filter = parseFilter(query.filter);
  const limit = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new DownloadListQueryError("Download page limit must be between 1 and 100");
  if (query.cursor !== undefined && query.anchor !== undefined) throw new DownloadListQueryError("Download cursor and anchor cannot be combined");
  let cursor: DownloadTaskKey | null = null;
  if (query.cursor !== undefined) {
    if (typeof query.cursor !== "string" || query.cursor.length > 1024) throw new DownloadListQueryError("Download cursor is invalid");
    try {
      const decoded = JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")) as DownloadTaskKey & { filter: DownloadFilter };
      if (decoded.filter !== filter) throw new Error("Wrong filter");
      cursor = parseKey(JSON.stringify(decoded));
    } catch { throw new DownloadListQueryError("Download cursor is invalid or belongs to another filter"); }
  }
  return { filter, limit, cursor, anchor: parseKey(query.anchor) };
}

function parseWindowQuery(query: DownloadListQuery): WindowInput {
  const newest = parseKey(query.newest);
  const oldest = parseKey(query.oldest);
  if (Boolean(newest) !== Boolean(oldest)) throw new DownloadListQueryError("Download window requires both boundaries");
  if (newest && oldest && (newest.createdAt < oldest.createdAt || (newest.createdAt === oldest.createdAt && newest.id < oldest.id))) {
    throw new DownloadListQueryError("Download window boundaries are reversed");
  }
  return { filter: parseFilter(query.filter), newest, oldest };
}
