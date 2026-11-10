import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createRequire } from "node:module";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";
import { openCyberOsDb } from "@cyberos/db";
import { loadCyberOsRuntime } from "@cyberos/shared";
import { buildServer } from "../packages/api/src/server.ts";
import { SETTINGS_SECTIONS } from "../packages/web/src/config/settings.ts";
import { populatedSettings } from "./settings-browser-fixtures.mjs";
import { settingsTestWorkbook } from "./settings-test-workbook.mjs";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const directory = fileURLToPath(new URL("../.cyberos/settings-visual-20261108/browser/", import.meta.url));
const responses = new Map();
const measurements = [];
let temporaryRoot, database, api, vite, browser, baseUrl;

before(async () => {
  temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "cyberos-settings-browser-"));
  const config = loadCyberOsRuntime({ CYBEROS_ENVIRONMENT: "development", CYBEROS_ROOT: temporaryRoot });
  await mkdir(path.join(temporaryRoot, "data", "pool-1"), { recursive: true });
  await mkdir(config.paths.stateDir, { recursive: true });
  database = openCyberOsDb(config.paths.databasePath);
  api = await buildServer({ config, db: database });
  await api.inject({ method: "POST", url: "/api/sessions", payload: { cwd: "." } });
  vite = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../packages/web/node_modules/.vite-settings-browser", import.meta.url)),
    server: { host: "127.0.0.1", port: 0 }
  });
  await vite.listen();
  baseUrl = vite.resolvedUrls.local[0];
  browser = await chromium.launch();
  await mkdir(directory, { recursive: true, mode: 0o700 });
});

after(async () => {
  if (measurements.length) await writeFile(path.join(directory, "measurements.json"), JSON.stringify(measurements, null, 2));
  await browser?.close();
  await vite?.close();
  await api?.close();
  database?.close();
  if (temporaryRoot) await rm(temporaryRoot, { recursive: true, force: true });
});

async function openSettings(context, viewport = { width: 1440, height: 900 }, language = "en", overrides = new Map()) {
  const page = await browser.newPage({ viewport, reducedMotion: "reduce" });
  context.after(() => page.close());
  const errors = [], mutations = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript(language => {
    globalThis.localStorage.setItem("cyberos:language", language);
    globalThis.localStorage.setItem("cyberos:appearance:v1", JSON.stringify({ scheme: "neon", mode: "dark" }));
    globalThis.EventSource = class extends globalThis.EventTarget {
      readyState = 1;
      close() { this.readyState = 2; }
    };
  }, language);
  await page.route("**/health", route => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const key = url.pathname + url.search;
    if (request.method() !== "GET") mutations.push({ method: request.method(), path: url.pathname });
    const override = overrides.get(`${request.method()} ${key}`) ?? overrides.get(key) ?? overrides.get(url.pathname);
    if (override) return route.fulfill(typeof override === "function" ? await override(request) : override);
    if (request.method() !== "GET") {
      return route.fulfill({ status: 409, json: { error: "Read-only visual fixture" } });
    }
    if (!responses.has(key)) {
      const response = await api.inject({ method: "GET", url: key });
      responses.set(key, { status: response.statusCode, contentType: response.headers["content-type"] ?? "application/json", body: response.body.replaceAll(temporaryRoot, "/cyberos") });
    }
    return route.fulfill(responses.get(key));
  });
  await page.goto(`${baseUrl}${viewport.width <= 1040 ? "#/app/settings" : ""}`);
  if (viewport.width > 1040) {
    const label = await page.evaluate(async () => (await import("/src/i18n/index.ts")).i18n.t("common.actions.systemSettings"));
    await page.getByRole("button", { name: label, exact: true }).click();
  }
  await expect(page.locator(".settings-nav")).toBeVisible();
  await page.evaluate(() => globalThis.document.fonts.ready);
  const sections = await page.evaluate(async () => {
    const { SETTINGS_SECTIONS, settingsSectionTitle } = await import("/src/config/settings.ts");
    const { i18n } = await import("/src/i18n/index.ts");
    return SETTINGS_SECTIONS.map(section => ({ id: section.id, title: settingsSectionTitle(section, i18n.t.bind(i18n)) }));
  });
  assert.equal(sections.length, SETTINGS_SECTIONS.length);
  return { page, sections, errors, mutations, viewport, overrides };
}

