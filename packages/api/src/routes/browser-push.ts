/**
 * [INPUT]: 依赖通知数据库、私有 VAPID 与第一方请求来源。
 * [OUTPUT]: 注册浏览器推送订阅、测试和前台观察接口。
 * [POS]: 通知 HTTP 边界；身份令牌只放请求体或授权头。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import {
  BrowserPushSubscriptionConflictError, createBrowserPushSubscription, deleteBrowserPushSubscription,
  getBrowserPushSubscription, latestNotificationEventId, listNotificationEvents, observeNotification,
  publishNotification, updateBrowserPushSubscription
} from "@cyberos/db";
import type { BrowserPushIdentity, BrowserPushSubscriptionRecord, NotificationPreferences } from "@cyberos/shared";
import { loadBrowserPushVapidKeys, validateBrowserPushEndpoint, validateBrowserPushSubscription } from "@cyberos/shared/browser-push-node";
import type { ApiRouteContext } from "../context.js";

interface BrowserPushRouteOptions { validateEndpoint?: (url: string) => Promise<unknown> }
const prefix = "/api/notifications/push";

export function registerBrowserPushRoutes(server: FastifyInstance, { db, config }: ApiRouteContext, options: BrowserPushRouteOptions = {}): void {
  server.addHook("onSend", (request, reply, payload, done) => {
    if (request.url.startsWith(prefix)) reply.header("Cache-Control", "no-store");
    done(null, payload);
  });
  const clients = new Set<() => void>();
  server.addHook("preClose", async () => { for (const close of clients) close(); });
  const originOf = (request: FastifyRequest): string | null => {
    const source = request.headers.origin;
    if (!source || source === "null" || request.headers["sec-fetch-site"] === "cross-site") return null;
    try {
      const url = new URL(source);
      if (url.origin !== source || url.username || url.password) return null;
      const secure = url.protocol === "https:";
      const localDevelopment = config.environment === "development" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
      if (!secure && !localDevelopment) return null;
      return url.host === request.headers.host || config.api.allowedOrigins.includes(source) ? source : null;
    } catch { return null; }
  };
  const identityRecord = (identity: BrowserPushIdentity | null, origin: string | null): BrowserPushSubscriptionRecord | null => {
    if (!identity || !origin) return null;
    const record = getBrowserPushSubscription(db, identity.id, identity.token);
    return record?.origin === origin ? record : null;
  };

  server.get(`${prefix}/config`, async () => {
    try { return { available: true, publicKey: loadBrowserPushVapidKeys(config.paths.secretsDir).publicKey }; }
    catch { return { available: false, publicKey: null }; }
  });

  server.post<{ Body: unknown }>(`${prefix}/subscriptions`, async (request, reply) => {
    const origin = originOf(request);
    if (!origin) return reply.code(403).send({ error: "A secure same-origin request is required" });
    try {
      const body = recordBody(request.body);
      const subscription = validateBrowserPushSubscription(body.subscription);
      const locale = parseLocale(body.locale);
      const preferences = body.preferences === undefined ? undefined : parsePreferences(body.preferences);
      const identity = body.identity === undefined ? undefined : parseIdentity(body.identity);
      if (identity && !identityRecord(identity, origin)) return reply.code(404).send({ error: "Push subscription not found" });
      await (options.validateEndpoint ?? validateBrowserPushEndpoint)(subscription.endpoint);
      loadBrowserPushVapidKeys(config.paths.secretsDir);
      return createBrowserPushSubscription(db, { subscription, origin, locale, ...(preferences ? { preferences } : {}), ...(identity ? { identity } : {}) });
    } catch (error) {
      return reply.code(error instanceof BrowserPushSubscriptionConflictError ? 409 : 400).send({ error: "Push subscription could not be registered" });
    }
  });

  server.get<{ Params: { id: string } }>(`${prefix}/subscriptions/:id`, async (request, reply) => {
    const token = bearer(request);
    const subscription = token ? getBrowserPushSubscription(db, request.params.id, token) : null;
    // 同源 GET 通常不发送 Origin；令牌与 Host 共同约束读取。
    const origin = request.headers.origin ? originOf(request) : subscription && new URL(subscription.origin).host === request.headers.host ? subscription.origin : null;
    if (!subscription || subscription.origin !== origin) return reply.code(404).send({ error: "Push subscription not found" });
    return { subscription };
  });

  server.patch<{ Params: { id: string }; Body: unknown }>(`${prefix}/subscriptions/:id`, async (request, reply) => {
    const origin = originOf(request);
    if (!origin) return reply.code(403).send({ error: "A secure same-origin request is required" });
    const token = bearer(request);
    if (!identityRecord(token ? { id: request.params.id, token } : null, origin)) return reply.code(404).send({ error: "Push subscription not found" });
    try {
      const body = recordBody(request.body);
      if (body.enabled !== undefined && typeof body.enabled !== "boolean") throw new Error("Invalid enabled flag");
      const patch = {
        ...(typeof body.enabled === "boolean" ? { enabled: body.enabled } : {}),
        ...(body.locale !== undefined ? { locale: parseLocale(body.locale) } : {}),
        ...(body.preferences !== undefined ? { preferences: parsePreferences(body.preferences) } : {})
      };
      return { subscription: updateBrowserPushSubscription(db, request.params.id, token!, patch) };
    } catch { return reply.code(400).send({ error: "Push preferences are invalid" }); }
  });

  server.delete<{ Params: { id: string } }>(`${prefix}/subscriptions/:id`, async (request, reply) => {
    const origin = originOf(request);
    if (!origin) return reply.code(403).send({ error: "A secure same-origin request is required" });
    const token = bearer(request);
    if (!identityRecord(token ? { id: request.params.id, token } : null, origin)) return reply.code(404).send({ error: "Push subscription not found" });
    deleteBrowserPushSubscription(db, request.params.id, token!);
    return { ok: true };
  });

  server.post<{ Body: unknown }>(`${prefix}/test`, async (request, reply) => {
    const origin = originOf(request);
    if (!origin) return reply.code(403).send({ error: "A secure same-origin request is required" });
    const identity = tryIdentity(request.body);
    const subscription = identityRecord(identity, origin);
    if (!subscription || !subscription.enabled) return reply.code(404).send({ error: "Push subscription not found" });
    return { event: publishNotification(db, { eventKey: `test:${randomUUID()}`, type: "system.test", target: { kind: "home" }, subscriptionId: subscription.id }) };
  });

  server.post<{ Params: { id: string }; Body: unknown }>("/api/notifications/events/:id/observed", async (request, reply) => {
    const origin = originOf(request);
    if (!origin) return reply.code(403).send({ error: "A secure same-origin request is required" });
    const identity = tryIdentity(request.body);
    if (!identityRecord(identity, origin)) return reply.code(404).send({ error: "Push subscription not found" });
    const eventId = Number(request.params.id);
    if (!Number.isSafeInteger(eventId) || eventId < 1) return reply.code(400).send({ error: "Notification event is invalid" });
    return { observed: observeNotification(db, { eventId, subscriptionId: identity!.id, token: identity!.token }) };
  });

  server.get<{ Querystring: { after?: string } }>("/api/notifications/events", async (request, reply) => {
    if (request.headers.origin && !originOf(request)) return reply.code(403).send({ error: "Notification origin is invalid" });
    const rawAfter = request.headers["last-event-id"] ?? request.query.after;
    if (rawAfter !== undefined && (typeof rawAfter !== "string" || !/^\d+$/u.test(rawAfter) || !Number.isSafeInteger(Number(rawAfter)))) return reply.code(400).send({ error: "Notification cursor is invalid" });
    if (clients.size >= 32) return reply.code(503).send({ error: "Too many notification event streams" });
    let after = rawAfter === undefined ? latestNotificationEventId(db) : Number(rawAfter);
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    raw.write(`event: ready\ndata: ${JSON.stringify({ lastEventId: after })}\n\n`);
    let polls = 0;
    const flush = () => {
      if (raw.destroyed) return close();
      try {
        for (const event of listNotificationEvents(db, { afterId: after, limit: 100, now: new Date() })) {
          if (raw.writableLength > 256 * 1024) return close();
          after = event.id;
          raw.write(`id: ${event.id}\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`);
        }
        if (++polls % 30 === 0) raw.write(": heartbeat\n\n");
      } catch { close(); }
    };
    const timer = setInterval(flush, 500);
    const close = () => { clearInterval(timer); clients.delete(close); raw.end(); };
    clients.add(close);
    request.raw.once("close", close);
    flush();
  });
}

function recordBody(value: unknown): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request"); return value as Record<string, unknown>; }
function parseLocale(value: unknown): "zh-CN" | "en" { if (value !== "zh-CN" && value !== "en") throw new Error("Invalid locale"); return value; }
function parsePreferences(value: unknown): NotificationPreferences { const record = recordBody(value); if (typeof record.replies !== "boolean" || typeof record.actionRequired !== "boolean" || typeof record.failures !== "boolean") throw new Error("Invalid preferences"); return { replies: record.replies, actionRequired: record.actionRequired, failures: record.failures }; }
function parseIdentity(value: unknown): BrowserPushIdentity { const record = recordBody(value); if (typeof record.id !== "string" || record.id.length > 100 || typeof record.token !== "string" || record.token.length > 200 || !record.id || !record.token) throw new Error("Invalid identity"); return { id: record.id, token: record.token }; }
function tryIdentity(value: unknown): BrowserPushIdentity | null { try { return parseIdentity(recordBody(value).identity); } catch { return null; } }
function bearer(request: FastifyRequest): string | null { const authorization = request.headers.authorization; return authorization?.startsWith("Bearer ") ? authorization.slice(7) : null; }
