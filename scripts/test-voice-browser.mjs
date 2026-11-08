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
const chatSession = { ...session, id: "chat-session", kind: "chat", firstMessage: "Workspace chat" };
const clip = (segment = 0) => ({ id: `media-${segment}`, role: "assistant", segment, durationMs: 1000, sizeBytes: 32044 });
const turn = (sequence) => ({ recordingId: `capture-${sequence}`, deviceId: "remote", sessionId: session.id, messageId: `message-${sequence}`, jobId: `job-${sequence}`,
  status: "completed", speechSuppressed: false, error: null, audioError: null, timings: {}, createdAt: timestamp, updatedAt: timestamp,
  sequence, revision: 1, source: "device", clientId: null, userText: `Message ${sequence} · 请查看一下今天的系统状态。`, assistantText: `Reply ${sequence} · 系统运行正常。${"历史保留文字与音频。 ".repeat(3)}`,
  awaitingApproval: false, userAudio: [{ ...clip(), role: "user" }], assistantAudio: [clip(0), clip(1)], userAudioState: "available", assistantAudioState: "available" });
function snapshot(before) {
  const available = state.items.filter((item) => !before || item.sequence < Number(before));
  const items = available.slice(-20);
  return { items, nextCursor: available.length > 20 ? String(items[0].sequence) : null,
    sessionId: session.id, enabled: state.enabled, configured: state.configured, speechEnabled: true, maxRecordingSeconds: state.maxSeconds,
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
  state = { items: Array.from({ length: 35 }, (_, index) => turn(index + 1)), enabled: true, configured: true, maxSeconds: 30, failUpload: false, uploads: [], accepted: new Map(), failHistory: false,
    sessions: [session, chatSession], createdChats: [], deletedSessions: [], transcriptRequests: [], ...options.state };
  const context = await browser.newContext({ viewport: { width: options.width ?? 1440, height: options.height ?? 900 }, locale: options.locale ?? "en-US", reducedMotion: options.motion ?? "no-preference" });
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
    if (path === "/api/sessions") {
      if (route.request().method() === "POST") {
        const created = { ...chatSession, id: `created-chat-${state.createdChats.length + 1}`, firstMessage: null };
        state.createdChats.push(created); state.sessions = [created, ...state.sessions];
        return route.fulfill({ json: { session: created } });
      }
      return route.fulfill({ json: { sessions: state.sessions } });
    }
    if (/^\/api\/sessions\/[^/]+$/.test(path) && route.request().method() === "DELETE") {
      const sessionId = path.split("/").at(-1);
      state.deletedSessions.push(sessionId); state.sessions = state.sessions.filter(item => item.id !== sessionId);
      return route.fulfill({ json: { ok: true } });
    }
    if (/^\/api\/sessions\/[^/]+\/transcript$/.test(path)) {
      state.transcriptRequests.push(path.split("/").at(-2));
      return route.fulfill({ json: { transcript: [], lastEventId: 0, activeJob: null, liveEvents: [] } });
    }
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
test("Agent navigation excludes system voice and starts the newest ordinary session", async context => {
  const { page } = await open(context);
  await closeDrawer(page);
  await expect(page.locator(".session-list .session-item")).toHaveCount(1);
  await expect(page.locator(".session-item")).toHaveAttribute("aria-current", "page");
  await expect(page.locator(".chat-header h2")).toHaveText("Workspace chat");
  await expect(page.locator(".chat-header-index")).toHaveText("01");
  await expect(page.locator(".agent-footer .voice-entry")).toBeVisible();
  assert.equal(state.transcriptRequests[0], "chat-session");
});
test("mobile Agent navigation also excludes system voice", async context => {
  const { page } = await open(context, { width: 390 });
  await closeDrawer(page);
  await page.getByRole("button", { name: "Conversations", exact: true }).click();
  await expect(page.locator(".mobile-sessions-dialog .session-item")).toHaveCount(1);
  await expect(page.locator(".mobile-sessions-dialog .session-item")).toHaveAccessibleName(/Workspace chat/);
});
test("mobile voice entry retains the current-entry accent without changing its target size", async context => {
  const { page } = await open(context, { width: 390, motion: "reduce", state: { items: [] } });
  const entry = page.locator(".voice-entry");
  const bounds = await entry.boundingBox();
  const colors = await entry.evaluate(element => ({
    active: globalThis.getComputedStyle(element).backgroundColor,
    accent: globalThis.getComputedStyle(globalThis.document.querySelector(".voice-header .ui-dialog-icon"), "::before").backgroundColor
  }));
  assert.equal(colors.active, colors.accent);
  await closeDrawer(page);
  assert.deepEqual(await entry.boundingBox(), bounds);
});
test("creates an ordinary session when only the protected voice session exists", async context => {
  const { page } = await open(context, { state: { sessions: [session] } });
  await closeDrawer(page);
  await expect(page.locator(".session-list .session-item")).toHaveCount(1);
  await expect(page.locator(".session-item[aria-current='page']")).toHaveCount(1);
  await expect(page.locator(".chat-header h2")).not.toHaveText("System voice session");
  assert.equal(state.createdChats.length, 1);
  assert.equal(state.transcriptRequests[0], "created-chat-1");
  assert.ok(state.sessions.some(item => item.id === session.id));
});
test("deleting the final ordinary session never falls back to system voice", async context => {
  const { page } = await open(context, { state: { sessions: [chatSession, session] } });
  await closeDrawer(page);
  await page.locator(".chat-delete-session-button").click();
  await page.locator(".session-delete-dialog .danger-button").click();
  await expect.poll(() => state.transcriptRequests.at(-1)).toBe("created-chat-1");
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "false");
  await expect(page.locator(".chat-header h2")).not.toHaveText("System voice session");
  await expect(page.locator(".session-item[aria-current='page']")).toHaveCount(1);
  assert.equal(state.createdChats.length, 1);
  assert.deepEqual(state.deletedSessions, ["chat-session"]);
  assert.equal(state.transcriptRequests.at(-1), "created-chat-1");
});
test("voice button retains full conversation and approval access without a voice list item", async context => {
  const { page } = await open(context);
  await page.getByRole("button", { name: "Open full conversation", exact: true }).click();
  await expect(page.locator(".voice-drawer")).toHaveCount(0);
  await expect(page.locator(".chat-header h2")).toHaveText("System voice session");
  await expect(page.locator(".chat-delete-session-button")).toBeDisabled();
  await expect(page.locator(".session-list .session-item")).toHaveCount(1);
  await expect(page.locator(".session-item[aria-current='page']")).toHaveCount(0);
  await page.locator(".session-item").click();
  await expect(page.locator(".chat-header h2")).toHaveText("Workspace chat");
});
test("voice drawer uses shared heading slots, status and primary recording commands", async context => {
  const { page } = await open(context, { motion: "reduce" });
  await page.screenshot({ path: `${directory}/visual-desktop.png` });
  await page.locator(".voice-drawer").screenshot({ path: `${directory}/visual-drawer.png` });
  assert.equal(await page.locator(".voice-header > .ui-dialog-icon").count(), 1);
  await expect(page.locator(".voice-status")).toHaveAttribute("data-state", "offline");
  await expect(page.locator(".voice-record-button")).toHaveAttribute("data-variant", "primary");
  await expect(page.locator(".voice-entry")).toHaveAttribute("data-icon-only", "true");
});
async function voiceTextContrast(page) {
  return page.locator(".voice-header h2, .voice-status, .voice-message-meta, .voice-message-meta time, .voice-bubble p, .voice-audio-time, .voice-record-idle > span, .voice-record-button, .voice-approval, .voice-preview-actions button, .voice-stop, .voice-pending, .voice-turn-error, .voice-no-audio, .voice-draft-label, .voice-capture-summary, .voice-date, .voice-older").evaluateAll(elements => elements.map(element => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const composite = (front, back) => front.slice(0, 3).map((channel, index) => channel * front[3] / 255 + back[index] * (1 - front[3] / 255)).concat(255);
    const ancestors = [];
    for (let ancestor = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
    let background = ancestors.reduce((color, ancestor) => composite(rgba(globalThis.getComputedStyle(ancestor).backgroundColor), color), [255, 255, 255, 255]);
    const decoration = element.querySelector("[data-slot='decoration']");
    if (decoration) background = composite(rgba(globalThis.getComputedStyle(decoration, "::after").backgroundColor), background);
    const foreground = composite(rgba(globalThis.getComputedStyle(element).color), background);
    const luminance = color => color.slice(0, 3).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    const frontLight = luminance(foreground), backLight = luminance(background);
    return { selector: element.className, ratio: (Math.max(frontLight, backLight) + .05) / (Math.min(frontLight, backLight) + .05) };
  }));
}
async function checkVoiceThemes(page, screenshotPrefix) {
  let minimumContrast = Infinity;
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => {
      const key = "cyberos:appearance:v1", value = JSON.stringify({ scheme, mode });
      globalThis.localStorage.setItem(key, value);
      globalThis.dispatchEvent(new globalThis.StorageEvent("storage", { key, newValue: value }));
    }, { scheme, mode });
    await page.waitForFunction(({ scheme, mode }) => {
      const provider = globalThis.document.querySelector(".cyberos-ui-root");
      return provider?.dataset.scheme === scheme && provider.dataset.mode === mode;
    }, { scheme, mode });
    await page.waitForTimeout(250);
    const readings = await voiceTextContrast(page);
    for (const reading of readings) assert.ok(reading.ratio >= 4.5, `${scheme}/${mode}: ${JSON.stringify(reading)}`);
    minimumContrast = Math.min(minimumContrast, ...readings.map(reading => reading.ratio));
    if (screenshotPrefix && scheme === "neon") await page.screenshot({ path: `${directory}/${screenshotPrefix}-${mode}.png` });
  }
  return minimumContrast;
}
test("voice drawer text and commands remain readable in every theme and mode", async context => {
  const approvalTurn = { ...turn(1), awaitingApproval: true, assistantText: "", assistantAudio: [], status: "agent" };
  const { page } = await open(context, { motion: "reduce", state: { items: [turn(2), approvalTurn] } });
  const minimumContrast = await checkVoiceThemes(page, "visual");
  context.diagnostic(`Minimum Voice text contrast: ${minimumContrast.toFixed(2)}:1`);
});
test("recording, preview, upload and unavailable controls retain readable operational states", async context => {
  const { page } = await open(context, { motion: "reduce", state: { items: [] } });
  await record(page);
  await checkVoiceThemes(page);
  await page.locator(".voice-preview-actions button").nth(1).click();
  await expect(page.locator(".voice-status")).toHaveAttribute("data-state", "recording");
  await checkVoiceThemes(page);
  await page.locator(".voice-stop").click();
  await expect(page.locator(".voice-preview")).toBeVisible();
  let releaseUpload;
  await page.route("**/api/audio/recordings", async route => {
    await new Promise(resolve => { releaseUpload = resolve; });
    await route.fallback();
  });
  await page.locator(".voice-send").click();
  await expect(page.locator(".voice-status")).toHaveAttribute("data-state", "uploading");
  await expect(page.locator(".voice-send")).toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".voice-send")).toBeDisabled();
  await checkVoiceThemes(page);
  releaseUpload();
  await expect(page.locator(".voice-preview")).toHaveCount(0);
  state.enabled = false; broadcast();
  await expect(page.locator(".voice-status")).toHaveAttribute("data-state", "disabled");
  await expect(page.locator(".voice-record-button")).toBeDisabled();
  await checkVoiceThemes(page);
  state.enabled = true; state.configured = false; broadcast();
  await expect(page.locator(".voice-status")).toHaveAttribute("data-state", "unconfigured");
  await expect(page.locator(".voice-record-button")).toBeDisabled();
  await checkVoiceThemes(page);
});
for (const width of [1440, 1041, 1040, 390, 320]) {
  test(`voice controls remain reachable in a short ${width}x600 viewport`, async context => {
    const { page } = await open(context, { width, height: 600, motion: "reduce" });
    for (const selector of [".voice-header-actions button", ".voice-record-button"]) for (const button of await page.locator(selector).all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y >= 0 && bounds.y + bounds.height <= 600, `${selector}: ${JSON.stringify(bounds)}`);
      if (width <= 1040) assert.ok(bounds.width >= 44 && bounds.height >= 44, `${selector}: touch target`);
    }
    assert.equal(await page.locator(".voice-history").evaluate(element => element.clientHeight > 100 && element.scrollHeight > element.clientHeight), true);
    const lastAudio = page.locator(".voice-history input[type='range']").last();
    await page.keyboard.press("Tab");
    await lastAudio.focus();
    await expect(lastAudio).toHaveCSS("outline-width", "2px");
    const audioBounds = await lastAudio.boundingBox();
    const composerBounds = await page.locator(".voice-composer").boundingBox();
    assert.ok(audioBounds.y + audioBounds.height <= composerBounds.y);
    const focus = await lastAudio.evaluate(element => {
      const style = globalThis.getComputedStyle(element);
      return { visible: element.matches(":focus-visible"), outline: style.outlineWidth, clipped: style.clipPath };
    });
    assert.equal(focus.visible, true);
    assert.notEqual(focus.outline, "0px", JSON.stringify(focus));
    assert.equal(focus.clipped, "none");
    await page.screenshot({ path: `${directory}/short-${width}.png` });
    await record(page);
    for (const button of await page.locator(".voice-preview-actions button").all()) {
      const bounds = await button.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width && bounds.y + bounds.height <= 600);
    }
    await expect(page.locator(".voice-send")).toHaveAttribute("data-variant", "primary");
  });
}
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
  await expect(page.locator(".chat-header")).toContainText("System voice session");
  await expect(page.locator(".transcript")).toHaveAttribute("aria-busy", "false");
});
