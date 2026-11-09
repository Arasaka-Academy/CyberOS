import assert from "node:assert/strict";
import { createRequire } from "node:module";
import process from "node:process";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { before, after, test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createServer } from "vite";

const { chromium, expect } = createRequire(new URL("../docs/package.json", import.meta.url))("@playwright/test");
const captureOnly = process.env.CYBEROS_TERMINAL_CAPTURE_ONLY === "1";
const artifacts = fileURLToPath(new URL("../.cyberos/terminal-workbench-20261108/", import.meta.url));
const timestamp = "2026-11-08T00:00:00.000Z";
const baselinePaths = ["packages/web/src/components/workspace/LocalTerminalPanel.tsx", "packages/web/src/styles/workspace.css", "packages/web/src/styles/terminal/workspace.css", "packages/web/src/styles/terminal/theme.css", "packages/web/src/styles/terminal/responsive.css", "packages/web/src/i18n/resources.ts"];
let server, browser, baseUrl;

before(async () => {
  await mkdir(artifacts, { recursive: true });
  server = await createServer({
    configFile: fileURLToPath(new URL("../packages/web/vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../packages/web", import.meta.url)),
    cacheDir: fileURLToPath(new URL("../packages/web/node_modules/.vite-terminal-browser", import.meta.url)),
    optimizeDeps: { include: ["react", "react-dom/client"] },
    plugins: captureOnly ? [{ name: "terminal-before-fixture", enforce: "pre", load(id) {
      const relative = baselinePaths.find(path => id === fileURLToPath(new URL(`../${path}`, import.meta.url)));
      if (relative) return execFileSync("git", ["show", `HEAD:${relative}`], { encoding: "utf8" });
    } }] : [],
    server: { host: "127.0.0.1", port: 0 }
  });
  await server.listen();
  baseUrl = server.resolvedUrls.local[0];
  browser = await chromium.launch();
});

after(async () => { await browser?.close(); await server?.close(); });

