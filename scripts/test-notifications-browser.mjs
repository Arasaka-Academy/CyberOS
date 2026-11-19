/**
 * [INPUT]: 依赖隔离通知 API 夹具、Vite、Chromium 与本地 CDP 推送注入。
 * [OUTPUT]: 验证通知设置、历史会话跳转、展示确认和关闭页面后的通知。
 * [POS]: 浏览器通知验收入口；不订阅或连接厂商推送服务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
/* global localStorage, Notification, navigator, ServiceWorkerRegistration, document, MessageEvent, setTimeout */
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import path from "node:path";
import os from "node:os";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const directory = fileURLToPath(new URL("../.cyberos/notifications-browser/", import.meta.url));
const timestamp = "2026-11-19T00:00:00.000Z";
const identity = { id: "fixture-browser", token: "local-fixture-token" };
const endpoint = "https://push.invalid/local-fixture";
const streams = new Map();
const evidence = { screenshots: [], scope: "Local fixtures and CDP injection; no vendor Push subscription or delivery", push: null };
const session = id => ({ id, kind: "chat", currentPath: ".", createdAt: timestamp, updatedAt: timestamp, firstMessage: `Conversation ${id}`, lastMessage: null, pendingApprovalCount: 0, activeJob: null });
const sessions = [session("a"), session("b"), ...Array.from({ length: 48 }, (_, index) => session(`recent-${index}`))];
let server, browser, baseUrl;

before(async () => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  server = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)), cacheDir: path.join(directory, "vite-cache"),
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "notifications-browser-fixture", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        const pathname = new URL(request.url, "http://localhost").pathname;
        if (pathname === "/notification-probe.html") {
          response.writeHead(200, { "Content-Type": "text/html" });
          response.end("<!doctype html><title>Notification probe</title><main>Local notification probe</main>");
          return;
        }
        if (!pathname.endsWith("/events")) return next();
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        response.write(pathname === "/api/notifications/events" ? 'event: ready\ndata: {"lastEventId":0}\n\n' : ": connected\n\n");
        const clients = streams.get(pathname) ?? new Set();
        clients.add(response); streams.set(pathname, clients);
        request.on("close", () => clients.delete(response));
      });
    } }]
  });
  await server.listen(); baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ channel: "chromium" });
});
after(async () => {
  await browser?.close();
  for (const clients of streams.values()) for (const response of clients) response.end();
  await server?.close();
  await writeFile(path.join(directory, "report.json"), JSON.stringify(evidence, null, 2));
});

