import { test, expect, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";
import type { TerminalTabState } from "../../packages/shared/src/types";

const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];
const storageKey = "cyberos:appearance:v1";

async function expectTheme(page: Page, scheme: string, mode: string) {
  await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
  await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
  await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
  expect(await page.evaluate(() => getComputedStyle(document.documentElement).colorScheme)).toBe(mode);
}

async function readable(page: Page, selector: string) {
  const ratios = await page.locator(selector).evaluateAll(elements => elements.map(element => {
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
    const over = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3]! / 255 + back[index]! * (1 - front[3]! / 255)).concat(255);
    const ancestors: Element[] = []; for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
    let background = ancestors.reduce((color, node) => over(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255, 255]);
    const decoration = element.querySelector("[data-slot='decoration']");
    if (decoration) background = over(rgba(getComputedStyle(decoration, "::after").backgroundColor), background);
    const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
    const a = luminance(over(rgba(getComputedStyle(element).color), background)), b = luminance(background);
    return { text: element.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  }));
  expect(ratios.length).toBeGreaterThan(0);
  for (const result of ratios) expect(result.ratio, result.text ?? selector).toBeGreaterThanOrEqual(4.5);
}

async function appearanceSettings(page: Page) {
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  await page.locator(".settings-nav button").filter({ hasText: /^Appearance$/ }).click();
  await expect(page.locator(".appearance-picker")).toBeVisible();
}

for (const scheme of schemes) {
  test(`${scheme}: both modes preserve the application and survive refresh`, async ({ page }, info) => {
    const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width: 1440, height: 900 }); await fixtures(page); await page.goto("/");
    const composer = page.locator(".composer textarea"); await composer.fill("Theme switching keeps this draft / 外观切换保留草稿");
    const opened = await page.evaluate(() => JSON.stringify((window.EventSource as unknown as { opened: object }).opened));
    await appearanceSettings(page);
    await page.locator(`[data-theme-swatch="${scheme}"]`).click();
    for (const mode of ["dark", "light"]) {
      await page.getByRole("button", { name: mode === "dark" ? "Dark" : "Light", exact: true }).click();
      await expectTheme(page, scheme, mode);
      await readable(page, ".settings-section-card h3");
      await expect(page.locator(`[data-theme-swatch="${scheme}"]`)).toHaveAttribute("aria-pressed", "true");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const close of await page.locator(".app-notification button").all()) await close.click();
      await page.screenshot({ path: info.outputPath(`${scheme}-${mode}.png`) });
    }
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("cyberos:appearance:v1")!))).toEqual({ scheme, mode: "light" });
    await page.locator(".settings-content-header button").click();
    await expect(composer).toHaveValue("Theme switching keeps this draft / 外观切换保留草稿");
    expect(await page.evaluate(() => JSON.stringify((window.EventSource as unknown as { opened: object }).opened))).toBe(opened);
    await page.reload(); await expectTheme(page, scheme, "light");
    expect(errors).toEqual([]);
  });
}

test("all themes keep mobile files, text and composer usable", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 }); await fixtures(page, "zh-CN"); await page.goto("/#/app/agent");
  await page.locator(".composer textarea").fill("移动草稿");
  await page.locator(".mobile-app-home:visible").click();
  await page.locator('[data-app-id="settings"]').click();
  await page.locator(".settings-nav button").filter({ hasText: /^外观$/ }).click();
  for (const scheme of schemes) for (const mode of ["dark", "light"]) {
    await page.locator(`[data-theme-swatch="${scheme}"]`).click();
    await page.getByRole("button", { name: mode === "dark" ? "深色" : "浅色", exact: true }).click();
    await expectTheme(page, scheme, mode); await readable(page, ".settings-section-card h3");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.locator(".mobile-app-home:visible").click(); await page.locator('[data-app-id="files"]').click();
  await expect(page.locator(".file-row:not(.file-row-head)")).toHaveCount(100);
  await readable(page, ".file-name-text");
  for (const close of await page.locator(".app-notification button").all()) await close.click();
  await page.screenshot({ path: info.outputPath("mobile-amber-light-files.png") });
  await page.locator(".mobile-app-home:visible").click(); await page.locator('[data-app-id="agent"]').click();
  await expect(page.locator(".composer textarea")).toHaveValue("移动草稿");
  expect(await page.locator(".composer textarea").evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
});

