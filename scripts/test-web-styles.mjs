import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium } = createRequire(new URL("../docs/package.json", import.meta.url))("playwright");
let server, browser, baseUrl;
before(async () => {
  server = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../packages/web/node_modules/.vite-styles-browser", import.meta.url)),
    optimizeDeps: { include: ["react", "react-dom/client"] },
    server: { host: "127.0.0.1", port: 0 }
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch();
});
after(async () => { await browser?.close(); await server?.close(); });

async function fixture(t, render, options = {}) {
  const { tv = false, ...pageOptions } = options;
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce", ...pageOptions });
  t.after(() => page.close());
  const errors = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/system/network", route => route.fulfill({
    json: { interfaces: [{ name: "eth0", kind: "ethernet" }] }
  }));
  await page.route("**/__style_fixture__", route => route.fulfill({
    contentType: "text/html; charset=utf-8",
    body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/${tv ? "tv/tv.css" : "styles.css"}"></head><body><main id="root" class="${tv ? "tv-library-shell" : "app-shell"}" style="display:block;height:100dvh;overflow:auto"></main><script type="module">
      import RefreshRuntime from "/@react-refresh";
      RefreshRuntime.injectIntoGlobalHook(window);
      globalThis.window.$RefreshReg$ = () => {};
      globalThis.window.$RefreshSig$ = () => type => type;
      globalThis.window.__vite_plugin_react_preamble_installed__ = true;
      const R = await import("/node_modules/.vite-styles-browser/deps/react.js");
      const React = R.default ?? R;
      const D = await import("/node_modules/.vite-styles-browser/deps/react-dom_client.js");
      const createRoot = D.createRoot ?? D.default.createRoot;
      const { CustomSelect } = await import("/src/components/common/CustomSelect.tsx");
      const { ModalPortal } = await import("/src/components/common/ModalPortal.tsx");
      const { Button, IconButton, Field, Input, InputGroup, Textarea, Checkbox, Section, DialogHeader, DialogActions, Notice, EmptyState, StatusBadge } = await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/index.ts", import.meta.url))}");
      await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/styles.css", import.meta.url))}");
      const { useModalDialog } = await import("/src/components/workspace/useModalDialog.ts");
      ${render}
      globalThis.window.__fixtureReady = true;
    </script></body></html>`
  }));
  await page.goto(`${baseUrl}__style_fixture__`);
  await page.waitForFunction(() => globalThis.window.__fixtureReady);
  assert.deepEqual(errors, []);
  return page;
}

async function filePickerFixture(context, { pickerMode = "files", language = "zh-CN", initialState = "ready", ...pageOptions } = {}) {
  const page = await fixture(context, `
    localStorage.setItem("cyberos:language", ${JSON.stringify(language)});
    const { initI18n } = await import("/src/i18n/index.ts");
    await initI18n();
    await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/fonts.css", import.meta.url))}");
    const { StorageFilePickerDialog } = await import("/src/components/workspace/StorageFilePickerDialog.tsx");
    const entries = [
      { name: "Documents / 文档", path: "documents", kind: "directory", isSafe: true, sizeBytes: 0, modifiedAt: "2026-11-08T00:00:00Z" },
      { name: "很长的文件名称 Long operational notes.txt", path: "notes.txt", kind: "file", isSafe: true, sizeBytes: 2048, modifiedAt: "2026-11-08T00:00:00Z" },
      { name: "CyberOS installer.iso", path: "installer.iso", kind: "file", isSafe: true, sizeBytes: 1048576, modifiedAt: "2026-11-08T00:00:00Z" },
      { name: "agent-skill.zip", path: "agent-skill.zip", kind: "file", isSafe: true, sizeBytes: 4096, modifiedAt: "2026-11-08T00:00:00Z" },
      { name: "unsafe.iso", path: "unsafe.iso", kind: "symlink", isSafe: false, sizeBytes: 0, modifiedAt: "2026-11-08T00:00:00Z" }
    ];
    globalThis.window.__pickerLoadState = ${JSON.stringify(initialState)};
    globalThis.window.__pickerSelection = null;
    function PickerExample() {
      const [open, setOpen] = React.useState(false);
      const triggerRef = React.useRef(null);
      const close = () => setOpen(false);
      return React.createElement(React.Fragment, null,
        React.createElement(Button, { ref: triggerRef, variant: "secondary", onClick: () => setOpen(true) }, "Open picker"),
        open && React.createElement(StorageFilePickerDialog, {
          pools: [
            { id: "primary", name: "Main pool / 数据池", path: ".", filesystem: "btrfs", status: "ready" },
            { id: "archive", name: "Archive / 归档", path: ".", filesystem: "ext4", status: "warning" }
          ], initialPoolId: "primary", locale: ${JSON.stringify(language)}, mode: ${JSON.stringify(pickerMode)}, returnFocusRef: triggerRef,
          loadEntries: async () => {
            if (globalThis.window.__pickerLoadState === "loading") await new Promise(resolve => { globalThis.window.__finishPickerLoad = resolve; });
            if (globalThis.window.__pickerLoadState === "error") throw new Error("Directory unavailable / 目录暂不可用");
            if (globalThis.window.__pickerLoadState === "empty") return [];
            return entries;
          },
          onCancel: close,
          onSelect: selection => { globalThis.window.__pickerSelection = selection; close(); },
          onSelectMany: selections => { globalThis.window.__pickerSelection = selections; close(); },
          onRequestCreateFolder: async input => { globalThis.window.__pickerFolderRequest = input; await new Promise(resolve => { globalThis.window.__finishPickerCreate = resolve; }); }
        }));
    }
    createRoot(globalThis.document.getElementById("root")).render(React.createElement(PickerExample));
  `, pageOptions);
  await page.getByRole("button", { name: "Open picker", exact: true }).click();
  await page.locator(".storage-file-picker").waitFor();
  if (initialState === "ready") await page.locator(".storage-file-picker-row").first().waitFor();
  await page.evaluate(() => globalThis.document.fonts.ready);
  return page;
}

test("file picker uses the shared heading slots and square operational surfaces", async context => {
  const page = await filePickerFixture(context);
  await page.locator(".storage-file-picker-row").filter({ hasText: ".txt" }).click();
  await mkdir(fileURLToPath(new URL("../.cyberos/file-picker-visual/screenshots/", import.meta.url)), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL("../.cyberos/file-picker-visual/screenshots/desktop.png", import.meta.url)) });
  assert.equal(await page.locator(".storage-file-picker-header > .ui-dialog-icon").count(), 1);
  assert.equal(await page.locator(".storage-file-picker-header .ui-dialog-heading > .ui-dialog-eyebrow").count(), 1);
  assert.equal(await page.locator(".storage-file-picker-header .ui-dialog-header-actions").locator(":scope > *").count(), 1);
  const radii = await page.locator(".storage-file-picker-pool-icon, .storage-file-picker-file-icon, .storage-file-picker-pool-state").evaluateAll(elements => elements.map(element => globalThis.getComputedStyle(element).borderRadius));
  assert.ok(radii.every(radius => radius === "0px"), JSON.stringify(radii));
});

test("file picker selected names, metadata and status remain readable across every theme", async context => {
  const page = await filePickerFixture(context);
  const row = page.locator(".storage-file-picker-row").filter({ hasText: ".txt" });
  await row.click();
  let minimumContrast = Infinity;
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
    await page.waitForTimeout(250);
    const readings = await textContrast(page.locator(".storage-file-picker-pool-copy strong, .storage-file-picker-pool-copy small, .storage-file-picker-pool-state, .storage-file-picker-file-name, .storage-file-picker-file-meta"));
    for (const reading of readings) assert.ok(reading.ratio >= 4.5, `${scheme}/${mode}: ${JSON.stringify(reading)}`);
    minimumContrast = Math.min(minimumContrast, ...readings.map(reading => reading.ratio));
    assert.equal(await row.evaluate(element => globalThis.getComputedStyle(element).color), await themeColor(page, "--cyber-on-accent"));
    const bounds = await row.boundingBox();
    await row.hover();
    assert.deepEqual(await row.boundingBox(), bounds);
  }
  context.diagnostic(`Minimum file picker text contrast: ${minimumContrast.toFixed(2)}:1`);
});

for (const language of ["en", "zh-CN"]) for (const viewport of [{ width: 1440, height: 900 }, { width: 820, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 600 }]) {
  test(`file picker keeps heading, folder tools and footer inside ${viewport.width}px (${language})`, async context => {
    const page = await filePickerFixture(context, { pickerMode: "directory", language, viewport });
    await page.locator(".storage-file-picker-create-folder-trigger").click();
    const input = page.locator(".storage-file-picker-create-folder input");
    await input.fill("Evidence");
    for (const selector of [".storage-file-picker", ".storage-file-picker-header", ".storage-file-picker-footer", ".storage-file-picker-create-folder input", ".storage-file-picker-create-folder button", ".storage-file-picker-up"]) {
      for (const element of await page.locator(selector).all()) {
        const bounds = await element.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= viewport.width && bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `${selector}: ${JSON.stringify(bounds)}`);
        if (viewport.width <= 1040 && (selector.endsWith("button") || selector.endsWith("-up"))) assert.ok(bounds.width >= 44 && bounds.height >= 44, `${selector}: touch target`);
      }
    }
    const form = await page.locator(".storage-file-picker-create-folder").boundingBox();
    const toolbar = await page.locator(".storage-file-picker-toolbar").boundingBox();
    assert.ok(form.x >= toolbar.x && form.x + form.width <= toolbar.x + toolbar.width);
    await mkdir(fileURLToPath(new URL("../.cyberos/file-picker-visual/screenshots/", import.meta.url)), { recursive: true });
    await page.screenshot({ path: fileURLToPath(new URL(`../.cyberos/file-picker-visual/screenshots/folder-${viewport.width}-${language}.png`, import.meta.url)) });
    const create = page.locator('.storage-file-picker-create-folder button[type="submit"]');
    await create.click();
    assert.equal(await create.getAttribute("aria-busy"), "true");
    await page.evaluate(() => globalThis.window.__finishPickerCreate());
    await page.locator(".storage-file-picker").waitFor({ state: "hidden" });
    assert.deepEqual(await page.evaluate(() => globalThis.window.__pickerFolderRequest), { storagePoolId: "primary", parentPath: ".", name: "Evidence" });
    await page.waitForFunction(() => globalThis.document.activeElement?.textContent === "Open picker");
    assert.equal(await page.getByRole("button", { name: "Open picker", exact: true }).evaluate(element => element === globalThis.document.activeElement), true);
  });
}

test("file picker preserves filtering, selection, directory navigation and Escape focus", async context => {
  for (const pickerMode of ["iso", "files", "skill-zip", "directory"]) {
    const page = await filePickerFixture(context, { pickerMode });
    const rows = page.locator(".storage-file-picker-row");
    assert.equal(await rows.count(), pickerMode === "files" ? 4 : pickerMode === "directory" ? 1 : 2);
    assert.equal(await rows.filter({ hasText: "unsafe" }).count(), 0);
    if (pickerMode === "directory") {
      await rows.first().click();
      await page.locator(".storage-file-picker-up:not(:disabled)").waitFor();
      await page.locator(".storage-file-picker-up").click();
      assert.equal(await page.locator(".storage-file-picker-up").isDisabled(), true);
    } else {
      await rows.last().click();
      assert.equal(await rows.last().getAttribute("aria-selected"), "true");
      await page.locator(".storage-file-picker-footer [data-variant='primary']").click();
      await page.locator(".storage-file-picker").waitFor({ state: "hidden" });
      assert.ok(await page.evaluate(() => globalThis.window.__pickerSelection));
      await page.getByRole("button", { name: "Open picker", exact: true }).click();
    }
    await page.keyboard.press("Escape");
    await page.locator(".storage-file-picker").waitFor({ state: "hidden" });
    await page.waitForFunction(() => globalThis.document.activeElement?.textContent === "Open picker");
    assert.equal(await page.getByRole("button", { name: "Open picker", exact: true }).evaluate(element => element === globalThis.document.activeElement), true);
  }
});

test("file picker preserves loading, retry, empty and keyboard focus feedback", async context => {
  const loading = await filePickerFixture(context, { initialState: "loading" });
  assert.equal(await loading.locator(".storage-file-picker-list .is-spinning").count(), 1);
  assert.equal(await loading.locator(".storage-file-picker-footer [data-variant='primary']").isDisabled(), true);
  await loading.evaluate(() => globalThis.window.__finishPickerLoad());
  await loading.locator(".storage-file-picker-row").first().waitFor();
  await loading.locator(".storage-file-picker-row").first().focus();
  await loading.keyboard.press("Tab");
  const focus = await loading.evaluate(() => {
    const element = globalThis.document.activeElement;
    const style = globalThis.getComputedStyle(element);
    return { outline: style.outlineWidth, offset: style.outlineOffset, clip: style.clipPath };
  });
  assert.deepEqual(focus, { outline: "2px", offset: "3px", clip: "none" });

  const error = await filePickerFixture(context, { initialState: "error" });
  await error.getByRole("alert").waitFor();
  assert.equal(await error.locator(".storage-file-picker-footer [data-variant='primary']").isDisabled(), true);
  await error.evaluate(() => { globalThis.window.__pickerLoadState = "empty"; });
  await error.locator(".storage-file-picker-error button").click();
  await error.locator(".storage-file-picker-list .ui-empty-state").waitFor();
  assert.equal(await error.locator(".storage-file-picker-row").count(), 0);
  assert.equal(await error.locator(".storage-file-picker-footer [data-variant='primary']").isDisabled(), true);
});

test("file picker keeps a complete file row reachable in short mobile viewports", async context => {
  const page = await filePickerFixture(context, { pickerMode: "directory", language: "en", viewport: { width: 320, height: 600 } });
  await page.locator(".storage-file-picker-create-folder-trigger").click();
  const row = page.locator(".storage-file-picker-row").first();
  const list = await page.locator(".storage-file-picker-list").boundingBox();
  const bounds = await row.boundingBox();
  assert.ok(list.height >= bounds.height + 16, `list ${list.height}px cannot contain a ${bounds.height}px row and its focus padding`);
  await row.focus();
  const focused = await row.boundingBox();
  const layout = await page.locator(".storage-file-picker-layout").boundingBox();
  assert.ok(focused.y >= layout.y && focused.y + focused.height <= layout.y + layout.height);
});

test("file picker pool hover changes its edge and surface without changing geometry", async context => {
  const page = await filePickerFixture(context);
  const pool = page.locator('.storage-file-picker-pool[aria-selected="false"]').first();
  const bounds = await pool.boundingBox();
  const normal = await pool.evaluate(element => ({ background: globalThis.getComputedStyle(element).backgroundColor, border: globalThis.getComputedStyle(element).borderTopColor }));
  await pool.hover();
  const hovered = await pool.evaluate(element => ({ background: globalThis.getComputedStyle(element).backgroundColor, border: globalThis.getComputedStyle(element).borderTopColor }));
  assert.notEqual(hovered.background, normal.background);
  assert.equal(hovered.border, await themeColor(page, "--cyber-accent2"));
  assert.deepEqual(await pool.boundingBox(), bounds);
});

async function themeColor(page, token) {
  return page.evaluate(token => {
    const probe = globalThis.document.createElement("span"); probe.style.color = `var(${token})`;
    globalThis.document.body.append(probe); const value = globalThis.getComputedStyle(probe).color; probe.remove(); return value;
  }, token);
}

async function textContrast(locator) {
  return locator.evaluateAll(elements => elements.map(element => {
    const canvas = globalThis.document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d");
    const rgba = color => {
      context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const over = (front, back) => front.slice(0, 3).map((channel, i) => channel * front[3] / 255 + back[i] * (1 - front[3] / 255)).concat(255);
    const ancestors = []; for (let node = element; node; node = node.parentElement) ancestors.unshift(node);
    let background = ancestors.reduce((color, node) => over(rgba(globalThis.getComputedStyle(node).backgroundColor), color), [255, 255, 255, 255]);
    const decoration = element.querySelector("[data-slot='decoration']");
    if (decoration) background = over(rgba(globalThis.getComputedStyle(decoration, "::after").backgroundColor), background);
    const foreground = over(rgba(globalThis.getComputedStyle(element).color), background);
    const luminance = color => color.slice(0, 3).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4)
      .reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
    const a = luminance(foreground), b = luminance(background);
    return { text: element.textContent, color: globalThis.getComputedStyle(element).color, background, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  }));
}

test("selected secondary commands keep text readable on their visible cut-corner face in all themes", async t => {
  const page = await fixture(t, `
    createRoot(document.getElementById("root")).render(React.createElement("div", { style: { padding: 24, display: "flex", gap: 12 } },
      ...["aria-pressed", "aria-selected", "aria-current"].map(attribute => React.createElement(Button, {
        key: attribute, variant: "secondary", [attribute]: attribute === "aria-current" ? "page" : true
      }, attribute))));
  `);
  const failures = [];
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
    await page.waitForTimeout(250);
    for (const paint of await textContrast(page.getByRole("button"))) if (paint.ratio < 4.5) failures.push({ scheme, mode, ...paint });
  }
  if (failures.length) {
    await mkdir(".cyberos/component-review/screenshots/followup", { recursive: true });
    await page.screenshot({ path: ".cyberos/component-review/screenshots/followup/selected-before.png" });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});

test("emphasis text, code links and expanded help remain readable on actual theme surfaces", async t => {
  const page = await fixture(t, `
    createRoot(document.getElementById("root")).render(React.createElement("div", { style: { padding: 24 } },
      ...["--cyber-bg", "--surface", "--surface-hover"].map(surface => React.createElement("section", { key: surface,
        style: { padding: 20, background: "var(" + surface + ")" } },
        React.createElement("div", { className: "markdown-preview" }, React.createElement("a", { href: "#", "data-readable": true }, "文件链接 / File link")),
        React.createElement("span", { className: "hljs-type", "data-readable": true }, "Type / 类型"),
        React.createElement("button", { className: "help-tip-trigger", "aria-expanded": true, "data-readable": true }, "?")))));
  `);
  const failures = [];
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
    await page.waitForTimeout(250);
    for (const paint of await textContrast(page.locator("[data-readable]"))) if (paint.ratio < 4.5) failures.push({ scheme, mode, ...paint });
  }
  if (failures.length) {
    await mkdir(".cyberos/component-review/screenshots/followup", { recursive: true });
    await page.screenshot({ path: ".cyberos/component-review/screenshots/followup/emphasis-before.png" });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});

test("status badges and helper copy stay readable on tinted and raised surfaces", async t => {
  const page = await fixture(t, `
    const { AppearanceProvider, setAppearance } = await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/index.ts", import.meta.url))}");
    globalThis.window.__setAppearance = setAppearance;
    createRoot(document.getElementById("root")).render(React.createElement(AppearanceProvider, null, React.createElement("div", { style: { padding: 24 } },
      ...["--cyber-bg", "--surface", "--surface-hover"].map(surface => React.createElement("section", { key: surface,
        style: { padding: 20, background: "var(" + surface + ")" } },
        ...["ready", "warning", "error", "pending"].map(state => React.createElement(StatusBadge, { key: state, state }, state)),
        React.createElement(EmptyState, { title: "Empty / 暂无内容", description: "Retry / 重试" }),
        React.createElement(Field, { label: "Name / 名称", hint: "Helper / 说明", error: "Error / 错误" }, React.createElement(Input)))))));
  `);
  const failures = [];
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(preference => globalThis.window.__setAppearance(preference), { scheme, mode });
    await page.waitForTimeout(250);
    for (const paint of await textContrast(page.locator(".ui-status, .ui-empty-description, .ui-field-label > label, .ui-field-hint, .ui-field-error"))) {
      if (paint.ratio < 4.5) failures.push({ scheme, mode, ...paint });
    }
  }
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});

test("disabled icon commands use readable inactive faces in every theme", async t => {
  const page = await fixture(t, `
    createRoot(document.getElementById("root")).render(React.createElement("div", { style: { padding: 24, display: "flex", gap: 12 } },
      ...["primary", "secondary", "plain"].flatMap(variant => ["disabled", "aria-disabled"].map(attribute =>
        React.createElement(IconButton, { key: variant + attribute, variant, label: variant + attribute,
          [attribute]: true, "aria-pressed": true }, "X")))));
  `);
  const failures = [];
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(globalThis.document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode }), { scheme, mode });
    await page.waitForTimeout(250);
    for (const paint of await textContrast(page.getByRole("button"))) if (paint.ratio < 4.5) failures.push({ scheme, mode, ...paint });
  }
  assert.equal(failures.length, 0, JSON.stringify(failures.slice(0, 8)));
});

test("explicit command variants own geometry without feature classes and preserve native form semantics", async t => {
  const page = await fixture(t, `
    globalThis.window.__submissions = 0;
    function Form() {
      const ref = React.useRef(null);
      React.useEffect(() => { globalThis.window.__buttonRef = ref.current; }, []);
      return React.createElement("form", { onSubmit: event => { event.preventDefault(); globalThis.window.__submissions++; } },
        React.createElement("input", { "aria-label": "Name", required: true }),
        React.createElement(Button, { variant: "primary", type: "submit", ref }, "Save"),
        React.createElement(Button, { variant: "secondary", type: "button" }, "Cancel"),
        React.createElement(Button, { variant: "danger", type: "button" }, "Remove"));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Form));
  `);
  const save = page.getByRole("button", { name: "Save", exact: true });
  assert.equal(await save.evaluate(node => node === globalThis.window.__buttonRef), true);
  assert.equal(await save.evaluate(node => globalThis.getComputedStyle(node).minHeight), "34px");
  assert.equal(await save.evaluate(node => globalThis.getComputedStyle(node).color), await themeColor(page, "--cyber-on-accent"));
  await save.click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 0);
  await page.getByRole("textbox", { name: "Name" }).fill("NAS");
  await save.click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
  const remove = page.getByRole("button", { name: "Remove", exact: true });
  assert.equal(await remove.evaluate(node => globalThis.getComputedStyle(node).color), await themeColor(page, "--cyber-danger-text"));
});

test("fields associate native and custom controls with labels, help and errors without losing existing descriptions", async t => {
  const page = await fixture(t, `
    function Form() {
      const [value, setValue] = React.useState("one");
      return React.createElement("form", null,
        React.createElement("p", { id: "existing-help" }, "Existing description"),
        React.createElement(Field, { label: "Name", hint: "NAS name", error: "Name is reserved", help: React.createElement(Button, { variant: "plain", type: "button", "aria-label": "Name help" }, "?") },
          React.createElement(Input, { "aria-describedby": "existing-help", defaultValue: "cyberos" })),
        React.createElement(Field, { label: "Pool", hint: "Choose storage", error: "Pool is unavailable" },
          React.createElement(CustomSelect, { value, onChange: setValue, "aria-describedby": "existing-help", options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] })),
        React.createElement(Field, { label: "Notes" }, React.createElement(Textarea)),
        React.createElement(Field, { label: "Include snapshots" }, React.createElement(Checkbox)));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Form));
  `);
  for (const control of [page.getByRole("textbox", { name: "Name", exact: true }), page.getByRole("button", { name: "Pool", exact: true })]) {
    assert.equal(await control.getAttribute("aria-invalid"), "true");
    const ids = (await control.getAttribute("aria-describedby")).split(/\s+/);
    assert.equal(ids.length, 3);
    assert.equal(ids[0], "existing-help");
    for (const id of ids) assert.equal(await page.locator(`[id="${id}"]`).count(), 1);
  }
  await page.getByText("Name", { exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Name", exact: true }).evaluate(node => node === globalThis.document.activeElement), true);
  await page.getByRole("button", { name: "Name help", exact: true }).click();
  assert.equal(await page.getByRole("checkbox", { name: "Include snapshots" }).isChecked(), false);
  const select = page.getByRole("button", { name: "Pool", exact: true });
  await select.focus();
  await select.press("ArrowDown");
  await select.press("End");
  await select.press("Enter");
  assert.equal(await select.textContent(), "Two");
  await select.press("Enter");
  await select.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.equal(await select.evaluate(node => node === globalThis.document.activeElement), true);
  assert.equal(await page.getByRole("textbox", { name: "Notes" }).count(), 1);
});

test("input affixes reserve text space at desktop and touch widths and retain native submit", async t => {
  const page = await fixture(t, `
    globalThis.window.__submissions = 0;
    function Search() {
      const [value, setValue] = React.useState("query");
      return React.createElement("form", { onSubmit: event => { event.preventDefault(); globalThis.window.__submissions++; } },
        React.createElement(InputGroup, {
          leading: React.createElement(IconButton, { variant: "ghost", type: "submit", label: "Search" }, "S"),
          trailing: React.createElement(IconButton, { variant: "ghost", type: "button", label: "Clear", onClick: () => setValue("") }, "X")
        }, React.createElement(Input, { "aria-label": "Query", value, onChange: event => setValue(event.target.value) })));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Search));
  `);
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const bounds = await page.locator(".ui-input-group").evaluate(group => {
      const input = group.querySelector("input"), style = globalThis.getComputedStyle(input), rect = input.getBoundingClientRect();
      const leading = group.querySelector(".ui-input-leading button").getBoundingClientRect();
      const trailing = group.querySelector(".ui-input-trailing button").getBoundingClientRect();
      return { textLeft: rect.left + parseFloat(style.paddingLeft), textRight: rect.right - parseFloat(style.paddingRight), leadingRight: leading.right, trailingLeft: trailing.left, target: leading.height };
    });
    assert.ok(bounds.textLeft >= bounds.leadingRight);
    assert.ok(bounds.textRight <= bounds.trailingLeft);
    assert.ok(bounds.target >= (width < 1040 ? 44 : 32));
  }
  await page.getByRole("button", { name: "Search", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
  await page.getByRole("button", { name: "Clear", exact: true }).click();
  assert.equal(await page.getByRole("textbox", { name: "Query", exact: true }).inputValue(), "");
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
});

test("required custom select blocks form submission and focuses its trigger", async t => {
  const page = await fixture(t, `
    globalThis.window.__submissions = 0;
    function Form() {
      const [value, setValue] = React.useState("");
      return React.createElement("form", { onSubmit: event => { event.preventDefault(); globalThis.window.__submissions++; } },
        React.createElement(CustomSelect, { required: true, ariaLabel: "Storage pool", value, onChange: setValue,
          options: [{ value: "", label: "Choose a pool" }, { value: "pool-1", label: "Pool one" }] }),
        React.createElement(Button, { variant: "primary", type: "submit", className: "primary-button" }, "Save"));
    }
    createRoot(globalThis.document.getElementById("root")).render(React.createElement(Form));
  `);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 0);
  const trigger = page.getByRole("button", { name: "Storage pool", exact: true });
  assert.equal(await trigger.evaluate(element => element === globalThis.document.activeElement), true);
  await trigger.press("End");
  await trigger.press("Enter");
  assert.equal(await page.getByRole("listbox").count(), 0);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
});

test("busy navigation controls remain readable in every appearance", async t => {
  const page = await fixture(t, `
    createRoot(document.getElementById("root")).render(React.createElement(Button, {
      variant: "ghost",
      className: "settings-button agent-settings-button", "aria-label": "Loading settings",
      "aria-busy": true, "aria-disabled": true
    }, "Loading"));
  `);
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) {
    for (const mode of ["dark", "light"]) {
      await page.evaluate(({ scheme, mode }) => {
        globalThis.document.documentElement.dataset.cyberScheme = scheme;
        globalThis.document.documentElement.dataset.cyberMode = mode;
      }, { scheme, mode });
      const ratio = await page.getByRole("button", { name: "Loading settings" }).evaluate(element => {
        const style = globalThis.getComputedStyle(element);
        const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number)
          .map(channel => channel / 255).map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
          .reduce((sum, channel, index) => sum + channel * [.2126, .7152, .0722][index], 0);
        const foreground = luminance(style.color), background = luminance(style.backgroundColor);
        return (Math.max(foreground, background) + .05) / (Math.min(foreground, background) + .05);
      });
      assert.ok(ratio >= 4.5, `${scheme}/${mode}: busy navigation contrast ${ratio}`);
    }
  }
});

test("command geometry, disabled, busy and keyboard focus agree across feature containers", async t => {
  const page = await fixture(t, `
    const contexts = ["standard", "music-panel", "music-dialog", "video-panel", "create-form-dialog-footer",
      "docker-compose-app-footer", "docker-daemon-settings-footer", "docker-image-dialog-footer",
      "storage-file-picker-footer", "storage-pool-form-actions"];
    createRoot(globalThis.document.getElementById("root")).render(React.createElement("div", { style: { padding: 24, display: "grid", gap: 20 } },
      ...contexts.map(context => React.createElement("section", { key: context, className: context, "data-context": context,
        style: { display: "flex", flexWrap: "wrap", gap: 12, height: "auto", width: "auto", padding: 20 } },
        ...["primary-button", "secondary-button", "danger-button"].flatMap(className =>
          ["default", "disabled", "busy"].map(state => React.createElement(Button, { key: className + state, className, variant: className.replace("-button", ""),
            disabled: state !== "default", "aria-busy": state === "busy" || undefined,
            "data-state": state }, "Save")))))));
  `);
  const properties = ["minHeight", "paddingTop", "paddingBottom", "paddingLeft", "paddingRight", "borderTopWidth", "borderRadius", "backgroundColor", "color", "fontFamily", "fontWeight", "opacity"];
  for (const kind of ["primary-button", "secondary-button", "danger-button"]) {
    for (const state of ["default", "disabled", "busy"]) {
      const styles = await page.locator(`.${kind}[data-state="${state}"]`).evaluateAll((elements, properties) =>
        elements.map(element => Object.fromEntries(properties.map(property => [property, globalThis.getComputedStyle(element)[property]]))), properties);
      for (const actual of styles) assert.deepEqual(actual, styles[0], `${kind} ${state}`);
      assert.equal(styles[0].minHeight, "34px");
      assert.equal(styles[0].opacity, "1");
      assert.equal(styles[0].borderRadius, "0px");
    }
  }
  await page.keyboard.press("Tab");
  const command = page.locator('.music-dialog .primary-button[data-state="default"]');
  await command.focus();
  assert.deepEqual(await command.evaluate(element => {
    const s = globalThis.getComputedStyle(element); return [s.outlineWidth, s.outlineColor, s.outlineOffset];
  }), ["2px", await themeColor(page, "--cyber-accent2"), "3px"]);
});

test("management icon actions share quiet surfaces and target sizes inside modal portals", async t => {
  for (const { tv, width, size } of [
    { tv: false, width: 1440, size: 32 },
    { tv: false, width: 390, size: 44 },
    { tv: true, width: 1920, size: 48 }
  ]) {
    const page = await fixture(t, `
      const action = (state, key) => React.createElement(Button, {
        key, variant: "ghost", iconOnly: true, className: "management-icon-action", "aria-label": key,
        disabled: state !== "default", "aria-busy": state === "busy" || undefined,
        "data-state": state
      }, "×");
      const states = ["default", "disabled", "busy"];
      createRoot(document.getElementById("root")).render(React.createElement(React.Fragment, null,
        React.createElement("div", { style: { padding: 24 } }, ...states.map(state => action(state, "workspace-" + state))),
        React.createElement(ModalPortal, null,
          React.createElement("section", { className: "management-modal docker-daemon-settings-dialog", role: "dialog", "aria-modal": true },
            React.createElement("header", null, ...states.map(state => action(state, "modal-" + state)))))));
    `, { tv, viewport: { width, height: 900 } });
    for (const state of ["default", "disabled", "busy"]) {
      const styles = await page.locator(`.management-icon-action[data-state="${state}"]`).evaluateAll(elements => elements.map(e => {
        const s = globalThis.getComputedStyle(e), rect = e.getBoundingClientRect();
        return { width: rect.width, height: rect.height, background: s.backgroundColor, color: s.color, border: s.borderTopColor, opacity: s.opacity };
      }));
      assert.deepEqual(styles[0], styles[1], `${tv ? "TV" : "Web"} ${width}px ${state}`);
      assert.equal(styles[0].width, size);
      assert.equal(styles[0].height, size);
      assert.equal(styles[0].opacity, "1");
      if (state === "default") assert.equal(styles[0].background, "rgba(0, 0, 0, 0)");
    }
  }
});

test("hover preserves the focused field appearance in workspaces and modal editors", async t => {
  for (const width of [1440, 390]) {
    for (const modal of [false, true]) {
      const page = await fixture(t, `
        const field = React.createElement("label", { className: ${JSON.stringify(modal ? "docker-daemon-editor-field" : "form-field")} },
          "Configuration", React.createElement("textarea", { "aria-label": "Configuration", defaultValue: "{}" }));
        createRoot(document.getElementById("root")).render(${modal
          ? 'React.createElement(ModalPortal, null, React.createElement("section", { className: "management-modal docker-daemon-settings-dialog", role: "dialog" }, field))'
          : 'React.createElement("div", { style: { padding: 24 } }, field)'});
      `, { viewport: { width, height: 900 } });
      const field = page.getByRole("textbox", { name: "Configuration", exact: true });
      await page.keyboard.press("Shift");
      await field.focus();
      await field.hover();
      const actual = await field.evaluate(element => {
        const style = globalThis.getComputedStyle(element);
        return { focused: element.matches(":focus-visible"), hovered: element.matches(":hover"), border: style.borderColor,
          shadow: style.boxShadow, outline: [style.outlineWidth, style.outlineColor, style.outlineOffset] };
      });
      assert.equal(actual.focused, true);
      assert.equal(actual.hovered, true);
      assert.equal(actual.border, await themeColor(page, "--cyber-accent2"), `${width}px ${modal ? "modal" : "workspace"}`);
      assert.equal(actual.shadow, `${await themeColor(page, "--cyber-accent2")} 3px 0px 0px 0px inset`);
      assert.deepEqual(actual.outline, ["2px", await themeColor(page, "--cyber-accent2"), "3px"]);
    }
  }
});

test("Web and TV share menu surfaces and states while retaining TV target size", async t => {
  const render = `createRoot(globalThis.document.getElementById("root")).render(React.createElement("div", { className: "workspace-search-field", style: { width: "min(320px, 100%)", padding: 24 } },
    React.createElement(CustomSelect, { value: "one", ariaLabel: "Library", onChange: () => undefined,
      options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] })));`;
  const results = [];
  for (const tv of [false, true]) {
    const page = await fixture(t, render, { tv });
    await page.getByRole("button", { name: "Library", exact: true }).click();
    const palette = await page.getByRole("listbox").evaluate(menu => {
      const selected = menu.querySelector('[aria-selected="true"]');
      const s = globalThis.getComputedStyle(menu), o = globalThis.getComputedStyle(selected);
      return [s.backgroundColor, s.borderTopColor, s.boxShadow, o.color, o.backgroundColor, o.borderLeftColor];
    });
    results.push(palette);
    assert.equal(await page.getByRole("button", { name: "Library", exact: true }).evaluate(el => el.getBoundingClientRect().height), tv ? 48 : 40);
    assert.equal(await page.getByRole("option").first().evaluate(el => el.getBoundingClientRect().height), tv ? 48 : 32);
  }
  assert.deepEqual(results[1], results[0]);
  assert.notEqual(results[0][0], "rgba(0, 0, 0, 0)");
  assert.notEqual(results[0][2], "none");
});

test("explicit compact fields share sizes across photo, network and playback containers", async t => {
  for (const { tv, width, height } of [
    { tv: false, width: 1440, height: 34 },
    { tv: false, width: 390, height: 44 },
    { tv: true, width: 1920, height: 48 }
  ]) {
    const page = await fixture(t, `
      const contexts = ["photo-sort-field", "photo-common-filters", "photo-condition-row", "system-wifi-toolbar", "playback-target-compact"];
      createRoot(document.getElementById("root")).render(React.createElement("div", null,
        ...contexts.map(context => React.createElement("div", { key: context, className: context, style: { padding: 24 } },
          React.createElement(CustomSelect, { className: "control-compact", value: "one", ariaLabel: context,
            onChange: () => undefined, options: [{ value: "one", label: "One" }] })))));
    `, { tv, viewport: { width, height: 900 } });
    for (const trigger of await page.locator(".custom-select-trigger").all()) {
      assert.equal(await trigger.evaluate(e => e.getBoundingClientRect().height), height);
    }
  }
});

test("numeric options, disabled options and disabled fieldsets preserve form semantics", async t => {
  const page = await fixture(t, `
    globalThis.window.__value = 60; globalThis.window.__submissions = 0;
    function Form() {
      const [value, setValue] = React.useState(60), [disabled, setDisabled] = React.useState(false);
      return React.createElement("form", { onSubmit: event => { event.preventDefault(); globalThis.window.__submissions++; } },
        React.createElement("fieldset", { disabled },
          React.createElement(CustomSelect, { required: true, ariaLabel: "Window", value: String(value),
            onChange: v => { globalThis.window.__value = Number(v); setValue(Number(v)); },
            options: [{ value: "60", label: "1m" }, { value: "300", label: "5m", disabled: true }, { value: "900", label: "15m" }] })),
        React.createElement(Button, { type: "button", onClick: () => setDisabled(!disabled) }, "Toggle disabled"),
        React.createElement(Button, { type: "submit" }, "Save"));
    }
    createRoot(globalThis.document.getElementById("root")).render(React.createElement(Form));
  `);
  const select = page.getByRole("button", { name: "Window", exact: true });
  await select.press("ArrowDown");
  await select.press("Enter");
  assert.equal(await page.evaluate(() => globalThis.window.__value), 900);
  assert.equal(await select.evaluate(element => element === globalThis.document.activeElement), true);
  await page.getByRole("button", { name: "Toggle disabled", exact: true }).click();
  assert.equal(await select.isDisabled(), true);
  await page.getByRole("button", { name: "Save", exact: true }).click();
  assert.equal(await page.evaluate(() => globalThis.window.__submissions), 1);
});

test("menus escape a clipped form row and keep the trigger focused after selection", async t => {
  const page = await fixture(t, `
    function Form() {
      const [value, setValue] = React.useState("one");
      return React.createElement("div", { style: { width: 280, height: 44, overflow: "hidden", margin: 24 } },
        React.createElement(CustomSelect, { value, ariaLabel: "Clipped row", onChange: setValue,
          options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }, { value: "three", label: "Three" }] }));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Form));
  `);
  const trigger = page.getByRole("button", { name: "Clipped row", exact: true });
  await trigger.click();
  const menu = await page.getByRole("listbox").boundingBox();
  assert.ok(menu.height > 44);
  await page.getByRole("option", { name: "Three", exact: true }).click();
  assert.match(await trigger.textContent(), /Three/);
  await page.waitForFunction(() => globalThis.document.activeElement?.getAttribute("aria-label") === "Clipped row");
});

test("shared fields and disabled commands retain their geometry and contrast in feature forms", async t => {
  const page = await fixture(t, `
    const contexts = ["standard", "music-dialog", "management-dialog", "docker-create-dialog"];
    const footers = ["docker-compose-app-footer", "docker-daemon-settings-footer", "docker-image-dialog-footer",
      "docker-image-toolbar", "storage-file-picker-footer", "storage-pool-form-actions"];
    createRoot(document.getElementById("root")).render(React.createElement("div", null,
      ...contexts.map(context => React.createElement("section", { key: context, className: context },
        React.createElement("label", { className: "form-field create-form-field music-field" }, "Name", React.createElement("input")),
        React.createElement(CustomSelect, { value: "one", ariaLabel: context, onChange: () => undefined,
          options: [{ value: "one", label: "One" }] }))),
      ...footers.map(context => React.createElement("footer", { key: context, className: context },
        React.createElement(Button, { disabled: true, className: "secondary-button" }, "Save")))));
  `);
  for (const input of await page.locator("input").all()) {
    assert.equal(await input.evaluate(e => e.getBoundingClientRect().height), 40);
  }
  for (const button of await page.locator("button:disabled").all()) {
    assert.equal(await button.evaluate(e => globalThis.getComputedStyle(e).opacity), "1");
  }
});

test("VOD track selectors submit numeric track IDs and a null subtitle ID for Off", async t => {
  const page = await fixture(t, `
    const i18n = await (await import("/src/i18n/index.ts")).initI18n();
    await i18n.changeLanguage("en");
    const { VodPlayerControls } = await import("/src/components/preview/VodPlayerControls.tsx");
    const track = { language: "eng", default: true, forced: false, external: false };
    const status = { state: "playing", sessionId: "session-1", fileName: "clip.mp4", relativePath: "movies/clip.mp4",
      positionSeconds: 30, durationSeconds: 120, volume: 75, retryCount: 0, nextRetryAt: null,
      audioFallbackReason: null, audioTracks: [{ ...track, id: 1, title: "Stereo" }, { ...track, id: 4, title: "Surround" }],
      subtitleTracks: [{ ...track, id: 2, title: "English" }], selectedAudioTrackId: 1, selectedSubtitleTrackId: 2 };
    globalThis.window.__commands = [];
    createRoot(document.getElementById("root")).render(React.createElement(VodPlayerControls,
      { status, busy: false, onRetry: () => undefined, onCommand: command => globalThis.window.__commands.push(command) }));
  `);
  await page.getByRole("button", { name: "Audio track", exact: true }).click();
  await page.getByRole("option", { name: "Surround · ENG", exact: true }).click();
  await page.getByRole("button", { name: "Subtitle track", exact: true }).click();
  await page.getByRole("option", { name: "Subtitles off", exact: true }).click();
  assert.deepEqual(await page.evaluate(() => globalThis.window.__commands), [
    { type: "set-audio-track", trackId: 4, sessionId: "session-1" },
    { type: "set-subtitle-track", trackId: null, sessionId: "session-1" }
  ]);
});

test("clicking a portaled option keeps its filter open until Apply", async t => {
  const page = await fixture(t, `
    await (await import("/src/i18n/index.ts")).initI18n();
    const { SearchFilterPopover } = await import("/src/components/common/SearchFilterPopover.tsx");
    function Filter() {
      const [value, setValue] = React.useState("one");
      return React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", padding: 24 } },
        React.createElement(SearchFilterPopover, { label: "Filters", active: false, onOpen: () => undefined, onApply: () => undefined, onReset: () => undefined },
          React.createElement(CustomSelect, { value, ariaLabel: "Category", onChange: setValue,
            options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] })));
    }
    createRoot(document.getElementById("root")).render(React.createElement(Filter));
  `);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  await page.getByRole("button", { name: "Category", exact: true }).click();
  await page.getByRole("option", { name: "Two", exact: true }).click();
  assert.equal(await page.getByRole("dialog", { name: "Filters", exact: true }).count(), 1);
  assert.match(await page.getByRole("button", { name: "Category", exact: true }).textContent(), /Two/);
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 0);
});

test("Docker network form uses shared options and retains conditional driver modes", async t => {
  const page = await fixture(t, `
    const i18n = await (await import("/src/i18n/index.ts")).initI18n();
    await i18n.changeLanguage("en");
    const { DockerCreateDialogs } = await import("/src/components/workspace/DockerCreateDialogs.tsx");
    const summary = { enabled: true, engine: { status: "ready", version: "28", resourceCapabilities: {} },
      metrics: { containers: { total: 0 }, volumes: 0, networks: 0 }, networks: [], volumes: [] };
    createRoot(document.getElementById("root")).render(React.createElement(DockerCreateDialogs, { kind: "network", summary, storagePools: [],
      onClose: () => undefined, onComplete: () => undefined, onError: () => undefined }));
  `);
  assert.equal(await page.locator("select").count(), 0);
  const selects = page.locator(".create-form-field .custom-select-trigger");
  await selects.nth(0).click();
  await page.getByRole("option", { name: "macvlan", exact: true }).click();
  await selects.nth(2).click();
  assert.equal(await page.getByRole("option", { name: "passthru", exact: true }).count(), 1);
  await page.keyboard.press("Escape");
  await selects.nth(0).click();
  await page.getByRole("option", { name: "ipvlan", exact: true }).click();
  await selects.nth(2).click();
  assert.equal(await page.getByRole("option", { name: "l3s", exact: true }).count(), 1);
  assert.equal(await page.getByRole("option", { name: "passthru", exact: true }).count(), 0);
});

test("the offline photo map fills its canvas after the map library stylesheet loads", async t => {
  const page = await fixture(t, `
    await import("/src/components/workspace/PhotoMapView.tsx");
    createRoot(document.getElementById("root")).render(React.createElement("div", { className: "photo-map-view", style: { height: "500px" } },
      React.createElement("div", { className: "photo-map-toolbar" }, "Offline map"),
      React.createElement("div", { className: "photo-map-canvas" }, React.createElement("div", { className: "photo-maplibre maplibregl-map" },
        React.createElement("div", { className: "maplibregl-canvas-container" }, React.createElement("canvas", { className: "maplibregl-canvas" }))))));
  `, { viewport: { width: 390, height: 900 } });
  const canvas = await page.locator(".photo-map-canvas").boundingBox();
  const host = await page.locator(".photo-maplibre").boundingBox();
  assert.ok(canvas.height >= 300, `Map canvas must be usable: ${JSON.stringify(canvas)}`);
  assert.ok(host.height >= canvas.height - 1, `Map library must fill its canvas: ${JSON.stringify({ canvas, host })}`);
});

test("photo filters retain a readable dialog surface in dark and light themes", async t => {
  const page = await fixture(t, `
    const { PhotoSearchFilterMenu } = await import("/src/components/workspace/PhotoSearchFilterMenu.tsx");
    createRoot(document.getElementById("root")).render(React.createElement(PhotoSearchFilterMenu, { filters: {}, facets: null, metadataFields: [], onApply: () => undefined }));
  `);
  await page.locator(".photo-filter-trigger").click();
  for (const mode of ["dark", "light"]) {
    await page.evaluate(mode => { globalThis.document.documentElement.dataset.theme = mode; globalThis.document.documentElement.dataset.cyberScheme = "neon"; }, mode);
    const paint = await page.locator(".photo-filter-menu").evaluate(node => ({ background: globalThis.getComputedStyle(node).backgroundColor, foreground: globalThis.getComputedStyle(node).color }));
    assert.equal(paint.background, await themeColor(page, "--dialog-bg"), mode);
    assert.equal(paint.foreground, await themeColor(page, "--text"), mode);
  }
});

test("the photo viewer keeps its image and controls visible when portalled outside the workspace container", async t => {
  const page = await fixture(t, `
    const image = "data:image/svg+xml;base64," + btoa('<svg xmlns="http://www.w3.org/2000/svg" width="640" height="480"><rect width="640" height="480" fill="gray"/></svg>');
    const e = React.createElement;
    const actions = e("div", { className: "photo-lightbox-tools" }, ...["Zoom out", "Reset", "Zoom in", "Close"].map(label =>
      e(Button, { key: label, variant: "ghost", iconOnly: true, "aria-label": label }, label.slice(0, 1))));
    const metadata = e("aside", { className: "photo-lightbox-meta" }, e("dl", null, ...Array.from({ length: 12 }, (_, i) =>
      e("div", { key: i }, e("dt", null, "Metadata " + i), e("dd", null, "Long technical value ".repeat(5))))));
    const body = e("div", { className: "photo-lightbox-body" },
      e(Button, { className: "photo-lightbox-nav is-previous", variant: "ghost", iconOnly: true, "aria-label": "Previous" }, "<"),
      e("div", { className: "photo-lightbox-canvas" }, e("img", { src: image, alt: "Photo", style: { width: "100%" } })),
      e(Button, { className: "photo-lightbox-nav is-next", variant: "ghost", iconOnly: true, "aria-label": "Next" }, ">"), metadata);
    const viewer = e("div", { className: "photo-lightbox", role: "dialog", "aria-label": "Photo" },
      e(DialogHeader, { className: "photo-lightbox-header", title: "长照片文件名-photo-with-metadata.png", eyebrow: "PHOTO", actions }), body);
    createRoot(document.getElementById("root")).render(e("section", { className: "workspace-stage" },
      e(ModalPortal, { className: "photo-lightbox-backdrop" }, viewer)));
  `);
  for (const [width, height] of [[1440, 900], [820, 900], [560, 900], [390, 900], [320, 900], [320, 420]]) {
    await page.setViewportSize({ width, height });
    const media = await page.locator(".photo-lightbox-canvas img").boundingBox();
    const canvas = await page.locator(".photo-lightbox-canvas").boundingBox();
    assert.ok(media && media.width >= 140, `${width}x${height}: photo has usable width: ${JSON.stringify(media)}`);
    assert.ok(canvas.height >= Math.min(180, height * .25), `${width}x${height}: photo has usable height: ${JSON.stringify(canvas)}`);
    const dialog = await page.getByRole("dialog").boundingBox();
    const close = await page.getByRole("button", { name: "Close", exact: true }).boundingBox();
    assert.ok(dialog.x >= 0 && dialog.x + dialog.width <= width && dialog.y >= 0 && dialog.y + dialog.height <= height);
    assert.ok(close.x >= 0 && close.x + close.width <= width && close.y >= 0 && close.y + close.height <= height);
    const overflow = await page.getByRole("dialog").evaluate(node => ({ width: node.clientWidth, height: node.clientHeight, scrollWidth: node.scrollWidth, scrollHeight: node.scrollHeight,
      overflowingChildren: [...node.children].flatMap(child => [...child.children]).filter(child => child.getBoundingClientRect().right > node.getBoundingClientRect().right).map(child => ({ class: child.className, width: child.getBoundingClientRect().width })) }));
    assert.ok(overflow.scrollWidth <= overflow.width && overflow.scrollHeight <= overflow.height, `${width}x${height}: dialog contains its content: ${JSON.stringify(overflow)}`);
  }
});

test("Escape dismisses a select, then the nested modal, and restores focus at each level", async t => {
  const page = await fixture(t, `
    function Dialog({ inner = false, onClose }) {
      const [nested, setNested] = React.useState(false);
      const ref = useModalDialog(onClose);
      return React.createElement(ModalPortal, { className: "management-dialog-backdrop", onRequestClose: onClose },
        React.createElement("section", { ref, tabIndex: -1, className: "management-dialog", role: "dialog", "aria-modal": true, "aria-label": inner ? "Inner" : "Outer" },
          React.createElement(CustomSelect, { required: true, ariaLabel: inner ? "Inner choice" : "Outer choice", value: "one", onChange: () => undefined,
            options: [{ value: "one", label: "One" }, { value: "two", label: "Two" }] }),
          !inner && React.createElement(Button, { variant: "secondary", className: "secondary-button", onClick: () => setNested(true) }, "Open inner"),
          React.createElement(Button, { variant: "secondary", className: "secondary-button", onClick: onClose }, "Close"),
          nested && React.createElement(Dialog, { inner: true, onClose: () => setNested(false) })));
    }
    function App() { const [open, setOpen] = React.useState(false); return React.createElement(React.Fragment, null,
      React.createElement(Button, { variant: "primary", className: "primary-button", onClick: () => setOpen(true) }, "Open outer"),
      open && React.createElement(Dialog, { onClose: () => setOpen(false) })); }
    createRoot(globalThis.document.getElementById("root")).render(React.createElement(App));
  `);
  await page.getByRole("button", { name: "Open outer", exact: true }).click();
  await page.getByRole("button", { name: "Open inner", exact: true }).click();
  const select = page.getByRole("button", { name: "Inner choice", exact: true });
  await select.click();
  await select.press("Escape");
  assert.equal(await page.getByRole("listbox").count(), 0);
  assert.equal(await page.getByRole("dialog").count(), 2);
  await select.press("Tab");
  assert.equal(await page.getByRole("dialog", { name: "Inner", exact: true }).getByRole("button", { name: "Close", exact: true }).evaluate(e => e === globalThis.document.activeElement), true);
  await page.keyboard.press("Tab");
  assert.equal(await select.evaluate(e => e === globalThis.document.activeElement), true);
  await select.press("Escape");
  await page.waitForFunction(() => globalThis.document.activeElement?.textContent === "Open inner");
  assert.equal(await page.getByRole("dialog").count(), 1);
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => globalThis.document.activeElement?.textContent === "Open outer");
  assert.equal(await page.getByRole("dialog").count(), 0);
});

for (const locale of ["zh-CN", "en-US"]) for (const width of [1440, 820, 560, 390, 320]) {
  test(`long form labels and menus fit ${locale} at ${width}px in a short viewport`, async t => {
    const page = await fixture(t, `
      const chinese = ${locale === "zh-CN"};
      const long = chinese ? "非常长的存储池名称与操作说明".repeat(5) : "Very long storage pool and operation description ".repeat(5);
      createRoot(globalThis.document.getElementById("root")).render(React.createElement(ModalPortal, { className: "management-dialog-backdrop" },
        React.createElement("form", { className: "management-dialog create-form-dialog", role: "dialog", "aria-label": "Create" },
          React.createElement(DialogHeader, { className: "create-form-dialog-header", title: long }),
          React.createElement("div", { className: "create-form-dialog-body" },
            React.createElement(Field, { className: "create-form-field", label: chinese ? "存储池" : "Storage pool" },
              React.createElement(CustomSelect, { required: true, value: "one", ariaLabel: "Pool", onChange: () => undefined,
                options: [{ value: "one", label: long }, ...Array.from({ length: 30 }, (_, i) => ({ value: String(i), label: long + i }))] }))),
          React.createElement(DialogActions, { className: "create-form-dialog-footer" }, React.createElement("div", null,
            React.createElement(Button, { type: "button", className: "secondary-button" }, chinese ? "取消" : "Cancel"),
            React.createElement(Button, { variant: "primary", type: "button", className: "primary-button" }, chinese ? "创建" : "Create"))))));
    `, { viewport: { width, height: 420 }, locale });
    const trigger = page.getByRole("button", { name: "Pool", exact: true });
    await trigger.click();
    assert.equal(await page.evaluate(() => globalThis.document.documentElement.scrollWidth <= globalThis.innerWidth), true);
    assert.equal(await page.getByRole("dialog").evaluate(e => e.scrollWidth <= e.clientWidth), true);
    const box = await page.getByRole("listbox").boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width && box.y >= 0 && box.y + box.height <= 420, JSON.stringify(box));
    await trigger.press("End");
    assert.equal(await page.getByRole("listbox").evaluate(e => e.scrollTop > 0), true);
    await trigger.press("Escape");
    assert.equal(await trigger.evaluate(e => e === globalThis.document.activeElement), true);
    assert.equal(await page.locator(".is-spinning").count(), 0);
    if (width === 390 && locale === "zh-CN") {
      await mkdir(fileURLToPath(new URL("../.cyberos/style-refactor/screenshots/", import.meta.url)), { recursive: true });
      await page.screenshot({ path: fileURLToPath(new URL("../.cyberos/style-refactor/screenshots/form-390.png", import.meta.url)) });
    }
  });
}

async function contentMotionFixture(context, options = {}) {
  return fixture(context, `
    const { initI18n } = await import("/src/i18n/index.ts");
    const motionI18n = await initI18n();
    await motionI18n.changeLanguage("en");
    const { ManagementDashboardGrid, useManagementDashboard } = await import("/src/components/workspace/ManagementDashboard.tsx");
    const { NotificationCenter } = await import("/src/components/notifications/NotificationCenter.tsx");
    const { useNewContentReveal } = await import("/src/components/common/useContentReveal.ts");
    const nativeAnimate = Element.prototype.animate;
    globalThis.window.__contentMotions = [];
    Element.prototype.animate = function(frames, options) {
      const animation = nativeAnimate.call(this, frames, options);
      if (this.matches(".management-dashboard-container, .notification-item, .message-approval")) {
        globalThis.window.__contentMotions.push({ target: this.className, frames: animation.effect.getKeyframes(), duration: animation.effect.getTiming().duration });
        if (globalThis.window.__pauseContentMotion) animation.pause();
      }
      return animation;
    };
    const noop = () => undefined;
    const notification = id => ({ id, jobId: "job-" + id, sessionId: "session-1", operationId: id,
      kind: "file", status: "succeeded", summary: "Operation " + id, error: null, readAt: null,
      createdAt: "2026-11-08T00:00:00Z", updatedAt: "2026-11-08T00:00:00Z" });
    globalThis.window.__motionNotification = notification;
    function MotionExample() {
      const [state, setState] = React.useState({ loading: true, open: false, notifications: [notification("history")], approvals: ["old"], session: "session-1" });
      const dashboard = useManagementDashboard("storage");
      const approvalRef = React.useRef(null);
      const close = React.useCallback(() => setState(current => ({ ...current, open: false })), []);
      globalThis.window.__updateContentMotion = patch => setState(current => ({ ...current, ...patch }));
      globalThis.window.__editContentMotionLayout = dashboard.setEditing;
      useNewContentReveal(approvalRef, { items: state.approvals, scope: state.session, selector: ".message-approval", ready: !state.loading });
      return React.createElement(React.Fragment, null,
        React.createElement(ManagementDashboardGrid, { dashboard, loading: state.loading, items: [{ id: "overview", title: "Overview", content: React.createElement("strong", null, "Live storage overview") }] }),
        React.createElement("div", { ref: approvalRef }, state.loading ? null : state.approvals.map(id => React.createElement("article", { key: id, className: "message-approval" }, "Approval " + id))),
        React.createElement(NotificationCenter, { open: state.open, loading: state.loading, notifications: state.notifications, bluetoothTransfers: [], alertIncidents: [],
          unreadCount: state.notifications.length, operationUnreadCount: state.notifications.length, bluetoothUnreadCount: 0, alertUnreadCount: 0,
          locale: "en", onClose: close, onRead: noop, onReadAll: noop, onReadBluetooth: noop, onReadAllBluetooth: noop, onReadAlert: noop, onReadAllAlerts: noop, onAcknowledgeAlert: noop }));
    }
    createRoot(globalThis.document.getElementById("root")).render(React.createElement(MotionExample));
  `, { reducedMotion: "no-preference", ...options });
}

async function contentMotionCount(page, selector) {
  return page.evaluate(selector => globalThis.window.__contentMotions.filter(record => record.target.split(" ").includes(selector)).length, selector);
}

test("management content reveals once when ready and survives refresh, editing and breakpoint changes", async context => {
  const page = await contentMotionFixture(context);
  assert.equal(await contentMotionCount(page, "management-dashboard-container"), 0);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false }));
  await page.getByText("Live storage overview", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "management-dashboard-container"), 1);
  const motion = await page.evaluate(() => globalThis.window.__contentMotions.find(record => record.target === "management-dashboard-container"));
  assert.equal(motion.duration, 240);
  assert.equal(motion.frames[0].translate, "0px 4px");
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: true }));
  await page.locator(".management-dashboard-container[aria-busy=true]").waitFor();
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false }));
  await page.getByText("Live storage overview", { exact: true }).waitFor();
  await page.evaluate(() => globalThis.window.__editContentMotionLayout(true));
  await page.locator(".management-widget-drag-handle").waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".management-dashboard-static").waitFor();
  assert.equal(await contentMotionCount(page, "management-dashboard-container"), 1);
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) {
    for (const mode of ["dark", "light"]) {
      await page.evaluate(({ scheme, mode }) => {
        globalThis.document.documentElement.setAttribute("data-cyber-scheme", scheme);
        globalThis.document.documentElement.setAttribute("data-cyber-mode", mode);
      }, { scheme, mode });
      assert.equal(await page.getByText("Live storage overview", { exact: true }).isVisible(), true);
    }
  }
  assert.equal(await contentMotionCount(page, "management-dashboard-container"), 1);
});

test("notification history stays still while a live addition reveals once", async context => {
  const page = await contentMotionFixture(context);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ open: true }));
  await page.locator(".notification-drawer").waitFor();
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false }));
  await page.getByText("Operation history", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "notification-item"), 0);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ notifications: [globalThis.window.__motionNotification("new"), globalThis.window.__motionNotification("history")] }));
  await page.getByText("Operation new", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "notification-item"), 1);
  const motion = await page.evaluate(() => globalThis.window.__contentMotions.find(record => record.target.split(" ").includes("notification-item")));
  assert.equal(motion.duration, 160);
  assert.equal(motion.frames[0].opacity, "0.65");
  await page.evaluate(() => globalThis.window.__updateContentMotion({ notifications: [{ ...globalThis.window.__motionNotification("new"), summary: "Updated without replay", readAt: "2026-11-08T00:01:00Z" }, globalThis.window.__motionNotification("history")] }));
  await page.getByText("Updated without replay", { exact: true }).waitFor();
  await page.getByRole("tab", { name: /Bluetooth/ }).click();
  await page.getByRole("tab", { name: /Operations/ }).click();
  assert.equal(await contentMotionCount(page, "notification-item"), 1);
  await page.keyboard.press("Escape");
  await page.locator(".notification-drawer").waitFor({ state: "detached" });
  await page.evaluate(() => globalThis.window.__updateContentMotion({ open: true, notifications: [globalThis.window.__motionNotification("while-closed"), globalThis.window.__motionNotification("history")] }));
  await page.getByText("Operation while-closed", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "notification-item"), 1);
});

test("approval history and session switches do not replay live card entrances", async context => {
  const page = await contentMotionFixture(context);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false }));
  await page.getByText("Approval old", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "message-approval"), 0);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ approvals: ["old", "new"] }));
  await page.getByText("Approval new", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "message-approval"), 1);
  await page.evaluate(() => globalThis.window.__updateContentMotion({ session: "session-2", approvals: ["other-history"] }));
  await page.getByText("Approval other-history", { exact: true }).waitFor();
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: true }));
  await page.locator(".message-approval").waitFor({ state: "detached" });
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false }));
  await page.getByText("Approval other-history", { exact: true }).waitFor();
  assert.equal(await contentMotionCount(page, "message-approval"), 1);
});

test("reduced motion keeps content visible and cancels an in-flight reveal", async context => {
  const page = await contentMotionFixture(context, { reducedMotion: "reduce" });
  await page.evaluate(() => globalThis.window.__updateContentMotion({ loading: false, open: true }));
  await page.getByText("Operation history", { exact: true }).waitFor();
  await page.evaluate(() => globalThis.window.__updateContentMotion({ notifications: [globalThis.window.__motionNotification("reduced")], approvals: ["old", "reduced"] }));
  await page.getByText("Operation reduced", { exact: true }).waitFor();
  assert.deepEqual(await page.evaluate(() => globalThis.window.__contentMotions), []);
  assert.equal(await page.locator(".management-dashboard-container").evaluate(element => globalThis.getComputedStyle(element).opacity), "1");

  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => { globalThis.window.__pauseContentMotion = true; globalThis.window.__updateContentMotion({ approvals: ["old", "reduced", "in-flight"] }); });
  await page.getByText("Approval in-flight", { exact: true }).waitFor();
  assert.equal(await page.getByText("Approval in-flight", { exact: true }).evaluate(element => element.getAnimations().length), 1);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => [...globalThis.document.querySelectorAll(".message-approval")].every(element => element.getAnimations().length === 0));
  assert.equal(await page.getByText("Approval in-flight", { exact: true }).evaluate(element => globalThis.getComputedStyle(element).opacity), "1");
});