async function fixture(testContext, { width = 1440, height = 900, language = "en", clipboard = "denied", fullscreen = true } = {}) {
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce" });
  if (clipboard === "native") await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await context.newPage();
  testContext.after(() => context.close());
  page.setDefaultTimeout(10_000);
  const errors = [];
  const connections = [];
  const messages = [];
  const tabs = Array.from({ length: 5 }, (_, index) => ({
    id: `11111111-1111-4111-8111-${String(index + 1).padStart(12, "0")}`,
    ordinal: index + 1, customTitle: index === 1 ? "Build logs / 构建日志 very long terminal title" : null,
    createdAt: timestamp, updatedAt: timestamp
  }));
  const state = { initialized: true, tabs, activeTabId: tabs[0].id, maxSessions: 32 };
  page.on("pageerror", error => errors.push(error.message));
  testContext.after(() => assert.deepEqual(errors, []));
  await page.addInitScript(({ clipboard, fullscreen }) => {
    if (clipboard !== "native") Object.defineProperty(globalThis.navigator, "clipboard", { configurable: true, value: clipboard === "missing" ? undefined : {
      readText: async () => { if (clipboard !== "allowed") throw new Error("Denied"); return "echo clipboard"; },
      writeText: async text => { if (clipboard !== "allowed") throw new Error("Denied"); globalThis.window.__copied = text; }
    } });
    if (!fullscreen) Object.defineProperty(globalThis.document, "fullscreenEnabled", { value: false });
  }, { clipboard, fullscreen });
  await page.route(/\/api\/terminal\/tabs(?:\/.*)?$/u, async route => {
    const url = new URL(route.request().url());
    const match = /\/tabs\/([^/]+)\/(activate|restart)$/u.exec(url.pathname);
    if (match?.[2] === "activate") state.activeTabId = match[1];
    if (route.request().method() === "PATCH") {
      const tab = tabs.find(item => url.pathname.endsWith(item.id));
      tab.customTitle = route.request().postDataJSON().customTitle;
    }
    if (route.request().method() === "DELETE") {
      const index = tabs.findIndex(item => url.pathname.endsWith(item.id));
      tabs.splice(index, 1);
      state.activeTabId = tabs[0]?.id ?? null;
    }
    if (route.request().method() === "POST" && url.pathname.endsWith("/tabs")) {
      const ordinal = tabs.length + 1;
      tabs.push({ ...tabs[0], id: `22222222-2222-4222-8222-${String(ordinal).padStart(12, "0")}`, ordinal, customTitle: null });
      state.activeTabId = tabs.at(-1).id;
    }
    await route.fulfill({ json: state });
  });
  await page.routeWebSocket("**/api/terminal", socket => {
    const connection = { socket, tabId: state.activeTabId, closed: false };
    connections.push(connection);
    socket.onClose(() => { connection.closed = true; });
    socket.onMessage(raw => messages.push({ tabId: connection.tabId, ...JSON.parse(String(raw)) }));
    socket.send(JSON.stringify({ type: "ready", sessionId: connection.tabId, cwd: "/home/cyberos" }));
    socket.send(JSON.stringify({ type: "output", data: "\x1b[?2004hCyberOS terminal browser fixture\r\n\x1b[32mcyberos\x1b[0m ~ $ journalctl --user -n 5\r\nkernel: test service started\r\nkernel: fixture output ready\r\n中文输出与路径 /home/cyberos\r\n$ " }));
  });
  await page.route("**/__terminal_fixture__", route => route.fulfill({ contentType: "text/html; charset=utf-8", body: `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/src/styles.css"><style>#root,.cyberos-ui-root,.workspace-terminal-panel{height:100dvh;min-height:0}#root{display:block;padding:0;overflow:hidden}</style></head><body><main id="root" class="app-shell"></main><script type="module">
    import RefreshRuntime from "/@react-refresh";
    RefreshRuntime.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const ReactModule = await import("/node_modules/.vite-terminal-browser/deps/react.js");
    const React = ReactModule.default ?? ReactModule;
    const DomModule = await import("/node_modules/.vite-terminal-browser/deps/react-dom_client.js");
    const createRoot = DomModule.createRoot ?? DomModule.default.createRoot;
    const { initI18n } = await import("/src/i18n/index.ts");
    localStorage.setItem("cyberos:language", ${JSON.stringify(language)});
    await initI18n();
    const { AppearanceProvider } = await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/AppearanceProvider.tsx", import.meta.url))}");
    const { setAppearance } = await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/theme.ts", import.meta.url))}");
    window.__terminalAppearance = setAppearance;
    await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/fonts.css", import.meta.url))}");
    await import("/@fs/${fileURLToPath(new URL("../packages/ui/src/styles.css", import.meta.url))}");
    const { LocalTerminalPanel } = await import("/src/components/workspace/LocalTerminalPanel.tsx");
    window.__terminalRoot = createRoot(document.getElementById("root"));
    window.__terminalRoot.render(React.createElement(AppearanceProvider, { locale: ${JSON.stringify(language)} }, React.createElement(LocalTerminalPanel, { active: true })));
  </script></body></html>` }));
  await page.goto(`${baseUrl}__terminal_fixture__`);
  await page.locator(".xterm-screen").first().waitFor().catch(async error => {
    await page.screenshot({ path: `${artifacts}fixture-error.png` });
    throw new Error(`${error.message}\nBrowser errors: ${JSON.stringify(errors)}\nDOM: ${await page.locator("#root").innerHTML()}`, { cause: error });
  });
  await expect.poll(() => connections.length).toBe(1);
  await page.evaluate(() => globalThis.document.fonts.ready);
  await expect(page.locator(".xterm-rows")).toContainText("fixture output ready");
  return { page, connections, messages, state, input: () => messages.filter(message => message.type === "input"), send: message => connections.at(-1).socket.send(JSON.stringify(message)) };
}