async function selectSection(view, id) {
  const { page, sections, viewport } = view;
  if (viewport.width <= 1040 && await page.locator('.mobile-settings-page[data-settings-view="detail"]').count()) await page.locator(".mobile-app-back").click();
  await page.locator(".settings-nav").getByRole("button", { name: sections.find(section => section.id === id).title, exact: true }).click();
  await expect(page.locator(".settings-content-body")).toBeVisible();
  await expect(page.locator(".settings-content-body .panel-content-skeleton")).toHaveCount(0, { timeout: 20_000 });
  await page.evaluate(() => globalThis.document.fonts.ready);
  await page.waitForTimeout(100);
}

async function assertContained(page, selector = ".settings-content") {
  const escaped = await page.locator(selector).evaluate(root => {
    const bounds = root.getBoundingClientRect();
    return [...root.querySelectorAll("button, input:not([type=hidden]), textarea, .custom-select-trigger, h3, .ui-field, .ui-notice, .settings-alerts-list, .settings-resource-copy, .settings-media-source")].filter(element => {
      const box = element.getBoundingClientRect();
      return box.width && (box.left < bounds.left - 1 || box.right > bounds.right + 1 || element.scrollWidth > element.clientWidth + 1 && !element.matches("input, textarea, button, .custom-select-trigger"));
    }).map(element => ({ className: element.className, text: element.textContent?.trim().slice(0, 60), width: element.clientWidth, scrollWidth: element.scrollWidth }));
  });
  assert.deepEqual(escaped, [], `${selector}: horizontal clipping`);
}

async function captureScrollStates(view, id, prefix) {
  const body = view.page.locator(".settings-content-body");
  const maximum = await body.evaluate(element => element.scrollHeight - element.clientHeight);
  for (const [state, fraction] of [["top", 0], ["middle", .5], ["bottom", 1]]) {
    await body.evaluate((element, fraction) => { element.scrollTop = fraction * (element.scrollHeight - element.clientHeight); }, fraction);
    await assertContained(view.page);
    if (state === "middle" && maximum < 200) continue;
    await view.page.screenshot({ path: path.join(directory, `${prefix}-${id}-${view.viewport.width}-${state}.png`) });
  }
  assert.ok(await body.evaluate(element => Math.abs(element.scrollTop - (element.scrollHeight - element.clientHeight)) <= 1));
  await body.evaluate(element => { element.scrollTop = 0; });
}

async function contrastReadings(page, includeNavigation = false, root = ".settings-content") {
  const selector = `${root} :is(h2, h3, p, dt, dd, label, .settings-help, .settings-empty-note, .settings-resource-copy strong, .settings-resource-copy small, .settings-resource-status, .settings-media-match-title, .settings-media-match-title small, .settings-media-candidate, .settings-media-candidate small, .settings-media-candidate em, .ui-field-hint, .ui-field-error, .ui-notice, .settings-card-actions button, .settings-actions button, .ui-section-actions button, .ui-dialog-actions button, .settings-alerts-actions button, .appearance-picker button)`;
  return page.locator(selector + (includeNavigation ? ", .settings-nav button, .settings-rail-footer" : "")).evaluateAll(elements => {
    const canvas = globalThis.document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const rgba = color => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (foreground, background) => foreground.slice(0, 3).map((value, index) => value * foreground[3] / 255 + background[index] * (1 - foreground[3] / 255)).concat(255);
    const luminance = color => color.slice(0, 3).map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4).reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
    return elements.filter(element => element.getClientRects().length && element.textContent.trim() && !element.classList.contains("hud-switch")).map(element => {
      const ancestors = [];
      for (let parent = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
      let background = ancestors.reduce((result, parent) => over(rgba(globalThis.getComputedStyle(parent).backgroundColor), result), [255, 255, 255, 255]);
      const decoration = element.querySelector("[data-slot='decoration']");
      if (decoration) background = over(rgba(globalThis.getComputedStyle(decoration, "::after").backgroundColor), background);
      const foreground = over(rgba(globalThis.getComputedStyle(element).color), background);
      return { text: element.textContent.trim().slice(0, 80), className: element.className, color: globalThis.getComputedStyle(element).color, ratio: (Math.max(luminance(foreground), luminance(background)) + .05) / (Math.min(luminance(foreground), luminance(background)) + .05) };
    });
  });
}

