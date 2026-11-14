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
const root = createRoot(document.getElementById('root'));
window.addEventListener('nvr-test-unmount', () => root.unmount());
root.render(<AppearanceProvider locale={i18n.language === 'en' ? 'en' : 'zh-CN'}><div className="app-shell" style={{display:'block',height:'100dvh',overflow:'hidden'}}><NvrPanel storagePools={[{id:'pool-1',name:'Pool 1',path:'.',filesystem:'ext4',status:'ready'}]} /></div></AppearanceProvider>);
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

async function open(t, width = 1440, zh = false, count = 4, configure = () => {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const commands = [], changes = [], sessions = [], removedSessions = [];
  const previews = { opened: 0, closed: 0, sockets: new Set() };
  const previewTimers = new Set();
  const jpeg = Buffer.from("/9j/4AAQSkZJRgABAgAAAQABAAD//gAPTGF2YzYzLjEuMTAyAP/bAEMACAQEBAQEBQUFBQUFBgYGBgYGBgYGBgYGBgYGBgcHBwgICAcHBwYGBwcICAgICQkJCAgICAkJCgoKDAwLCw4ODhERFP/EAEwAAQEAAAAAAAAAAAAAAAAAAAAHAQEBAAAAAAAAAAAAAAAAAAAAAxABAAAAAAAAAAAAAAAAAAAAABEBAAAAAAAAAAAAAAAAAAAAAP/AABEIABIAIAMBIgACEQADEQD/2gAMAwEAAhEDEQA/AI6AuiAAAAAA/9k=", "base64");
  const stamp = new Date().toISOString();
  const fixture = {
    devices: Array.from({ length: count }, (_, i) => ({ id: `camera-${i}`, name: `Camera ${i + 1}`, onvifUrl: `http://camera-${i}:8000/onvif/device_service`,
      credentialsConfigured: true, profiles: [{ token: "raw", name: "Raw" }, { token: "annotated", name: "AI" }], recordingEnabled: false,
      recordingProfile: "raw", removedAt: null, connection: "connected", video: "available", recording: "disabled", ptz: "running", analytics: true, person: false, vehicle: false, lastError: null, updatedAt: stamp })),
    policy: { storagePoolId: "pool-1", directory: "NVR", retentionDays: 7, quotaBytes: 100 * 2 ** 30 },
    ptz: { enabled: true, driver: "simulated", state: "running", simulated: true, position: { pan: .2, tilt: -.1, moving: false }, presets: [], calibrationRequired: false, absoluteMove: true, relativeMove: true, continuousMove: true, lastError: null },
    stopFails: false, previewFails: false, previewWaiting: false, previewInvalid: false, sessionFails: false, historyEmpty: false, moveGate: null
  };
  configure(fixture);
  await page.routeWebSocket("**/api/nvr/devices/*/preview-socket", (socket) => {
    previews.opened += 1;
    if (fixture.previewFails) { socket.close(); previews.closed += 1; return; }
    previews.sockets.add(socket);
    const frame = fixture.previewInvalid ? Buffer.from("not a JPEG") : jpeg;
    if (!fixture.previewWaiting) socket.send(frame);
    const timer = setInterval(() => { if (!fixture.previewWaiting) socket.send(frame); }, 500); previewTimers.add(timer);
    socket.onClose(() => { clearInterval(timer); previewTimers.delete(timer); previews.sockets.delete(socket); previews.closed += 1; });
  });
  t.after(async () => { for (const timer of previewTimers) clearInterval(timer); await context.close(); assert.deepEqual(errors, []); });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    if (path.endsWith("/ptz")) {
      if (request.method() === "POST") {
        const command = request.postDataJSON(); commands.push(command);
        if (command.action === "stop" && fixture.stopFails) return route.fulfill({ status: 503, json: { error: "Stop could not be confirmed" } });
        if (["absolute_move", "relative_move", "home", "goto_preset"].includes(command.action) && fixture.moveGate) await fixture.moveGate;
        return route.fulfill({ status: 204 });
      }
      return route.fulfill({ json: fixture.ptz });
    }
    const deviceId = url.searchParams.get("deviceId");
    if (path.endsWith("/segments")) return route.fulfill({ json: fixture.historyEmpty ? [] : [{ id: "segment-1", deviceId, profile: "raw", startedAt: stamp, endedAt: new Date(Date.parse(stamp) + 60_000).toISOString(), durationSeconds: 60, sizeBytes: 188, status: "ready" }] });
    if (path.endsWith("/events")) return route.fulfill({ json: fixture.historyEmpty ? [] : [{ id: "event-1", deviceId, category: "person", state: true, occurredAt: stamp, receivedAt: stamp, gap: false }, { id: "gap-1", deviceId, category: "subscription_gap", state: null, occurredAt: stamp, receivedAt: stamp, gap: true }] });
    if (path.endsWith("/sessions")) {
      const value = request.postDataJSON(); sessions.push(value); const id = `session-${sessions.length}`;
      if (fixture.sessionFails) return route.fulfill({ status: 503, json: { error: "Live session unavailable" } });
      return route.fulfill({ json: { id, deviceId: value.deviceId, kind: value.kind, url: `/api/nvr/sessions/${id}/assets/index.m3u8`, expiresAt: stamp } });
    }
    if (path.includes("/sessions/")) {
      if (request.method() === "DELETE") removedSessions.push(path.split("/").at(-1));
      return route.fulfill({ status: request.method() === "GET" ? 503 : 204 });
    }
    if (request.method() === "PATCH") {
      const value = request.postDataJSON(); changes.push(value); const device = fixture.devices.find(d => path.endsWith(d.id)); Object.assign(device, value);
      return route.fulfill({ json: device });
    }
    return route.fulfill({ json: { devices: fixture.devices, policy: fixture.policy, usedBytes: 1024, maxRecordings: 4, heartbeatAt: new Date().toISOString() } });
  });
  await page.goto(`${baseUrl}__nvr-test?${zh ? "zh" : "en"}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
  await expect(page.locator(".nvr-camera")).toHaveCount(count);
  if (count && fixture.devices.some(device => device.connection !== "disconnected") && !fixture.previewFails && !fixture.previewWaiting && !fixture.previewInvalid) {
    await expect.poll(() => page.locator(".nvr-preview img").evaluateAll((images) => images.length > 0 && images.every((image) => image.naturalWidth > 0))).toBe(true);
  }
  return { page, commands, changes, sessions, removedSessions, previews, fixture };
}

async function openCamera(page, index = 0) {
  await page.locator(".nvr-camera-open").nth(index).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  return dialog;
}
async function closeCamera(page) {
  await page.getByRole("dialog").getByRole("button", { name: /^(Close|关闭)$/ }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function assertNoOverflow(page) {
  assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
  assert.deepEqual(await page.locator('.nvr-scroll button, .nvr-scroll input, [role="dialog"] button, [role="dialog"] input').evaluateAll(nodes => nodes.filter(node => {
    const b = node.getBoundingClientRect(); return b.width > 0 && (b.left < -1 || b.right > globalThis.innerWidth + 1);
  }).map(node => node.textContent || node.getAttribute("aria-label"))), []);
  assert.deepEqual(await page.locator(".nvr-media-state").evaluateAll(nodes => nodes.flatMap(node => {
    const frame = node.parentElement.getBoundingClientRect();
    return [...node.children].filter(child => {
      const box = child.getBoundingClientRect();
      return box.width > 0 && (box.top < frame.top - 1 || box.bottom > frame.bottom + 1 || box.left < frame.left - 1 || box.right > frame.right + 1);
    }).map(child => child.textContent || child.className);
  })), []);
}

test("four preview sockets close on tab exit and reconnect on return", async t => {
  const { page, previews } = await open(t);
  assert.equal(previews.opened, 4);
  await page.locator("#nvr-tab-events").click();
  await expect.poll(() => previews.closed).toBe(4);
  await page.locator("#nvr-tab-live").click();
  await expect.poll(() => previews.opened).toBe(8);
});

for (const zh of [false, true]) for (const width of [1440, 820, 560, 390, 320]) {
  test(`NVR cards and camera dialog fit ${width}px in ${zh ? "Chinese" : "English"}`, async t => {
    const { page, fixture } = await open(t, width, zh);
    const geometry = await page.locator(".nvr-live-grid").evaluate(grid => ({ width: grid.getBoundingClientRect().width, overview: grid.querySelector(".nvr-overview").getBoundingClientRect().width, columns: globalThis.getComputedStyle(grid).gridTemplateColumns.split(" ").length }));
    assert.ok(Math.abs(geometry.width - geometry.overview) < 1, "overview occupies the full row");
    assert.equal(geometry.columns, geometry.width >= 620 ? 2 : 1);
    await mkdir(".cyberos/nvr-browser", { recursive: true });
    for (const tab of ["live", "playback", "events", "devices"]) {
      await page.locator(`#nvr-tab-${tab}`).click();
      await expect(page.locator(`#nvr-${tab}`)).toBeVisible();
      if (tab === "devices") await expect(page.locator(".nvr-device-row.nvr-card")).toHaveCount(4);
      if (tab === "events") await expect(page.locator(".nvr-events > .nvr-card")).toHaveCount(2);
      if (tab === "playback") await expect(page.locator(".nvr-recordings > .nvr-card")).toHaveCount(1);
      await assertNoOverflow(page);
      await page.screenshot({ path: `.cyberos/nvr-browser/${zh ? "zh" : "en"}-${width}-${tab}.png` });
    }
    await page.locator("#nvr-tab-live").click();
    const dialog = await openCamera(page);
    await expect(dialog.locator(".nvr-preview img")).toBeVisible();
    const box = await dialog.boundingBox();
    assert.ok(box.x >= 12 && box.x + box.width <= width - 12 + 1);
    assert.ok(Math.abs(box.x + box.width / 2 - width / 2) < 1, "dialog is centered on viewport");
    assert.ok(box.y >= 12 && box.y + box.height <= 900 - 12 + 1);
    assert.ok(Math.abs(box.y + box.height / 2 - 450) < 1);
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cyberos/nvr-browser/${zh ? "zh" : "en"}-${width}-dialog.png` });
    await closeCamera(page);
    for (const device of fixture.devices) Object.assign(device, { connection: "disconnected", video: "unavailable", ptz: "unavailable", analytics: null, lastError: "Camera connection unavailable" });
    await page.getByRole("button", { name: zh ? "刷新" : "Refresh", exact: true }).click();
    await expect(page.locator(".nvr-camera .nvr-preview[data-state='offline']")).toHaveCount(4);
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cyberos/nvr-browser/${zh ? "zh" : "en"}-${width}-offline-live.png` });
    const offlineDialog = await openCamera(page);
    await expect(offlineDialog.locator(".nvr-direction-pad, input")).toHaveCount(0);
    await expect(offlineDialog.getByRole("button", { name: zh ? "停止" : "Stop", exact: true })).toBeEnabled();
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cyberos/nvr-browser/${zh ? "zh" : "en"}-${width}-offline-dialog.png` });
    await closeCamera(page);
  });
}

test("dialog pauses background previews, restores focus, and supports keyboard and backdrop close", async t => {
  const { page, previews } = await open(t);
  const trigger = page.locator(".nvr-camera-open").first();
  await trigger.focus(); await trigger.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect.poll(() => previews.opened - previews.closed).toBe(1);
  assert.equal(await page.locator(".nvr-panel-content").evaluate(node => node.inert), true);
  await page.keyboard.press("Shift+Tab");
  assert.equal(await page.getByRole("dialog").evaluate(node => node.contains(globalThis.document.activeElement)), true);
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect.poll(() => previews.opened - previews.closed).toBe(4);
  await trigger.press("Space");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.mouse.click(5, 5);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});

test("raw HLS session is retained across resizing and removed on stream switch or dialog close", async t => {
  const { page, sessions, removedSessions, previews } = await open(t);
  let dialog = await openCamera(page);
  await dialog.getByRole("button", { name: "Original · HLS", exact: true }).click();
  await expect.poll(() => sessions.length).toBe(1);
  await expect.poll(() => previews.opened - previews.closed).toBe(0);
  await page.setViewportSize({ width: 390, height: 700 });
  assert.equal(sessions.length, 1);
  await dialog.getByRole("button", { name: "AI overlay · MJPEG", exact: true }).click();
  await expect.poll(() => removedSessions.length).toBe(1);
  await expect.poll(() => previews.opened - previews.closed).toBe(1);
  await dialog.getByRole("button", { name: "Original · HLS", exact: true }).click();
  await expect.poll(() => sessions.length).toBe(2);
  await closeCamera(page);
  await expect.poll(() => removedSessions.length).toBe(2);
  await expect.poll(() => previews.opened - previews.closed).toBe(4);
  dialog = await openCamera(page, 1);
  await expect(dialog.getByRole("heading", { name: "Camera 2", exact: true })).toBeVisible();
  await closeCamera(page);
});

test("PTZ hold renews, release/cancel/blur/close stop, and recording changes stay explicit", async t => {
  const { page, commands, changes } = await open(t);
  await openCamera(page);
  let right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.dispatchEvent("keydown", { key: " " });
  await expect.poll(() => commands.filter(c => c.action === "continuous_move").length).toBeGreaterThan(1);
  await right.dispatchEvent("keyup", { key: " " });
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  for (const kind of ["cancel", "blur", "close"]) {
    const count = commands.length;
    await right.dispatchEvent("keydown", { key: "Enter" });
    await expect.poll(() => commands.length).toBeGreaterThan(count);
    if (kind === "cancel") await right.dispatchEvent("pointercancel");
    if (kind === "blur") await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event("blur")));
    if (kind === "close") await closeCamera(page);
    await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  }
  await page.locator("#nvr-tab-devices").click();
  assert.equal(changes.length, 0);
  await page.getByRole("button", { name: "Start recording", exact: true }).first().click();
  await expect.poll(() => changes.length).toBe(1);
  assert.deepEqual(changes[0], { recordingEnabled: true });
  await page.getByRole("button", { name: "Stop recording", exact: true }).first().click();
  await expect.poll(() => changes.length).toBe(2);
  assert.deepEqual(changes[1], { recordingEnabled: false });
});

test("closing during an unacknowledged finite move sends stop after its acknowledgement", async t => {
  const { page, fixture, commands } = await open(t);
  let finish;
  fixture.moveGate = new Promise(resolve => { finish = resolve; });
  await openCamera(page);
  await page.getByRole("button", { name: "Return to center", exact: true }).click();
  await expect.poll(() => commands.at(-1)?.action).toBe("home");
  await closeCamera(page);
  assert.equal(commands.at(-1).action, "home");
  finish();
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
});

test("unmount and remote device removal stop PTZ and release the dialog preview", async t => {
  const { page, fixture, commands, previews } = await open(t);
  await openCamera(page);
  let right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  fixture.devices[0].removedAt = new Date().toISOString();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await openCamera(page);
  right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event("nvr-test-unmount")));
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await expect.poll(() => previews.opened - previews.closed).toBe(0);
});

test("unknown and removed devices do not inflate overview availability", async t => {
  const { page, fixture } = await open(t);
  Object.assign(fixture.devices[0], { connection: "disconnected", video: "unavailable", recording: "paused", analytics: null, ptz: "uncalibrated" });
  Object.assign(fixture.devices[1], { video: "unknown", recording: "recording", analytics: false, ptz: "unknown" });
  fixture.devices[2].removedAt = new Date().toISOString();
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.locator(".nvr-camera")).toHaveCount(3);
  for (const [metric, value] of Object.entries({ total: 3, online: 2, video: 1, recording: 1, analytics: 1, ptz: 1 })) {
    await expect(page.locator(`[data-metric="${metric}"] dd`)).toHaveText(String(value));
  }
  await expect(page.locator(".nvr-camera").first()).toContainText("Unknown");
  await page.locator("#nvr-tab-events").click();
  await page.getByRole("button", { name: "Camera", exact: true }).click();
  await page.getByRole("option", { name: "Camera 3", exact: true }).click();
  await expect(page.locator(".nvr-events")).toContainText("Camera 3");
});

test("empty and single-camera states retain usable cards, filters and fault controls", async t => {
  const { page, fixture } = await open(t, 320, true, 0);
  await expect(page.locator('[data-metric="total"] dd')).toHaveText("0");
  await expect(page.getByText("尚未接入摄像机", { exact: true })).toBeVisible();
  for (const tab of ["playback", "events", "devices"]) {
    await page.locator(`#nvr-tab-${tab}`).click(); await assertNoOverflow(page);
  }
  fixture.devices = [{ id: "one", name: "长摄像机名称 Long camera name ".repeat(6), onvifUrl: "http://camera/onvif/device_service", profiles: [{ token: "raw" }], recordingProfile: "raw", removedAt: null, connection: "disconnected", video: "unavailable", recording: "paused", analytics: null, ptz: "uncalibrated", lastError: "serial_port_unconfigured", recordingEnabled: false }];
  Object.assign(fixture.ptz, { enabled: false, calibrationRequired: true, state: "calibration_required", lastError: "serial_port_unconfigured" });
  fixture.previewFails = true;
  await page.getByRole("button", { name: "刷新", exact: true }).click();
  await page.locator("#nvr-tab-live").click();
  await expect(page.locator(".nvr-camera")).toHaveCount(1);
  await expect(page.locator(".nvr-camera .nvr-preview")).toContainText("设备离线");
  const dialog = await openCamera(page);
  await expect(dialog.getByRole("button", { name: "向右", exact: true })).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "停止", exact: true })).toBeEnabled();
  await expect(dialog).toContainText("云台暂不可用");
  await assertNoOverflow(page);
});