for (const locale of ["en", "zh-CN"] as const) for (const width of [390, 320]) {
  test(`file selection remains readable in all themes at ${width}px (${locale})`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: width === 320 ? 568 : 844 });
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fixtures(page, locale); await page.goto("/#/app/files");
    await expect(page.locator(".file-row:not(.file-row-head)")).toHaveCount(100);
    for (const close of await page.locator(".app-notification button").all()) await close.click();
    const select = page.locator(".mobile-file-select");
    for (const scheme of schemes) for (const mode of ["dark", "light"]) {
      await page.evaluate(({ scheme, mode, key }) => {
        const value = JSON.stringify({ scheme, mode }); localStorage.setItem(key, value);
        window.dispatchEvent(new StorageEvent("storage", { key, newValue: value }));
      }, { scheme, mode, key: storageKey });
      await expectTheme(page, scheme, mode);
      await select.click(); await expect(select).toHaveAttribute("aria-pressed", "true");
      await page.mouse.move(0, 0);
      await readable(page, ".mobile-file-select");
      await page.locator(".mobile-file-checkbox").first().check();
      await expect(page.locator(".file-batch-toolbar")).toBeVisible();
      if (scheme === "neon") await page.screenshot({ path: info.outputPath(`file-selection-${mode}.png`) });
      await select.click(); await expect(select).toHaveAttribute("aria-pressed", "false");
      await expect(page.locator(".mobile-file-checkbox")).toHaveCount(0);
      await expect(page.locator(".file-batch-toolbar")).toHaveCount(0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test("same-origin tabs synchronize preference without reloading", async ({ page, context }) => {
  await fixtures(page); await page.goto("/");
  const peer = await context.newPage(); await fixtures(peer); await peer.goto("/");
  await appearanceSettings(page); await page.locator('[data-theme-swatch="terminal"]').click(); await page.getByRole("button", { name: "Light", exact: true }).click();
  await expectTheme(peer, "terminal", "light");
  await peer.evaluate(key => localStorage.removeItem(key), storageKey);
  await expectTheme(page, "neon", "dark");
  await peer.close();
});

test("TV themes synchronize with native controls and Escape restores focus", async ({ page }, info) => {
  await page.setViewportSize({ width: 1920, height: 1080 }); await fixtures(page, "en");
  const commands: { type: string; scheme: string; mode: string }[] = [];
  await page.route("**/api/vod-player/command", route => { commands.push(route.request().postDataJSON()); return route.fulfill({ json: { status: null } }); });
  await page.goto("/tv/");
  const trigger = page.getByRole("button", { name: "Appearance", exact: true }); await trigger.click();
  await expect(page.getByRole("dialog")).toBeVisible();
  for (const scheme of schemes) for (const mode of ["dark", "light"]) {
    await page.locator(`[data-theme-swatch="${scheme}"]`).click();
    await page.getByRole("button", { name: mode === "dark" ? "Dark" : "Light", exact: true }).click();
    await expectTheme(page, scheme, mode);
    await expect.poll(() => commands.at(-1)).toEqual({ type: "set-ui-theme", scheme, mode });
    expect(await page.getByRole("button", { name: "Light", exact: true }).evaluate(node => node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(48);
    if (scheme === "neon") await page.screenshot({ path: info.outputPath(`tv-${mode}.png`) });
  }
  await page.keyboard.press("Escape");
  // The first Escape may dismiss a visible tooltip; the next closes the dialog.
  if (await page.getByRole("dialog").count()) await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0); await expect(trigger).toBeFocused();
  expect(commands.every(command => command.type === "set-ui-theme")).toBe(true);
});

test("terminal changes palette without replacing its socket or losing input", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixtures(page);
  const state: TerminalTabState = { initialized: true, activeTabId: "appearance-terminal", maxSessions: 32, tabs: [{ id: "appearance-terminal", ordinal: 1, customTitle: "Theme continuity", createdAt: "2026-11-06T00:00:00Z", updatedAt: "2026-11-06T00:00:00Z" }] };
  await page.route("**/api/terminal/tabs", route => route.fulfill({ json: state }));
  let connections = 0, closures = 0;
  const inputs: string[] = [];
  await page.routeWebSocket("**/api/terminal", socket => {
    connections++;
    socket.send(JSON.stringify({ type: "ready", sessionId: state.activeTabId }));
    socket.send(JSON.stringify({ type: "output", data: "Terminal theme continuity\r\n$ " }));
    socket.onMessage(raw => {
      const message = JSON.parse(String(raw)) as { type: string; data?: string };
      if (message.type === "input" && message.data) {
        inputs.push(message.data);
        socket.send(JSON.stringify({ type: "output", data: message.data }));
      }
    });
    socket.onClose(() => { closures++; });
  });
  await page.goto("/");
  await page.getByRole("button", { name: "Terminal", exact: true }).click();
  const screen = page.locator(".workspace-terminal .xterm-screen");
  const surface = page.locator(".workspace-terminal .xterm-scrollable-element");
  await expect(screen).toBeVisible();
  const opened = connections, closed = closures;
  expect(opened).toBeGreaterThan(0);
  await appearanceSettings(page);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  const lightBackground = await surface.evaluate(node => getComputedStyle(node).backgroundColor);
  await page.getByRole("button", { name: "Dark", exact: true }).click();
  await expect.poll(() => surface.evaluate(node => getComputedStyle(node).backgroundColor)).not.toBe(lightBackground);
  await page.getByRole("button", { name: "Light", exact: true }).click();
  await page.locator(".settings-content-header button").click();
  await screen.click();
  await page.keyboard.type("theme-alive");
  await expect.poll(() => inputs.join("")).toContain("theme-alive");
  expect(connections).toBe(opened);
  expect(closures).toBe(closed);
});

test("the initial loading surface restores all saved themes before the app module loads", async ({ page }) => {
  await page.route("**/src/main.tsx", route => route.abort());
  await page.goto("/");
  for (const scheme of schemes) for (const mode of ["dark", "light"]) {
    await page.evaluate(preference => localStorage.setItem("cyberos:appearance:v1", JSON.stringify(preference)), { scheme, mode });
    await page.reload();
    await expectTheme(page, scheme, mode);
    await expect(page.locator("#cyberos-boot")).toBeVisible();
    const background = await page.locator("#cyberos-boot").evaluate(node => {
      const probe = document.createElement("span"); probe.style.background = "var(--cyber-bg)"; document.body.append(probe);
      const colors = { actual: getComputedStyle(node).backgroundColor, expected: getComputedStyle(probe).backgroundColor }; probe.remove(); return colors;
    });
    expect(background.actual).toBe(background.expected);
  }
});
