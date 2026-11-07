import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { setInterval, clearInterval } from "node:timers";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import process from "node:process";
import { before, after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
let server, browser, baseUrl;
const harness = `
import React from 'react';
import { AppearanceProvider } from '@cyberos/ui';
import { mountAppearance } from '@cyberos/ui/theme';
import '@cyberos/ui/fonts.css';
import '@cyberos/ui/styles.css';
import { createRoot } from 'react-dom/client';
import { NvrPanel } from '/src/components/nvr/NvrPanel.tsx';
import { initI18n, i18n } from '/src/i18n/index.ts';
import '/src/styles.css';
mountAppearance();
await initI18n();
await i18n.changeLanguage(location.search.includes('zh') ? 'zh-CN' : 'en');
createRoot(document.getElementById('root')).render(<AppearanceProvider locale={i18n.language === 'en' ? 'en' : 'zh-CN'}><div className="app-shell" style={{display:'block',height:'100dvh',overflow:'hidden'}}><NvrPanel storagePools={[{id:'pool-1',name:'Pool 1',path:'.',filesystem:'ext4',status:'ready'}]} /></div></AppearanceProvider>);
`;
before(async () => {
  server = await createServer({ configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)), server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "nvr-browser-harness",
      resolveId(id) { if (id === "/__nvr-entry.tsx") return id; },
      load(id) { if (id === "/__nvr-entry.tsx") return harness; },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__nvr-test")) return next();
        response.setHeader("Content-Type", "text/html");
        response.end(await vite.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__nvr-entry.tsx"></script></body></html>'));
      }); }
    }]
  });
  await server.listen(); baseUrl = server.resolvedUrls.local[0]; browser = await chromium.launch(process.env.CYBEROS_BROWSER_CHANNEL ? { channel: process.env.CYBEROS_BROWSER_CHANNEL } : {});
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, width = 1440, zh = false) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const commands = [], changes = [], sessions = [];
  const previews = { opened: 0, closed: 0 };
  const previewTimers = new Set();
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAAAxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABIAIAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AI6AuiAAAAAA/9k=", "base64");
  await page.routeWebSocket("**/api/nvr/devices/*/preview-socket", (socket) => {
    previews.opened += 1; socket.send(jpeg);
    const timer = setInterval(() => socket.send(jpeg), 500);
    previewTimers.add(timer);
    socket.onClose(() => { clearInterval(timer); previewTimers.delete(timer); previews.closed += 1; });
  });
  const stamp = new Date().toISOString();
  const devices = Array.from({ length: 4 }, (_, i) => ({ id: `camera-${i}`, name: `Camera ${i + 1}`, onvifUrl: `http://camera-${i}:8000/onvif/device_service`,
    credentialsConfigured: true, profiles: [{ token: "raw", name: "Raw" }, { token: "annotated", name: "AI" }], recordingEnabled: false,
    recordingProfile: "raw", removedAt: null, connection: "connected", video: "available", recording: "disabled", ptz: "running", analytics: true, person: false, vehicle: false, lastError: null, updatedAt: stamp }));
  const policy = { storagePoolId: "pool-1", directory: "NVR", retentionDays: 7, quotaBytes: 100 * 2 ** 30 };
  t.after(async () => { for (const timer of previewTimers) clearInterval(timer); await context.close(); assert.deepEqual(errors, []); });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path.endsWith("/preview")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#16202d"/><path d="M100 180V70h120v110" stroke="#58d3ca" fill="none"/></svg>' });
    if (path.endsWith("/ptz")) {
      if (request.method() === "POST") { commands.push(request.postDataJSON()); return route.fulfill({ status: 204 }); }
      return route.fulfill({ json: { enabled: true, driver: "simulated", state: "running", simulated: true, position: { pan: .2, tilt: -.1, moving: false }, presets: [], calibrationRequired: false, absoluteMove: true, relativeMove: true, continuousMove: true, lastError: null } });
    }
    if (path.endsWith("/segments")) return route.fulfill({ json: [{ id: "segment-1", deviceId: "camera-0", profile: "raw", startedAt: stamp, endedAt: stamp, durationSeconds: 60, sizeBytes: 188, status: "ready" }] });
    if (path.endsWith("/events")) return route.fulfill({ json: [{ id: "event-1", deviceId: "camera-0", category: "person", state: true, occurredAt: stamp, receivedAt: stamp, gap: false }, { id: "gap-1", deviceId: "camera-0", category: "subscription_gap", state: null, occurredAt: stamp, receivedAt: stamp, gap: true }] });
    if (path.endsWith("/sessions")) {
      const value = request.postDataJSON(); sessions.push(value);
      return route.fulfill({ json: { id: "session", deviceId: value.deviceId, kind: value.kind, url: "/api/nvr/sessions/session/assets/index.m3u8", expiresAt: stamp } });
    }
    if (path.includes("/sessions/")) return route.fulfill({ status: 204 });
    if (request.method() === "PATCH") {
      const value = request.postDataJSON(); changes.push(value); const device = devices.find(d => path.endsWith(d.id)); Object.assign(device, value);
      return route.fulfill({ json: device });
    }
    return route.fulfill({ json: { devices, policy, usedBytes: 1024, maxRecordings: 4, heartbeatAt: stamp } });
  });
  await page.goto(`${baseUrl}__nvr-test?${zh ? "zh" : "en"}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.locator(".nvr-camera")).toHaveCount(4);
  await expect.poll(() => page.locator(".nvr-preview img").evaluateAll((images) => images.length === 4 && images.every((image) => image.naturalWidth > 0))).toBe(true);
  return { page, commands, changes, sessions, previews };
}

test("four preview sockets close on tab exit and reconnect on return", async (t) => {
  const { page, previews } = await open(t);
  assert.equal(previews.opened, 4);
  await page.locator("#nvr-tab-events").click();
  await expect.poll(() => previews.closed).toBe(4);
  await page.locator("#nvr-tab-live").click();
  await expect.poll(() => previews.opened).toBe(8);
  await expect.poll(() => page.locator(".nvr-preview img").evaluateAll((images) => images.length === 4 && images.every((image) => image.naturalWidth > 0))).toBe(true);
});

for (const zh of [false, true]) for (const width of [1440, 820, 560, 390, 320]) {
  test(`NVR four tabs fit ${width}px in ${zh ? "Chinese" : "English"}`, async t => {
    const { page } = await open(t, width, zh);
    for (const tab of ["live", "playback", "events", "devices"]) {
      await page.locator(`#nvr-tab-${tab}`).click();
      await expect(page.locator(`#nvr-${tab}`)).toBeVisible();
      if (tab === "live" && width >= 820) {
        assert.equal(await page.locator(".nvr-camera").evaluateAll(nodes => nodes.every(node => node.getBoundingClientRect().bottom <= globalThis.innerHeight)), true, "all four cameras remain visible together");
      }
      if (tab === "devices") await expect(page.locator(".nvr-device-row")).toHaveCount(4);
      assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
      const overflowing = await page.locator(".nvr-scroll button, .nvr-scroll input").evaluateAll(nodes => nodes.filter(node => {
        const b = node.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > globalThis.innerWidth + 1);
      }).map(node => node.textContent || node.getAttribute("aria-label")));
      assert.deepEqual(overflowing, []);
      await mkdir(".cyberos/nvr-browser", { recursive: true });
      await page.screenshot({ path: `.cyberos/nvr-browser/${zh ? "zh" : "en"}-${width}-${tab}.png` });
    }
  });
}