function transcript(id) {
  return { session: session(id), transcript: [{ id: "event:42", role: "assistant", content: `Reply in ${id}`, createdAt: timestamp, sequence: 1, turnSequence: 1 }], lastEventId: 42, activeJob: null, liveEvents: [] };
}
async function open(t, { width = 1440, locale = "en", linked = null, permission = "default", subscribed = false, observedFailures = 0 } = {}) {
  const context = await browser.newContext({ viewport: { width, height: width < 1040 ? 844 : 900 }, reducedMotion: "reduce", locale });
  t.after(() => context.close());
  const state = {
    observed: [], observedAttempts: [], observedFailures, requests: [], subscription: { id: identity.id, enabled: true, preferences: { replies: true, actionRequired: true, failures: true }, locale, origin: new URL(baseUrl).origin, createdAt: timestamp, updatedAt: timestamp, lastSuccessAt: null, lastError: null }
  };
  await context.addInitScript(({ locale, identity, endpoint, permission, subscribed }) => {
    localStorage.setItem("cyberos:language", locale);
    localStorage.setItem("cyberos:appearance:v1", JSON.stringify({ scheme: "neon", mode: "dark" }));
    if (subscribed) localStorage.setItem("cyberos.browser-push.v1", JSON.stringify({ identity, endpoint }));
    globalThis.notificationFixture = { permission, permissionCalls: [], subscribeCalls: 0, subscription: subscribed };
    Object.defineProperty(Notification, "permission", { get: () => globalThis.notificationFixture.permission });
    Notification.requestPermission = async () => {
      globalThis.notificationFixture.permissionCalls.push(navigator.userActivation.isActive);
      globalThis.notificationFixture.permission = "granted";
      return "granted";
    };
    const subscription = { endpoint, unsubscribe: async () => { globalThis.notificationFixture.subscription = false; return true; }, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "fixture-key", auth: "fixture-auth" } }) };
    Object.defineProperty(ServiceWorkerRegistration.prototype, "pushManager", { get: () => ({
      getSubscription: async () => globalThis.notificationFixture.subscription ? subscription : null,
      subscribe: async () => { globalThis.notificationFixture.subscribeCalls++; globalThis.notificationFixture.subscription = true; return subscription; }
    }) });
  }, { locale, identity, endpoint, permission, subscribed });
  const fixtures = {
    "/api/system/storage": { storage: { pools: [], drives: [] } },
    "/api/settings/model-provider": { settings: { generation: 1, providerName: "openai", model: "fixture-model", baseUrl: null, apiKeyConfigured: false, updatedAt: timestamp } },
    "/api/approvals": { capabilityApprovals: [] }, "/api/operations": { operations: [] }, "/api/docker/operations": { operations: [] },
    "/api/vms/operations": { operations: [] }, "/api/files/batches": { batches: [] },
    "/api/notifications": { notifications: [], bluetoothTransfers: [], unreadCount: 0, bluetoothUnreadCount: 0 },
    "/api/notifications/summary": { operations: 0, bluetoothTransfers: 0, alerts: 0 }, "/api/monitoring/alerts/incidents": { incidents: [] }
  };
  await context.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), pathname = url.pathname;
    state.requests.push({ method: request.method(), path: pathname });
    if (pathname === "/api/notifications/events" || /^\/api\/sessions\/[^/]+\/events$/u.test(pathname)) return route.continue();
    if (pathname.endsWith("/events")) return route.fulfill({ status: 503, json: { error: "Fixture stream unused" } });
    if (pathname === "/api/sessions") return route.fulfill({ json: request.method() === "GET" ? { sessions } : { session: session("created") } });
    const match = /^\/api\/sessions\/([^/]+)\/transcript$/u.exec(pathname);
    if (match) return route.fulfill({ status: match[1] === "deleted" ? 404 : 200, json: match[1] === "deleted" ? { error: "Session missing" } : transcript(match[1]) });
    if (pathname === "/api/notifications/push/config") return route.fulfill({ json: { available: true, publicKey: "AQID" } });
    if (pathname === "/api/notifications/push/subscriptions") {
      const body = request.postDataJSON(); state.subscription = { ...state.subscription, locale: body.locale, preferences: body.preferences, enabled: true };
      return route.fulfill({ json: { ...identity, subscription: state.subscription } });
    }
    if (pathname === `/api/notifications/push/subscriptions/${identity.id}`) {
      assert.equal(request.headers().authorization, `Bearer ${identity.token}`);
      if (request.method() === "PATCH") state.subscription = { ...state.subscription, ...request.postDataJSON() };
      return route.fulfill({ json: { subscription: state.subscription } });
    }
    const observed = /^\/api\/notifications\/events\/(\d+)\/observed$/u.exec(pathname);
    if (observed) {
      state.observedAttempts.push(Number(observed[1]));
      if (state.observedFailures-- > 0) return route.fulfill({ status: 503, json: { error: "Transient fixture failure" } });
      state.observed.push({ id: Number(observed[1]), identity: request.postDataJSON().identity });
      return route.fulfill({ json: { observed: true } });
    }
    if (pathname === "/api/notifications/push/test") return route.fulfill({ json: { event: { id: 999 } } });
    return route.fulfill({ status: fixtures[pathname] ? 200 : 503, json: fixtures[pathname] ?? { error: "Unavailable in fixture" } });
  });
  const page = await context.newPage(), errors = [];
  page.setDefaultTimeout(7000);
  page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseUrl}${linked ? `?session=${linked}` : ""}#/app/agent`);
  await expect(page.locator(".composer textarea")).toBeVisible();
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "false");
  return { context, page, state, errors, width, locale };
}
async function settings(view) {
  const { page, width, locale } = view;
  if (width <= 1040) await page.goto(`${baseUrl}#/app/settings`);
  else {
    const label = await page.evaluate(async () => (await import("/src/i18n/index.ts")).i18n.t("common.actions.systemSettings"));
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await expect(page.locator(".settings-nav")).toBeVisible();
  await page.locator(".settings-nav").getByRole("button", { name: locale === "en" ? "Notifications" : "通知", exact: true }).click();
  await expect(page.getByRole("switch", { name: locale === "en" ? "Enable browser notifications" : "启用浏览器通知" })).toBeVisible();
  await expect(page.locator(".settings-content-body")).toHaveAttribute("aria-busy", "false");
}
async function screenshot(page, name) {
  const filename = path.join(directory, name);
  await page.screenshot({ path: filename }); evidence.screenshots.push(filename);
}
async function assertLayout(page) {
  const overflow = await page.locator(".settings-content").evaluate(root => {
    const box = root.getBoundingClientRect();
    return [...root.querySelectorAll("button, input, h3, dt, dd")].filter(element => {
      const bounds = element.getBoundingClientRect();
      return bounds.width > 0 && (bounds.left < box.left - 1 || bounds.right > box.right + 1);
    }).map(element => element.textContent?.trim());
  });
  assert.deepEqual(overflow, []);
}
function emitNotification(id, sessionId = "a", transcriptEventId = 42) {
  const event = { id, eventKey: `fixture:${id}`, type: "agent.reply", target: { kind: "agent_session", sessionId, jobId: "fixture-job", transcriptEventId }, createdAt: new Date().toISOString(), expiresAt: new Date(Date.now() + 60_000).toISOString() };
  for (const response of streams.get("/api/notifications/events") ?? []) response.write(`id: ${id}\nevent: notification\ndata: ${JSON.stringify(event)}\n\n`);
}

for (const locale of ["en", "zh-CN"]) for (const width of [1440, 390, 320]) {
  test(`notification settings preserve explicit permission and layout at ${width}px (${locale})`, async t => {
    const view = await open(t, { locale, width });
    await settings(view);
    assert.deepEqual(await view.page.evaluate(() => globalThis.notificationFixture.permissionCalls), []);
    const enable = view.page.getByRole("switch", { name: locale === "en" ? "Enable browser notifications" : "启用浏览器通知" });
    await enable.locator("..").click();
    await expect(enable).toBeChecked();
    await expect(enable).toBeEnabled();
    assert.deepEqual(await view.page.evaluate(() => globalThis.notificationFixture.permissionCalls), [true]);
    assert.equal(await view.page.evaluate(() => globalThis.notificationFixture.subscribeCalls), 1);
    await view.page.getByRole("switch", { name: locale === "en" ? "Execution failures" : "执行失败", exact: true }).locator("..").click();
    await expect.poll(() => view.state.subscription.preferences.failures).toBe(false);
    await view.page.getByRole("button", { name: locale === "en" ? "Send test notification" : "发送测试通知", exact: true }).click();
    await expect(view.page.locator('.settings-content-body [role="status"]')).toContainText(locale === "en" ? "Test queued" : "测试已排队");
    await assertLayout(view.page);
    await screenshot(view.page, `notifications-${locale}-${width}.png`);
    assert.deepEqual(view.errors, []);
  });
}
test("denied permission explains browser recovery without requesting permission", async t => {
  const view = await open(t, { permission: "denied" });
  await settings(view);
  await expect(view.page.getByRole("switch", { name: "Enable browser notifications" })).toBeDisabled();
  await expect(view.page.locator('.settings-content-body [role="status"]')).toContainText("Allow notifications in this site");
  assert.deepEqual(await view.page.evaluate(() => globalThis.notificationFixture.permissionCalls), []);
  await screenshot(view.page, "notifications-permission-denied.png");
});
for (const id of ["b", "historic-outside-list"]) test(`notification deep link opens ${id} directly`, async t => {
  const view = await open(t, { linked: id });
  await expect(view.page.locator(".transcript")).toContainText(`Reply in ${id}`);
  assert.ok(view.state.requests.some(request => request.path === `/api/sessions/${id}/transcript`));
  assert.equal(view.state.requests.some(request => request.method === "POST" && request.path === "/api/sessions"), false);
  assert.deepEqual(view.errors, []);
});
test("deleted notification session reports a localized error and leaves chat usable", async t => {
  const view = await open(t, { linked: "deleted" });
  await expect(view.page.getByRole("alert")).toContainText("The conversation for this notification is no longer available");
  await expect(view.page.locator(".transcript")).toContainText("Reply in a");
  assert.deepEqual(view.errors, []);
  await screenshot(view.page, "notification-deleted-session.png");
});
test("opening a deleted session from a worker message preserves the current chat stream", async t => {
  const view = await open(t);
  await expect.poll(() => streams.get("/api/sessions/a/events")?.size ?? 0).toBeGreaterThan(0);
  await view.page.evaluate(() => navigator.serviceWorker.dispatchEvent(new MessageEvent("message", {
    data: { type: "cyberos.notification.open", target: { kind: "agent_session", sessionId: "deleted", jobId: "missing-job" } }
  })));
  await expect(view.page.getByRole("alert")).toContainText("The conversation for this notification is no longer available");
  const event = {
    schemaVersion: 1, id: 43, sessionId: "a", jobId: "fixture-job", type: "agent.message", audience: "chat",
    transcriptSequence: 2, transcriptTurnSequence: 2, source: "pi", sourceId: "fixture-after-404", runId: "fixture-run", sequence: 43,
    payload: { role: "assistant", content: "Reply after unavailable notification", jobId: "fixture-job" }, createdAt: timestamp
  };
  for (const response of streams.get("/api/sessions/a/events") ?? []) response.write(`id: 43\nevent: agent.message\ndata: ${JSON.stringify(event)}\n\n`);
  await expect(view.page.locator(".transcript")).toContainText("Reply after unavailable notification");
  assert.deepEqual(view.errors, []);
});
test("only a rendered current conversation in the foreground acknowledges notifications", async t => {
  const view = await open(t, { subscribed: true, permission: "granted", observedFailures: 1 });
  await view.page.bringToFront();
  await expect.poll(() => streams.get("/api/notifications/events")?.size ?? 0).toBeGreaterThan(0);
  await expect(view.page.locator('[data-transcript-id="event:42"]')).toBeVisible();
  emitNotification(1001);
  await expect.poll(() => view.state.observed.map(item => item.id)).toContain(1001);
  assert.deepEqual(view.state.observedAttempts, [1001, 1001]);
  assert.deepEqual(view.state.observed.find(item => item.id === 1001).identity, identity);
  emitNotification(1002, "b");
  emitNotification(1003, "a", 999);
  const other = await view.context.newPage(); await other.goto(`${baseUrl}notification-probe.html`); await other.bringToFront();
  const nativeBackground = await view.page.evaluate(() => !document.hasFocus() && document.visibilityState !== "visible");
  if (!nativeBackground) {
    await view.page.evaluate(() => {
      Object.defineProperty(document, "hasFocus", { configurable: true, value: () => false });
      Object.defineProperty(document, "visibilityState", { configurable: true, value: "hidden" });
    });
  }
  evidence.backgroundState = nativeBackground ? "Native browser visibility/focus" : "Explicit document visibility/focus fixture; Chromium keeps headless tabs focused";
  await expect.poll(() => view.page.evaluate(() => document.hasFocus())).toBe(false);
  emitNotification(1004);
  await new Promise(resolve => setTimeout(resolve, 700));
  assert.deepEqual(view.state.observed.map(item => item.id), [1001]);
  assert.deepEqual(view.state.observedAttempts, [1001, 1001]);
  await view.page.bringToFront();
  if (!nativeBackground) await view.page.evaluate(() => { delete document.hasFocus; delete document.visibilityState; });
  await expect.poll(() => view.state.observed.map(item => item.id)).toContain(1004);
  assert.equal(view.state.observed.some(item => [1002, 1003].includes(item.id)), false);
  assert.deepEqual(view.errors, []);
});
test("real Service Worker shows generic push after the app page closes via local CDP injection", async t => {
  // Chromium 的隐私窗口禁用 PushMessagingService。独立临时常规配置不含用户数据。
  const profile = await mkdtemp(path.join(os.tmpdir(), "cyberos-push-browser-"));
  const context = await chromium.launchPersistentContext(profile, { channel: "chromium", permissions: ["notifications"] });
  let cdp;
  t.after(async () => { await cdp?.detach().catch(() => {}); await context.close(); await rm(profile, { recursive: true, force: true }); });
  const probe = await context.newPage(); await probe.goto(`${baseUrl}notification-probe.html`);
  cdp = await context.newCDPSession(probe);
  const workerErrors = [];
  cdp.on("ServiceWorker.workerErrorReported", error => workerErrors.push(error));
  let registrationId;
  cdp.on("ServiceWorker.workerRegistrationUpdated", event => { registrationId = event.registrations.find(registration => registration.scopeURL === baseUrl)?.registrationId ?? registrationId; });
  await cdp.send("ServiceWorker.enable");
  await context.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await context.route("**/api/**", route => {
    const pathname = new URL(route.request().url()).pathname;
    const fixtures = {
      "/api/sessions": { sessions: [session("a")] }, "/api/sessions/a/transcript": transcript("a"),
      "/api/system/storage": { storage: { pools: [], drives: [] } },
      "/api/settings/model-provider": { settings: { generation: 1, providerName: "openai", model: "fixture", baseUrl: null, apiKeyConfigured: false, updatedAt: timestamp } },
      "/api/approvals": { capabilityApprovals: [] }, "/api/operations": { operations: [] }, "/api/docker/operations": { operations: [] },
      "/api/vms/operations": { operations: [] }, "/api/files/batches": { batches: [] },
      "/api/notifications": { notifications: [], bluetoothTransfers: [], unreadCount: 0, bluetoothUnreadCount: 0 },
      "/api/notifications/summary": { operations: 0, bluetoothTransfers: 0, alerts: 0 }, "/api/monitoring/alerts/incidents": { incidents: [] }
    };
    return route.fulfill({ status: fixtures[pathname] ? 200 : 503, json: fixtures[pathname] ?? { error: "Fixture service unused" } });
  });
  const app = await context.newPage(); await app.goto(`${baseUrl}#/app/agent`);
  await expect(app.locator(".composer textarea")).toBeVisible();
  await app.evaluate(async () => { await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" }); await navigator.serviceWorker.ready; });
  assert.equal(await probe.evaluate(() => Notification.permission), "granted");
  await expect.poll(() => registrationId).toBeTruthy();
  await app.close();
  const payload = { version: 1, eventId: 7001, type: "agent.reply", title: "Agent replied", body: "Open the conversation to view the reply", target: { kind: "agent_session", sessionId: "historic-outside-list", jobId: "fixture-job", transcriptEventId: 42 } };
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(baseUrl).origin, registrationId, data: JSON.stringify(payload) });
  const notifications = () => probe.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).map(notification => ({ title: notification.title, body: notification.body, tag: notification.tag, data: notification.data })));
  await expect.poll(notifications, { message: `Worker errors: ${JSON.stringify(workerErrors)}` }).toHaveLength(1);
  const [shown] = await notifications();
  assert.equal(shown.title, "Agent replied"); assert.equal(shown.body, "Open the conversation to view the reply"); assert.equal(shown.tag, "cyberos-event-7001");
  assert.deepEqual(shown.data.target, payload.target);
  assert.equal(JSON.stringify(shown).includes("private conversation content"), false);
  await cdp.send("ServiceWorker.deliverPushMessage", { origin: new URL(baseUrl).origin, registrationId, data: JSON.stringify(payload) });
  await expect.poll(notifications).toHaveLength(1);
  evidence.push = { mechanism: "Chromium CDP ServiceWorker.deliverPushMessage", appPageClosed: app.isClosed(), actualServiceWorker: true, actualNotification: shown, vendorDeliveryTested: false };
});
