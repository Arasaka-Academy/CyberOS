/**
 * [INPUT]: 依赖共享 TV 浏览器夹具和真实 Chromium。
 * [OUTPUT]: 验证音乐、遥控和无帧回调的屏保握手。
 * [POS]: Web 的 TV 功能验收；不连接真实播放设备。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createTvHarness, key, noOverflow, playback, snapshot } from "../../scripts/lib/tv-browser-fixture.mjs";

const library = createTvHarness();
function musicStatus(state = "playing", route = "hdmi", revision = 2) {
  return { ...globalThis.structuredClone(playback), actualAudioRoute: { kind: route }, revision, music: { ...globalThis.structuredClone(playback.music), revision, state, queue: [{ id: "item-1", trackId: "track-1", title: "Night sky", artist: "Test artist", album: "Test album", coverKey: null }] } };
}
const settings = { enabled: true, videoOutput: "wayland", drmConnector: null, audioDevice: null, hardwareDecoding: "auto-safe", screensaverSource: { kind: "builtin" }, screensaverEnabled: true, screenOffEnabled: true, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30, updatedAt: "2026-11-18T00:00:00Z" };
function display(state, source = settings.screensaverSource) {
  return { settings: { ...settings, screensaverSource: source }, display: { state, supported: true, reason: null, updatedAt: "2026-11-18T00:00:00Z" } };
}
test("HDMI music entry, fixed playing page, pause/wake, return and output change", async t => {
  const { page, writes } = await library(t);
  await page.locator('[data-tv-nav="movie"]').click();
  await snapshot(page, musicStatus("playing", "unknown"));
  await page.waitForTimeout(100);
  assert.equal(await page.locator(".tv-music-player").count(), 0);
  await snapshot(page, musicStatus("playing", "hdmi", 3));
  await page.locator(".tv-music-player").waitFor();
  await page.waitForFunction(() => globalThis.document.activeElement?.textContent?.includes("Pause"));
  await page.screenshot({ path: ".cyberos/tv-idle/music-page.png" });
  await noOverflow(page, ".tv-music-player, .tv-music-main, .tv-music-controls, .tv-music-transport");
  await key(page, "BrowserBack"); await key(page, "Home");
  assert.equal(await page.locator(".tv-music-player").count(), 1);
  await page.getByRole("button", { name: "Next song", exact: true }).focus();
  await snapshot(page, musicStatus("starting", "unknown", 4));
  await key(page, "BrowserBack"); await key(page, "Home");
  assert.equal(await page.locator(".tv-music-player").count(), 1);
  assert.equal(await page.getByRole("button", { name: "Next song", exact: true }).evaluate(element => element === globalThis.document.activeElement), true);
  const nextTrack = musicStatus("playing", "hdmi", 4);
  nextTrack.music.queue[0].trackId = "track-2";
  nextTrack.music.queue[0].title = "New song";
  await snapshot(page, nextTrack);
  assert.equal(await page.getByRole("button", { name: "Next song", exact: true }).evaluate(element => element === globalThis.document.activeElement), true);
  await key(page, "MediaTrackNext");
  await page.waitForFunction(() => globalThis.document.querySelector(".tv-music-player"));
  assert.ok(writes.some(write => write.path === "/api/music/player/command" && write.body.type === "next"));
  await snapshot(page, musicStatus("playing", "hdmi", 5));
  await page.getByRole("button", { name: /Queue/u }).click();
  await page.getByRole("dialog").waitFor(); await key(page, "Home");
  await page.getByRole("dialog").waitFor({ state: "detached" });
  assert.equal(await page.locator(".tv-music-player").count(), 1);
  await snapshot(page, musicStatus("paused", "hdmi", 6));
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await page.locator(".tv-screensaver").waitFor();
  await page.waitForTimeout(100);
  assert.ok(writes.some(write => write.path === "/api/tv/renderer" && write.body.ready === true));
  await snapshot(page, display("off"), "/api/tv/events");
  await page.locator(".tv-screensaver").waitFor({ state: "detached" });
  assert.equal(await page.locator(".tv-awake-shell").isVisible(), false);
  await snapshot(page, display("active"), "/api/tv/events");
  await page.locator(".tv-music-player").waitFor();
  await key(page, "BrowserBack"); await page.locator(".tv-music-player").waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-tv-nav="movie"]').getAttribute("aria-current"), "page");
  await snapshot(page, musicStatus("playing", "hdmi", 7)); await page.locator(".tv-music-player").waitFor();
  await snapshot(page, musicStatus("playing", "bluetooth", 8)); await page.locator(".tv-music-player").waitFor({ state: "detached" });
  assert.equal(await page.locator('[data-tv-nav="movie"]').getAttribute("aria-current"), "page");
  assert.equal(writes.some(write => ["output", "set-output", "set-target"].includes(write.body?.type)), false);
});
test("NAS failure has immediate local fallback and off cancels image work", async t => {
  const { page } = await library(t);
  let itemReads = 0;
  await page.clock.install();
  await page.route("**/api/tv/screensaver/items*", route => { itemReads += 1; return route.fulfill({ json: { items: [{ id: "bad", url: "/bad-tv-image.jpg" }], nextCursor: null, sourceKey: "pool/Images", fallbackReason: null } }); });
  await page.route("**/bad-tv-image.jpg", route => route.fulfill({ status: 404, body: "missing" }));
  await snapshot(page, display("screensaver", { kind: "directory", storagePoolId: "pool", path: "Images" }), "/api/tv/events");
  await page.locator(".tv-screensaver-builtin").waitFor();
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".tv-screensaver img").count(), 0);
  await snapshot(page, display("off"), "/api/tv/events");
  await page.locator(".tv-screensaver").waitFor({ state: "detached" });
  const count = itemReads;
  assert.ok(count >= 1);
  await page.clock.fastForward(21_000);
  assert.equal(itemReads, count);
});