test("settings navigation groups keep their order, search and selection on desktop and mobile", async context => {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1041, height: 600 }, { width: 1040, height: 600 }, { width: 390, height: 844 }]) {
    for (const language of ["en", "zh-CN"]) {
      await context.test(`${viewport.width}/${language}`, async child => {
        const view = await openSettings(child, viewport, language);
        const navigation = view.page.locator(".settings-nav");
        const labels = language === "en"
          ? ["General", "Network & Connections", "Files & Data", "Media & Downloads", "AI & Voice", "System & Maintenance"]
          : ["常规", "网络与连接", "文件与数据", "媒体与下载", "AI 与语音", "系统与维护"];
        await expect(navigation.locator("h3")).toHaveText(labels);
        await expect(navigation.locator("button strong")).toHaveText(view.sections.map(section => section.title));
        assert.deepEqual(await navigation.locator("section").evaluateAll(groups => groups.map(group => group.querySelectorAll("button").length)), [4, 4, 4, 3, 5, 5]);
        const clippedLabels = await navigation.locator("h3, button strong").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
        assert.deepEqual(clippedLabels, []);
        await expect(navigation).toHaveCSS("scroll-padding-bottom", "6px");
        await view.page.screenshot({ path: path.join(directory, `navigation-top-${viewport.width}-${language}.png`) });
        const search = view.page.locator(".settings-search input");
        await search.fill(labels[2]);
        await expect(navigation.locator("h3")).toHaveText([labels[2]]);
        await expect(navigation.locator("button strong")).toHaveText(view.sections.filter(section => ["files", "indexer", "shares", "backup"].includes(section.id)).map(section => section.title));
        await search.fill("Tailscale");
        await expect(navigation.locator("h3")).toHaveText([labels[1]]);
        await expect(navigation.locator("button")).toHaveCount(1);
        await search.fill("");
        await expect(navigation.locator("h3")).toHaveText(labels);
        await selectSection(view, "operations");
        if (viewport.width <= 1040) await view.page.locator(".mobile-app-back").click();
        const current = navigation.locator('[aria-current="page"]');
        await expect(current).toHaveText(view.sections.find(section => section.id === "operations").title);
        await expect(current).toBeInViewport();
        await current.focus();
        await view.page.keyboard.press("Shift+Tab");
        await view.page.keyboard.press("Tab");
        await expect(current).toBeFocused();
        await assertFocusRing(current, { alreadyFocused: true });
        await view.page.screenshot({ path: path.join(directory, `navigation-${viewport.width}-${language}.png`) });
        assert.deepEqual(view.errors, []);
        assert.deepEqual(view.mutations, []);
      });
    }
  }
});

test("every settings form uses the shared section heading instead of a legacy card", async context => {
  const view = await openSettings(context);
  for (const id of ["shares", "backup", "media"]) {
    await selectSection(view, id);
    const headers = await view.page.locator(".settings-section-card > header").evaluateAll(elements => elements.map(element => ({ shared: element.classList.contains("ui-section-header"), fontSize: globalThis.getComputedStyle(element.querySelector("h3")).fontSize })));
    assert.ok(headers.length > 0);
    assert.ok(headers.every(header => header.shared && header.fontSize === "15px"), `${id}: ${JSON.stringify(headers)}`);
  }
});

async function translated(page, key) {
  return page.evaluate(async key => (await import("/src/i18n/index.ts")).i18n.t(key), key);
}

