import { expect, test, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";

declare global {
  interface Window {
    __settingsMotions: { duration: number; translate: string | undefined }[];
  }
}

async function settingsMotionCount(page: Page) {
  return page.evaluate(() => window.__settingsMotions.length);
}

for (const { width, reducedMotion } of [
  { width: 1440, reducedMotion: "no-preference" },
  { width: 390, reducedMotion: "no-preference" },
  { width: 390, reducedMotion: "reduce" }
] as const) {
  test(`settings preserves draft, focus and shell during content reveals at ${width}px with ${reducedMotion}`, async ({ page }, info) => {
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ reducedMotion });
    await fixtures(page);
    await page.addInitScript(() => {
      window.__settingsMotions = [];
      const nativeAnimate = Element.prototype.animate;
      Element.prototype.animate = function (frames, options) {
        const animation = nativeAnimate.call(this, frames, options);
        if (this.matches(".settings-detail") && animation.effect instanceof KeyframeEffect) {
          window.__settingsMotions.push({
            duration: Number(animation.effect.getTiming().duration),
            translate: animation.effect.getKeyframes()[0]?.translate as string | undefined
          });
        }
        return animation;
      };
    });
    await page.route("**/api/settings/model-provider", route => route.fulfill({ json: { settings: {
      providerName: "openai", model: "fixture-model", baseUrl: null, apiKeyConfigured: true, updatedAt: "2026-11-08T00:00:00Z"
    } } }));
    await page.goto("/");
    if (width < 1041) await page.locator('[data-app-id="settings"]').click();
    else await page.getByRole("button", { name: "System settings", exact: true }).click();
    await expect(page.locator(".settings-modal")).toBeVisible();
    const rail = await page.locator(".settings-rail").elementHandle();
    const header = await page.locator(width < 1041 ? ".mobile-settings-header" : ".settings-content-header").elementHandle();
    const section = async (label: string) => {
      if (width < 1041 && await page.locator(".settings-detail").count()) await page.locator(".mobile-app-back").click();
      await page.locator(".settings-nav button").filter({ hasText: new RegExp(`^${label}$`) }).click();
    };

    await section("Model Providers");
    const model = page.locator('input[placeholder="provider/model-name"]');
    await expect(model).toHaveValue("fixture-model");
    const modelNode = await model.elementHandle();
    const entered = await settingsMotionCount(page);
    await model.fill("unsaved-motion-draft");
    await expect(model).toBeFocused();
    expect(await modelNode?.evaluate(element => element.isConnected)).toBe(true);
    expect(await settingsMotionCount(page)).toBe(entered);

    await section("Appearance");
    await expect(page.locator(".appearance-picker")).toBeVisible();
    const beforeTheme = await settingsMotionCount(page);
    await page.locator('[data-theme-swatch="amber"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", "amber");
    expect(await settingsMotionCount(page)).toBe(beforeTheme);
    await section("Model Providers");
    await expect(model).toHaveValue("unsaved-motion-draft");
    expect(await rail?.evaluate(element => element.isConnected)).toBe(true);
    expect(await header?.evaluate(element => element.isConnected)).toBe(true);
    const motions = await page.evaluate(() => window.__settingsMotions);
    if (reducedMotion === "reduce") expect(motions).toEqual([]);
    else {
      expect(motions.length).toBeGreaterThanOrEqual(3);
      expect(motions.every(motion => motion.duration === 160 && motion.translate === undefined)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator(".settings-detail").evaluate(async element => {
      await Promise.allSettled(element.getAnimations().map(animation => animation.finished));
    });
    await page.screenshot({ path: info.outputPath("settings-content-ready.png") });
    if (width >= 1041) {
      await page.keyboard.press("Escape");
      await expect(page.locator(".settings-modal")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "System settings", exact: true })).toBeFocused();
    }
    expect(errors).toEqual([]);
  });
}