test("offline cards have no image transport and details recover after a status retry", async t => {
  const { page, fixture, previews, sessions } = await open(t, 1440, false, 1, value => {
    Object.assign(value.devices[0], { connection: "disconnected", video: "unavailable", ptz: "unavailable", lastError: "Camera connection unavailable" });
  });
  const card = page.locator(".nvr-camera");
  await expect(card.locator(".nvr-preview")).toHaveAttribute("data-state", "offline");
  await expect(card.locator("img")).toHaveCount(0);
  assert.equal(previews.opened, 0);
  const box = await card.locator(".nvr-preview").boundingBox();
  assert.ok(Math.abs(box.width / box.height - 16 / 9) < .02);
  const dialog = await openCamera(page);
  await expect(dialog.getByRole("button", { name: "Pan right", exact: true })).toHaveCount(0);
  await expect(dialog.locator("input")).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Stop", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Original · HLS", exact: true }).click();
  assert.equal(sessions.length, 0);
  await expect(dialog.getByText("Camera connection unavailable", { exact: true })).not.toBeVisible();
  await dialog.locator("summary").click();
  await expect(dialog.getByText("Camera connection unavailable", { exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  assert.equal(sessions.length, 0);
  await dialog.getByRole("button", { name: "AI overlay · MJPEG", exact: true }).click();
  Object.assign(fixture.devices[0], { connection: "connected", video: "available", ptz: "running", lastError: null });
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.locator(".nvr-preview")).toHaveAttribute("data-state", "available");
  await expect(dialog.locator('.nvr-stream-switch [aria-pressed="true"]')).toBeFocused();
  await expect(dialog.getByRole("button", { name: "Pan right", exact: true })).toBeEnabled();
  await expect.poll(() => previews.opened - previews.closed).toBe(1);
  await assertNoOverflow(page);
});

