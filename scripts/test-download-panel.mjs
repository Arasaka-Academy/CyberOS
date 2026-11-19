/**
 * [INPUT]: 依赖 Vite、Playwright 和下载分页与窗口快照契约。
 * [OUTPUT]: 验证下载进度、紧凑布局和一万条历史的滚动行为。
 * [POS]: 下载面板浏览器验收；隔离模拟接口，不操作设备任务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { after, before, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const timestamp = "2026-11-19T00:00:00.000Z";
const health = { status: "ready", freshWorkers: 1, activeTasks: 1, queuedTasks: 0, retryWaitTasks: 0 };
const output = fileURLToPath(new URL("../.cyberos/download-panel/browser/", import.meta.url));
let server, browser, baseUrl;
const harness = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { HttpDownloaderPanel } from '/src/components/workspace/HttpDownloaderPanel.tsx';
import { TooltipLayer } from '/src/components/common/TooltipLayer.tsx';
import { initI18n } from '/src/i18n/index.ts';
import { MobileNavigationProvider } from '/src/mobile/MobileNavigation.tsx';
import i18n from 'i18next';
import '/src/styles.css';
const zh = new URLSearchParams(location.search).has('zh');
function Harness() {
  const [notice, setNotice] = useState(null);
  return <div className="app-shell workspace-pane" style={{ display:'grid', height:'100dvh', gridTemplateRows:'minmax(0,1fr)', gridTemplateColumns:'minmax(0,1fr)' }}>
    <HttpDownloaderPanel pools={[{id:'pool-1',name:'Data',path:'.',filesystem:'ext4',status:'ready'}]}
      storagePoolsLoading={false} selectedStoragePoolId="pool-1" locale={zh ? 'zh-CN' : 'en'}
      onSelectStoragePool={() => {}} onOpenDirectory={() => {}} onOpenStorage={() => {}}
      onNotifyError={setNotice} onNotifySuccess={setNotice} onNotifyWarning={setNotice}/>
    {notice ? <output style={{position:'fixed',bottom:0}}>{notice}</output> : null}
    <TooltipLayer />
  </div>;
}
await initI18n();
await i18n.changeLanguage(zh ? 'zh-CN' : 'en');
createRoot(document.getElementById('root')).render(<MobileNavigationProvider><Harness /></MobileNavigationProvider>);
`;

function task(index, patch = {}) {
  return {
    id: `task-${String(index).padStart(5, "0")}`, sourceKind: "http", url: "https://example.org/file.bin",
    storagePoolId: "pool-1", targetDirectory: "Downloads", targetFileName: `Download ${index}.bin`,
    targetPath: `Downloads/Download ${index}.bin`, status: "completed", receivedBytes: 100, totalBytes: 100,
    speedBytesPerSecond: 0, createdAt: new Date(Date.parse(timestamp) - index * 1000).toISOString(),
    updatedAt: timestamp, startedAt: timestamp, completedAt: timestamp, error: null, workerId: null,
    leaseExpiresAt: null, heartbeatAt: null, lastProgressAt: timestamp, fileOperationId: null, phase: null,
    downloadMode: "single", expectedSha256: null, actualSha256: null, errorCode: null, errorRetryable: false,
    retryCount: 0, nextRetryAt: null, controlRequested: null, segmentCount: 0, torrentInfoHash: null,
    torrentName: null, selectedFileCount: 0, uploadedBytes: 0, uploadSpeedBytesPerSecond: 0,
    peerCount: 0, seedRatioLimit: 1, seedTimeLimitSeconds: 7200, contentCompletedAt: timestamp,
    seedStartedAt: null, ...patch
  };
}
function matches(item, filter) {
  if (filter === "active") return ["queued", "running", "paused", "seeding"].includes(item.status);
  if (filter === "completed") return item.status === "completed";
  if (filter === "failed") return ["failed", "cancelled"].includes(item.status);
  return true;
}
function summary(items) {
  return {
    total: items.length,
    active: items.filter(item => ["running", "paused", "seeding"].includes(item.status)).length,
    queued: items.filter(item => item.status === "queued").length,
    completed: items.filter(item => item.status === "completed").length,
    failed: items.filter(item => ["failed", "cancelled"].includes(item.status)).length,
    speedBytesPerSecond: items.reduce((sum, item) => sum + (item.status === "running" ? item.speedBytesPerSecond : 0), 0)
  };
}
const compare = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

before(async () => {
  await mkdir(output, { recursive: true });
  server = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../packages/web/node_modules/.vite-download-panel", import.meta.url)),
    optimizeDeps: { include: ["react", "react-dom/client"] },
    server: { host: "127.0.0.1", port: 0 },
    plugins: [{
      name: "download-panel-browser-harness",
      resolveId(id) { if (id === "/__download-panel-entry.tsx") return id; },
      load(id) { if (id === "/__download-panel-entry.tsx") return harness; },
      configureServer(vite) {
        vite.middlewares.use(async (request, response, next) => {
          if (!request.url?.startsWith("/__download-panel-test")) return next();
          response.setHeader("Content-Type", "text/html");
          response.end(await vite.transformIndexHtml(request.url, '<html><head><meta name="viewport" content="width=device-width,initial-scale=1" /></head><body><div id="root"></div><script type="module" src="/__download-panel-entry.tsx"></script></body></html>'));
        });
      }
    }]
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });

async function openPanel(t, { width = 1440, zh = false, count = 10000, items } = {}) {
  const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  const errors = [], reads = [];
  let data = items ?? Array.from({ length: count }, (_, index) => task(index));
  let sequence = 0, failNextPage = false;
  const observation = () => ({ serverId: "browser-fixture", sequence: ++sequence });
  page.on("pageerror", error => errors.push(error.message));
  t.after(async () => { await context.close(); assert.deepEqual(errors, []); });
  await page.addInitScript(() => {
    globalThis.__downloadStreams = [];
    globalThis.EventSource = class extends globalThis.EventTarget {
      readyState = 1;
      constructor(url) {
        super(); this.url = url; globalThis.__downloadStreams.push(this);
        globalThis.setTimeout(() => this.dispatchEvent(new globalThis.Event("open")), 0);
      }
      close() { this.readyState = 2; }
    };
  });
  await page.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === "/api/downloads" && request.method() === "GET") {
      reads.push(url.search);
      if (url.searchParams.has("cursor") && failNextPage) {
        failNextPage = false;
        return route.fulfill({ status: 503, json: { error: "History temporarily unavailable" } });
      }
      const filtered = data.filter(item => matches(item, url.searchParams.get("filter") ?? "all")).sort(compare);
      let start = Number(url.searchParams.get("cursor") ?? 0);
      if (url.searchParams.has("anchor")) {
        const anchor = JSON.parse(url.searchParams.get("anchor"));
        start = Math.max(0, filtered.findIndex(item => compare(item, anchor) >= 0) - 10);
      }
      const limit = Number(url.searchParams.get("limit") ?? 50);
      const selected = filtered.slice(start, start + limit);
      return route.fulfill({ json: {
        tasks: selected, nextCursor: start + selected.length < filtered.length ? String(start + selected.length) : null,
        health, summary: summary(data), observation: observation()
      } });
    }
    const match = url.pathname.match(/^\/api\/downloads\/([^/]+)\/(pause|resume|retry|cancel)$/u);
    if (match) {
      const item = data.find(item => item.id === match[1]);
      assert.ok(item);
      Object.assign(item, {
        status: match[2] === "pause" ? "paused" : match[2] === "cancel" ? "cancelled" : "queued",
        phase: null, speedBytesPerSecond: 0
      });
      return route.fulfill({ json: { task: item, observation: observation() } });
    }
    if (request.method() === "DELETE") {
      data = data.filter(item => item.id !== url.pathname.split("/").at(-1));
      return route.fulfill({ status: 204, headers: { "X-CyberOS-Download-Observation": JSON.stringify(observation()) } });
    }
    return route.fulfill({ status: 404, json: { error: "Unexpected panel fixture route" } });
  });
  await page.goto(`${baseUrl}__download-panel-test${zh ? "?zh" : ""}`);
  await expect(page.locator(".downloads-header")).toBeVisible();
  await expect(page.locator(".download-create-button")).toBeVisible();
  if (data.length) await expect(page.locator(".download-task-row").first()).toBeVisible();
  async function push(patch = {}, version) {
    await expect.poll(() => page.evaluate(() => globalThis.__downloadStreams.some(source => source.readyState !== 2))).toBe(true);
    const payload = await page.evaluate(({ all, health, summary, observation, patch }) => {
      const stream = [...globalThis.__downloadStreams].reverse().find(source => source.readyState !== 2);
      if (!stream) return false;
      const params = new URL(stream.url, globalThis.location.href).searchParams;
      const filter = params.get("filter") ?? "all";
      const includes = item => filter === "all" || (filter === "active" ? ["queued", "running", "paused", "seeding"].includes(item.status) : filter === "completed" ? item.status === "completed" : ["failed", "cancelled"].includes(item.status));
      const filtered = all.filter(includes);
      const newest = params.has("newest") ? JSON.parse(params.get("newest")) : null;
      const oldest = params.has("oldest") ? JSON.parse(params.get("oldest")) : null;
      const cmp = (a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);
      const within = item => newest && oldest && cmp(item, newest) >= 0 && cmp(item, oldest) <= 0;
      stream.dispatchEvent(new globalThis.MessageEvent("window", { data: JSON.stringify({
        filter, headTasks: filtered.slice(0, 50), headNextCursor: filtered.length > 50 ? "50" : null, windowTasks: filtered.filter(within).slice(0, 150),
        window: { newest, oldest, overflow: false }, health, summary, observation, ...patch
      }) }));
      return true;
    }, { all: data, health, summary: summary(data), observation: version ?? observation(), patch });
    assert.equal(payload, true);
  }
  return { page, reads, push, items: data, observation, setItems(items) { data = items; }, failPage() { failNextPage = true; } };
}

test("ten thousand history entries load on scroll with bounded mounted rows", async t => {
  const { page, reads, push } = await openPanel(t);
  const list = page.locator(".downloads-list");
  assert.ok(await page.locator(".download-task-row").count() < 80);
  for (let index = 0; index < 14; index++) {
    const before = reads.length;
    await list.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => reads.length).toBeGreaterThan(before);
    await push();
  }
  assert.ok(reads.some(query => Number(new globalThis.URLSearchParams(query).get("cursor")) >= 500));
  assert.ok(await page.locator(".download-task-row").count() < 80);
  assert.equal(await page.locator(".download-task-row").filter({ hasText: "Download 0.bin" }).count(), 0);
  await page.screenshot({ path: `${output}/history-desktop.png` });
});

test("BT resume retains content progress during verification and ignores old snapshots", async t => {
  const bt = task(0, { sourceKind: "magnet", status: "paused", receivedBytes: 50, totalBytes: 100,
    phase: null, contentCompletedAt: null, torrentName: "Duplicate subtitle", downloadMode: "torrent" });
  const state = await openPanel(t, { items: [bt] });
  const row = state.page.locator(".download-task-row");
  await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  await row.getByRole("button", { name: "Resume download", exact: true }).click();
  await expect(row).toHaveAttribute("data-status", "queued");
  Object.assign(bt, { status: "running", phase: "verifying", speedBytesPerSecond: 12345 });
  const old = { ...bt, receivedBytes: 1, phase: "downloading" };
  const oldVersion = state.observation();
  await state.push();
  await expect(row).toContainText(/verif|check/iu);
  await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
  assert.equal(await row.locator("text=Duplicate subtitle").count(), 0);
  await state.push({ headTasks: [old], windowTasks: [old] }, oldVersion);
  await expect(row.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "50");
});

for (const width of [1440, 820, 560, 390, 320]) {
  for (const zh of [false, true]) {
    test(`compact rows remain usable at ${width}px in ${zh ? "Chinese" : "English"}`, async t => {
      const state = await openPanel(t, { width, zh, items: [
        task(0, { targetFileName: "很长的下载任务名称Long-download-file-name".repeat(8) }),
        task(1, { status: "failed", error: "Download failed: ".repeat(20), errorCode: null }),
        task(2, { status: "running", phase: "downloading", receivedBytes: 30, speedBytesPerSecond: 20,
          contentCompletedAt: null })
      ] });
      const { page } = state;
      await expect(page.locator(".downloads-filters")).toContainText(zh ? "全部" : "All");
      assert.equal(await page.locator(".downloads-header .management-header-copy p").count(), 0);
      assert.equal(await page.locator(".download-task-heading > div > span").count(), 0);
      const failed = page.locator('.download-task-row[data-status="failed"]');
      await expect(failed).toContainText("Download failed");
      const overflow = await page.evaluate(() => globalThis.document.documentElement.scrollWidth > globalThis.innerWidth + 1);
      assert.equal(overflow, false);
      if (width <= 560) {
        const buttons = await page.locator(".download-task-actions button").evaluateAll(elements => elements.map(element => {
          const rect = element.getBoundingClientRect(); return { width: rect.width, height: rect.height };
        }));
        assert.ok(buttons.every(button => button.width >= 44 && button.height >= 44));
      }
      await page.screenshot({ path: `${output}/layout-${width}-${zh ? "zh" : "en"}.png` });
    });
  }
}

test("hover highlights only the pointed row without persisting selection", async t => {
  const { page } = await openPanel(t, { count: 3 });
  const buttonLayout = await page.locator(".download-create-button").evaluate(element => {
    const button = element.getBoundingClientRect(), header = element.closest("header").getBoundingClientRect();
    return { headerX: header.x, headerY: header.y, x: button.x, y: button.y, width: button.width, height: button.height, right: button.right, headerRight: header.right, headerBottom: header.bottom, opacity: globalThis.getComputedStyle(element).opacity };
  });
  assert.ok(buttonLayout.x >= buttonLayout.headerX && buttonLayout.y >= buttonLayout.headerY && buttonLayout.right <= buttonLayout.headerRight && buttonLayout.y + buttonLayout.height <= buttonLayout.headerBottom && buttonLayout.opacity !== "0", JSON.stringify(buttonLayout));
  const row = page.locator(".download-task-row").first();
  await expect.poll(() => row.evaluate(element => globalThis.getComputedStyle(element).backgroundColor)).not.toBe("");
  await page.locator(".downloads-header").hover();
  const initial = await row.evaluate(element => globalThis.getComputedStyle(element).backgroundColor);
  await row.hover();
  await expect.poll(() => row.evaluate(element => globalThis.getComputedStyle(element).backgroundColor)).not.toBe(initial);
  await row.locator("strong").click();
  await page.locator(".downloads-header").hover();
  await expect.poll(() => row.evaluate(element => globalThis.getComputedStyle(element).backgroundColor)).toBe(initial);
  assert.equal(await row.getAttribute("aria-selected"), null);
});

test("a failed history page preserves rows and can be retried", async t => {
  const state = await openPanel(t, { count: 500 });
  state.failPage();
  await state.page.locator(".downloads-list").evaluate(element => { element.scrollTop = element.scrollHeight; });
  const alert = state.page.getByRole("alert");
  await expect(alert).toContainText("History temporarily unavailable");
  assert.ok(await state.page.locator(".download-task-row").count() > 0);
  const before = state.reads.length;
  await alert.getByRole("button", { name: "Retry", exact: true }).click();
  await expect.poll(() => state.reads.length).toBeGreaterThan(before);
  await expect(alert).toHaveCount(0);
});

test("new head tasks keep the current history reading anchor", async t => {
  const state = await openPanel(t, { count: 1000 });
  const list = state.page.locator(".downloads-list");
  await list.evaluate(element => { element.scrollTop = 1100; });
  const anchor = await list.evaluate(element => {
    const top = element.getBoundingClientRect().top;
    const row = [...element.querySelectorAll(".download-task-row")].find(row => row.getBoundingClientRect().bottom > top + 1);
    return { id: row.dataset.taskId, top: row.getBoundingClientRect().top };
  });
  state.items.unshift(...Array.from({ length: 20 }, (_, index) => task(-index - 1)));
  await state.push();
  await expect.poll(async () => {
    const box = await state.page.locator(`[data-task-id="${anchor.id}"]`).boundingBox();
    return box ? Math.abs(box.y - anchor.top) : 10000;
  }).toBeLessThan(3);
});

test("an initially empty list can page past a new head of fifty tasks", async t => {
  const state = await openPanel(t, { count: 0 });
  const items = Array.from({ length: 120 }, (_, index) => task(index));
  state.setItems(items);
  await state.push();
  await expect(state.page.locator(".download-task-row").first()).toBeVisible();
  const seen = new Set();
  for (let step = 0; step < 80 && seen.size < items.length; step++) {
    const visible = await state.page.locator(".download-task-row").evaluateAll(rows => rows.map(row => row.dataset.taskId));
    visible.forEach(id => seen.add(id));
    await state.page.locator(".downloads-list").evaluate(async element => {
      element.scrollTop += 600;
      await new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
    });
  }
  assert.equal(seen.size, 120);
  assert.ok(state.reads.some(query => new globalThis.URLSearchParams(query).has("cursor")));
});
