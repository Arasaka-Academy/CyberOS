import { expect, test, type Locator, type Page } from "@playwright/test";
import { fixtures, stamp } from "./fixtures";

const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];
const desktopViewports = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 1280, height: 720 },
  { width: 1041, height: 600 }
];
const railButtons = ".agent-list button, .workspace-panel-tab";

async function openNavigation(page: Page, { count = 6, unread = 0, scheme = "neon", mode = "dark" } = {}) {
  await fixtures(page, "zh-CN");
  await page.addInitScript(({ scheme, mode }) => {
    localStorage.setItem("cyberos:appearance:v1", JSON.stringify({ scheme, mode }));
  }, { scheme, mode });
  await page.route("**/api/sessions", route => route.fulfill({
    json: {
      sessions: Array.from({ length: count }, (_, index) => ({
        id: `rail-session-${index + 1}`,
        currentPath: ".",
        firstMessage: `会话 ${index + 1}`,
        lastMessage: null,
        pendingApprovalCount: index === 1 ? 12 : 0,
        createdAt: stamp,
        updatedAt: stamp
      }))
    }
  }));
  if (unread > 0) await page.route(/\/api\/notifications(?:\?|$)/u, route => route.fulfill({
    json: { notifications: [], bluetoothTransfers: [], unreadCount: unread, bluetoothUnreadCount: 0 }
  }));
  await page.goto("/");
  await expect(page.locator(".agent-list .session-item")).toHaveCount(count);
  await page.evaluate(() => document.fonts.ready);
}

async function dimensions(locator: Locator) {
  return locator.evaluateAll(elements => elements.map(element => {
    const bounds = element.getBoundingClientRect();
    return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
  }));
}

async function expectReadableRails(page: Page) {
  const readings = await page.locator(`${railButtons}, .agent-list .session-number, .agent-list .session-approval-badge, .agent-list .notification-badge`).evaluateAll(elements => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const context = canvas.getContext("2d")!;
    const rgba = (color: string) => {
      context.clearRect(0, 0, 1, 1);
      context.fillStyle = color;
      context.fillRect(0, 0, 1, 1);
      return [...context.getImageData(0, 0, 1, 1).data];
    };
    const composite = (front: number[], back: number[]) => front.slice(0, 3)
      .map((channel, index) => channel * front[3]! / 255 + back[index]! * (1 - front[3]! / 255)).concat(255);
    const luminance = (color: number[]) => color.slice(0, 3).map(channel => channel / 255)
      .map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4)
      .reduce((total, channel, index) => total + channel * [.2126, .7152, .0722][index]!, 0);

    return elements.map(element => {
      const ancestors: Element[] = [];
      for (let ancestor: Element | null = element; ancestor; ancestor = ancestor.parentElement) ancestors.unshift(ancestor);
      let background = [255, 255, 255, 255];
      for (const ancestor of ancestors) {
        background = composite(rgba(getComputedStyle(ancestor).backgroundColor), background);
        if (ancestor.matches(".agent-list button, .workspace-panel-tab")) {
          background = composite(rgba(getComputedStyle(ancestor, "::after").backgroundColor), background);
        }
      }
      const foreground = composite(rgba(getComputedStyle(element).color), background);
      const foregroundLuminance = luminance(foreground);
      const backgroundLuminance = luminance(background);
      return {
        label: element.getAttribute("aria-label") ?? element.className,
        ratio: (Math.max(foregroundLuminance, backgroundLuminance) + .05) / (Math.min(foregroundLuminance, backgroundLuminance) + .05)
      };
    });
  });
  expect(readings.length).toBeGreaterThan(10);
  for (const reading of readings) expect(reading.ratio, reading.label).toBeGreaterThanOrEqual(4.5);
}