async function assertFocusRing(control, { alreadyFocused = false } = {}) {
  if (!alreadyFocused) {
    await control.page().keyboard.press("Tab");
    await control.focus();
  }
  const focus = await control.evaluate(element => {
    const style = globalThis.getComputedStyle(element), bounds = element.getBoundingClientRect();
    const inset = Number.parseFloat(style.outlineWidth) + Number.parseFloat(style.outlineOffset);
    const clipped = [];
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const parentStyle = globalThis.getComputedStyle(parent), parentBounds = parent.getBoundingClientRect();
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowX) && (bounds.left - inset < parentBounds.left - 1 || bounds.right + inset > parentBounds.right + 1)) clipped.push({ parent: parent.className, axis: "x", control: [bounds.left, bounds.right], bounds: [parentBounds.left, parentBounds.right] });
      if (/(auto|scroll|hidden|clip)/.test(parentStyle.overflowY) && (bounds.top - inset < parentBounds.top - 1 || bounds.bottom + inset > parentBounds.bottom + 1)) clipped.push({ parent: parent.className, axis: "y", control: [bounds.top, bounds.bottom], bounds: [parentBounds.top, parentBounds.bottom] });
    }
    return { visible: element.matches(":focus-visible"), width: style.outlineWidth, offset: style.outlineOffset, clipped };
  });
  assert.equal(focus.visible, true);
  assert.equal(focus.width, "2px");
  assert.equal(focus.offset, "3px");
  assert.deepEqual(focus.clipped, []);
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test(`nested settings dialogs keep shared headers, focus and viewport bounds at ${viewport.width}px`, async context => {
    const view = await openSettings(context, viewport, "en", await populatedSettings(api));
    const cases = [
      { id: "mcp", dialog: ".settings-mcp-dialog", trigger: async () => view.page.getByRole("button", { name: await translated(view.page, "settings.mcp.addServer"), exact: true }) },
      { id: "docker", dialog: ".docker-daemon-settings-dialog", trigger: async () => view.page.getByRole("button", { name: await translated(view.page, "workspace.management.docker.daemon.title"), exact: true }) },
      { id: "backup", dialog: ".storage-file-picker", trigger: async () => view.page.locator(".settings-backup-repository-picker") },
      { id: "skills", dialog: ".settings-git-skill-dialog", trigger: async () => view.page.getByRole("button", { name: await translated(view.page, "settings.skills.installGit"), exact: true }) },
      { id: "operations", dialog: ".settings-ops-confirm-dialog", trigger: async () => view.page.locator(".settings-operations-run-button").nth(1) },
      { id: "tailscale", dialog: ".tailscale-confirm", trigger: async () => view.page.getByRole("button", { name: await translated(view.page, "settings.tailscale.actions.restart"), exact: true }) },
      { id: "wireless", dialog: ".system-wifi-networks-dialog", trigger: async () => view.page.getByRole("button", { name: await translated(view.page, "workspace.management.network.wifi.scan"), exact: true }) },
      { id: "bluetooth", dialog: ".bluetooth-discovery-dialog", trigger: async () => view.page.locator(".bluetooth-devices-card").getByRole("button", { name: await translated(view.page, "settings.bluetooth.scan"), exact: true }) },
      { id: "media", dialog: ".music-dialog", trigger: async () => view.page.locator(".settings-music-source .settings-media-row-actions button").last() },
      { id: "downloads", dialog: ".storage-file-picker", trigger: async () => view.page.locator(".settings-download-directory-actions button").first() }
    ];
    for (const scenario of cases) await context.test(scenario.id, async subcontext => {
      subcontext.after(async () => {
        if (await view.page.locator(scenario.dialog).isVisible()) {
          await view.page.screenshot({ path: path.join(directory, `dialog-${scenario.id}-${viewport.width}-failure.png`) });
          for (let attempt = 0; attempt < 3 && await view.page.locator(scenario.dialog).isVisible(); attempt++) await view.page.keyboard.press("Escape");
        }
      });
      await selectSection(view, scenario.id);
      const trigger = await scenario.trigger();
      await trigger.click();
      const dialog = view.page.locator(scenario.dialog);
      await expect(dialog).toBeVisible();
      if (scenario.dialog === ".storage-file-picker") await expect(dialog.locator(".create-form-submit")).toBeEnabled();
      await assertContained(view.page, scenario.dialog);
      await expect.poll(async () => (await contrastReadings(view.page, false, scenario.dialog)).filter(reading => reading.ratio < 4.5), { message: `${scenario.id}: dialog contrast` }).toEqual([]);
      const bounds = await dialog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width, JSON.stringify(bounds));
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, JSON.stringify(bounds));
      const heading = dialog.locator(".ui-dialog-heading");
      await expect(heading).toBeVisible();
      assert.ok((await heading.boundingBox()).width >= 100, "heading cannot retain a legacy icon-width column");
      assert.ok(await heading.locator("h2, h3").first().evaluate(element => element.scrollWidth <= element.clientWidth + 1), `${scenario.id}: complete dialog title`);
      await assertFocusRing(dialog.locator("button:enabled").last());
      await view.page.screenshot({ path: path.join(directory, `dialog-${scenario.id}-${viewport.width}.png`) });
      for (let attempt = 0; attempt < 2 && await dialog.isVisible(); attempt++) await view.page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trigger).toBeFocused();
    });
    assert.deepEqual(view.errors, []);
    assert.ok(view.mutations.every(mutation => mutation.method === "POST" && ["/api/system/bluetooth/scan/start", "/api/system/bluetooth/scan/stop", "/api/system/network/wifi/scan"].includes(mutation.path)), JSON.stringify(view.mutations));
  });
}

