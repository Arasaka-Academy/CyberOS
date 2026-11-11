import { expect, test } from "@playwright/test";
import { fixtures } from "./fixtures.js";

async function appearance(page: import("@playwright/test").Page, scheme: string, mode: string) {
  await page.evaluate(({ scheme, mode }) => {
    const key = "cyberos:appearance:v1";
    const newValue = JSON.stringify({ scheme, mode });
    localStorage.setItem(key, newValue);
    window.dispatchEvent(new StorageEvent("storage", { key, newValue }));
  }, { scheme, mode });
  await expect(page.locator(".cyberos-ui-root")).toHaveAttribute("data-scheme", scheme);
  await expect(page.locator(".cyberos-ui-root")).toHaveAttribute("data-mode", mode);
}

test("month and year selection, Today and a bounded Tab cycle work without submitting filters", async ({ page }) => {
  const { field, calendar } = await openFileDates(page);
  await calendar.getByRole("button", { name: "November 2026 · Choose month and year" }).click();
  await calendar.getByRole("spinbutton", { name: "Year", exact: true }).fill("2024");
  await calendar.getByRole("button", { name: "Feb", exact: true }).click();
  await calendar.locator('[data-date="2024-02-29"]').click();
  await expect(field.getByRole("textbox")).toHaveValue("2024-02-29");
  await field.getByRole("button").click();
  await calendar.getByRole("button", { name: "Today", exact: true }).focus();
  await page.keyboard.press("Tab");
  await expect(calendar.getByRole("button", { name: "Previous month", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(calendar.getByRole("button", { name: "Today", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(field.getByRole("textbox")).toHaveValue("2026-11-11");
});

test("photo date selection leaves the surrounding filters open", async ({ page }) => {
  await fixtures(page);
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00"));
  await page.goto("/#/app/photos");
  await page.locator(".photo-filter-trigger").click();
  const field = page.locator(".photo-date-filter .date-picker").first();
  await field.getByRole("button").click();
  await page.locator('[data-cyber-date-picker-panel] [data-date="2026-11-10"]').click();
  await expect(field.getByRole("textbox")).toHaveValue("2026-11-10");
  await expect(page.locator(".photo-filter-menu")).toBeVisible();
});

test("NVR disables future dates and clearing its required date", async ({ page }) => {
  await fixtures(page);
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00"));
  await page.route("**/api/nvr", route => route.fulfill({ json: { devices: [], usedBytes: 0, policy: { quotaBytes: 1000, retentionDays: 7 }, heartbeatAt: null } }));
  await page.goto("/#/app/nvr");
  await page.getByRole("tab", { name: "Playback", exact: true }).click();
  const field = page.locator(".nvr-filters .date-picker");
  await field.getByRole("button").click();
  const calendar = page.locator("[data-cyber-date-picker-panel]");
  await expect(calendar.locator('[data-date="2026-11-12"]')).toBeDisabled();
  await expect(calendar.getByRole("button", { name: "Next month", exact: true })).toBeDisabled();
  await expect(calendar.getByRole("button", { name: "Clear", exact: true })).toBeDisabled();
  await page.keyboard.press("ArrowRight");
  await expect(calendar.locator('[data-date="2026-11-11"]')).toBeFocused();
  await calendar.locator('[data-date="2026-11-10"]').click();
  await expect(field.getByRole("textbox")).toHaveValue("2026-11-10");
});

test("date-time selection stays inside the incident dialog and keeps local hours", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00"));
  const stamp = "2026-11-11T00:00:00.000Z";
  const incident = { id: "incident-date", source: "metric", ruleId: "cpu", healthAlertId: null, seriesKey: "cpu", labels: {}, status: "firing", severity: "warning", title: "CPU warning", currentValue: .95, firingAt: stamp, resolvedAt: null, closeReason: null, acknowledgedAt: stamp, readAt: stamp, createdAt: stamp, updatedAt: stamp, occurrenceCount: 1 };
  await page.route("**/api/monitoring/alerts/incidents*", route => route.fulfill({ json: { incidents: [incident] } }));
  await page.route("**/api/monitoring/alerts/incidents/incident-date", route => route.fulfill({ json: { incident, events: [], deliveries: [], ruleSnapshot: {}, policySnapshot: null } }));
  await page.goto("/#/app/monitoring");
  await page.getByRole("tab", { name: "Incidents", exact: true }).click();
  await page.getByRole("button", { name: "Silence", exact: true }).click();
  const dialog = page.locator(".monitoring-incident-detail-dialog");
  const field = dialog.locator(".date-picker").first();
  await field.getByRole("button").click();
  const calendar = page.locator("[data-cyber-date-picker-panel]");
  await calendar.locator('[data-date="2026-11-12"]').click();
  await calendar.getByRole("spinbutton", { name: "Hours", exact: true }).fill("18");
  await calendar.getByRole("spinbutton", { name: "Minutes", exact: true }).fill("35");
  await page.screenshot({ path: info.outputPath("datetime-mobile.png") });
  await calendar.getByRole("button", { name: "Done", exact: true }).click();
  await expect(field.getByRole("textbox")).toHaveValue("2026-11-12 18:35");
  await expect(dialog).toBeVisible();
  await expect(field.getByRole("button")).toBeFocused();
  await field.getByRole("button").click();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(dialog).toBeVisible();
});

test("calendar fits a short landscape viewport and closes on outside click", async ({ page }) => {
  await page.setViewportSize({ width: 560, height: 390 });
  const { calendar } = await openFileDates(page);
  const box = (await calendar.boundingBox())!;
  expect(box.y).toBeGreaterThanOrEqual(8);
  expect(box.y + box.height).toBeLessThanOrEqual(382);
  await calendar.getByRole("button", { name: "Today", exact: true }).scrollIntoViewIfNeeded();
  await expect(calendar.getByRole("button", { name: "Today", exact: true })).toBeInViewport();
  await page.mouse.click(2, 2);
  await expect(calendar).toHaveCount(0);
});

async function openFileDates(page: import("@playwright/test").Page, locale = "en") {
  await fixtures(page, locale);
  await page.clock.setFixedTime(new Date("2026-11-11T12:00:00"));
  await page.goto("/#/app/files");
  await page.locator(".workspace-search-filter-trigger").click();
  const field = page.locator(".workspace-search-filter-menu .date-picker").first();
  await field.getByRole("button").click();
  return { field, calendar: page.locator("[data-cyber-date-picker-panel]") };
}

test("choosing a date updates the file filter and keeps its parent popover open", async ({ page }) => {
  const { field, calendar } = await openFileDates(page);
  await expect(calendar).toBeVisible();
  await calendar.locator('[data-date="2026-11-12"]').click();
  await expect(calendar).toHaveCount(0);
  await expect(field.getByRole("textbox")).toHaveValue("2026-11-12");
  await expect(page.locator(".workspace-search-filter-menu")).toBeVisible();
  await expect(field.getByRole("button")).toBeFocused();
  await field.getByRole("button").click();
  await page.locator("[data-cyber-date-picker-panel]").getByRole("button", { name: "Clear", exact: true }).click();
  await expect(field.getByRole("textbox")).toHaveValue("");
});

test("calendar keyboard navigation and Escape preserve the filter draft and restore focus", async ({ page }) => {
  const { field, calendar } = await openFileDates(page);
  await expect(calendar.locator('[data-date="2026-11-11"]')).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(calendar.locator('[data-date="2026-11-12"]')).toBeFocused();
  await page.keyboard.press("PageDown");
  await expect(calendar.locator('[data-date="2026-12-12"]')).toBeFocused();
  await page.keyboard.press("Home");
  await expect(calendar.locator('[data-date="2026-12-06"]')).toBeFocused();
  await page.keyboard.press("End");
  await expect(calendar.locator('[data-date="2026-12-12"]')).toBeFocused();
  await page.keyboard.press("Shift+PageDown");
  await expect(calendar.locator('[data-date="2027-12-12"]')).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(calendar).toHaveCount(0);
  await expect(page.locator(".workspace-search-filter-menu")).toBeVisible();
  await expect(field.getByRole("textbox")).toHaveValue("");
  await expect(field.getByRole("button")).toBeFocused();
});

test("selected dates and keyboard focus use each theme's semantic colors", async ({ page }) => {
  const { field, calendar } = await openFileDates(page);
  await calendar.locator('[data-date="2026-11-12"]').click();
  await field.getByRole("button").click();
  const day = calendar.locator('[data-date="2026-11-12"]');
  await day.hover();
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) {
    for (const mode of ["dark", "light"]) {
      await appearance(page, scheme, mode);
      await expect.poll(() => day.evaluate(element => {
        const sample = document.createElement("span");
        element.append(sample);
        sample.style.color = "var(--cyber-on-accent)";
        sample.style.backgroundColor = "var(--cyber-accent)";
        const actual = getComputedStyle(element);
        const tokens = getComputedStyle(sample);
        const matches = actual.color === tokens.color && actual.backgroundColor === tokens.backgroundColor;
        sample.remove();
        return matches;
      })).toBe(true);
      await page.keyboard.press("ArrowRight");
      await expect(calendar.locator('[data-date="2026-11-13"]')).toBeFocused();
      await page.keyboard.press("ArrowLeft");
      await expect(day).toBeFocused();
    }
  }
});

test("typed dates reject impossible days and keep leap days as local calendar values", async ({ page }) => {
  const { field, calendar } = await openFileDates(page);
  await page.keyboard.press("Escape");
  const input = field.getByRole("textbox");
  await input.fill("2025-02-29");
  await input.press("Tab");
  await expect(input).toHaveAttribute("aria-invalid", "true");
  await input.fill("2024-02-29");
  await input.press("Tab");
  await expect(input).not.toHaveAttribute("aria-invalid", "true");
  await field.getByRole("button").click();
  await expect(calendar.getByRole("gridcell", { selected: true }).locator('[data-date="2024-02-29"]')).toBeVisible();
});

for (const width of [1440, 820, 560, 390, 320]) {
  for (const locale of ["en", "zh-CN"]) {
    test(`calendar fits ${width}px in ${locale} with both theme modes`, async ({ page }, info) => {
      await page.setViewportSize({ width, height: 900 });
      const { calendar } = await openFileDates(page, locale);
      for (const mode of ["dark", "light"]) {
        await appearance(page, "neon", mode);
        await page.evaluate(() => document.fonts.ready);
        const box = (await calendar.boundingBox())!;
        const margin = width < 340 ? 4 : 8;
        expect(box.x).toBeGreaterThanOrEqual(margin);
        expect(box.x + box.width).toBeLessThanOrEqual(width - margin);
        expect(box.y).toBeGreaterThanOrEqual(8);
        expect(box.y + box.height).toBeLessThanOrEqual(892);
        const styles = await calendar.evaluate(element => ({ scroll: element.scrollWidth, width: element.clientWidth, corners: [...element.querySelectorAll("button")].map(button => getComputedStyle(button).borderRadius) }));
        expect(styles.scroll).toBeLessThanOrEqual(styles.width);
        expect(styles.corners.every(radius => radius === "0px")).toBe(true);
        expect(await calendar.evaluate(element => getComputedStyle(element).backgroundColor)).toBe(await page.locator(".cyberos-ui-root").evaluate(element => {
          const sample = document.createElement("span");
          sample.style.backgroundColor = "var(--cyber-bg)";
          element.append(sample);
          const color = getComputedStyle(sample).backgroundColor;
          sample.remove();
          return color;
        }));
        if (width <= 560) {
          const sizes = await calendar.locator("button[data-date]").evaluateAll(buttons => buttons.map(button => button.getBoundingClientRect()));
          expect(sizes.every(box => box.width >= 44 && box.height >= 44)).toBe(true);
        }
        await page.screenshot({ path: info.outputPath(`calendar-${mode}.png`) });
      }
    });
  }
}
