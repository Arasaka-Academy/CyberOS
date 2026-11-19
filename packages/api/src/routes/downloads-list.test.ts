/**
 * [INPUT]: 依赖临时 Fastify、SQLite 和下载列表路由。
 * [OUTPUT]: 验证分页参数、观察顺序和窗口事件的数据库真值。
 * [POS]: 下载 HTTP 同步协议回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDownloadTask, getDownloadTask, openCyberOsDb, type CyberOsDatabase } from "@cyberos/db";
import type { DownloadTaskPage, DownloadWindowSnapshot } from "@cyberos/shared";
import { createDownloadObserver, DOWNLOAD_OBSERVATION_HEADER, readDownloadWindow, registerDownloadListRoutes } from "./downloads-list.js";

let directory: string;
let db: CyberOsDatabase;
let app: FastifyInstance;
const now = new Date("2026-11-19T00:00:00.000Z");

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-download-list-api-"));
  db = openCyberOsDb(path.join(directory, "test.sqlite"));
  app = Fastify();
  registerDownloadListRoutes(app, db);
});
afterEach(async () => { await app.close(); db.close(); await rm(directory, { recursive: true, force: true }); });

function task(index: number) {
  return createDownloadTask(db, {
    url: "https://example.com/test", storagePoolId: "pool-1", targetDirectory: ".",
    targetFileName: `${index}.bin`, targetPath: `${index}.bin`, now
  });
}

describe("download list HTTP synchronization", () => {
  it("keeps legacy responses and adds filter-bound cursor pagination beyond 500", async () => {
    db.transaction(() => { for (let i = 0; i < 510; i++) task(i); })();
    const legacy = (await app.inject("/api/downloads")).json();
    expect(legacy.tasks).toHaveLength(500);
    expect(Object.keys(legacy).sort()).toEqual(["health", "tasks"]);
    const first = (await app.inject("/api/downloads?mode=page&limit=100")).json<DownloadTaskPage>();
    expect(first.tasks).toHaveLength(100);
    expect(first.summary.total).toBe(510);
    const next = (await app.inject(`/api/downloads?mode=page&limit=100&cursor=${encodeURIComponent(first.nextCursor!)}`)).json<DownloadTaskPage>();
    expect(next.tasks).toHaveLength(100);
    expect(new Set([...first.tasks, ...next.tasks].map((item) => item.id)).size).toBe(200);
    expect(next.observation.serverId).toBe(first.observation.serverId);
    expect(next.observation.sequence).toBeGreaterThan(first.observation.sequence);
    expect((await app.inject(`/api/downloads?mode=page&filter=failed&cursor=${encodeURIComponent(first.nextCursor!)}`)).statusCode).toBe(400);
  });

  it.each([
    "mode=nope", "mode=page&filter=other", "mode=page&limit=101", "mode=page&limit=0",
    "mode=page&cursor=bad", "mode=page&anchor=null", "mode=page&anchor=bad&cursor=bad"
  ])("rejects malformed query %s", async (query) => {
    expect((await app.inject(`/api/downloads?${query}`)).statusCode).toBe(400);
  });

  it("returns nearby rows for anchors including deleted tasks", async () => {
    const tasks = Array.from({ length: 80 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const anchor = tasks[40]!;
    db.prepare("DELETE FROM download_tasks WHERE id = ?").run(anchor.id);
    const key = JSON.stringify({ createdAt: anchor.createdAt, id: anchor.id });
    const page = (await app.inject(`/api/downloads?mode=page&anchor=${encodeURIComponent(key)}`)).json<DownloadTaskPage>();
    expect(page.tasks).toHaveLength(50);
    expect(page.tasks[24]?.id).toBe(tasks[39]?.id);
    expect(page.tasks[25]?.id).toBe(tasks[41]?.id);
    expect(page.nextCursor).not.toBeNull();
  });

  it("exposes a valid head cursor to bridge newly inserted batches", async () => {
    const tasks = Array.from({ length: 130 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const snapshot = readDownloadWindow(db, createDownloadObserver(db), { filter: "all", newest: null, oldest: null });
    expect(snapshot.headTasks).toHaveLength(50);
    expect(snapshot.headNextCursor).not.toBeNull();
    expect(snapshot.windowTasks).toEqual([]);
    const next = (await app.inject(`/api/downloads?mode=page&cursor=${encodeURIComponent(snapshot.headNextCursor!)}`)).json<DownloadTaskPage>();
    expect(next.tasks.map((item) => item.id)).toEqual(tasks.slice(50, 100).map((item) => item.id));
  });

  it("re-reads action payloads and sequences observations despite identical timestamps", async () => {
    const stale = task(1);
    app.post("/api/downloads/:id/resume", async () => {
      db.prepare("UPDATE download_tasks SET received_bytes = 17 WHERE id = ?").run(stale.id);
      return { task: stale };
    });
    app.delete("/api/downloads/:id", async (_request, reply) => {
      db.prepare("DELETE FROM download_tasks WHERE id = ?").run(stale.id);
      return reply.code(204).send();
    });
    const before = (await app.inject("/api/downloads?mode=page")).json<DownloadTaskPage>();
    const action = (await app.inject({ method: "POST", url: `/api/downloads/${stale.id}/resume` })).json();
    expect(action.task.receivedBytes).toBe(17);
    expect(action.task.updatedAt).toBe(stale.updatedAt);
    expect(action.observation.sequence).toBeGreaterThan(before.observation.sequence);
    const removed = await app.inject({ method: "DELETE", url: `/api/downloads/${stale.id}` });
    expect(removed.statusCode).toBe(204);
    const observation = JSON.parse(String(removed.headers[DOWNLOAD_OBSERVATION_HEADER.toLowerCase()]));
    expect(observation.sequence).toBeGreaterThan(action.observation.sequence);
    expect(getDownloadTask(db, stale.id)).toBeNull();
  });

  it("streams current window membership after independent database changes and deletion", async () => {
    const tasks = Array.from({ length: 3 }, (_, i) => task(i)).sort((a, b) => b.id.localeCompare(a.id));
    const newest = JSON.stringify({ createdAt: tasks[0]!.createdAt, id: tasks[0]!.id });
    const oldest = JSON.stringify({ createdAt: tasks[2]!.createdAt, id: tasks[2]!.id });
    const address = await app.listen({ port: 0, host: "127.0.0.1" });
    const abort = new AbortController();
    const response = await fetch(`${address}/api/downloads/events?mode=window&filter=completed&newest=${encodeURIComponent(newest)}&oldest=${encodeURIComponent(oldest)}`, { signal: abort.signal });
    const reader = response.body!.getReader();
    const independentWriter = openCyberOsDb(path.join(directory, "test.sqlite"));
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async (): Promise<DownloadWindowSnapshot> => {
      while (true) {
        const match = /event: window\ndata: ([^\n]+)\n\n/.exec(buffer);
        if (match) { buffer = buffer.slice(match.index + match[0].length); return JSON.parse(match[1]!) as DownloadWindowSnapshot; }
        const chunk = await reader.read();
        if (chunk.done) throw new Error("Window stream ended");
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    try {
      const initial = await next();
      expect(initial.windowTasks).toEqual([]);
      independentWriter.prepare("UPDATE download_tasks SET status = 'completed' WHERE id = ?").run(tasks[1]!.id);
      const changed = await next();
      expect(changed.windowTasks.map((item) => item.id)).toEqual([tasks[1]!.id]);
      expect(changed.observation.sequence).toBeGreaterThan(initial.observation.sequence);
      independentWriter.prepare("DELETE FROM download_tasks WHERE id = ?").run(tasks[1]!.id);
      const removed = await next();
      expect(removed.windowTasks).toEqual([]);
      expect(removed.summary.total).toBe(2);
      expect(removed.observation.sequence).toBeGreaterThan(changed.observation.sequence);
    } finally { independentWriter.close(); abort.abort(); await reader.cancel().catch(() => undefined); }
  }, 10_000);
});
