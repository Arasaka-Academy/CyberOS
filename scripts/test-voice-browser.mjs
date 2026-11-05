import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { Buffer } from "node:buffer";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const directory = fileURLToPath(new URL("../.cyberos/voice-browser/", import.meta.url));
const timestamp = "2026-11-05T03:00:00.000Z";
const clients = new Set();
let server, browser, baseUrl, state;
const session = { id: "voice-session", kind: "voice", currentPath: ".", createdAt: timestamp, updatedAt: timestamp, firstMessage: "Voice", lastMessage: null, pendingApprovalCount: 0 };
const clip = (segment = 0) => ({ id: `media-${segment}`, role: "assistant", segment, durationMs: 1000, sizeBytes: 32044 });
const turn = (sequence) => ({ recordingId: `capture-${sequence}`, deviceId: "remote", sessionId: session.id, messageId: `message-${sequence}`, jobId: `job-${sequence}`,
  status: "completed", speechSuppressed: false, error: null, audioError: null, timings: {}, createdAt: timestamp, updatedAt: timestamp,
  sequence, revision: 1, source: "device", clientId: null, userText: `Message ${sequence} · 请查看一下今天的系统状态。`, assistantText: `Reply ${sequence} · 系统运行正常。${"历史保留文字与音频。 ".repeat(3)}`,
  awaitingApproval: false, userAudio: [{ ...clip(), role: "user" }], assistantAudio: [clip(0), clip(1)], userAudioState: "available", assistantAudioState: "available" });