test("saving a settings form keeps its fixed actions and button dimensions", async context => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const overrides = new Map([["PATCH /api/settings/system-profile", () => response]]);
  context.after(() => finish({ status: 409, json: { error: "Visual test cleanup" } }));
  const view = await openSettings(context, { width: 1041, height: 600 }, "en", overrides);
  await selectSection(view, "system-profile");
  await view.page.locator(".settings-content input").fill("CyberOS Visual Regression");
  const save = view.page.locator(".settings-actions button[type=submit]");
  const original = await save.boundingBox();
  await save.click();
  await expect(save).toHaveAttribute("aria-busy", "true");
  await expect(save).toBeDisabled();
  assert.deepEqual(await save.boundingBox(), original);
  finish({ status: 409, json: { error: "Visual fixture: changes were not saved" } });
  await expect(save).toBeEnabled();
  await expect(view.page.locator(".settings-inline-error")).toContainText("Visual fixture");
  assert.deepEqual(await save.boundingBox(), original);
  await assertContained(view.page);
  assert.deepEqual(view.mutations, [{ method: "PATCH", path: "/api/settings/system-profile" }]);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`all settings pages remain readable in every theme and mode at ${viewport.width}px`, async context => {
    const view = await openSettings(context, viewport, "zh-CN", await populatedSettings(api));
    for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
      await view.page.evaluate(({ scheme, mode }) => {
        const key = "cyberos:appearance:v1", newValue = JSON.stringify({ scheme, mode });
        globalThis.localStorage.setItem(key, newValue);
        globalThis.dispatchEvent(new globalThis.StorageEvent("storage", { key, newValue }));
      }, { scheme, mode });
      await expect(view.page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
      await expect(view.page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
      for (const section of view.sections) await context.test(`${scheme}/${mode}/${section.id}`, async () => {
        await selectSection(view, section.id);
        await assertContained(view.page);
        const readings = await contrastReadings(view.page, true);
        assert.ok(readings.length > 0);
        assert.deepEqual(readings.filter(reading => reading.ratio < 4.5), []);
        measurements.push({ viewport: viewport.width, scheme, mode, section: section.id, minimumContrast: Math.min(...readings.map(reading => reading.ratio)) });
      });
      if (viewport.width > 1040) {
        const current = view.page.locator('.settings-nav [aria-current="page"]');
        const original = await current.boundingBox();
        await current.hover();
        assert.deepEqual(await current.boundingBox(), original);
        await assertFocusRing(current);
      } else {
        await selectSection(view, "appearance");
        await assertFocusRing(view.page.locator(".settings-content .custom-select-trigger").first());
      }
      await view.page.screenshot({ path: path.join(directory, `theme-${scheme}-${mode}-${viewport.width}.png`) });
    }
    assert.deepEqual(view.errors, []);
    assert.deepEqual(view.mutations, []);
  });
}

test("spreadsheet preview runtime cannot override settings field typography or colors", async context => {
  const view = await openSettings(context);
  await selectSection(view, "model-providers");
  const label = view.page.locator(".ui-field-label > label").first();
  const read = () => label.evaluate(element => {
    const style = globalThis.getComputedStyle(element);
    return { color: style.color, size: style.fontSize, margin: style.marginBottom };
  });
  const original = await read();
  const workbook = [...settingsTestWorkbook()];
  const rendered = await view.page.evaluate(async bytes => {
    const { loadSpreadsheetPreview } = await import("/src/lib/spreadsheet-preview.ts");
    const [{ default: preview }] = await Promise.all([loadSpreadsheetPreview(), loadSpreadsheetPreview()]);
    const host = globalThis.document.createElement("div");
    host.style.cssText = "position:fixed;inset:0 auto auto 0;width:900px;height:500px;z-index:99999";
    globalThis.document.body.append(host);
    const renderer = preview.init(host, { showContextmenu: false });
    try {
      await renderer.preview(new Uint8Array(bytes).buffer);
      await new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve)));
      const canvas = host.querySelector("canvas");
      return { sheet: host.querySelector(".x-spreadsheet-bottombar")?.textContent, width: canvas?.width, height: canvas?.height };
    } finally {
      renderer.destroy();
      host.remove();
    }
  }, workbook);
  assert.match(rendered.sheet, /Settings/);
  assert.ok(rendered.width > 0 && rendered.height > 0);
  await expect(view.page.locator('style[data-cyberos-spreadsheet-layer="legacy"]')).toHaveCount(1);
  assert.deepEqual(await read(), original);
  assert.equal(original.size, "12px");
  assert.equal(original.margin, "0px");
  assert.deepEqual((await contrastReadings(view.page)).filter(reading => reading.ratio < 4.5), []);
  assert.deepEqual(view.errors, []);
});

