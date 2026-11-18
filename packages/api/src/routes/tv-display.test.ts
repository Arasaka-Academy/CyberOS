/**
 * [INPUT]: 依赖隔离数据库、HTTP 服务和可控显示运行时。
 * [OUTPUT]: 验证显示事件、渲染握手和素材 HTTP 边界。
 * [POS]: TV 展示接口的跨层契约回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import Fastify from "fastify";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { openCyberOsDb } from "@cyberos/db";
import { loadCyberOsRuntime, type TvDisplayStatus } from "@cyberos/shared";
import type { ApiRouteContext } from "../context.js";
import { registerTvDisplayRoutes } from "./tv-display.js";
import { registerTvScreensaverRoutes } from "./tv-screensaver.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "tv-http-"));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: directory }, directory);
  const db = openCyberOsDb(config.paths.databasePath);
  cleanups.push(async () => db.close());
  const server = Fastify();
  cleanups.push(() => server.close());
  const ready: boolean[] = [];
  const listeners = new Set<() => void>();
  let display: TvDisplayStatus = { state: "active", supported: true, reason: null, updatedAt: new Date(0).toISOString() };
  const context = { config, db, tvDisplay: {
    status: () => display, configure: () => {}, rendererReady: (value: boolean) => { ready.push(value); },
    subscribe: (listener: () => void) => { listeners.add(listener); return () => listeners.delete(listener); }
  } } as unknown as ApiRouteContext;
  registerTvDisplayRoutes(server, context);
  registerTvScreensaverRoutes(server, context);
  return { server, ready, listeners, transition: (state: TvDisplayStatus["state"]) => {
    display = { ...display, state, updatedAt: new Date().toISOString() };
    for (const listener of listeners) listener();
  } };
}
describe("TV display HTTP contracts", () => {
  it("accepts only explicit renderer readiness and retains independent default timers", async () => {
    const { server, ready } = await fixture();
    for (const payload of [{ ready: 1 }, { ready: true, off: true }, {}]) {
      expect((await server.inject({ method: "POST", url: "/api/tv/renderer", payload })).statusCode).toBe(400);
    }
    expect(ready).toEqual([]);
    const response = await server.inject({ method: "POST", url: "/api/tv/renderer", payload: { ready: true } });
    expect(response.json()).toMatchObject({ display: { state: "active", supported: true } });
    expect(ready).toEqual([true]);
    for (const headers of [{ "x-forwarded-for": "192.0.2.1" }, { "x-forwarded-for": "127.0.0.1, 192.0.2.1" }]) {
      expect((await server.inject({ method: "POST", url: "/api/tv/renderer", headers, payload: { ready: false } })).statusCode).toBe(403);
    }
    expect((await server.inject({ method: "POST", url: "/api/tv/renderer", remoteAddress: "192.0.2.1", payload: { ready: false } })).statusCode).toBe(403);
    expect(ready).toEqual([true]);
    expect((await server.inject("/api/tv/screensaver/items")).json()).toMatchObject({ items: [], nextCursor: null, fallbackReason: null });
    expect((await server.inject("/api/tv/screensaver/image/arbitrary-path")).statusCode).toBe(404);
  });
  it("streams settings and native transitions, then removes the subscriber on disconnect", async () => {
    const { server, listeners, transition } = await fixture();
    const address = await server.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/tv/events`, { signal: controller.signal });
    expect(response.headers.get("content-type")).toBe("text/event-stream");
    const reader = response.body!.getReader();
    cleanups.push(async () => { controller.abort(); await reader.cancel().catch(() => {}); });
    const decoder = new TextDecoder();
    let data = "";
    while (!data.includes('"screenOffAfterMinutes":30')) data += decoder.decode((await reader.read()).value);
    expect(data).toContain('"screensaverAfterMinutes":5');
    expect(listeners.size).toBe(1);
    transition("screensaver");
    data = "";
    while (!data.includes('"state":"screensaver"')) data += decoder.decode((await reader.read()).value);
    expect(data).toContain("event: snapshot");
    await reader.cancel();
    await expect.poll(() => listeners.size).toBe(0);
  });
});