function snapshot(before) {
  const available = state.items.filter((item) => !before || item.sequence < Number(before));
  const items = available.slice(-20);
  return { items, nextCursor: available.length > 20 ? String(items[0].sequence) : null,
    sessionId: session.id, enabled: state.enabled, configured: true, speechEnabled: true, maxRecordingSeconds: state.maxSeconds,
    status: { sessionId: session.id, awaitingApproval: state.items.some((item) => item.awaitingApproval), turns: state.items.slice(-30), error: null,
      daemon: { available: false, connected: false, protocol: "disabled", recordingId: null, recordings: [], generation: 0, playing: false, error: null }, test: { armed: false, transcript: null, error: null } } };
}
function broadcast() { for (const response of clients) response.write(`event: history\ndata: ${JSON.stringify(snapshot())}\n\n`); }
before(async () => {
  await mkdir(directory, { recursive: true });
  server = await createServer({ configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)), cacheDir: `${directory}/vite-cache`,
    root: fileURLToPath(new URL("../packages/web", import.meta.url)), server: { host: "127.0.0.1", port: 0 }, plugins: [{ name: "voice-browser-events", configureServer(vite) {
      vite.middlewares.use((request, response, next) => {
        const path = new URL(request.url, "http://localhost").pathname;
        if (!path.endsWith("/events")) return next();
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
        if (path === "/api/audio/history/events") { clients.add(response); response.write(`event: history\ndata: ${JSON.stringify(snapshot())}\n\n`); }
        else response.write(": connected\n\n");
        request.on("close", () => clients.delete(response));
      });
    } }] });
  await server.listen(); baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
});
after(async () => { await browser?.close(); for (const response of clients) response.end(); await server?.close(); });
function audioBytes() {
  const buffer = Buffer.alloc(32044); buffer.write("RIFF"); buffer.writeUInt32LE(32036, 4); buffer.write("WAVEfmt ", 8);
  buffer.writeUInt32LE(16, 16); buffer.writeUInt16LE(1, 20); buffer.writeUInt16LE(1, 22); buffer.writeUInt32LE(16000, 24);
  buffer.writeUInt32LE(32000, 28); buffer.writeUInt16LE(2, 32); buffer.writeUInt16LE(16, 34); buffer.write("data", 36); buffer.writeUInt32LE(32000, 40);
  return buffer;
}
async function open(t, options = {}) {
  state = { items: Array.from({ length: 35 }, (_, index) => turn(index + 1)), enabled: true, maxSeconds: 30, failUpload: false, uploads: [], accepted: new Map(), failHistory: false, ...options.state };
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: 900 }, locale: options.locale ?? "en-US", reducedMotion: options.motion ?? "no-preference" });
  t.after(() => context.close());
  if (options.withoutRandomUUID) await context.addInitScript(() => {
    Object.defineProperty(globalThis.crypto, "randomUUID", { value: undefined });
  });
  await context.addInitScript(() => {
    const { HTMLMediaElement, HTMLAudioElement, DOMException, navigator } = globalThis;
    globalThis.voicePlayLog = [];
    const originalPlay = HTMLMediaElement.prototype.play;
    HTMLMediaElement.prototype.play = function () {
      if (this instanceof HTMLAudioElement) {
        globalThis.voicePlayLog.push(this.src);
        if (globalThis.blockVoicePlay) return Promise.reject(new DOMException("Blocked", "NotAllowedError"));
      }
      return originalPlay.call(this);
    };
    globalThis.voiceMicStreams = [];
    globalThis.voiceMicRequests = 0;
    const originalMic = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      globalThis.voiceMicRequests++;
      if (globalThis.denyVoiceMic) throw new DOMException("Denied", "NotAllowedError");
      const stream = await originalMic(constraints); globalThis.voiceMicStreams.push(stream); return stream;
    };
  });
  const fixtures = {
    "/api/system/storage": { storage: { pools: [], drives: [] } }, "/api/settings/model-provider": { settings: { generation: 1, providerName: "openai", model: "test", baseUrl: null, apiKeyConfigured: false, updatedAt: timestamp } },
    "/api/sessions": { sessions: [session] }, "/api/approvals": { capabilityApprovals: [] }, "/api/operations": { operations: [] }, "/api/docker/operations": { operations: [] },
    "/api/vms/operations": { operations: [] }, "/api/files/batches": { batches: [] }, "/api/notifications": { notifications: [], bluetoothTransfers: [], unreadCount: 0, bluetoothUnreadCount: 0 },
    "/api/notifications/summary": { operations: 0, bluetoothTransfers: 0, alerts: 0 }, "/api/monitoring/alerts/incidents": { incidents: [] },
    [`/api/sessions/${session.id}/transcript`]: { transcript: [], lastEventId: 0, activeJob: null, liveEvents: [] }
  };
  await context.route("**/health", (route) => route.fulfill({ json: { ok: true } }));
  await context.route("**/api/**", async (route) => {
    const url = new URL(route.request().url()); const path = url.pathname;
    if (path === "/api/audio/history/events") return route.continue();
    // Unused fixture services must not occupy HTTP/1 connection slots in a
    // multi-tab test. Production Tailnet HTTPS multiplexes these over HTTP/2.
    if (path.endsWith("/events")) return route.fulfill({ status: 503, json: { error: "Fixture service unavailable" } });
    if (path === "/api/audio/history") return route.fulfill({ status: state.failHistory ? 503 : 200, json: state.failHistory ? { error: "offline" } : snapshot(url.searchParams.get("before")) });
    if (path.startsWith("/api/audio/media/")) return route.fulfill({ contentType: "audio/wav", body: audioBytes() });
    if (path === "/api/audio/recordings") {
      const headers = route.request().headers();
      const key = headers["idempotency-key"], clientId = headers["x-voice-client"];
      const bytes = route.request().postDataBuffer();
      state.uploads.push({ key, clientId, size: bytes?.length ?? 0 });
      if (state.failUpload) return route.fulfill({ status: 503, json: { error: "offline" } });
      let accepted = state.accepted.get(key);
      if (!accepted) { accepted = { ...turn(state.items.length + 1), source: "browser", clientId, status: state.pendingTranscription ? "transcribing" : "queued", jobId: state.pendingTranscription ? null : `job-${key}`, userText: "浏览器测试录音", assistantText: "", assistantAudio: [], recordingId: `browser-${key}` }; state.accepted.set(key, accepted); state.items.push(accepted); }
      else if (accepted.status === "failed" && !accepted.jobId) { accepted.status = "queued"; accepted.jobId = `job-${key}`; accepted.revision++; }
      broadcast(); return route.fulfill({ status: 202, json: { turn: accepted } });
    }
    await route.fulfill({ status: fixtures[path] ? 200 : 503, json: fixtures[path] ?? { error: "Unavailable in fixture" } });
  });
  const page = await context.newPage(); const errors = []; page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${baseUrl}#/app/agent`);
  await expect(page.locator(".voice-entry")).toBeVisible();
  await page.locator(".voice-entry").click();
  await expect(page.locator(".voice-drawer .voice-turn")).toHaveCount(state.items.length > 20 ? 20 : state.items.length);
  return { page, context, errors };
}
async function closeDrawer(page) { await page.locator(".voice-header-actions button").last().click(); await expect(page.locator(".voice-drawer")).toHaveCount(0); }
async function record(page) {
  await page.locator(".voice-record-button").click();
  await expect(page.locator(".voice-capture")).toBeVisible();
  await page.waitForFunction(() => globalThis.voiceMicStreams.at(-1)?.getTracks().some((track) => track.readyState === "live"));
  await page.waitForTimeout(400);
  await page.locator(".voice-stop").click();
  await expect(page.locator(".voice-preview")).toBeVisible();
}
const liveTracks = (page) => page.evaluate(() => globalThis.voiceMicStreams.flatMap((stream) => stream.getTracks()).filter((track) => track.readyState === "live").length);
test("keeps history and recording available when native UUID generation is unavailable", async (t) => {
  const { page, errors } = await open(t, { withoutRandomUUID: true, state: { items: [] } });
  await record(page);
  await page.locator(".voice-send").click();
  await expect(page.locator(".voice-preview")).toHaveCount(0);
  assert.match(state.uploads[0].clientId, /^[a-f0-9-]{36}$/u);
  assert.match(state.uploads[0].key, /^[a-f0-9-]{36}$/u);
  assert.deepEqual(errors, []);
});
for (const width of [1440, 820, 560, 390, 320]) for (const locale of ["en-US", "zh-CN"]) {
  test(`${width}px ${locale}: history, focus, safe layout and reduced motion`, async (t) => {
    const { page, errors } = await open(t, { width, locale, motion: "reduce" });
    assert.equal(await page.evaluate(() => globalThis.voiceMicRequests), 0);
    assert.equal(await page.locator(".voice-drawer").evaluate((element) => Math.round(element.getBoundingClientRect().width)), width <= 560 ? width : 460);
    assert.equal(await page.locator(".voice-drawer").evaluate((element) => Math.round(element.getBoundingClientRect().height)), 900);
    assert.equal(await page.locator(".voice-drawer").evaluate((element) => element.getBoundingClientRect().top), 0);
    assert.equal(await page.locator(".voice-drawer").evaluate((element) => globalThis.getComputedStyle(element).animationName), "none");
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
    assert.equal(await page.locator(".voice-drawer").evaluate((element) => element.scrollWidth > element.clientWidth), false);
    assert.equal(await page.locator(".voice-drawer input[type=text], .voice-drawer textarea").count(), 0);
    await expect(page.locator(".voice-header-actions button").last()).toBeFocused();
    await page.screenshot({ path: `${directory}/${width}-${locale}.png` });
    await page.keyboard.press("Escape"); await expect(page.locator(".voice-entry")).toBeFocused();
    assert.deepEqual(errors, []);
  });
}
test("preserves reading position across older pages, new replies and reopen", async (t) => {
  const { page } = await open(t); const list = page.locator(".voice-history");
  await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
  await list.evaluate((element) => { element.scrollTop = 0; });
  await page.waitForTimeout(100);
  const anchor = page.locator('[data-recording-id="capture-16"]'); const before = (await anchor.boundingBox()).y;
  await page.locator(".voice-older").click(); await expect(page.locator(".voice-turn")).toHaveCount(35);
  assert.ok(Math.abs((await anchor.boundingBox()).y - before) < 3, "loading older records jumped the anchor");
  const position = await list.evaluate((element) => element.scrollTop);
  state.items.push(turn(36)); broadcast(); await expect(page.locator(".voice-new-messages")).toBeVisible();
  assert.equal(await list.evaluate((element) => element.scrollTop), position);
  await closeDrawer(page); await page.locator(".voice-entry").click();
  assert.equal(await list.evaluate((element) => element.scrollTop), position);
  await page.locator(".voice-new-messages").click();
  await expect.poll(() => list.evaluate((element) => element.scrollHeight - element.scrollTop - element.clientHeight)).toBeLessThan(3);
});
test("can fill a gap when reconnecting after more than one page of new turns", async (t) => {
  const { page } = await open(t, { state: { items: Array.from({ length: 20 }, (_, index) => turn(index + 1)) } });
  await expect(page.locator(".voice-older")).toHaveCount(0);
  state.items.push(...Array.from({ length: 40 }, (_, index) => turn(index + 21))); broadcast();
  await expect(page.locator(".voice-turn")).toHaveCount(40);
  await expect(page.locator(".voice-older")).toBeVisible();
  await page.locator(".voice-older").click();
  await expect(page.locator(".voice-turn")).toHaveCount(60);
  await page.locator(".voice-older").click();
  await expect(page.locator(".voice-older")).toHaveCount(0);
});
test("handles denied permission, real MediaRecorder preview, rerecord, cancel and close cleanup", async (t) => {
  const { page } = await open(t, { state: { items: [] } });
  await page.evaluate(() => { globalThis.denyVoiceMic = true; }); await page.locator(".voice-record-button").click();
  await expect(page.locator(".voice-record-error")).toContainText("denied");
  await page.evaluate(() => { globalThis.denyVoiceMic = false; }); await record(page);
  assert.equal(await liveTracks(page), 0);
  await page.locator(".voice-preview-actions button").nth(1).click(); await expect(page.locator(".voice-capture")).toBeVisible();
  await closeDrawer(page); assert.equal(await liveTracks(page), 0);
  await page.locator(".voice-entry").click(); await expect(page.locator(".voice-preview")).toBeVisible();
  await page.locator(".voice-preview-actions button").first().click(); await expect(page.locator(".voice-record-button")).toBeVisible();
  assert.equal(state.uploads.length, 0);
});
test("automatically stops at the saved limit and preserves the draft on a failed send", async (t) => {
  const { page } = await open(t, { state: { items: [], maxSeconds: 1, failUpload: true } });
  await page.locator(".voice-record-button").click(); await expect(page.locator(".voice-preview")).toBeVisible({ timeout: 5000 });
  assert.equal(await liveTracks(page), 0);
  await page.locator(".voice-send").click(); await expect(page.locator(".voice-record-error")).toBeVisible();
  await expect(page.locator(".voice-preview")).toBeVisible(); state.failUpload = false;
  await page.locator(".voice-send").click(); await expect(page.locator(".voice-preview")).toHaveCount(0);
  assert.equal(state.uploads.length, 2); assert.equal(state.uploads[0].key, state.uploads[1].key); assert.ok(state.uploads[0].size > 100);
  assert.equal(state.items.length, 1);
});
test("restores a rejected transcription draft and retries with the same recording key", async (t) => {
  const { page } = await open(t, { state: { items: [], pendingTranscription: true } });
  await record(page); await page.locator(".voice-send").click();
  await expect(page.locator(".voice-preview")).toHaveCount(0);
  const accepted = state.items[0]; accepted.status = "failed"; accepted.revision++; broadcast();
  await expect(page.locator(".voice-preview")).toBeVisible();
  await expect(page.locator(".voice-record-error")).toBeVisible();
  await page.locator(".voice-send").click();
  await expect(page.locator(".voice-preview")).toHaveCount(0);
  await page.waitForTimeout(150);
  await expect(page.locator(".voice-preview")).toHaveCount(0);
  assert.equal(state.uploads.length, 2); assert.equal(state.uploads[0].key, state.uploads[1].key);
  assert.equal(state.items.length, 1);
});
test("only the initiating tab auto-plays, with a manual action when autoplay is blocked", async (t) => {
  const { page, context } = await open(t, { state: { items: [] } });
  const second = await context.newPage(); await second.goto(`${baseUrl}#/app/agent`); await second.locator(".voice-entry").click();
  await page.bringToFront(); await record(page); await page.locator(".voice-send").click(); await expect(page.locator(".voice-preview")).toHaveCount(0);
  await page.evaluate(() => { globalThis.blockVoicePlay = true; });
  Object.assign(state.items.at(-1), { status: "completed", assistantText: "Origin-bound reply", assistantAudio: [clip(0), clip(1)] }); broadcast();
  await expect(page.locator(".voice-manual-reply")).toBeVisible();
  assert.equal(await second.evaluate(() => globalThis.voicePlayLog.length), 0);
  await page.evaluate(() => { globalThis.blockVoicePlay = false; }); await page.locator(".voice-manual-reply").click();
  await expect.poll(() => page.evaluate(() => globalThis.voicePlayLog.length)).toBeGreaterThan(1);
  await closeDrawer(page); await page.locator(".voice-entry").click();
  const count = await page.evaluate(() => globalThis.voicePlayLog.length); broadcast(); await page.waitForTimeout(200);
  assert.equal(await page.evaluate(() => globalThis.voicePlayLog.length), count);
});
test("backgrounding ends capture and invalidates automatic replies; refresh never replays history", async (t) => {
  const { page } = await open(t, { state: { items: [] } });
  await page.locator(".voice-record-button").click(); await expect(page.locator(".voice-capture")).toBeVisible(); await page.waitForTimeout(300);
  await page.evaluate(() => { Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, value: "hidden" }); globalThis.document.dispatchEvent(new globalThis.Event("visibilitychange")); });
  await expect(page.locator(".voice-preview")).toBeVisible(); assert.equal(await liveTracks(page), 0);
  await page.evaluate(() => { Object.defineProperty(globalThis.document, "visibilityState", { configurable: true, value: "visible" }); });
  await page.locator(".voice-send").click(); await expect(page.locator(".voice-preview")).toHaveCount(0);
  await closeDrawer(page);
  Object.assign(state.items.at(-1), { status: "completed", assistantText: "Late reply", assistantAudio: [clip()] }); broadcast();
  await page.reload(); await page.locator(".voice-entry").click(); await expect(page.locator(".voice-history")).toContainText("Late reply");
  assert.equal(await page.evaluate(() => globalThis.voicePlayLog.length), 0);
});
test("empty, disabled, connection failure and approval remain actionable", async (t) => {
  const { page } = await open(t, { state: { items: [], enabled: false } });
  await expect(page.locator(".voice-empty")).toBeVisible(); await expect(page.locator(".voice-record-button")).toBeDisabled();
  await page.screenshot({ path: `${directory}/empty-disabled.png` });
  state.items = [{ ...turn(1), assistantText: "", assistantAudio: [], status: "agent", awaitingApproval: true }]; state.enabled = true; broadcast();
  await expect(page.locator(".voice-approval")).toBeVisible();
  state.failHistory = true; await closeDrawer(page); await page.locator(".voice-entry").click(); await expect(page.locator(".voice-inline-error")).toBeVisible();
  state.failHistory = false; await page.locator(".voice-inline-error button").click(); await expect(page.locator(".voice-inline-error")).toHaveCount(0);
  await page.locator(".voice-approval").click(); await expect(page.locator(".voice-drawer")).toHaveCount(0);
});
