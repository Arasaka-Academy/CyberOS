import { expect, test, type Page } from "@playwright/test";
import { fixtures, stamp } from "./fixtures.js";

async function stableDashboard(page: Page) {
  return page.evaluate(() => new Promise<boolean>((resolve) => {
    const start = performance.now();
    let previous = "";
    let stableSince = start;
    function sample() {
      const grid = document.querySelector(".management-dashboard-grid, .management-dashboard-static");
      if (!grid) return resolve(false);
      const bounds = grid.getBoundingClientRect();
      const boxes = [...grid.children].map(element => {
        const box = element.getBoundingClientRect();
        return { left: box.left, top: box.top, right: box.right, bottom: box.bottom };
      });
      const fits = boxes.every(box => box.left >= bounds.left - 1 && box.right <= bounds.right + 1);
      const overlaps = boxes.some((box, index) => boxes.slice(index + 1).some(other =>
        Math.min(box.right, other.right) - Math.max(box.left, other.left) > 1 &&
        Math.min(box.bottom, other.bottom) - Math.max(box.top, other.top) > 1));
      const signature = JSON.stringify(boxes);
      const now = performance.now();
      if (signature !== previous || !fits || overlaps) stableSince = now;
      previous = signature;
      if (now - stableSince >= 300) return resolve(true);
      if (now - start >= 3000) return resolve(false);
      requestAnimationFrame(sample);
    }
    requestAnimationFrame(sample);
  }));
}

for (const panel of ["docker", "virtualMachines", "network", "storage", "shares", "monitoring"]) {
  test(`${panel} cards settle without overlap after changing breakpoints`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.setViewportSize({ width: 1920, height: 900 });
    await fixtures(page);
    if (panel === "monitoring") {
      await page.route("**/api/monitoring/overview", route => route.fulfill({ json: {
        status: "unavailable", enabled: true, sampledAt: stamp, latest: [], collectors: [],
        retention: { rawMs: 0, minuteMs: 0, hourMs: 0, maxDatabaseBytes: 0, databaseBytes: 0, writesPaused: true }
      } }));
      await page.route("**/api/monitoring/query", route => {
        const { start, end } = route.request().postDataJSON();
        return route.fulfill({ json: { start, end, series: [] } });
      });
    }
    await page.goto(`/#/app/${panel}`);
    await expect(page.locator(`.workspace-stage[data-panel="${panel}"]`)).toBeVisible();
    await expect(page.locator(".management-dashboard-widget").first()).toBeVisible();
    for (const width of [1920, 1440, 820, 1440, 820, 390, 820, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await stableDashboard(page), `${panel} at ${width}px should stop moving and fit its container`).toBe(true);
    }
  });
}

test("Docker search retains its draft and desktop focus across dashboard breakpoints", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 900 });
  await fixtures(page);
  await page.goto("/#/app/docker");
  const search = page.locator(".docker-image-search input");
  await search.fill("unsaved image filter");
  for (const width of [1440, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await stableDashboard(page)).toBe(true);
    await expect(search).toHaveValue("unsaved image filter");
    await expect(search).toBeFocused();
  }
  for (const width of [820, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await stableDashboard(page)).toBe(true);
    await expect(search).toHaveValue("unsaved image filter");
  }
});

test("resized dashboard cards persist independently and can be reset", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1920, height: 900 });
  await fixtures(page);
  await page.goto("/#/app/docker");
  const card = page.locator('.react-grid-item:has([data-widget-id="metric-containers"])');
  await expect(card).toBeVisible();
  expect(await stableDashboard(page)).toBe(true);
  const initialHeight = (await card.boundingBox())!.height;
  await page.locator(".management-layout-controls button").click();
  const handle = card.locator(".react-resizable-handle-se");
  await expect(handle).toBeVisible();
  const box = (await handle.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2 + 42, { steps: 5 });
  await page.mouse.up();
  await expect.poll(async () => (await card.boundingBox())!.height).toBeGreaterThan(initialHeight);
  expect(await stableDashboard(page)).toBe(true);
  const savedHeight = (await card.boundingBox())!.height;
  await page.reload();
  await expect(card).toBeVisible();
  expect(await stableDashboard(page)).toBe(true);
  expect((await card.boundingBox())!.height).toBe(savedHeight);
  await page.setViewportSize({ width: 1440, height: 900 });
  expect(await stableDashboard(page)).toBe(true);
  expect((await card.boundingBox())!.height).toBe(initialHeight);
  await page.setViewportSize({ width: 1920, height: 900 });
  expect(await stableDashboard(page)).toBe(true);
  expect((await card.boundingBox())!.height).toBe(savedHeight);
  await page.locator(".management-layout-controls button").click();
  await page.locator(".management-layout-controls button").first().click();
  await expect.poll(async () => (await card.boundingBox())!.height).toBe(initialHeight);
});