async function paste(page, text) {
  await page.locator(".workspace-terminal:not([hidden]) .xterm-helper-textarea").evaluate((element, text) => {
    const clipboardData = new globalThis.DataTransfer();
    clipboardData.setData("text/plain", text);
    element.dispatchEvent(new globalThis.ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData }));
  }, text);
}

if (captureOnly) {
  for (const width of [1440, 390]) test(`capture existing terminal at ${width}px`, async testContext => {
    const { page } = await fixture(testContext, { width, language: "zh-CN" });
    await page.screenshot({ path: `${artifacts}before-${width}.png` });
  });
} else {
  test("single-line paste is sent exactly once while multiline paste waits for explicit approval", async testContext => {
    const { page, input } = await fixture(testContext);
    await paste(page, "echo safe");
    await expect.poll(() => input().length).toBe(1);
    assert.equal(input()[0].data, "\x1b[200~echo safe\x1b[201~");
    await paste(page, "echo first\necho second\x1b[31m");
    await expect(page.getByRole("dialog")).toBeVisible();
    assert.equal(input().length, 1);
    await expect(page.getByRole("dialog")).toContainText("\\x1B[31m");
    await page.screenshot({ path: `${artifacts}after-paste-confirmation.png` });
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(input().length, 1);
    await paste(page, "echo first\necho second");
    await page.getByRole("button", { name: "Paste into terminal", exact: true }).click();
    await expect.poll(() => input().length).toBe(2);
    assert.equal(input()[1].data, "\x1b[200~echo first\recho second\x1b[201~");
  });

  test("native keyboard paste uses the same confirmation path, including fullscreen", async testContext => {
    const { page, input, connections } = await fixture(testContext, { clipboard: "native" });
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await page.evaluate(() => globalThis.navigator.clipboard.writeText("echo native\necho keyboard"));
    await page.locator(".xterm-helper-textarea").first().focus();
    await page.keyboard.press(process.platform === "darwin" ? "Meta+v" : "Control+v");
    await expect(page.getByRole("dialog", { name: "Review terminal paste" })).toBeVisible();
    await page.screenshot({ path: `${artifacts}after-fullscreen-paste-confirmation.png` });
    assert.equal(input().length, 0);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    assert.equal(connections.length, 1);
  });

  test("search, theme changes and fullscreen preserve the terminal attachment", async testContext => {
    const { page, connections, input } = await fixture(testContext);
    await page.getByRole("button", { name: "Search output", exact: true }).click();
    await page.getByRole("textbox", { name: "Search loaded output" }).fill("kernel");
    await expect(page.getByRole("button", { name: "Copy selection", exact: true })).toBeEnabled();
    await page.setViewportSize({ width: 1300, height: 700 });
    await expect(page.getByRole("button", { name: "Copy selection", exact: true })).toBeEnabled();
    await page.getByRole("textbox", { name: "Search loaded output" }).fill("does-not-exist");
    await expect(page.getByRole("status").filter({ hasText: "No matches" })).toBeVisible();
    await page.getByRole("textbox", { name: "Search loaded output" }).press("Escape");
    await expect(page.locator(".xterm-helper-textarea").first()).toBeFocused();
    await page.getByRole("button", { name: "Enter fullscreen", exact: true }).click();
    await expect.poll(() => page.evaluate(() => Boolean(globalThis.document.fullscreenElement))).toBe(true);
    await page.getByRole("button", { name: "Exit fullscreen", exact: true }).click();
    assert.equal(connections.length, 1);
    await page.locator(".xterm-helper-textarea").first().press("Control+c");
    await expect.poll(() => input().some(message => message.data === "\x03")).toBe(true);
  });

  for (const clipboard of ["denied", "missing"]) test(`clipboard ${clipboard}: manual copy and paste never claim success or bypass review`, async testContext => {
    const { page, input } = await fixture(testContext, { clipboard });
    await page.getByRole("button", { name: "Search output", exact: true }).click();
    await page.getByRole("textbox", { name: "Search loaded output" }).fill("kernel");
    await page.getByRole("button", { name: "Copy selection", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Copy selected text" })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Selected text" })).toHaveValue("kernel");
    await expect(page.locator(".terminal-statusbar")).not.toContainText("Selection copied");
    await page.getByRole("button", { name: "Done", exact: true }).click();
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await page.getByRole("textbox", { name: "Text to paste" }).fill("echo first\necho second");
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Review terminal paste" })).toBeVisible();
    assert.equal(input().length, 0);
    await page.getByRole("button", { name: "Paste into terminal", exact: true }).click();
    await expect.poll(() => input().length).toBe(1);
  });

  test("allowed clipboard buttons copy only the selection and paste without adding Enter", async testContext => {
    const { page, input } = await fixture(testContext, { clipboard: "allowed" });
    await page.getByRole("button", { name: "Search output", exact: true }).click();
    await page.getByRole("textbox", { name: "Search loaded output" }).fill("kernel");
    await page.getByRole("button", { name: "Copy selection", exact: true }).click();
    await expect.poll(() => page.evaluate(() => globalThis.window.__copied)).toBe("kernel");
    await expect(page.locator(".terminal-statusbar")).toContainText("Selection copied");
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    await expect.poll(() => input().length).toBe(1);
    assert.equal(input()[0].data, "\x1b[200~echo clipboard\x1b[201~");
  });

  for (const transition of ["switch", "restart", "disconnect", "taken_over", "exit"]) test(`pending paste expires on ${transition} without sending input`, async testContext => {
    const { page, input, connections, state, send } = await fixture(testContext);
    await paste(page, "echo first\necho second");
    await expect(page.getByRole("dialog")).toBeVisible();
    if (transition === "switch") {
      state.activeTabId = state.tabs[1].id;
      await page.evaluate(() => globalThis.window.dispatchEvent(new globalThis.Event("focus")));
    } else if (transition === "restart") {
      await page.getByRole("button", { name: "Restart terminal", exact: true }).dispatchEvent("click");
    } else if (transition === "disconnect") {
      await connections.at(-1).socket.close();
    } else send({ type: transition });
    await expect(page.getByRole("dialog")).toHaveCount(0);
    assert.equal(input().length, 0);
    if (["switch", "restart", "disconnect"].includes(transition)) {
      await expect.poll(() => connections.length).toBe(2);
      assert.equal(input().length, 0);
      await paste(page, "echo fresh");
      await expect.poll(() => input().length).toBe(1);
    }
  });

  test("oversized UTF-8 and bracket-wrapped input is rejected without truncation", async testContext => {
    const { page, input } = await fixture(testContext);
    for (const text of ["中".repeat(21_846), "x".repeat(65_525)]) {
      await paste(page, text);
      await expect(page.locator(".terminal-statusbar")).toContainText("64 KiB");
      assert.equal(input().length, 0);
    }
  });

  test("fullscreen rejection is explained and unmount disposes the attachment", async testContext => {
    const { page, connections } = await fixture(testContext, { fullscreen: false });
    const fullscreen = page.getByRole("button", { name: "Enter fullscreen", exact: true });
    await expect(fullscreen).toBeDisabled();
    await expect(fullscreen).toHaveAttribute("data-tooltip", "Fullscreen is not supported in this browser.");
    await page.evaluate(() => globalThis.window.__terminalRoot.unmount());
    await expect(page.locator(".xterm")).toHaveCount(0);
    await expect.poll(() => connections[0].closed).toBe(true);
    await page.waitForTimeout(600);
    assert.equal(connections.length, 1);
  });

  test("tab actions and shell keyboard input retain their existing semantics", async testContext => {
    const { page, input, state } = await fixture(testContext);
    await page.locator(".xterm-helper-textarea").first().focus();
    await page.keyboard.insertText("中文输入");
    await expect.poll(() => input().some(message => message.data.includes("中文输入"))).toBe(true);
    await page.getByRole("button", { name: "Rename terminal", exact: true }).click();
    await page.getByRole("textbox", { name: "Tab name" }).fill("Notes / 笔记");
    await page.getByRole("button", { name: "Save name", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Notes / 笔记", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "New terminal", exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(6);
    await page.getByRole("button", { name: "Close terminal", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("all processes");
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    assert.equal(state.tabs.length, 6);
    await page.getByRole("button", { name: "Close terminal", exact: true }).click();
    await page.getByRole("button", { name: "Close and stop", exact: true }).click();
    await expect(page.getByRole("tab")).toHaveCount(5);
  });

  for (const language of ["en", "zh-CN"]) for (const width of [1440, 820, 560, 390, 320]) test(`terminal layout, all themes and search at ${width}px (${language})`, async testContext => {
    const { page, connections, messages } = await fixture(testContext, { width, language, height: width <= 560 ? 640 : 900 });
    const zh = language === "zh-CN";
    const before = connections.length;
    for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["dark", "light"]) {
      await page.evaluate(preference => globalThis.window.__terminalAppearance(preference), { scheme, mode });
      await expect(page.locator(".terminal-connection")).toContainText(zh ? "已连接" : "Connected");
      const measure = () => page.evaluate(() => {
        const frame = globalThis.document.querySelector(".workspace-terminal-frame").getBoundingClientRect();
        const screen = globalThis.document.querySelector(".xterm-screen").getBoundingClientRect();
        return { overflow: globalThis.document.documentElement.scrollWidth > globalThis.innerWidth, frameRight: frame.right, screenRight: screen.right, screenHeight: screen.height };
      });
      await expect.poll(async () => { const layout = await measure(); return !layout.overflow && layout.screenRight <= layout.frameRight + 1 && layout.screenHeight > 100; }, { message: `${scheme}/${mode} terminal fits viewport` }).toBe(true);
      if (zh && [1440, 390].includes(width)) await page.screenshot({ path: `${artifacts}after-${width}-${scheme}-${mode}.png` });
    }
    assert.equal(connections.length, before);
    await page.evaluate(() => globalThis.window.__terminalAppearance({ scheme: "neon", mode: "dark" }));
    await page.screenshot({ path: `${artifacts}after-${width}-${language}.png` });
    await page.getByRole("button", { name: zh ? "搜索输出" : "Search output", exact: true }).click();
    const search = page.getByRole("textbox", { name: zh ? "搜索已加载的输出" : "Search loaded output" });
    await expect(search).toBeFocused();
    await search.fill("kernel");
    await search.press("Enter");
    await search.press("Shift+Enter");
    if (zh && [1440, 390].includes(width)) await page.screenshot({ path: `${artifacts}after-search-${width}.png` });
    if (width <= 560) {
      const tools = page.locator(".terminal-toolbar button:visible, .terminal-search button:visible, .workspace-terminal-new-tab");
      for (const button of await tools.all()) {
        const bounds = await button.boundingBox();
        assert.ok(bounds.width >= 44 && bounds.height >= 44, JSON.stringify(bounds));
      }
      await page.getByRole("button", { name: zh ? "更多终端工具" : "More terminal tools", exact: true }).click();
      await expect(page.getByRole("button", { name: zh ? "粘贴" : "Paste", exact: true })).toBeVisible();
      await expect.poll(() => page.locator(".terminal-more-menu").evaluate(menu => Array.from(menu.querySelectorAll("button")).every(button => globalThis.getComputedStyle(button).backgroundColor === "rgba(0, 0, 0, 0)")), { message: "Mobile actions use the themed menu surface instead of native button backgrounds" }).toBe(true);
      if (zh && width === 390) await page.screenshot({ path: `${artifacts}after-mobile-more.png` });
      await page.keyboard.press("Escape");
      await expect(page.locator(".terminal-more-menu")).toHaveCount(0);
      await page.setViewportSize({ width, height: 360 });
    }
    await search.press("Escape");
    await expect(page.locator(".xterm-helper-textarea").first()).toBeFocused();
    await expect.poll(() => messages.filter(message => message.type === "resize").length).toBeGreaterThan(0);
    assert.equal(connections.length, before);
  });
}