for (const kind of ["mcp", "skills"]) test(`${kind} editor busy controls retain dimensions and error drafts`, async context => {
  let finish;
  const response = new Promise(resolve => { finish = resolve; });
  const endpoint = kind === "mcp" ? "/api/settings/mcp/servers" : "/api/settings/skills/install-git";
  const overrides = new Map([[`POST ${endpoint}`, () => response]]);
  context.after(() => finish({ status: 409, json: { error: "Visual test cleanup" } }));
  const view = await openSettings(context, { width: 390, height: 844 }, "en", overrides);
  view.page.on("dialog", dialog => dialog.accept());
  await selectSection(view, kind);
  await view.page.getByRole("button", { name: await translated(view.page, kind === "mcp" ? "settings.mcp.addServer" : "settings.skills.installGit"), exact: true }).click();
  const form = view.page.locator(kind === "mcp" ? ".settings-mcp-form" : ".settings-git-skill-form");
  if (kind === "mcp") await form.locator("input").nth(0).fill("visual-server");
  const url = form.locator('input[type="url"]');
  await url.fill("https://example.invalid/visual-regression");
  const submit = form.locator('button[type="submit"]');
  const original = await submit.boundingBox();
  await submit.click();
  await expect(form).toHaveAttribute("aria-busy", "true");
  await expect(submit).toBeDisabled();
  const busy = await submit.boundingBox();
  finish({ status: 409, json: { error: "Visual fixture: draft preserved" } });
  await expect(submit).toBeEnabled();
  await expect(form.locator('[role="alert"]')).toContainText("Visual fixture");
  await expect(url).toHaveValue("https://example.invalid/visual-regression");
  assert.deepEqual(busy, original);
  const after = await submit.boundingBox();
  assert.deepEqual({ width: after.width, height: after.height }, { width: original.width, height: original.height });
  assert.deepEqual(view.mutations, [{ method: "POST", path: endpoint }]);
  assert.deepEqual(view.errors, []);
});

for (const id of ["model-providers", "pi-agent", "docker", "virtual-machines", "indexer", "photos", "downloads"]) {
  test(`${id} primary save command retains its dimensions while busy`, async context => {
    const endpoints = { "model-providers": "model-provider", "pi-agent": "agent-capability-policy", docker: "docker", "virtual-machines": "vm", indexer: "indexer", photos: "photos", downloads: "downloads" };
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    const overrides = await populatedSettings(api);
    const endpointsToSave = [endpoints[id]];
    for (const endpoint of endpointsToSave) {
      const settingsPath = `/api/settings/${endpoint}`;
      const savedResponse = overrides.get(settingsPath) ?? { json: (await api.inject({ method: "GET", url: settingsPath })).json() };
      overrides.set(`PATCH ${settingsPath}`, async () => {
        await response;
        return savedResponse;
      });
    }
    context.after(() => finish({ status: 409, json: { error: "Visual test cleanup" } }));
    const view = await openSettings(context, { width: 1041, height: 600 }, "en", overrides);
    await selectSection(view, id);
    if (id === "model-providers") {
      const fields = view.page.locator(".settings-provider-grid .ui-section").first().locator("input");
      await fields.nth(0).fill("https://example.invalid/v1");
      await fields.nth(1).fill("visual-regression");
    }
    const submit = view.page.locator('.settings-actions button[type="submit"]');
    await expect(submit).toBeEnabled();
    const original = await submit.boundingBox();
    await submit.click();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(submit).toBeDisabled();
    const busy = await submit.boundingBox();
    finish();
    await expect(submit).not.toHaveAttribute("aria-busy", "true");
    assert.deepEqual({ width: busy.width, height: busy.height }, { width: original.width, height: original.height });
    const saved = await submit.boundingBox();
    assert.deepEqual({ width: saved.width, height: saved.height }, { width: original.width, height: original.height });
    assert.deepEqual(view.mutations, endpointsToSave.map(endpoint => ({ method: "PATCH", path: `/api/settings/${endpoint}` })));
    assert.deepEqual(view.errors, []);
  });
}