test("loading, invalid frames and a closed socket never expose broken or stale images", async t => {
  const { page, fixture, previews } = await open(t, 390, false, 1, value => { value.previewWaiting = true; });
  const media = page.locator(".nvr-camera .nvr-preview");
  await expect(media).toHaveAttribute("data-state", "loading");
  await expect(media.locator("img")).toBeHidden();
  fixture.previewWaiting = false;
  await expect(media).toHaveAttribute("data-state", "available");
  for (const socket of previews.sockets) socket.close();
  await expect(media).toHaveAttribute("data-state", "unavailable");
  await expect(media.locator("img")).toBeHidden();
  await expect(page.locator(".nvr-camera-header-status")).toHaveAttribute("data-state", "ready");
  fixture.previewInvalid = true;
  const dialog = await openCamera(page);
  await expect(dialog.locator(".nvr-preview")).toHaveAttribute("data-state", "unavailable");
  await expect(dialog.locator("img")).toBeHidden();
  await expect(dialog.getByRole("button", { name: "Pan right", exact: true })).toBeEnabled();
  fixture.previewInvalid = false;
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(dialog.locator(".nvr-preview")).toHaveAttribute("data-state", "available");
  await expect(dialog.locator("img")).toBeVisible();
});

test("diagnostics remain reachable in the dialog keyboard loop", async t => {
  const { page } = await open(t, 390, false, 1, value => {
    value.devices[0].connection = "disconnected";
  });
  const dialog = await openCamera(page);
  await dialog.getByRole("button", { name: "Stop", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(dialog.locator("summary")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog.locator("details")).toHaveAttribute("open", "");
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Close", exact: true })).toBeFocused();
});

test("an unavailable raw live session updates video status without disabling PTZ", async t => {
  const { page, sessions } = await open(t, 820, false, 1, value => { value.sessionFails = true; });
  const dialog = await openCamera(page);
  await dialog.getByRole("button", { name: "Original · HLS", exact: true }).click();
  await expect(dialog.locator(".nvr-video")).toHaveAttribute("data-state", "unavailable");
  await dialog.locator("video").dispatchEvent("loadeddata");
  await expect(dialog.locator(".nvr-video")).toHaveAttribute("data-state", "unavailable");
  await expect(dialog.locator(".nvr-device-state .ui-description-row").filter({ has: page.locator("dt", { hasText: /^Video$/ }) })).toContainText("Unavailable");
  await expect(dialog.getByRole("button", { name: "Pan right", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => sessions.length).toBe(2);
});

test("going offline collapses PTZ safely and retains stop failure until acknowledged", async t => {
  const { page, fixture, commands } = await open(t, 1440, false, 1);
  const dialog = await openCamera(page);
  const right = dialog.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  fixture.stopFails = true;
  fixture.devices[0].connection = "disconnected";
  await page.getByRole("button", { name: "Refresh", exact: true, includeHidden: true }).evaluate(node => node.click());
  await expect(right).toHaveCount(0);
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await expect(dialog.getByRole("alert")).toContainText("Stop could not be confirmed");
  fixture.devices[0].connection = "connected";
  await dialog.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(right).toBeDisabled();
  fixture.stopFails = false;
  await dialog.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(right).toBeEnabled();
  await closeCamera(page);
  await expect(page.getByRole("alert")).toContainText("Stop could not be confirmed");
});

test("going offline during a pending finite move stops only after its acknowledgement", async t => {
  const { page, fixture, commands } = await open(t, 1440, false, 1);
  let acknowledge;
  fixture.moveGate = new Promise(resolve => { acknowledge = resolve; });
  const dialog = await openCamera(page);
  await expect(dialog.getByRole("button", { name: "Move to position", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Move to position", exact: true }).click();
  await expect.poll(() => commands.at(-1)?.action).toBe("absolute_move");
  fixture.devices[0].connection = "disconnected";
  await page.getByRole("button", { name: "Refresh", exact: true, includeHidden: true }).evaluate(node => node.click());
  await expect(dialog.locator("input")).toHaveCount(0);
  assert.equal(commands.some(command => command.action === "stop"), false);
  acknowledge();
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await closeCamera(page);
});

test("stop failure survives dialog close and overview refresh", async t => {
  const { page, fixture, commands } = await open(t);
  fixture.stopFails = true;
  await openCamera(page);
  const right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  await closeCamera(page);
  await expect(page.getByRole("alert")).toContainText("Stop could not be confirmed");
  await page.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Stop could not be confirmed");
});

test("event cards open playback for their camera and a coverage gap has no playback action", async t => {
  const { page, sessions } = await open(t, 390, true);
  await page.locator("#nvr-tab-events").click();
  await expect(page.locator(".nvr-events > li")).toHaveCount(2);
  await expect(page.locator('.nvr-events > li[data-gap="true"] button')).toHaveCount(0);
  await page.locator('.nvr-events > li[data-gap="false"] button').click();
  await expect(page.locator("#nvr-playback")).toBeVisible();
  await expect.poll(() => sessions.length).toBe(1);
  assert.equal(sessions[0].deviceId, "camera-0"); assert.equal(sessions[0].kind, "playback");
  await expect(page.locator(".nvr-download")).toHaveAttribute("href", "/api/nvr/segments/segment-1/download");
});


test("card columns follow the content container at the 620px boundary", async t => {
  const { page } = await open(t);
  for (const width of [619, 620]) {
    await page.locator(".nvr-panel").evaluate((node, value) => { node.style.width = `${value + 28}px`; }, width);
    // The shared reduced-motion rule still has a 0.01ms transition. Wait for
    // its resulting container size before asserting the exact boundary.
    await expect.poll(() => page.locator(".nvr-live-grid").evaluate(node => ({ width: node.getBoundingClientRect().width, columns: globalThis.getComputedStyle(node).gridTemplateColumns.split(" ").length }))).toEqual({ width, columns: width < 620 ? 1 : 2 });
  }
});

test("pointer release and programmatic tab exit stop a held pan", async t => {
  const { page, commands, previews } = await open(t);
  await openCamera(page);
  const right = page.getByRole("button", { name: "Pan right", exact: true });
  await expect(right).toBeEnabled();
  await right.hover(); await page.mouse.down();
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  await page.mouse.up();
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await right.dispatchEvent("keydown", { key: "Enter" });
  await expect.poll(() => commands.at(-1)?.action).toBe("continuous_move");
  await page.locator("#nvr-tab-events").evaluate(node => node.click());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect.poll(() => commands.at(-1)?.action).toBe("stop");
  await expect.poll(() => previews.opened - previews.closed).toBe(0);
});

test("all theme modes retain card surfaces and square controls in the dialog", async t => {
  const { page } = await open(t, 390, true, 1);
  await openCamera(page);
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(preference => {
      globalThis.localStorage.setItem("cyberos:appearance:v1", JSON.stringify(preference));
      globalThis.window.dispatchEvent(new globalThis.StorageEvent("storage", { key: "cyberos:appearance:v1" }));
    }, { scheme, mode });
    await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
    await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
    const styles = await page.getByRole("dialog").evaluate(node => ({ background: globalThis.getComputedStyle(node).backgroundColor, rounded: [...node.querySelectorAll("button")].filter(button => globalThis.getComputedStyle(button).borderRadius !== "0px").length }));
    assert.notEqual(styles.background, "rgba(0, 0, 0, 0)");
    assert.equal(styles.rounded, 0);
    await assertNoOverflow(page);
  }
});

test("offline cards and details retain clear states in all theme modes", async t => {
  const { page, previews, sessions } = await open(t, 390, true, 1, value => {
    Object.assign(value.devices[0], { connection: "disconnected", video: "unavailable", ptz: "unavailable", analytics: null });
  });
  await mkdir(".cyberos/nvr-browser", { recursive: true });
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(preference => {
      globalThis.localStorage.setItem("cyberos:appearance:v1", JSON.stringify(preference));
      globalThis.window.dispatchEvent(new globalThis.StorageEvent("storage", { key: "cyberos:appearance:v1" }));
    }, { scheme, mode });
    await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
    await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
    await expect(page.locator(".nvr-camera .nvr-camera-header-status")).toHaveAttribute("data-state", "offline");
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cyberos/nvr-browser/zh-390-${scheme}-${mode}-offline-live.png` });
    const dialog = await openCamera(page);
    const controls = dialog.locator("button");
    assert.deepEqual(await controls.evaluateAll(buttons => buttons.filter(button => {
      const box = button.getBoundingClientRect();
      return globalThis.getComputedStyle(button).borderRadius !== "0px" || box.width < 44 || box.height < 44;
    }).map(button => button.textContent || button.getAttribute("aria-label"))), []);
    await expect(dialog.locator("img, video, input")).toHaveCount(0);
    await assertNoOverflow(page);
    await page.screenshot({ path: `.cyberos/nvr-browser/zh-390-${scheme}-${mode}-offline-dialog.png` });
    await closeCamera(page);
  }
  assert.equal(previews.opened, 0);
  assert.equal(sessions.length, 0);
});