for (const viewport of desktopViewports) {
  test(`desktop navigation stays centred inside 72px rails at ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await openNavigation(page);
    await page.screenshot({ path: info.outputPath("navigation.png") });

    for (const selector of [".agent-list", ".workspace-panel-rail"]) {
      const rail = page.locator(selector);
      const bounds = (await rail.boundingBox())!;
      expect(bounds.width).toBe(72);
      const buttons = await dimensions(rail.locator("button"));
      expect(buttons.length).toBeGreaterThan(0);
      for (const button of buttons) {
        expect(button.width).toBe(48);
        expect(button.height).toBe(selector === ".agent-list" ? 44 : 52);
        expect(button.left).toBeGreaterThanOrEqual(bounds.x);
        expect(button.left + button.width).toBeLessThanOrEqual(bounds.x + bounds.width);
        expect(Math.abs(button.left + button.width / 2 - bounds.x - bounds.width / 2)).toBeLessThanOrEqual(.5);
      }
      const faces = await rail.locator("button").evaluateAll(elements => elements.map(element => {
        const style = getComputedStyle(element, "::after");
        return { width: parseFloat(style.width), height: parseFloat(style.height) };
      }));
      for (const face of faces) expect(face).toEqual({ width: 46, height: selector === ".agent-list" ? 42 : 50 });
    }

    const baselines = await page.locator(".brand, .chat-header, .workspace-stage .app-titlebar").evaluateAll(elements => elements.map(element => element.getBoundingClientRect().bottom));
    expect(baselines).toEqual([70, 70, 70]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator(".agent-power-button")).toHaveAttribute("data-icon-only", "true");
  });
}

test("selection, hover and keyboard focus retain geometry and separate session badges", async ({ page }) => {
  await page.setViewportSize(desktopViewports[0]!);
  await openNavigation(page);
  const buttons = page.locator(railButtons);
  const initial = await dimensions(buttons);
  const session = page.locator(".agent-list .session-item").nth(1);
  await session.hover();
  expect(await dimensions(buttons)).toEqual(initial);
  await session.click();
  await expect(session).toHaveAttribute("aria-current", "page");
  expect(await dimensions(buttons)).toEqual(initial);
  await page.keyboard.press("Tab");
  await page.keyboard.press("Shift+Tab");
  await expect(session).toBeFocused();
  const focus = await session.evaluate(element => {
    const style = getComputedStyle(element);
    return { outlineWidth: style.outlineWidth, outlineOffset: style.outlineOffset, clipPath: style.clipPath };
  });
  expect(focus).toEqual({ outlineWidth: "2px", outlineOffset: "3px", clipPath: "none" });
  const number = (await session.locator(".session-number").boundingBox())!;
  const badge = (await session.locator(".session-approval-badge").boundingBox())!;
  expect(number.x + number.width).toBeLessThanOrEqual(badge.x);
  await expect(session.locator(".session-approval-badge")).toHaveText("9+");

  const power = page.locator(".agent-power-button");
  await power.click();
  await expect(page.locator(".power-dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator(".power-dialog")).not.toBeVisible();
  await expect(power).toBeFocused();
});

test("long session and panel lists scroll without moving the footer", async ({ page }) => {
  await page.setViewportSize({ width: 1041, height: 600 });
  await openNavigation(page, { count: 40 });
  const footer = await dimensions(page.locator(".agent-footer"));
  const lastSession = page.locator(".agent-list .session-item").last();
  await lastSession.focus();
  await expect(lastSession).toBeInViewport({ ratio: 1 });
  const sessionBounds = (await lastSession.boundingBox())!;
  const scrollBounds = (await page.locator(".agent-list .session-list").boundingBox())!;
  expect(sessionBounds.y + sessionBounds.height + 5).toBeLessThanOrEqual(scrollBounds.y + scrollBounds.height);
  await lastSession.press("Enter");
  await expect(lastSession).toHaveAttribute("aria-current", "page");
  expect(await dimensions(page.locator(".agent-footer"))).toEqual(footer);
  expect(await page.locator(".agent-list .session-list").evaluate(element => element.scrollTop)).toBeGreaterThan(0);

  const lastPanel = page.locator(".workspace-panel-tab").last();
  await lastPanel.focus();
  await expect(lastPanel).toBeInViewport({ ratio: 1 });
  expect(await page.locator(".workspace-panel-rail").evaluate(element => element.scrollTop)).toBeGreaterThan(0);
  await expect(page.locator(".agent-power-button")).toBeInViewport({ ratio: 1 });
});

test("initial loading preserves navigation headers and footer geometry", async ({ page }) => {
  await page.setViewportSize(desktopViewports[0]!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixtures(page, "zh-CN");
  let release: () => void = () => undefined;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/sessions", async route => {
    await pending;
    await route.fallback();
  });
  try {
    await page.goto("/");
    await expect(page.locator(".chat-loading")).toBeVisible();
    const selectors = ".agent-list .brand, .agent-list-head, .agent-footer, .agent-list .session-list";
    const loading = await dimensions(page.locator(selectors));
    release();
    await expect(page.locator(".agent-list .session-item")).toHaveCount(1);
    expect(await dimensions(page.locator(selectors))).toEqual(loading);
  } finally {
    release();
  }
});

test("reduced motion disables navigation face and state transitions", async ({ page }) => {
  await page.setViewportSize(desktopViewports[0]!);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openNavigation(page);
  const transitions = await page.locator(railButtons).evaluateAll(elements => elements.flatMap(element => [
    getComputedStyle(element).transitionDuration,
    getComputedStyle(element, "::before").transitionDuration,
    getComputedStyle(element, "::after").transitionDuration
  ]));
  for (const duration of transitions) expect(parseFloat(duration)).toBeLessThanOrEqual(.00001);
});

for (const scheme of schemes) {
  for (const mode of ["dark", "light"]) {
    test(`${scheme}/${mode}: navigation states and badges stay readable`, async ({ page }, info) => {
      await page.setViewportSize(desktopViewports[0]!);
      await openNavigation(page, { scheme, mode, unread: 12 });
      await expect(page.locator(".agent-notification-button .notification-badge")).toHaveText("12");
      await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
      await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
      await expectReadableRails(page);
      const session = page.locator(".agent-list .session-item").nth(1);
      await session.hover();
      await page.waitForTimeout(250);
      await expectReadableRails(page);
      await session.click();
      await session.focus();
      await page.waitForTimeout(250);
      await expectReadableRails(page);

      await page.locator(".agent-settings-button:not(.agent-playback-button)").evaluate(element => {
        element.setAttribute("aria-disabled", "true");
        element.setAttribute("aria-busy", "true");
      });
      await page.locator(".agent-list-head button").evaluate(element => { (element as HTMLButtonElement).disabled = true; });
      await page.waitForTimeout(250);
      await expectReadableRails(page);
      await page.screenshot({ path: info.outputPath(`${scheme}-${mode}.png`) });
    });
  }
}

for (const width of [1040, 390]) {
  test(`desktop rails remain hidden below the mobile breakpoint at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await fixtures(page, "zh-CN");
    await page.goto("/#/app/agent");
    await expect(page.locator(".composer textarea")).toBeVisible();
    await expect(page.locator(".agent-list")).toHaveCount(0);
    await expect(page.locator(".workspace-panel-rail")).not.toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: info.outputPath("mobile.png") });
  });
}
