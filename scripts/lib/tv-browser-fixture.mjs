import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { before, after } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(new URL("../../docs/package.json", import.meta.url))("playwright");
export const title = { id: "series-1", title: "Test Series", originalTitle: null, overview: "A series from your library. Continue where you left off.", kind: "series", sourceId: "source-1", sourcePath: "Series", tmdbId: null, genres: ["Drama"], year: 2024, releaseDate: null, runtimeMinutes: 45, originalLanguage: "en", metadataSource: "local", matchStatus: "matched", matchConfidence: null, posterKey: null, backdropKey: null, addedAt: "2026-11-01", updatedAt: "2026-11-01", progress: null, personal: { favorite: false, watchlist: false, watched: null }, watched: false, credits: [], rating: null };
const file = { id: "file-1", titleId: title.id, episodeId: "episode-1", sourceId: "source-1", storagePoolId: "pool-1", relativePath: "Series/episode.mkv", name: "Test.Series.S01E01.1080p.mkv", mimeType: "video/x-matroska", sizeBytes: 1024, mtimeMs: 0, durationSeconds: 120, container: "mkv", videoCodec: "h264", audioCodec: "aac", updatedAt: "2026-11-01" };
export const detail = { ...title, files: [], seasons: [{ id: "season-1", seasonNumber: 1, name: "Season 1", episodes: [{ id: "episode-1", episodeNumber: 1, name: "Episode one", files: [file, { ...file, id: "file-1-4k", name: "Test.Series.S01E01.2160p.HDR.Extended.Version.mkv", relativePath: "Series/4k/episode.mkv", videoCodec: "hevc" }] }, { id: "episode-2", episodeNumber: 2, name: "Episode two", files: [{ ...file, id: "file-2", episodeId: "episode-2" }] }] }], artwork: [], fileProgress: {}, episodeWatched: {}, technical: { "file-1-4k": [{ type: "video", codec: "hevc", width: 3840, height: 2160, hdr: true }] }, nextFileId: "file-1" };
const music = { serviceInstanceId: "instance-1", sessionId: "music-1", owner: "music", revision: 1, queueVersion: 1, state: "paused", queue: [{ id: "item-1", fileId: "song-1", title: "Test song", artist: "Test artist", durationSeconds: 100 }], currentItemId: "item-1", positionSeconds: 0, durationSeconds: 100, volume: 50, shuffle: false, repeat: "off", error: null, updatedAt: "2026-11-04T00:00:00Z" };
export const playback = { target: "nas", owner: "music", sessionId: "music-1", serviceInstanceId: "instance-1", revision: 1, music, video: { state: "idle", sessionId: null, audioTracks: [], subtitleTracks: [], capabilities: {} }, preferences: { musicVolume: 50, videoVolume: 50, musicMuted: false, videoMuted: false }, output: { requested: { kind: "default", deviceId: null }, effective: { kind: "default", deviceId: null } } };

