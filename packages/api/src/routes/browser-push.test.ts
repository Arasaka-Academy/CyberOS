/**
 * [INPUT]: 依赖真实 SQLite、Fastify 注入和隔离秘密目录。
 * [OUTPUT]: 验证订阅同源、身份、偏好、观察与测试通知。
 * [POS]: 通知 HTTP 入口的契约与安全回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createECDH } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { openCyberOsDb, publishNotification, type CyberOsDatabase } from "@cyberos/db";
import { createCyberOsRuntime, loadBootstrap, type BrowserPushRegistration } from "@cyberos/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerBrowserPushRoutes } from "./browser-push.js";
import type { ApiRouteContext } from "../context.js";

let directory: string;
let server: FastifyInstance;
let db: CyberOsDatabase;
const headers = { origin: "http://localhost:5173", host: "localhost:5173" };
const base = "/api/notifications/push";
function subscription() { const ecdh = createECDH("prime256v1"); ecdh.generateKeys(); return { endpoint: "https://push.example/id", expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 2).toString("base64url") } }; }

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-push-api-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  const config = createCyberOsRuntime(loadBootstrap({ CYBEROS_ROOT: directory }));
  server = Fastify({ logger: false });
  registerBrowserPushRoutes(server, { db, config } as ApiRouteContext, { validateEndpoint: async () => undefined });
  server.addHook("onClose", async () => db.close());
});
afterEach(async () => { await server.close(); await rm(directory, { recursive: true, force: true }); });

async function register(): Promise<BrowserPushRegistration> { const response = await server.inject({ method: "POST", url: `${base}/subscriptions`, headers, payload: { subscription: subscription(), locale: "zh-CN" } }); expect(response.statusCode).toBe(200); return response.json() as BrowserPushRegistration; }

describe("browser push routes", () => {
  it("returns only the persistent public VAPID key", async () => {
    const firstResponse = await server.inject({ url: `${base}/config` });
    expect(firstResponse.headers["cache-control"]).toBe("no-store");
    const first = firstResponse.json();
    const second = (await server.inject({ url: `${base}/config` })).json();
    expect(first).toEqual(second);
    expect(first).toEqual({ available: true, publicKey: expect.any(String) });
    expect(JSON.stringify(first)).not.toContain("privateKey");
  });
  it("requires a secure same origin for subscription writes", async () => {
    for (const requestHeaders of [{}, { origin: "https://evil.example", host: "localhost:5173" }, { origin: "http://nas.local", host: "nas.local" }]) {
      expect((await server.inject({ method: "POST", url: `${base}/subscriptions`, headers: requestHeaders, payload: { subscription: subscription(), locale: "en" } })).statusCode).toBe(403);
    }
  });
  it("binds update and deletion to the secret identity and registering origin", async () => {
    const registration = await register();
    const url = `${base}/subscriptions/${registration.id}`;
    expect((await server.inject({ method: "PATCH", url, headers, payload: { enabled: false } })).statusCode).toBe(404);
    expect((await server.inject({ method: "PATCH", url, headers: { ...headers, authorization: `Bearer ${registration.token}` }, payload: { preferences: { replies: false, actionRequired: true, failures: false } } })).json()).toMatchObject({ subscription: { preferences: { replies: false } } });
    expect((await server.inject({ method: "DELETE", url, headers: { origin: "https://other.example", host: "other.example", authorization: `Bearer ${registration.token}` } })).statusCode).toBe(404);
    expect((await server.inject({ method: "DELETE", url, headers: { ...headers, authorization: `Bearer ${registration.token}` } })).json()).toEqual({ ok: true });
  });
  it("creates a generic test event and acknowledges only the owning subscription", async () => {
    const identity = await register();
    const response = await server.inject({ method: "POST", url: `${base}/test`, headers, payload: { identity: { id: identity.id, token: identity.token } } });
    expect(response.statusCode).toBe(200);
    const event = response.json().event;
    expect(event).toMatchObject({ type: "system.test", target: { kind: "home" } });
    const observed = await server.inject({ method: "POST", url: `/api/notifications/events/${event.id}/observed`, headers, payload: { identity: { id: identity.id, token: identity.token } } });
    expect(observed.json()).toEqual({ observed: true });
    expect((await server.inject({ method: "POST", url: `${base}/test`, headers, payload: { identity: { id: identity.id, token: "invalid" } } })).statusCode).toBe(404);
  });
  it("streams only new events on first connect and resumes from Last-Event-ID", async () => {
    const old = publishNotification(db, { eventKey: "old", type: "system.test", target: { kind: "home" } });
    const address = await server.listen({ host: "127.0.0.1", port: 0 });
    const controller = new AbortController();
    const response = await fetch(`${address}/api/notifications/events`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(4_000)]) });
    const reader = response.body!.getReader();
    let text = new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`"lastEventId":${old.id}`);
    expect(text).not.toContain('"eventKey":"old"');
    const next = publishNotification(db, { eventKey: "new", type: "system.test", target: { kind: "home" } });
    while (!text.includes('"eventKey":"new"')) text += new TextDecoder().decode((await reader.read()).value);
    expect(text).toContain(`id: ${next.id}`);
    controller.abort();
    await reader.cancel().catch(() => undefined);
    const resumedController = new AbortController();
    const resumed = await fetch(`${address}/api/notifications/events?after=0`, { headers: { "Last-Event-ID": String(old.id) }, signal: AbortSignal.any([resumedController.signal, AbortSignal.timeout(4_000)]) });
    const resumedReader = resumed.body!.getReader();
    let replay = new TextDecoder().decode((await resumedReader.read()).value);
    while (!replay.includes('"eventKey":"new"')) replay += new TextDecoder().decode((await resumedReader.read()).value);
    expect(replay).not.toContain('"eventKey":"old"');
    resumedController.abort();
    await resumedReader.cancel().catch(() => undefined);
  });

  it("rejects malformed subscription keys and preferences", async () => {
    expect((await server.inject({ method: "POST", url: `${base}/subscriptions`, headers, payload: { subscription: { ...subscription(), keys: { p256dh: "invalid", auth: "invalid" } }, locale: "en" } })).statusCode).toBe(400);
    const identity = await register();
    expect((await server.inject({ method: "PATCH", url: `${base}/subscriptions/${identity.id}`, headers: { ...headers, authorization: `Bearer ${identity.token}` }, payload: { preferences: { replies: "true" } } })).statusCode).toBe(400);
  });
});
