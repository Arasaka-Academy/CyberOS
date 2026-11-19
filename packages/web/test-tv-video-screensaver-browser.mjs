/**
 * [INPUT]: 依赖真实 Chromium、TV 页面和生成的 WebM 视频。
 * [OUTPUT]: 验证静音轮播、故障回退、来源切换与息屏释放。
 * [POS]: 视频屏保的浏览器行为验收；不调用共享播放器。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { test } from "node:test";
import { createTvHarness, snapshot } from "../../scripts/lib/tv-browser-fixture.mjs";

const library = createTvHarness();
const settings = { enabled: true, videoOutput: "wayland", drmConnector: null, audioDevice: null, hardwareDecoding: "auto-safe", screensaverSource: { kind: "video-directory", storagePoolId: "pool-1", path: "Videos" }, screensaverEnabled: true, screenOffEnabled: true, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30, updatedAt: "2026-11-18T00:00:00Z" };
function display(state, source = settings.screensaverSource) {
  return { settings: { ...settings, screensaverSource: source }, display: { state, supported: true, reason: null, updatedAt: settings.updatedAt } };
}
const item = id => ({ id, kind: "video", mimeType: "video/webm", url: `/api/tv/screensaver/video/${id}` });
const list = items => ({ items, nextCursor: null, sourceKey: "video-source", fallbackReason: null });
function noMediaWrites(writes) { assert.equal(writes.some(write => /\/api\/(?:playback|media\/.*play|vod-player|music\/player)/u.test(write.path)), false); }

async function sampleVideo(page) {
  return Buffer.from(await page.evaluate(async () => {
    const canvas = globalThis.document.createElement("canvas"); canvas.width = 160; canvas.height = 90;
    const context = canvas.getContext("2d"); const stream = canvas.captureStream(20);
    const recorder = new globalThis.MediaRecorder(stream, { mimeType: "video/webm;codecs=vp8" });
    const chunks = []; recorder.ondataavailable = event => chunks.push(event.data);
    const stopped = new Promise(resolve => { recorder.onstop = resolve; });
    let frame = 0; const timer = globalThis.setInterval(() => { context.fillStyle = frame++ % 2 ? "#114488" : "#882244"; context.fillRect(0, 0, 160, 90); }, 50);
    recorder.start(); await new Promise(resolve => globalThis.setTimeout(resolve, 800)); recorder.stop(); await stopped;
    globalThis.clearInterval(timer); for (const track of stream.getTracks()) track.stop();
    return [...new Uint8Array(await new globalThis.Blob(chunks).arrayBuffer())];
  }));
}

test("video screensaver plays muted, advances, loops and releases decoding on screen off", async t => {
  const { page, writes } = await library(t);
  const video = await sampleVideo(page); const requested = [];
  await page.route("**/api/tv/screensaver/items*", route => route.fulfill({ json: list([item("first"), item("second")]) }));
  await page.route("**/api/tv/screensaver/video/*", route => { requested.push(route.request().url().split("/").at(-1)); return route.fulfill({ body: video, contentType: "video/webm" }); });
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await page.locator(".tv-screensaver video").waitFor({ timeout: 2000 });
  await page.waitForFunction(() => { const video = globalThis.document.querySelector(".tv-screensaver video"); return video && !video.paused && video.currentTime > 0; });
  assert.equal(await page.locator(".tv-screensaver video").evaluate(video => video.muted && video.playsInline && !video.controls), true);
  await page.waitForFunction(() => globalThis.document.querySelector(".tv-screensaver video")?.getAttribute("src")?.endsWith("/second"));
  await page.waitForFunction(() => globalThis.document.querySelector(".tv-screensaver video")?.getAttribute("src")?.endsWith("/first"));
  assert.ok(requested.includes("first") && requested.includes("second"));
  await page.evaluate(() => { globalThis.window.__saverVideo = globalThis.document.querySelector(".tv-screensaver video"); });
  await snapshot(page, display("off"), "/api/tv/events");
  await page.locator(".tv-screensaver").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => { const video = globalThis.window.__saverVideo; return !video.isConnected && video.paused && video.getAttribute("src") === null; }), true);
  noMediaWrites(writes);
});

test("unsupported video falls back and changing the source cancels stale media", async t => {
  const { page, writes } = await library(t);
  await page.route("**/api/tv/screensaver/items*", route => route.fulfill({ json: list([item("bad")]) }));
  await page.route("**/api/tv/screensaver/video/*", route => route.fulfill({ contentType: "video/webm", body: "invalid video" }));
  const failedVideo = page.waitForResponse(response => response.url().endsWith("/api/tv/screensaver/video/bad"));
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await failedVideo;
  await page.locator(".tv-screensaver video").waitFor({ state: "detached" });
  await page.locator(".tv-screensaver-builtin").waitFor();
  await page.route("**/api/tv/screensaver/video/*", route => new Promise(resolve => { t.after(() => resolve(route.abort().catch(() => {}))); }));
  await snapshot(page, display("screensaver", { ...settings.screensaverSource, path: "Other" }), "/api/tv/events");
  await page.locator(".tv-screensaver video").waitFor({ state: "attached", timeout: 2000 });
  await page.evaluate(() => { globalThis.window.__saverVideo = globalThis.document.querySelector(".tv-screensaver video"); });
  await snapshot(page, display("screensaver", { kind: "builtin" }), "/api/tv/events");
  await page.locator(".tv-screensaver video").waitFor({ state: "detached" });
  assert.equal(await page.evaluate(() => { const video = globalThis.window.__saverVideo; return video.paused && video.getAttribute("src") === null; }), true);
  noMediaWrites(writes);
});

test("fifteen seconds without video progress skips the item and releases its request", async t => {
  const { page, writes } = await library(t);
  await page.route("**/api/tv/screensaver/items*", route => route.fulfill({ json: list([item("stalled")]) }));
  await page.route("**/api/tv/screensaver/video/*", route => new Promise(resolve => { t.after(() => resolve(route.abort().catch(() => {}))); }));
  await page.clock.install();
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await page.locator(".tv-screensaver video").waitFor({ state: "attached", timeout: 2000 });
  await page.clock.fastForward(15_100);
  await page.locator(".tv-screensaver video").waitFor({ state: "detached" });
  await page.locator(".tv-screensaver-builtin").waitFor();
  noMediaWrites(writes);
});
