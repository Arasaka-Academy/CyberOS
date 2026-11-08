import { expect, test } from "@playwright/test";
import { fixtures } from "./fixtures.js";

test("photos are usable while the metadata catalog is still loading", async ({ page }) => {
  await fixtures(page);
  let releaseCatalog!: () => void;
  const catalog = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/photos/metadata/fields");
  await page.route("**/api/photos/metadata/fields?*", async (route) => {
    await catalog;
    await route.fulfill({ json: { fields: [{ key: "exif.ISO", valueType: "number", count: 80, sensitive: false }] } });
  });
  try {
    await page.goto("/#/app/photos");
    await requested;
    await expect(page.locator(".photo-tile")).toHaveCount(80, { timeout: 2_000 });
    await expect(page.locator(".photo-library")).not.toHaveAttribute("aria-busy", "true");
    await page.locator(".photo-tile").first().click();
    await expect(page.locator(".photo-lightbox")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator(".photo-filter-trigger").click();
    const addCondition = page.getByRole("button", { name: "Add condition", exact: true });
    await expect(addCondition).toBeDisabled();
    releaseCatalog();
    await expect(addCondition).toBeEnabled();
    await addCondition.click();
    await expect(page.locator(".photo-condition-field")).toContainText("exif.ISO");
  } finally {
    releaseCatalog();
  }
});

test("a failed metadata catalog keeps the photo timeline available", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/photos/metadata/fields?*", (route) => route.fulfill({
    status: 503,
    json: { error: "Metadata catalog unavailable" }
  }));
  await page.goto("/#/app/photos");
  await expect(page.locator(".photo-tile")).toHaveCount(80);
  await expect(page.locator(".photo-library")).not.toHaveAttribute("aria-busy", "true");
  await expect(page.locator(".photo-library [role='alert']")).toHaveCount(0);
  await expect(page.getByText("Metadata catalog unavailable", { exact: true })).toBeVisible();
});

test("leaving photos cancels a pending metadata catalog request", async ({ page }) => {
  await fixtures(page);
  let releaseCatalog!: () => void;
  const catalog = new Promise<void>((resolve) => { releaseCatalog = resolve; });
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname === "/api/photos/metadata/fields");
  await page.route("**/api/photos/metadata/fields?*", async (route) => {
    await catalog;
    await route.fulfill({ json: { fields: [] } }).catch(() => undefined);
  });
  try {
    await page.goto("/#/app/photos");
    await requested;
    const cancelled = page.waitForEvent("requestfailed", {
      predicate: (request) => new URL(request.url()).pathname === "/api/photos/metadata/fields",
      timeout: 2_000
    });
    await page.locator(".workspace-panel-tab").first().click();
    expect((await cancelled).failure()?.errorText).toContain("ERR_ABORTED");
    await expect(page.locator(".file-browser")).toBeVisible();
  } finally {
    releaseCatalog();
  }
});

test("photos request nearby thumbnails and load more when scrolled into view", async ({ page }) => {
  await fixtures(page);
  const thumbnails = new Set<string>();
  page.on("request", (request) => {
    if (new URL(request.url()).pathname.endsWith("/thumbnail")) thumbnails.add(request.url());
  });
  await page.goto("/#/app/photos");
  await expect(page.locator(".photo-tile")).toHaveCount(80);
  await expect.poll(() => page.locator(".photo-tile img").first().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
  expect(thumbnails.size).toBeLessThan(40);
  await page.locator(".photo-tile").last().scrollIntoViewIfNeeded();
  await expect.poll(() => page.locator(".photo-tile img").last().evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
});

test("leaving photos cancels unfinished thumbnail downloads", async ({ page }) => {
  await fixtures(page);
  let releaseThumbnails!: () => void;
  const thumbnails = new Promise<void>((resolve) => { releaseThumbnails = resolve; });
  const requested = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/thumbnail"));
  await page.route("**/api/photos/*/thumbnail", async (route) => {
    await thumbnails;
    await route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" />' }).catch(() => undefined);
  });
  try {
    await page.goto("/#/app/photos");
    const request = await requested;
    const cancelled = page.waitForEvent("requestfailed", {
      predicate: (failed) => failed.url() === request.url(),
      timeout: 2_000
    });
    await page.locator(".workspace-panel-tab").first().click();
    expect((await cancelled).failure()?.errorText).toContain("ERR_ABORTED");
    await expect(page.locator(".file-browser")).toBeVisible();
  } finally {
    releaseThumbnails();
  }
});