test("Renderer readiness works when an occluded Chromium surface has no frame callbacks", async t => {
  const { page, writes } = await library(t);
  await page.evaluate(() => {
    const pending = new Map();
    let sequence = 0;
    globalThis.window.__heldTvFrames = pending;
    globalThis.requestAnimationFrame = callback => { pending.set(++sequence, callback); return sequence; };
    globalThis.cancelAnimationFrame = id => pending.delete(id);
  });
  const ready = page.waitForRequest(request => request.url().endsWith("/api/tv/renderer") && request.postDataJSON()?.ready === true, { timeout: 1500 });
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await ready;
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".tv-screensaver").count(), 1);
  assert.equal(writes.filter(write => write.path === "/api/tv/renderer" && write.body.ready === true).length, 1);
  await page.evaluate(() => {
    const callbacks = [...globalThis.window.__heldTvFrames.values()];
    globalThis.window.__heldTvFrames.clear();
    for (const callback of callbacks) callback(globalThis.performance.now());
  });
  await page.waitForTimeout(150);
  assert.equal(writes.filter(write => write.path === "/api/tv/renderer" && write.body.ready === true).length, 1);
  const stopped = page.waitForRequest(request => request.url().endsWith("/api/tv/renderer") && request.postDataJSON()?.ready === false);
  await snapshot(page, display("active"), "/api/tv/events");
  await stopped;
  await page.waitForTimeout(150);
  assert.equal(writes.filter(write => write.path === "/api/tv/renderer" && write.body.ready === false).length, 1);
  await page.evaluate(() => {
    const start = globalThis.setTimeout;
    const stop = globalThis.clearTimeout;
    const pending = new Map();
    let sequence = 1_000_000;
    globalThis.window.__heldTvReadyTimers = pending;
    globalThis.setTimeout = (callback, milliseconds, ...args) => {
      if (milliseconds !== 100) return start(callback, milliseconds, ...args);
      pending.set(++sequence, () => callback(...args));
      return sequence;
    };
    globalThis.clearTimeout = id => { if (!pending.delete(id)) stop(id); };
  });
  await snapshot(page, display("screensaver"), "/api/tv/events");
  await page.waitForTimeout(50);
  assert.equal(await page.locator(".tv-screensaver").count(), 1);
  assert.equal(await page.evaluate(() => globalThis.window.__heldTvReadyTimers.size), 1);
  await snapshot(page, display("off"), "/api/tv/events");
  await page.waitForTimeout(150);
  assert.equal(await page.locator(".tv-screensaver").count(), 0);
  assert.equal(await page.evaluate(() => globalThis.window.__heldTvReadyTimers.size), 0);
  assert.equal(await page.evaluate(() => globalThis.window.__heldTvFrames.size), 0);
  assert.equal(writes.filter(write => write.path === "/api/tv/renderer" && write.body.ready === true).length, 1);
  assert.equal(writes.filter(write => write.path === "/api/tv/renderer" && write.body.ready === false).length, 2);
});

