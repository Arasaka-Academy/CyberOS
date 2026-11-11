import { expect, test } from "@playwright/test";
import { fixtures } from "./fixtures.js";

const downloadModule = /\/HttpDownloaderPanel(?:\.tsx|-[A-Za-z0-9_-]+\.js)(?:\?|$)/;

for (const width of [1440, 390]) {
  test(`a missing download module preserves navigation and drafts at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await fixtures(page, "zh-CN");
    await page.route(downloadModule, route => route.fulfill({ status: 404, body: "Not Found" }));
    await page.goto(`${process.env.CYBEROS_MODULE_TEST_BASE_URL ?? ""}/#/app/agent`, { waitUntil: "domcontentloaded" });
    const draft = page.locator(".composer textarea");
    await draft.fill("尚未发送的草稿");
    await page.evaluate(() => { window.location.hash = "/app/downloads"; });

    const panel = page.locator('.workspace-stage[data-panel="downloads"]');
    await expect(panel.getByRole("alert")).toContainText("面板加载失败");
    await expect(panel.getByRole("button", { name: "重新加载页面" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("missing-module.png") });
    if (width > 1040) {
      await page.locator('.workspace-panel-rail button[data-tooltip="文件"]').click();
    } else {
      await page.locator(".mobile-app-home:visible").click();
      await page.locator('[data-app-id="files"]').click();
    }
    await expect(page.locator(".file-browser")).toBeVisible();
    await page.evaluate(() => { window.location.hash = "/app/agent"; });
    await expect(draft).toHaveValue("尚未发送的草稿");

    await page.evaluate(() => { window.location.hash = "/app/downloads"; });
    await expect(panel.getByRole("button", { name: "重新加载页面" })).toBeVisible();
    await page.unroute(downloadModule);
    await panel.getByRole("button", { name: "重新加载页面" }).click();
    await expect(page.locator(".workspace-panel-loading")).toHaveCount(0);
    await expect(page.locator(".http-downloader-panel")).toBeVisible();
    await expect(panel.getByRole("alert").filter({ hasText: "面板加载失败" })).toHaveCount(0);
  });
}

test("a terminal module that fails in the background preserves the current panel", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await fixtures(page);
  const terminalModule = /\/LocalTerminalPanel(?:\.tsx|-[A-Za-z0-9_-]+\.js)(?:\?|$)/;
  let releaseModule!: () => void;
  const heldModule = new Promise<void>(resolve => { releaseModule = resolve; });
  await page.route(terminalModule, async route => {
    await heldModule;
    await route.fulfill({ status: 404, body: "Not Found" });
  });
  await page.goto(`${process.env.CYBEROS_MODULE_TEST_BASE_URL ?? ""}/#/app/files`, { waitUntil: "domcontentloaded" });
  await expect(page.locator(".file-browser")).toBeVisible();
  const requestedModule = page.waitForRequest(terminalModule);
  await page.evaluate(() => { window.location.hash = "/app/terminal"; });
  await requestedModule;
  await page.evaluate(() => { window.location.hash = "/app/files"; });
  await expect(page.locator(".file-browser")).toBeVisible();
  const failedModule = page.waitForResponse(terminalModule);
  releaseModule();
  await failedModule;
  await expect(page.locator(".file-browser")).toBeVisible();
  await expect(page.locator("[data-panel-error]")).toHaveCount(0);
  await page.evaluate(() => { window.location.hash = "/app/terminal"; });
  await expect(page.locator('[data-panel-error="terminal"]')).toContainText("Unable to load this panel");
  await expect(page.getByRole("button", { name: "Reload page", exact: true })).toBeVisible();
});