test("Overview keeps partial storage read errors local and retries only its resource", async context => {
  const info = (await api.inject({ method: "GET", url: "/api/settings/system-info" })).json().info;
  info.storage.volumes = [{
    id: "pool-1", label: "Data pool", kind: "storage-pool", path: "/cyberos/data/pool-1", status: "error",
    blockSizeBytes: null, totalBytes: null, freeBytes: null, availableBytes: null, usedBytes: null,
    usedPercent: null, storagePoolId: "pool-1", error: "Storage mount unavailable"
  }];
  let reads = 0;
  const overrides = new Map([["/api/settings/system-info", () => { reads += 1; return { json: { info } }; }]]);
  const view = await openSettings(context, { width: 1041, height: 600 }, "en", overrides);
  const warning = view.page.locator('.settings-overview [role="alert"]');
  await expect(warning).toContainText("Data pool: Storage mount unavailable");
  await expect(view.page.locator(".settings-overview-details")).toContainText("Hardware");
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await view.page.evaluate(({ scheme, mode }) => {
      const key = "cyberos:appearance:v1", newValue = JSON.stringify({ scheme, mode });
      globalThis.localStorage.setItem(key, newValue);
      globalThis.dispatchEvent(new globalThis.StorageEvent("storage", { key, newValue }));
    }, { scheme, mode });
    await expect(view.page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
    await expect(view.page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
    await assertContained(view.page);
    assert.deepEqual((await contrastReadings(view.page)).filter(reading => reading.ratio < 4.5), []);
  }
  await warning.getByRole("button", { name: "Refresh", exact: true }).click();
  await expect.poll(() => reads).toBe(2);
  await expect(warning).toBeVisible();
  assert.deepEqual(view.mutations, []);
  assert.deepEqual(view.errors, []);
});

test("settings loading and error states retain the same page header and usable actions", async context => {
  const view = await openSettings(context, { width: 1041, height: 600 });
  for (const [id, endpoint] of [["system-profile", "system-profile"], ["audio", "audio"], ["mcp", "mcp"]]) {
    let finish;
    const response = new Promise(resolve => { finish = resolve; });
    context.after(() => finish({ status: 503, json: { error: "Visual test cleanup" } }));
    view.overrides.set(`/api/settings/${endpoint}`, () => response);
    await view.page.locator(".settings-nav").getByRole("button", { name: view.sections.find(section => section.id === id).title, exact: true }).click();
    await expect(view.page.locator(".settings-content-body .panel-content-skeleton")).toBeVisible();
    const header = await view.page.locator(".settings-content-header").boundingBox();
    await view.page.screenshot({ path: path.join(directory, `loading-${id}.png`) });
    finish({ status: 503, json: { error: "Visual fixture: service unavailable" } });
    await expect(view.page.locator(".settings-content-body .panel-content-skeleton")).toHaveCount(0);
    await expect(view.page.locator(".settings-content-body")).toContainText(id === "audio" ? "Unable to load Audio settings" : "Visual fixture");
    assert.deepEqual(await view.page.locator(".settings-content-header").boundingBox(), header);
    await assertContained(view.page);
    await view.page.screenshot({ path: path.join(directory, `error-${id}.png`) });
  }
  assert.deepEqual(view.errors, []);
  assert.deepEqual(view.mutations, []);
});

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`media matching controls use themed surfaces and stable hover geometry at ${viewport.width}px`, async context => {
    const view = await openSettings(context, viewport, "en", await populatedSettings(api));
    await selectSection(view, "media");
    const title = view.page.locator(".settings-media-match-title").first();
    await expect(title).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    await title.click();
    const candidate = view.page.locator(".settings-media-candidate").first();
    await expect(candidate).toBeVisible();
    await expect(candidate).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
    for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
      await view.page.evaluate(({ scheme, mode }) => {
        const key = "cyberos:appearance:v1", newValue = JSON.stringify({ scheme, mode });
        globalThis.localStorage.setItem(key, newValue);
        globalThis.dispatchEvent(new globalThis.StorageEvent("storage", { key, newValue }));
      }, { scheme, mode });
      await expect(view.page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
      await candidate.scrollIntoViewIfNeeded();
      const original = await candidate.boundingBox();
      await candidate.hover();
      assert.deepEqual(await candidate.boundingBox(), original);
      await assertContained(view.page);
      assert.deepEqual((await contrastReadings(view.page)).filter(reading => reading.ratio < 4.5), [], `${scheme}/${mode}`);
      await assertFocusRing(candidate);
    }
    await view.page.screenshot({ path: path.join(directory, `media-matching-${viewport.width}.png`) });
    assert.deepEqual(view.errors, []);
    assert.deepEqual(view.mutations, []);
  });
}