test("TV settings sliders, output selection, refresh and disabled timer persistence", async t => {
  const { page } = await library(t);
  let configReads = 0;
  let statusReads = 0;
  let saved;
  let applied = 0;
  let applyBlocked = true;
  let deviceReads = 0;
  let deviceFailure = false;
  const outputs = { drm: { items: [{ id: "HDMI-A-1", name: "HDMI-A-1", connected: true, modes: ["1920x1080"] }, { id: "HDMI-A-2", name: "HDMI-A-2", connected: false, modes: [] }], error: null }, audio: { items: [{ id: "alsa/hdmi", name: "TV HDMI" }, { id: "alsa/usb", name: "USB speakers" }], error: null }, applied: { known: true, drmConnector: null }, restartRequired: true };
  await page.route("**/api/settings/tv/outputs", route => { deviceReads += 1; return route.fulfill(deviceFailure ? { status: 503, json: { error: "Device enumeration unavailable" } } : { json: outputs }); });
  await page.route("**/api/settings/tv/apply-output", route => { if (applyBlocked) return route.fulfill({ status: 409, json: { error: "End the current media session before applying" } }); applied += 1; outputs.restartRequired = false; return route.fulfill({ json: { applied: true, drmConnector: saved?.drmConnector ?? null } }); });
  const health = { state: "ready", detail: null, updatedAt: settings.updatedAt };
  await page.route("**/api/tv/status", route => { statusReads += 1; return route.fulfill({ json: { status: { state: "ready", enabled: true, weston: health, chromium: health, vodPlayer: health, cec: health, gamepad: health, display: display("active").display } } }); });
  await page.route("**/api/settings/tv", route => {
    if (route.request().method() === "GET") configReads += 1;
    else saved = route.request().postDataJSON();
    return route.fulfill({ json: { settings: { ...settings, ...saved } } });
  });
  const uiSource = `/@fs${fileURLToPath(new URL("../ui/src/", import.meta.url))}`;
  await page.route("**/__tv_settings__", route => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><head><link rel="stylesheet" href="${uiSource}fonts.css"><link rel="stylesheet" href="${uiSource}styles.css"><link rel="stylesheet" href="/src/styles.css"></head><body><div id="root" class="settings-content" style="height:100vh;grid-template-rows:minmax(0,1fr)"></div><script type="module">
    import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
    const R = await import("/node_modules/.vite/deps/react.js"); const React = R.default ?? R;
    const D = await import("/node_modules/.vite/deps/react-dom_client.js");
    const { mountAppearance } = await import("${uiSource}theme.ts"); mountAppearance();
    const { AppearanceProvider } = await import("${uiSource}AppearanceProvider.tsx");
    const { initI18n, i18n } = await import("/src/i18n/index.ts"); await initI18n(); await i18n.changeLanguage("en");
    const { SettingsTvPage } = await import("/src/components/settings/SettingsTvPage.tsx");
    function Harness() {
      const [locale, setLocale] = React.useState("en");
      React.useEffect(() => { const change = value => setLocale(value); i18n.on("languageChanged", change); return () => i18n.off("languageChanged", change); }, []);
      return React.createElement(AppearanceProvider, { locale }, React.createElement(SettingsTvPage, { pools: [], locale, onNotifySuccess: () => {}, onNotifyError: () => {} }));
    }
    (D.createRoot ?? D.default.createRoot)(globalThis.document.getElementById("root")).render(React.createElement(Harness));
  </script></body></html>` }));
  await page.goto(new URL("/__tv_settings__", page.url()).href);
  const audio = page.getByRole("button", { name: "Audio output device", exact: true });
  await audio.click(); await page.getByRole("option", { name: "USB speakers", exact: true }).click();
  await page.getByRole("button", { name: "DRM connector", exact: true }).click();
  await page.getByRole("option", { name: "HDMI-A-2 · Disconnected", exact: true }).click();
  assert.equal(await page.getByRole("button", { name: "Apply and restart TV", exact: true }).isDisabled(), true);
  const saver = page.getByRole("slider", { name: "Start screensaver after", exact: true });
  const off = page.getByRole("slider", { name: "Turn screen off after", exact: true });
  await saver.press("End"); assert.equal(await saver.inputValue(), "60");
  await saver.press("Home");
  for (let count = 0; count < 16; count += 1) await saver.press("ArrowRight");
  assert.equal(await saver.inputValue(), "17");
  const track = await page.getByRole("group", { name: "Turn screen off after", exact: true }).locator(":scope > div:last-child").boundingBox();
  assert.ok(track.height >= 44);
  await page.mouse.move(track.x + track.width * .3, track.y + track.height / 2);
  await page.mouse.down(); await page.mouse.move(track.x + track.width * .6, track.y + track.height / 2, { steps: 5 }); await page.mouse.up();
  assert.ok(Number(await off.inputValue()) > 60);
  await page.locator(".hud-switch").filter({ hasText: /^Screensaver$/u }).click();
  assert.equal(await saver.isDisabled(), true); assert.equal(await saver.inputValue(), "17");
  await page.getByRole("button", { name: "Screensaver source", exact: true }).click();
  await page.getByRole("option", { name: "NAS video folder", exact: true }).click();
  await page.getByRole("button", { name: "Screensaver source", exact: true }).click();
  await page.getByRole("option", { name: "Built-in geometry", exact: true }).click();
  await page.waitForResponse(response => response.url().endsWith("/api/tv/status"));
  assert.ok(statusReads >= 2); assert.equal(configReads, 1);
  assert.match(await audio.innerText(), /USB speakers/u);
  deviceFailure = true;
  await page.getByRole("button", { name: "Refresh devices", exact: true }).click();
  await page.getByRole("alert").filter({ hasText: "Device enumeration unavailable" }).waitFor();
  assert.match(await audio.innerText(), /USB speakers/u);
  assert.equal(await saver.inputValue(), "17");
  deviceFailure = false;
  await page.getByRole("button", { name: "Refresh devices", exact: true }).click();
  await Promise.all([
    page.waitForResponse(response => response.url().endsWith("/api/settings/tv") && response.request().method() !== "GET"),
    page.getByRole("button", { name: "Save Changes", exact: true }).click(),
  ]);
  assert.equal(applied, 0);
  assert.equal(saved.audioDevice, "alsa/usb"); assert.equal(saved.drmConnector, "HDMI-A-2"); assert.equal(saved.screensaverEnabled, false); assert.equal(saved.screensaverAfterMinutes, 17);
  assert.deepEqual(Object.keys(saved).sort(), ["audioDevice", "drmConnector", "hardwareDecoding", "screenOffEnabled", "screensaverEnabled", "screenOffAfterMinutes", "screensaverAfterMinutes", "screensaverSource"].sort());
  await page.getByRole("button", { name: "Apply and restart TV", exact: true }).click();
  await page.getByRole("alertdialog").waitFor(); assert.equal(applied, 0);
  await page.getByRole("alertdialog").getByRole("button", { name: "Apply and restart TV", exact: true }).click();
  await page.getByRole("alertdialog").getByRole("alert").filter({ hasText: "End the current media session before applying" }).waitFor({ timeout: 1500 });
  assert.equal(applied, 0);
  applyBlocked = false;
  await page.getByRole("alertdialog").getByRole("button", { name: "Apply and restart TV", exact: true }).click();
  await page.getByRole("alertdialog").waitFor({ state: "detached" }); assert.equal(applied, 1);
  assert.ok(deviceReads >= 4);
  await page.reload();
  await page.getByRole("slider", { name: "Start screensaver after", exact: true }).waitFor();
  assert.equal(await saver.isDisabled(), true); assert.equal(await saver.inputValue(), "17");
  await page.locator(".hud-switch").filter({ hasText: /^Screensaver$/u }).click(); assert.equal(await saver.isEnabled(), true); assert.equal(await saver.inputValue(), "17");
  await page.screenshot({ path: ".cyberos/tv-idle/tv-settings-enhanced-desktop.png" });
  await page.evaluate(async () => { const { i18n } = await import("/src/i18n/index.ts"); await i18n.changeLanguage("zh-CN"); });
  await page.setViewportSize({ width: 390, height: 844 });
  const zhSaver = page.getByRole("slider", { name: "屏保等待时间", exact: true });
  await zhSaver.waitFor();
  await zhSaver.scrollIntoViewIfNeeded();
  const touchTrack = await page.getByRole("group", { name: "屏保等待时间", exact: true }).locator(":scope > div:last-child").boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send("Emulation.setTouchEmulationEnabled", { enabled: true });
  assert.ok(touchTrack.width >= 300);
  const point = { x: touchTrack.x + touchTrack.width * .2, y: touchTrack.y + touchTrack.height / 2 };
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok(Number(await zhSaver.inputValue()) >= 11 && Number(await zhSaver.inputValue()) <= 14);
  await session.detach();
  await noOverflow(page, ".settings-form, .settings-page-grid, .settings-field-grid, .settings-tv-timer, .ui-slider");
  await page.screenshot({ path: ".cyberos/tv-idle/tv-settings-enhanced.png" });
});