export function createTvHarness() {
  let server, browser, baseUrl;
  before(async () => {
    server = await createServer({ configFile: fileURLToPath(new URL("../../packages/web/vite.config.ts", import.meta.url)), root: fileURLToPath(new URL("../../packages/web", import.meta.url)), optimizeDeps: { include: ["pinyin-ime/dictionary/google_pinyin_dict"] }, server: { host: "127.0.0.1", port: 0 } });
    await server.listen();
    baseUrl = server.resolvedUrls.local[0];
    browser = await chromium.launch();
  });
  after(async () => { await browser?.close(); await server?.close(); });
  return async function library(testContext, options = {}) {
    const context = await browser.newContext({ locale: options.locale ?? "en-US", viewport: options.viewport ?? { width: 1920, height: 1080 }, reducedMotion: options.reducedMotion ?? "reduce" });
    testContext.after(() => context.close());
    const page = await context.newPage();
    const writes = [], reads = [], errors = [];
    page.on("pageerror", error => errors.push(error.message));
    testContext.after(() => assert.deepEqual(errors, [], "Browser runtime errors"));
    let currentDetail = globalThis.structuredClone(options.detail ?? detail);
    await page.addInitScript(() => {
      globalThis.window.__tvSources = [];
      globalThis.window.EventSource = class extends globalThis.EventTarget {
        constructor(url) { super(); this.url = url; globalThis.window.__tvSources.push(this); }
        close() { globalThis.window.__tvSources = globalThis.window.__tvSources.filter(source => source !== this); }
      };
    });
    await page.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      if (url.pathname === "/api/vod-player/command" && request.postDataJSON()?.type === "set-ui-theme") return route.fulfill({ json: { status: playback.video } });
      if (request.method() !== "GET") {
        const write = { path: url.pathname, body: request.postDataJSON() };
        writes.push(write);
        await options.onWrite?.(write);
        if (url.pathname.endsWith("/state")) { currentDetail.personal = { ...currentDetail.personal, ...write.body }; if (write.body.watched !== undefined) currentDetail.watched = write.body.watched; return route.fulfill({ json: {} }); }
      } else reads.push(url);
      if (url.pathname.endsWith("/events")) return route.fulfill({ status: 204 });
      if (url.pathname === "/api/playback/status" && options.playbackFailure) return route.fulfill({ status: 503, json: { error: "Playback unavailable" } });
      if (url.pathname === "/api/media/titles" && url.searchParams.get("query") && options.searchFailure?.()) return route.fulfill({ status: 503, json: { error: "Search unavailable" } });
      if (url.pathname === "/api/media/titles" && url.searchParams.get("query") && options.searchResults) return route.fulfill({ json: { titles: await options.searchResults(url.searchParams.get("query")), nextCursor: null } });
      if (url.pathname === "/api/media/home" && options.homeFailure?.()) return route.fulfill({ status: 503, json: { error: "Library unavailable" } });
      if (/^\/api\/media\/titles\/[^/]+$/u.test(url.pathname)) return route.fulfill({ json: { title: { ...(options.detailResponse?.() ?? currentDetail), id: decodeURIComponent(url.pathname.split("/").at(-1)) } } });
      if (/^\/api\/media\/files\/[^/]+\/play$/u.test(url.pathname)) return route.fulfill({ json: { status: globalThis.structuredClone(playback) } });
      const fixtures = {
        "/api/media/home": options.home ?? { continueWatching: [], recentlyAdded: [title], movies: [], series: [title], watchlist: [], upNext: [], collections: [] },
        "/api/media/collections": { collections: options.collections ?? [{ id: "collection-1", name: "Test collection", kind: "manual", titleIds: [title.id] }] },
        "/api/media/sources": { sources: [] },
        "/api/media/filter-options": { years: [2024, 1999], genres: ["Drama", "Sci-Fi"] },
        "/api/media/titles": { titles: options.titles ?? [title], nextCursor: null },
        "/api/playback/status": { status: globalThis.structuredClone(options.playback ?? playback) },
        "/api/playback/command": { status: globalThis.structuredClone(options.playback ?? playback) },
        "/api/music/player": { status: (options.playback ?? playback).music },
        "/api/music/player/command": { status: (options.playback ?? playback).music },
        "/api/settings/bluetooth": { audioDevices: [] },
        "/api/tv/status": { status: { gamepad: { state: "unavailable" } } },
      };
      await route.fulfill({ status: url.pathname in fixtures ? 200 : 503, json: fixtures[url.pathname] ?? { error: "Not available in TV test" } });
    });
    if (options.tv === false) await page.route("**/__video_fixture__", route => route.fulfill({
      contentType: "text/html; charset=utf-8",
      body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"></head><body><main id="root" class="app-shell" style="display:block;height:100dvh;max-width:${options.panelWidth ? `${options.panelWidth}px` : "100%"}"></main><script type="module">
        import RefreshRuntime from "/@react-refresh"; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;
        const R = await import("/node_modules/.vite/deps/react.js"); const React = R.default ?? R;
        const D = await import("/node_modules/.vite/deps/react-dom_client.js");
        await (await import("/src/i18n/index.ts")).initI18n();
        const { PlaybackProvider } = await import("/src/components/playback/PlaybackProvider.tsx"); const { VideoLibraryPanel } = await import("/src/components/video/VideoLibraryPanel.tsx");
        (D.createRoot ?? D.default.createRoot)(document.getElementById("root")).render(React.createElement(PlaybackProvider, null, React.createElement(VideoLibraryPanel)));
      </script></body></html>`,
    }));
    await page.goto(`${baseUrl}${options.tv === false ? "__video_fixture__" : "tv/"}`);
    if (options.tv === false) await page.locator(".video-poster").first().waitFor();
    else await page.locator("[data-tv-nav='home']").waitFor();
    return { page, writes, reads };
  };
}

export async function key(page, value, keyCode = 0) {
  return page.evaluate(({ value, keyCode }) => {
    const event = new globalThis.KeyboardEvent("keydown", { key: value, keyCode, bubbles: true, composed: true, cancelable: true });
    (globalThis.document.activeElement ?? globalThis.document.body).dispatchEvent(event);
    return event.defaultPrevented;
  }, { value, keyCode });
}
export async function openDetail(page) { await page.locator(".tv-media-card").first().click(); await page.locator("[data-tv-detail-primary]").waitFor(); }
export async function snapshot(page, status, url = "/api/playback/events") {
  await page.evaluate(({ status, url }) => {
    const source = globalThis.window.__tvSources.find(source => source.url === url);
    if (!source) throw new Error("Playback subscription missing");
    source.dispatchEvent(new globalThis.MessageEvent("snapshot", { data: JSON.stringify(status) }));
  }, { status, url });
}
export async function noOverflow(page, selectors) {
  const overflow = await page.locator(selectors).evaluateAll(elements => elements.filter(element => element.getClientRects().length && element.scrollWidth > element.clientWidth + 1).map(element => ({ className: element.className, width: element.clientWidth, scroll: element.scrollWidth })));
  assert.deepEqual(overflow, []);
}
export async function visualRows(buttons) {
  return buttons.evaluateAll(elements => {
    const rows = [];
    elements.forEach((element, index) => { const top = Math.round(element.getBoundingClientRect().top); const row = rows.find(row => Math.abs(row.top - top) < 2); if (row) row.indices.push(index); else rows.push({ top, indices: [index] }); });
    return rows.map(row => row.indices);
  });
}
