/**
 * [INPUT]: 依赖真实通知队列、隔离密钥和注入推送传输。
 * [OUTPUT]: 验证投递、观察抑制、退避和失效订阅。
 * [POS]: worker 独立通知调度的行为回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createECDH } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserPushSubscription, createSession, createUserMessageAndJob, getBrowserPushSubscription, observeNotification, openCyberOsDb, publishNotification, updateBrowserPushSubscription, updateJobStatus, type CyberOsDatabase } from "@cyberos/db";
import { createCyberOsRuntime, loadBootstrap, type BrowserPushRegistration, type CyberOsRuntime } from "@cyberos/shared";
import { BrowserPushTransportError, createBrowserPushTransport, type BrowserPushTransport } from "@cyberos/shared/browser-push-node";
import { processNextNotification } from "./notifications.js";

let directory: string;
let db: CyberOsDatabase;
let config: CyberOsRuntime;
let identity: BrowserPushRegistration;
const created = new Date("2026-11-19T10:00:00.000Z");
let now: Date;
beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-push-worker-"));
  db = openCyberOsDb(path.join(directory, "db.sqlite"));
  config = createCyberOsRuntime(loadBootstrap({ CYBEROS_ROOT: directory }));
  const ecdh = createECDH("prime256v1"); ecdh.generateKeys();
  identity = createBrowserPushSubscription(db, { subscription: { endpoint: "https://push.example/private-endpoint", expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 3).toString("base64url") } }, origin: "https://nas.example", locale: "zh-CN", now: created });
  now = new Date(created.getTime() + 3_000);
});
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });
function event() { return publishNotification(db, { eventKey: "reply:test", type: "agent.reply", target: { kind: "home" }, now: created }); }
function tick(transport: BrowserPushTransport) { return processNextNotification({ db, config, workerId: "worker-a", now: () => now, transport }); }

describe("notification sender", () => {
  it("sends only generic localized payload and settles the persistent delivery", async () => {
    event();
    await tick(async (_subscription, payload, keys, _signal, ttlSeconds, subject) => { expect(payload).toMatchObject({ type: "agent.reply", title: "Agent 已回复", body: "点击查看回复" }); expect(keys.privateKey).toBeTruthy(); expect(ttlSeconds).toBe(86_397); expect(subject).toBe("https://nas.example"); return { status: 201, retryAfter: null }; });
    expect(db.prepare("SELECT state FROM notification_deliveries").get()).toEqual({ state: "sent" });
    expect(getBrowserPushSubscription(db, identity.id, identity.token)?.lastSuccessAt).toBe(now.toISOString());
  });
  it("does not send observed or disabled deliveries", async () => {
    const notification = event();
    observeNotification(db, { eventId: notification.id, subscriptionId: identity.id, token: identity.token, now });
    let sends = 0;
    await tick(async () => { sends++; return { status: 201, retryAfter: null }; });
    expect(sends).toBe(0);
    updateBrowserPushSubscription(db, identity.id, identity.token, { enabled: false, now });
    publishNotification(db, { eventKey: "another", type: "system.test", target: { kind: "home" }, now: created });
    await tick(async () => { sends++; return { status: 201, retryAfter: null }; });
    expect(sends).toBe(0);
  });
  it("disables an expired subscription after HTTP 410", async () => {
    event(); await tick(async () => ({ status: 410, retryAfter: null }));
    expect(getBrowserPushSubscription(db, identity.id, identity.token)).toMatchObject({ enabled: false, lastError: "push_http_410" });
  });
  it("honors Retry-After, then succeeds without sending before the due time", async () => {
    event();
    await tick(async () => ({ status: 429, retryAfter: "120" }));
    expect(db.prepare("SELECT state,due_at FROM notification_deliveries").get()).toEqual({ state: "pending", due_at: new Date(now.getTime() + 120_000).toISOString() });
    let sends = 0;
    await tick(async () => { sends++; return { status: 201, retryAfter: null }; });
    expect(sends).toBe(0);
    now = new Date(now.getTime() + 120_001);
    await tick(async () => { sends++; return { status: 201, retryAfter: null }; });
    expect(sends).toBe(1);
  });
  it("bounds retries and never persists endpoint details from transport errors", async () => {
    event();
    for (let index = 0; index < 8; index++) { await tick(async () => { throw new Error("https://secret-endpoint.example/credential"); }); now = new Date(now.getTime() + 3_600_000); }
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "failed", last_error: "push_retries_exhausted" });
    expect(getBrowserPushSubscription(db, identity.id, identity.token)?.lastError).toBe("push_retries_exhausted");
  });
  it("rejects a private push endpoint permanently without retrying it", async () => {
    event(); await tick(async () => { throw new BrowserPushTransportError("unsafe_endpoint"); });
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "failed", last_error: "push_unsafe_endpoint" });
  });

  it("keeps the subscription enabled after temporary DNS resolution fails", async () => {
    event();
    const transport = createBrowserPushTransport({ resolve: async () => { throw new Error("DNS unavailable"); } });
    await tick(transport);
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "pending", last_error: "push_network" });
    expect(getBrowserPushSubscription(db, identity.id, identity.token)?.enabled).toBe(true);
  });

  it("returns an interrupted network request to the persistent retry queue", async () => {
    event();
    const controller = new AbortController();
    const pending = processNextNotification({ db, config, workerId: "worker-a", now: () => now, signal: controller.signal, transport: async (_subscription, _payload, _keys, signal) => {
      await new Promise<void>((_resolve, reject) => signal!.addEventListener("abort", () => reject(new Error("interrupted")), { once: true }));
      return { status: 201, retryAfter: null };
    } });
    controller.abort();
    await pending;
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "pending", last_error: "push_interrupted" });
  });

  it.each(["observed", "disabled", "resolved"] as const)("rechecks %s state after DNS resolves and before HTTP starts", async (change) => {
    const session = createSession(db, {});
    const { job } = createUserMessageAndJob(db, { sessionId: session.id, content: "wait for input" });
    updateJobStatus(db, job.id, "waiting_approval");
    const notification = publishNotification(db, { eventKey: `race:${change}`, type: "agent.action_required", target: { kind: "agent_session", sessionId: session.id, jobId: job.id }, now: created });
    let finishDns!: () => void;
    let enteredDns!: () => void;
    const ready = new Promise<void>(resolve => { enteredDns = resolve; });
    const waiting = new Promise<void>(resolve => { finishDns = resolve; });
    let httpRequests = 0;
    const transport = createBrowserPushTransport({
      resolve: async () => { enteredDns(); await waiting; return [{ address: "8.8.8.8", family: 4 }]; },
      request: async () => { httpRequests++; return { status: 201, retryAfter: null }; }
    });
    const sending = tick(transport);
    await ready;
    if (change === "observed") observeNotification(db, { eventId: notification.id, subscriptionId: identity.id, token: identity.token, now });
    else if (change === "disabled") updateBrowserPushSubscription(db, identity.id, identity.token, { enabled: false, now });
    else updateJobStatus(db, job.id, "completed");
    finishDns();
    await sending;
    expect(httpRequests).toBe(0);
    expect(db.prepare("SELECT state FROM notification_deliveries").get()).toEqual({ state: change === "observed" ? "observed" : "failed" });
  });
});