for (const viewport of [{ width: 1440, height: 900 }, { width: 1041, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test(`populated settings and long resource names remain usable at ${viewport.width}px`, async context => {
    const view = await openSettings(context, viewport, "en", await populatedSettings(api));
    for (const id of ["mcp", "skills", "wireless", "bluetooth", "tailscale", "operations", "alerts", "media"]) await context.test(id, async () => {
      await selectSection(view, id);
      await expect(view.page.locator(".settings-content-body")).toContainText("长期存储与自动化管理");
      await captureScrollStates(view, id, "populated");
      if (viewport.width <= 1040) {
        const smallCommands = await view.page.locator(".settings-content .cyberos-button").evaluateAll(buttons => buttons.filter(button => button.getClientRects().length && button.getBoundingClientRect().height < 44).map(button => ({ className: button.className, height: button.getBoundingClientRect().height })));
        assert.deepEqual(smallCommands, [], `${id}: mobile command target`);
      }
      assert.deepEqual((await contrastReadings(view.page)).filter(reading => reading.ratio < 4.5), [], `${id}: contrast`);
    });
    assert.deepEqual(view.errors, []);
    assert.deepEqual(view.mutations, []);
  });
}

for (const language of ["en", "zh-CN"]) for (const viewport of [{ width: 1440, height: 900 }, { width: 1041, height: 600 }, { width: 1040, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test(`all settings pages keep consistent structure and usable controls at ${viewport.width}px (${language})`, async context => {
    const view = await openSettings(context, viewport, language);
    for (const section of view.sections) await context.test(section.id, async () => {
      await selectSection(view, section.id);
      const measurements = await view.page.locator(".settings-content").evaluate(content => {
        const bounds = content.getBoundingClientRect();
        const body = content.querySelector(".settings-content-body");
        const escaped = [...content.querySelectorAll("button, input:not([type=hidden]), textarea, .custom-select-trigger, h3, .ui-field")].filter(element => {
          const box = element.getBoundingClientRect();
          return box.width && (box.left < bounds.left - 1 || box.right > bounds.right + 1);
        }).map(element => ({ className: element.className, text: element.textContent?.trim().slice(0, 50) }));
        const headings = [...content.querySelectorAll(".settings-section-card > header")].map(element => ({ shared: element.classList.contains("ui-section-header"), fontSize: globalThis.getComputedStyle(element.querySelector("h3")).fontSize }));
        const fields = [...content.querySelectorAll(".ui-input:not([type=range]):not([type=checkbox]), .custom-select-trigger")].filter(element => element.getBoundingClientRect().width).map(element => ({ height: element.getBoundingClientRect().height, radius: globalThis.getComputedStyle(element).borderRadius }));
        const sections = [...content.querySelectorAll(".settings-section-card:not([role=dialog])")].map(element => ({ background: globalThis.getComputedStyle(element).backgroundColor, radius: globalThis.getComputedStyle(element).borderRadius }));
        const commands = [...content.querySelectorAll(".cyberos-button")].filter(element => element.getClientRects().length).map(element => ({ className: element.className, height: element.getBoundingClientRect().height }));
        return { escaped, headings, fields, sections, commands, overflow: body.scrollWidth > body.clientWidth + 1, radius: globalThis.getComputedStyle(content).borderRadius };
      });
      assert.deepEqual(measurements.escaped, [], section.id);
      assert.equal(measurements.overflow, false, section.id);
      assert.ok(measurements.headings.every(heading => heading.shared && heading.fontSize === "15px"), section.id);
      for (const block of measurements.sections) {
        assert.equal(block.background, "rgba(0, 0, 0, 0)", section.id);
        assert.equal(block.radius, "0px", section.id);
      }
      for (const field of measurements.fields) {
        assert.equal(field.radius, "0px", section.id);
        assert.ok(field.height >= (viewport.width <= 1040 ? 44 : 40), `${section.id}: ${JSON.stringify(field)}`);
      }
      if (viewport.width <= 1040) assert.deepEqual(measurements.commands.filter(command => command.height < 44), [], `${section.id}: mobile command target`);
      const contrast = await contrastReadings(view.page);
      assert.ok(contrast.length > 0);
      assert.deepEqual(contrast.filter(reading => reading.ratio < 4.5), [], `${section.id}: text contrast`);
      if ([1440, 390].includes(viewport.width)) {
        await view.page.screenshot({ path: path.join(directory, `${section.id}-${viewport.width}-${language}.png`) });
        if (language === "en") await captureScrollStates(view, section.id, "review");
      }
    });
    assert.deepEqual(view.errors, []);
    assert.deepEqual(view.mutations, []);
  });
}