test("PTZ holds renew, release/blur/tab exit stop and recording changes are explicit", async t => {
  const { page, commands, changes } = await open(t);
  const right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.scrollIntoViewIfNeeded();
  await right.dispatchEvent("keydown", { key: " " });
  await expect.poll(() => commands.filter(c => c.action === "continuous_move").length).toBeGreaterThan(1);
  await right.dispatchEvent("keyup", { key: " " });
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  let count = commands.length;
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.length).toBeGreaterThan(count);
  await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event("blur")));
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  count = commands.length;
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.length).toBeGreaterThan(count);
  await page.locator("#nvr-tab-devices").click();
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  assert.equal(changes.length, 0);
  await page.getByRole("button", { name: "Start recording", exact: true }).first().click();
  await expect.poll(() => changes.length).toBe(1);
  assert.deepEqual(changes[0], { recordingEnabled: true });
  await page.getByRole("button", { name: "Stop recording", exact: true }).first().click();
  await expect.poll(() => changes.length).toBe(2);
  assert.deepEqual(changes[1], { recordingEnabled: false });
});

test("event opens playback for its camera and a coverage gap has no playback action", async t => {
  const { page, sessions } = await open(t, 390, true);
  await page.locator("#nvr-tab-events").click();
  await expect(page.locator(".nvr-events > li")).toHaveCount(2);
  await expect(page.locator('.nvr-events > li[data-gap="true"] button')).toHaveCount(0);
  await page.locator('.nvr-events > li[data-gap="false"] button').click();
  await expect(page.locator("#nvr-playback")).toBeVisible();
  await expect.poll(() => sessions.length).toBe(1);
  assert.equal(sessions[0].deviceId, "camera-0"); assert.equal(sessions[0].kind, "playback");
});
