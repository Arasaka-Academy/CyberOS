import { test, expect, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";
import { SETTINGS_SECTIONS, type SettingsSectionId } from "../../packages/web/src/config/settings";

const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];
const viewports = [{ width: 1440, height: 900 }, { width: 1366, height: 768 }, { width: 1280, height: 720 }, { width: 1041, height: 600 }, { width: 1040, height: 600 }, { width: 390, height: 844 }];

async function selectSection(page: Page, section: SettingsSectionId) {
  if (!await page.locator(".settings-nav").isVisible()) await page.locator(".mobile-app-back:visible").click();
  await page.locator(".settings-nav button").nth(SETTINGS_SECTIONS.findIndex(item => item.id === section)).click();
}

for (const locale of ["en", "zh-CN"]) for (const viewport of viewports) {
  test(`loading shell and local settings remain stable across all themes: ${locale} ${viewport.width}x${viewport.height}`, async ({ page }, info) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await fixtures(page, locale);
    const provider = { providerName: "openai", model: "fixture-model", baseUrl: null, apiKeyConfigured: true, updatedAt: "2026-11-08T00:00:00.000Z" };
    await page.route("**/api/settings/model-provider", route => route.fulfill({ json: { settings: provider } }));
    await page.goto(viewport.width <= 1040 ? "/#/app/settings" : "/");
    if (viewport.width > 1040) {
      await expect(page.locator(".composer textarea")).toBeVisible();
    } else await expect(page.locator(".settings-nav")).toBeVisible();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    await page.route(/\/components\/settings\/SettingsContent\.tsx(?:\?|$)/, async route => { await gate; await route.continue(); });
    await page.route("**/api/settings/model-provider", async route => { await gate; await route.fulfill({ json: { settings: provider } }); });
    try {
      if (viewport.width > 1040) await page.getByRole("button", { name: locale === "en" ? "System settings" : "系统设置", exact: true }).click();
      await selectSection(page, "model-providers");
      const shell = page.locator(".settings-modal");
      const initial = await shell.boundingBox();
      for (const scheme of schemes) for (const mode of ["dark", "light"]) {
        await page.evaluate(({ scheme, mode }) => {
          const key = "cyberos:appearance:v1";
          const newValue = JSON.stringify({ scheme, mode });
          localStorage.setItem(key, newValue);
          window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
        }, { scheme, mode });
        await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
        await expect(page.locator("html")).toHaveAttribute("data-cyber-mode", mode);
        await expect(page.locator('.settings-content [role="status"][aria-label]')).toBeVisible();
        await page.screenshot({ path: info.outputPath(`pending-${scheme}-${mode}.png`) });
        await selectSection(page, "appearance");
        await expect(page.locator(".appearance-picker")).toBeVisible();
        expect(await shell.boundingBox()).toEqual(initial);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        await selectSection(page, "model-providers");
      }
      release();
      await expect(page.locator('input[placeholder="provider/model-name"]')).toHaveValue(provider.model);
      expect(await shell.boundingBox()).toEqual(initial);
      await page.screenshot({ path: info.outputPath("ready-provider.png") });
    } finally { release(); }
  });
}
