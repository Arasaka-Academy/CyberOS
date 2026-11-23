/**
 * [INPUT]: 依赖 Vite、Playwright 与照片组件隔离夹具。
 * [OUTPUT]: 验证照片搜索、真实限速上传和浮窗响应布局。
 * [POS]: 照片前端的浏览器验收；上传仅写入测试 HTTP 流。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { before, after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
let server, browser, baseUrl;
const photoUploads = [];
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
import { PhotoUploadsProvider } from '/src/components/workspace/PhotoUploads.tsx';
import { TooltipLayer } from '/src/components/common/TooltipLayer.tsx';
import { initI18n, i18n } from '/src/i18n/index.ts';
import '@cyberos/ui/fonts.css';
import '@cyberos/ui/styles.css';
import '/src/styles.css';
await initI18n();
await i18n.changeLanguage(new URLSearchParams(location.search).has('zh') ? 'zh-CN' : 'en');
const library = new URLSearchParams(location.search).has('library');
const noop = () => {};
globalThis.__photoErrors = [];
const notifyError = message => globalThis.__photoErrors.push(message);
function LibraryHarness() {
  const [visible, setVisible] = React.useState(true);
  globalThis.__setPhotoLibraryVisible = setVisible;
  return visible ? <PhotoLibraryPanel pools={[{id:'pool',name:'Photos',path:'.',filesystem:'ext4',status:'ready'}]} locale="en"
    onWorkQueuesChanged={noop} onNotifyError={notifyError} onNotifySuccess={noop} onNotifyWarning={noop} onOpenSettings={noop} configurationUpdatedAt={null} /> : <div>Other workspace</div>;
}
createRoot(document.getElementById('root')).render(<PhotoUploadsProvider><div className="app-shell" style={{display:'block',height:'100dvh',overflow:'auto'}}>
  {library ? <LibraryHarness /> :
  <section className="settings-modal" style={{width:'100%',height:'100%',maxHeight:'none',display:'block'}}>
    <main className="settings-section-page"><div className="settings-section-body"><PhotosSemanticSettingsCard /></div></main>
  </section>}<TooltipLayer />
</div></PhotoUploadsProvider>);
`;

before(async () => {
  server = await createServer({ configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)), server: { host: "127.0.0.1", port: 0 },
    plugins: [{ name: "photos-semantic-browser-harness",
      resolveId(id) { if (id === "/__photos-semantic-entry.tsx") return id; },
      load(id) { if (id === "/__photos-semantic-entry.tsx") return harness; },
      configureServer(vite) { vite.middlewares.use(async (request, response, next) => {
        if (request.url?.startsWith("/api/photos/upload?")) {
          const name = new URL(request.url, "http://localhost").searchParams.get("name");
          let received = 0;
          request.on("data", (chunk) => { received += chunk.length; });
          request.on("end", () => photoUploads.push({ name, received, reply(status = 201) {
            response.writeHead(status, { "Content-Type": "application/json" });
            response.end(JSON.stringify(status === 201 ? { path: `Photos/${name}`, operation: {} } : { error: "Upload test: disk full" }));
          } }));
          return;
        }
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
    if (path === "/api/photos/upload") return route.continue();
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

test("photo upload floating window tracks real bytes, processing, failures, and workspace changes", async t => {
  photoUploads.length = 0;
  const { page } = await open(t, { library: true });
  await expect(page.locator(".photo-tile")).toHaveCount(2);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Network.enable");
  await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 10, downloadThroughput: -1, uploadThroughput: 128 * 1024 });
  const input = page.locator('input[type="file"]');
  await input.setInputFiles([
    { name: "trip.xmp", mimeType: "application/xml", buffer: Buffer.from("<xmp/>") },
    { name: "旅行-很长的照片文件名称-".repeat(6) + ".jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(512 * 1024) },
    { name: "broken.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) },
    { name: "last.jpg", mimeType: "image/jpeg", buffer: Buffer.alloc(1024) }
  ]);
  const window = page.locator(".photo-upload-window");
  await expect(window).toBeVisible();
  await expect(window.locator("li")).toHaveCount(4);
  await expect(window.locator(".ui-dialog-header")).toHaveCount(1);
  await expect(window.locator(".ui-status")).toHaveCount(4);
  const transferring = window.locator('li[data-state="uploading"] [role="progressbar"]');
  await expect.poll(async () => transferring.count() ? Number(await transferring.getAttribute("aria-valuenow")) : 0).toBeGreaterThan(0);
  assert(Number(await transferring.getAttribute("aria-valuenow")) < 100);
  await window.getByRole("button", { name: "Collapse uploads" }).click();
  await expect(window.locator("ol")).toBeHidden();
  await page.evaluate(() => globalThis.__setPhotoLibraryVisible(false));
  await expect(page.locator(".photo-library")).toHaveCount(0);
  await expect(window).toBeVisible();
  await window.getByRole("button", { name: "Expand uploads" }).click();
  await expect.poll(() => photoUploads.length).toBe(1);
  assert(photoUploads[0].name.endsWith(".jpg"));
  assert.equal(photoUploads[0].received, 512 * 1024);
  await expect(window.locator('li[data-state="processing"]')).toHaveCount(1);
  await expect(window.locator('li[data-state="completed"]')).toHaveCount(0);
  photoUploads[0].reply();
  await expect.poll(() => photoUploads.length).toBe(2);
  photoUploads[1].reply(409);
  await expect.poll(() => photoUploads.length).toBe(3);
  photoUploads[2].reply();
  await expect.poll(() => photoUploads.length).toBe(4);
  assert.equal(photoUploads[3].name, "trip.xmp");
  photoUploads[3].reply();
  await expect(window.locator('li[data-state="completed"]')).toHaveCount(3);
  await expect(window.locator('li[data-state="failed"]')).toContainText("Upload test: disk full");
  await expect(window.getByRole("status")).toContainText("3 / 4 uploaded · 1 failed");
  await page.evaluate(() => globalThis.__setPhotoLibraryVisible(true));
  await expect(page.locator(".photo-library")).toHaveCount(1);
  await expect(window).toBeVisible();
  await mkdir(".cyberos/photos-semantic-browser", { recursive: true });
  await page.screenshot({ path: ".cyberos/photos-semantic-browser/upload-en-1440.png" });
  for (const zh of [false, true]) for (const width of [1440, 820, 560, 390, 320]) {
    await page.setViewportSize({ width, height: 720 });
    await page.evaluate(async (zh) => {
      const { i18n } = await import("/src/i18n/index.ts");
      await i18n.changeLanguage(zh ? "zh-CN" : "en");
    }, zh);
    const box = await window.boundingBox();
    assert(box.x >= 0 && box.x + box.width <= width);
    assert(box.y >= 0 && box.y + box.height <= 720);
    assert.equal(await window.evaluate((node) => node.scrollWidth <= node.clientWidth), true);
    for (const button of await window.getByRole("button").all()) {
      const size = await button.boundingBox();
      const minimum = width <= 560 ? 44 : 32;
      assert(size.width >= minimum && size.height >= minimum);
      assert.equal(await button.evaluate((node) => globalThis.getComputedStyle(node).borderRadius), "0px");
    }
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => {
      Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode, theme: mode });
    }, { scheme, mode });
    const colors = await window.evaluate((node) => {
      const style = globalThis.getComputedStyle(node);
      const cell = node.querySelector('[data-filled="true"]');
      return { background: style.backgroundColor, text: style.color, progress: globalThis.getComputedStyle(cell).backgroundColor };
    });
    assert.notEqual(colors.background, "rgba(0, 0, 0, 0)");
    assert.notEqual(colors.progress, "rgba(0, 0, 0, 0)");
    assert.notEqual(colors.text, colors.background);
  }
  await page.evaluate(() => {
    globalThis.document.documentElement.dataset.cyberScheme = "neon";
    globalThis.document.documentElement.dataset.cyberMode = "light";
    globalThis.document.documentElement.dataset.theme = "light";
  });
  await page.screenshot({ path: ".cyberos/photos-semantic-browser/upload-zh-320.png" });
  await page.setViewportSize({ width: 320, height: 400 });
  await window.locator("ol").focus();
  await page.keyboard.press("End");
  await expect.poll(() => window.locator("ol").evaluate((node) => node.scrollTop)).toBeGreaterThan(0);
  await page.keyboard.press("Escape");
  await expect(window.locator("ol")).toBeHidden();
  await expect(window.getByRole("button", { name: "展开上传列表" })).toBeFocused();
  await window.getByRole("button", { name: "关闭上传列表" }).click();
  await expect(window).toHaveCount(0);
});

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
