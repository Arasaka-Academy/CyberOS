import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
let server, browser, baseUrl;
const space = "a".repeat(64);
const defaults = { enabled: true, baseUrl: "https://mac-mini.example.ts.net:9443", model: "Qwen/Qwen3-VL-Embedding-2B",
  apiKeyConfigured: true, dimensions: 2048, embeddingSpaceId: space, minSimilarity: 0.35 };
const status = { state: "pending", total: 12345, indexed: 100, pending: 12244, failed: 1,
  cache: { vectors: 15000, bytes: 122880000, retiredSpaces: 1, lastCleanupAt: "2026-11-05", removedVectors: 4, removedBytes: 32768 },
  embeddingSpaceId: space, dimensions: 2048, error: null, estimatedRemainingSeconds: 18000 };
const harness = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { PhotosSemanticSettingsCard } from '/src/components/settings/PhotosSemanticSettingsCard.tsx';
import { PhotoLibraryPanel } from '/src/components/workspace/PhotoLibraryPanel.tsx';
import { TooltipLayer } from '/src/components/common/TooltipLayer.tsx';
import { initI18n, i18n } from '/src/i18n/index.ts';
import '/src/styles.css';
await initI18n();
await i18n.changeLanguage(new URLSearchParams(location.search).has('zh') ? 'zh-CN' : 'en');
const library = new URLSearchParams(location.search).has('library');
const noop = () => {};
globalThis.__photoErrors = [];
const notifyError = message => globalThis.__photoErrors.push(message);
createRoot(document.getElementById('root')).render(<div className="app-shell" style={{display:'block',height:'100dvh',overflow:'auto'}}>
  {library ? <PhotoLibraryPanel pools={[{id:'pool',name:'Photos',path:'.',filesystem:'ext4',status:'ready'}]} locale="en"
    onWorkQueuesChanged={noop} onNotifyError={notifyError} onNotifySuccess={noop} onNotifyWarning={noop} onOpenSettings={noop} configurationUpdatedAt={null} /> :
  <section className="settings-modal" style={{width:'100%',height:'100%',maxHeight:'none',display:'block'}}>
    <main className="settings-section-page"><div className="settings-section-body"><PhotosSemanticSettingsCard /></div></main>
  </section>}<TooltipLayer />
</div>);
`;

before(async () => {
  server = await createServer({ configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)), server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "photos-semantic-browser-harness",
      resolveId(id) { if (id === "/__photos-semantic-entry.tsx") return id; },
      load(id) { if (id === "/__photos-semantic-entry.tsx") return harness; },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (!request.url?.startsWith("/__photos-semantic-test")) return next();
        response.setHeader("Content-Type", "text/html");
        response.end(await vite.transformIndexHtml(request.url, '<html><body><div id="root"></div><script type="module" src="/__photos-semantic-entry.tsx"></script></body></html>'));
      }); }
    }]
  });
  await server.listen(); baseUrl = server.resolvedUrls.local[0]; browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });

async function open(t, { width = 1440, zh = false, failInitial = false, library = false, photoState = "ready" } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(10_000);
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  const writes = [], tests = [], queries = [];
  const slow = Promise.withResolvers();
  let saved = { ...defaults }, gets = 0, statusReads = 0;
  t.after(async () => { slow.resolve(); await context.close(); assert.deepEqual(errors, []); });
  await page.route("**/api/**", async route => {
    const request = route.request(), path = new URL(request.url()).pathname;
    if (path === "/api/photos/settings") return route.fulfill({ json: { settings: { storagePoolId: "pool", path: "Photos", updatedAt: "2026-01-01" } } });
    if (path === "/api/photos/status") { statusReads++; return route.fulfill({ json: {
      status: { state: photoState, total: 120, failed: 0, scanned: 120, processed: 120, updatedAt: "2026-01-01" },
      workerHealth: { status: "ready", freshWorkers: 1, activeJobs: 0, queuedJobs: 0, retryingJobs: 0 }, semanticIndex: status
    } }); }
    if (path === "/api/photos/metadata/fields") return route.fulfill({ json: { fields: [] } });
    if (path.endsWith("/thumbnail")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#123"/></svg>' });
    if (path === "/api/photos/query") {
      const query = request.postDataJSON(); queries.push(query);
      const text = query.filters?.text ?? "browse";
      if (text === "slow") await slow.promise;
      const count = text === "none" ? 0 : text === "pages" ? 60 : text === "repeated-dates" ? 3 : 2;
      const photos = Array.from({ length: count }, (_, index) => ({
        id: `${text}-${query.cursor ? 60 + index : index}`, name: `${text}-${query.cursor ? 60 + index : index}.jpg`,
        storagePoolId: "pool", path: "Photos/test.jpg", mimeType: "image/jpeg", sizeBytes: 100,
        takenAt: text === "repeated-dates" && index === 1 ? "2025-12-01" : "2026-01-01",
        takenAtSource: "file_mtime", width: 100, height: 100, status: "ready", metadata: null, keywords: []
      }));
      return route.fulfill({ json: { photos, total: text === "pages" ? 120 : count,
        nextCursor: text === "pages" && !query.cursor ? "page-2" : null,
        facets: { mediaKinds: [], cameraModels: [], lensModels: [], ratings: [], keywords: [], numeric: {} },
        metadataIndex: { state: "ready", total: 120, indexed: 120 }, search: text === "browse" ? undefined : {
          mode: text === "none" ? "lexical" : "hybrid", semanticState: text === "none" ? "unavailable" : "ready", indexed: 100, total: 120, embeddingSpaceId: space
        }
      } });
    }
    if (path.endsWith("/test")) {
      tests.push(request.postDataJSON());
      return route.fulfill({ json: { model: { protocol: "cyberos-photos-embedding/v1", model: defaults.model,
        revision: "pinned", dimensions: 2048, embeddingSpaceId: space, normalized: true, modalities: ["text", "image"] } } });
    }
    if (path === "/api/settings/photos/semantic-search") {
      if (request.method() === "GET" && gets++ === 0 && failInitial) return route.fulfill({ status: 503, json: { error: "Temporarily unavailable" } });
      if (request.method() === "PATCH") {
        const patch = request.postDataJSON(); writes.push(patch);
        saved = { ...saved, ...patch, apiKeyConfigured: patch.clearApiKey ? false : true };
        delete saved.apiKey; delete saved.clearApiKey;
      }
      return route.fulfill({ json: { settings: saved, status } });
    }
    return route.fulfill({ status: 202, json: { status } });
  });
  await page.goto(`${baseUrl}__photos-semantic-test?${zh ? "zh&" : ""}${library ? "library" : ""}`);
  const card = page.locator(".photos-semantic-settings");
  return { page, card, writes, tests, queries, releaseSlow: () => slow.resolve(), gets: () => gets, statusReads: () => statusReads };
}

test("keyword searches cancel obsolete requests, prefer relevance and show empty offline results", async t => {
  const { page, queries, releaseSlow } = await open(t, { library: true });
  const input = page.locator('input[type="search"]');
  await expect(page.locator(".photo-tile")).toHaveCount(2);
  await input.fill("slow"); await input.press("Enter");
  await expect.poll(() => queries.some(query => query.filters?.text === "slow")).toBe(true);
  const slowCancelled = page.waitForEvent("requestfailed", request => request.url().endsWith("/api/photos/query") && request.postDataJSON().filters?.text === "slow");
  await input.fill("fast"); await input.press("Enter");
  await expect(page.locator(".photo-name").first()).toHaveText("fast-0.jpg");
  assert.equal(queries.filter(query => query.filters?.text === "fast").at(-1).sort.field, "relevance");
  assert.match((await slowCancelled).failure().errorText, /abort/iu);
  releaseSlow();
  await page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));
  await expect(page.locator(".photo-name").first()).toHaveText("fast-0.jpg");
  await input.fill("none"); await input.press("Enter");
  await expect(page.locator(".photo-tile")).toHaveCount(0);
  await expect(page.locator(".photo-library-empty strong")).toHaveText("No matching media");
  await expect(page.locator(".photo-library-empty p")).toHaveText("Try another keyword or adjust your filters.");
  await expect(page.locator(".photo-semantic-status")).toContainText("temporarily unavailable");
  await input.fill(""); await input.press("Enter");
  await expect(page.locator(".photo-name").first()).toHaveText("browse-0.jpg");
  assert.equal(queries.at(-1).sort.field, "captured_at");
  assert.deepEqual(await page.evaluate(() => globalThis.__photoErrors), []);
});

for (const zh of [false, true]) {
  test(`unmatched keywords show search guidance during scanning in ${zh ? "Chinese" : "English"}`, async t => {
    const { page } = await open(t, { library: true, width: 390, zh, photoState: "scanning" });
    await expect(page.locator(".photo-tile")).toHaveCount(2);
    const input = page.locator('input[type="search"]');
    await input.fill("none"); await input.press("Enter");
    await expect(page.locator(".photo-tile")).toHaveCount(0);
    await expect(page.locator(".photo-library-empty strong")).toHaveText(zh ? "没有匹配的媒体" : "No matching media");
    await expect(page.locator(".photo-library-empty p")).toHaveText(zh ? "试试其他关键词或调整筛选条件。" : "Try another keyword or adjust your filters.");
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
  });
}

test("a background index update preserves a paginated result and selection", async t => {
  const { page, queries, statusReads } = await open(t, { library: true, width: 820 });
  const input = page.locator('input[type="search"]');
  await expect(page.locator(".photo-tile")).toHaveCount(2);
  await input.fill("pages"); await input.press("Enter");
  await expect(page.locator(".photo-tile")).toHaveCount(60);
  await page.locator(".photo-pagination-sentinel").scrollIntoViewIfNeeded();
  await expect(page.locator(".photo-tile")).toHaveCount(120);
  await page.locator(".photo-select").first().click();
  const count = queries.filter(query => query.filters?.text === "pages" && !query.cursor).length;
  const reads = statusReads();
  status.indexed++;
  await expect.poll(statusReads, { timeout: 7000 }).toBeGreaterThan(reads);
  assert.equal(queries.filter(query => query.filters?.text === "pages" && !query.cursor).length, count);
  await expect(page.locator(".photo-tile")).toHaveCount(120);
  await expect(page.locator(".photo-select").first()).toHaveAttribute("aria-pressed", "true");
});

test("relevance results with repeated dates leave no old tiles after changing keywords", async t => {
  const { page } = await open(t, { library: true });
  const input = page.locator('input[type="search"]');
  await expect(page.locator(".photo-tile")).toHaveCount(2);
  await input.fill("repeated-dates"); await input.press("Enter");
  await expect(page.locator(".photo-name")).toHaveText([
    "repeated-dates-0.jpg", "repeated-dates-1.jpg", "repeated-dates-2.jpg"
  ]);
  const headingIds = await page.locator(".photo-day h3").evaluateAll(headings => headings.map(heading => heading.id));
  assert.equal(headingIds.length, 3);
  assert.equal(new Set(headingIds).size, headingIds.length);
  await input.fill("next"); await input.press("Enter");
  await expect(page.locator(".photo-tile")).toHaveCount(2);
  await expect(page.locator(".photo-name")).toHaveText(["next-0.jpg", "next-1.jpg"]);
  await input.fill("none"); await input.press("Enter");
  await expect(page.locator(".photo-tile")).toHaveCount(0);
});

test("recovers an initial failed load and preserves a draft through polling, testing and saving", async t => {
  const { page, card, writes, tests, gets } = await open(t, { failInitial: true });
  await expect(card.getByRole("alert")).toHaveText("Temporarily unavailable");
  const url = card.getByRole("textbox", { name: "API Base URL" });
  await expect(url).toBeEnabled({ timeout: 10_000 });
  await expect(card.getByRole("alert")).toHaveCount(0);
  await url.fill("https://offline.example.ts.net:9443");
  const count = gets(); await expect.poll(gets, { timeout: 7000 }).toBeGreaterThan(count);
  await expect(url).toHaveValue("https://offline.example.ts.net:9443");
  await card.getByRole("button", { name: "Test connection", exact: true }).click();
  await expect(card.getByRole("status")).toContainText("Draft has not been saved");
  assert.equal(tests[0].baseUrl, "https://offline.example.ts.net:9443"); assert.equal(writes.length, 0);
  await expect(url).toHaveValue("https://offline.example.ts.net:9443");
  await card.getByRole("button", { name: "Clear saved API Key", exact: true }).click();
  await expect(card.locator('input[type="password"]')).toBeFocused();
  await card.getByRole("button", { name: "Undo clear", exact: true }).click();
  await card.getByRole("button", { name: "Save smart search", exact: true }).click();
  await expect.poll(() => writes.length).toBe(1);
  assert.equal(writes[0].clearApiKey, false); assert.equal(writes[0].apiKey, "");
  await expect(card.getByRole("textbox", { name: "API Key" })).toHaveValue("");
  assert.equal(await page.evaluate(() => Object.values(globalThis.localStorage).some(value => value.includes("offline.example"))), false);
});

for (const zh of [false, true]) for (const width of [1440, 820, 560, 390, 320]) {
  test(`smart search settings fit ${width}px in ${zh ? "Chinese" : "English"}`, async t => {
    const { page, card } = await open(t, { width, zh });
    await expect(card.locator('input[type="url"]')).toBeEnabled();
    await expect(card).toContainText("2048"); await expect(card).toContainText(space);
    const bounds = await card.boundingBox(); assert(bounds.x >= -1 && bounds.x + bounds.width <= width + 1);
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth), false);
    for (const button of await card.locator(".settings-card-actions button").all()) {
      const box = await button.boundingBox(); assert(box.x >= -1 && box.x + box.width <= width + 1);
    }
    await card.getByRole("button", { name: zh ? "智能搜索的提示" : "About Smart search" }).click();
    await expect(page.getByRole("tooltip")).toBeVisible();
    await page.keyboard.press("Escape"); await expect(page.getByRole("tooltip")).toHaveCount(0);
    await mkdir(".cyberos/photos-semantic-browser", { recursive: true });
    await page.screenshot({ path: `.cyberos/photos-semantic-browser/${zh ? "zh" : "en"}-${width}.png`, fullPage: true });
  });
}
