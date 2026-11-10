import { expect, test, type Page } from "@playwright/test";
import { fixtures } from "./fixtures.js";
import { adjustManagementDashboardLayout, defaultManagementDashboardLayouts, managementDashboardStorageKey, MANAGEMENT_DASHBOARD_LAYOUT_VERSION, type ManagementDashboardId } from "../../packages/web/src/lib/management-dashboard-layout.js";

const dashboardSkeleton = ".management-widget-skeleton";
const panels = [
  { id: "photos", module: "PhotoLibraryPanel", api: /^\/api\/photos\//, skeleton: ".photo-skeleton-tile", count: 16 },
  { id: "downloads", module: "HttpDownloaderPanel", api: /^\/api\/downloads(?:\/|$)/, skeleton: ".download-task-row-skeleton", count: 5 },
  { id: "terminal", module: "LocalTerminalPanel", api: /^\/api\/terminal\/tabs(?:\/|$)/, skeleton: ".workspace-terminal-skeleton", count: 1 },
  { id: "music", module: "MusicLibraryPanel", api: /^\/api\/music\//, skeleton: ".panel-content-skeleton", count: 1 },
  { id: "video", module: "VideoLibraryPanel", api: /^\/api\/media\//, skeleton: ".panel-content-skeleton", count: 1 },
  { id: "nvr", module: "NvrPanel", api: /^\/api\/nvr(?:\/|$)/, skeleton: ".panel-content-skeleton", count: 1 },
  { id: "docker", module: "WorkspaceManagementPanel", api: /^\/api\/docker\/summary$/, skeleton: dashboardSkeleton, count: 11 },
  { id: "virtualMachines", module: "WorkspaceManagementPanel", api: /^\/api\/vms\/summary$/, skeleton: dashboardSkeleton, count: 6 },
  { id: "network", module: "WorkspaceManagementPanel", api: /^\/api\/system\/network$/, skeleton: dashboardSkeleton, count: 11 },
  { id: "storage", module: "WorkspaceManagementPanel", api: /^\/api\/(?:system\/storage|storage\/iscsi)$/, skeleton: dashboardSkeleton, count: 8 },
  { id: "shares", module: "WorkspaceManagementPanel", api: /^\/api\/(?:settings\/shares|shares\/summary)$/, skeleton: dashboardSkeleton, count: 6 },
  { id: "monitoring", module: "MonitoringPanel", api: /^\/api\/monitoring\/(?:overview|query)$/, skeleton: dashboardSkeleton, count: 12 }
] as const;

async function geometry(page: Page, panel: string, skeleton: string) {
  return page.locator(`.workspace-stage[data-panel="${panel}"]`).evaluate((stage, selector) => {
    const header = stage.querySelector(".app-titlebar")!;
    const shapes = [header, ...stage.querySelectorAll(selector === ".management-widget-skeleton" ? "[data-widget-id]" : selector)];
    return {
      title: header.querySelector("h2")?.textContent,
      boxes: shapes.map((element) => {
        const box = element.getBoundingClientRect();
        return [box.x, box.y, box.width, box.height].map(Math.round);
      })
    };
  }, skeleton);
}

const scenarios = [
  { width: 1920, locale: "en", savedLayout: false },
  { width: 1920, locale: "zh-CN", savedLayout: false },
  { width: 390, locale: "en", savedLayout: false },
  { width: 390, locale: "zh-CN", savedLayout: false },
  { width: 1920, locale: "en", savedLayout: true }
];

for (const { width, locale, savedLayout } of scenarios) {
    for (const panel of panels.filter((candidate) => !savedLayout || candidate.skeleton === dashboardSkeleton)) {
      test(`${panel.id} keeps its skeleton across module and data loading at ${width}px in ${locale}${savedLayout ? " with a saved layout" : ""}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await fixtures(page, locale);
        let savedCardHeight: number | undefined;
        if (savedLayout) {
          const id = panel.id as ManagementDashboardId;
          const layouts = defaultManagementDashboardLayouts(id);
          const resized = adjustManagementDashboardLayout(layouts, "desktop", layouts.desktop[0]!.i, { kind: "resize", dw: 0, dh: 2 });
          savedCardHeight = resized.desktop[0]!.h * 9 + (resized.desktop[0]!.h - 1) * 12;
          await page.addInitScript(({ key, value }) => localStorage.setItem(key, value), {
            key: managementDashboardStorageKey(id),
            value: JSON.stringify({ version: MANAGEMENT_DASHBOARD_LAYOUT_VERSION, layouts: resized })
          });
        }
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        let releaseModule!: () => void;
        let releaseData!: () => void;
        let dataRequested!: () => void;
        let holdData = false;
        const moduleReady = new Promise<void>((resolve) => { releaseModule = resolve; });
        const dataReady = new Promise<void>((resolve) => { releaseData = resolve; });
        const requestedData = new Promise<void>((resolve) => { dataRequested = resolve; });
        const moduleUrl = new RegExp(`/${panel.module}(?:\\.tsx|-[A-Za-z0-9_-]+\\.js)(?:\\?|$)`);
        const requestedModule = page.waitForRequest(moduleUrl);
        await page.route(moduleUrl, async (route) => {
          await moduleReady;
          await route.continue();
        });
        await page.route("**/api/**", async (route) => {
          if (holdData && panel.api.test(new URL(route.request().url()).pathname)) {
            dataRequested();
            await dataReady;
          }
          await route.fallback();
        });
        try {
          await page.goto(`${process.env.CYBEROS_SKELETON_BASE_URL ?? ""}/#/app/${panel.id}`);
          await requestedModule;
          await expect(page.locator(`[data-panel-loading="${panel.id}"]`)).toBeVisible();
          await expect(page.locator(panel.skeleton)).toHaveCount(panel.count);
          await expect(page.locator(panel.skeleton).first()).toBeVisible();
          if (panel.skeleton !== ".panel-content-skeleton") await expect(page.locator(".panel-content-skeleton")).toHaveCount(0);
          await page.evaluate(() => document.fonts.ready);
          const before = await geometry(page, panel.id, panel.skeleton);
          expect(before.boxes[0]![3]).toBe(width > 1040 ? 70 : 104);
          if (savedCardHeight !== undefined) expect(before.boxes[1]![3]).toBe(savedCardHeight);
          expect(before.boxes.slice(1).every((box) => box[2]! > 0 && box[3]! > 0)).toBe(true);
          await page.screenshot({ path: testInfo.outputPath("module-loading.png") });
          holdData = true;
          releaseModule();
          await requestedData;
          await expect(page.locator(".workspace-panel-loading")).toHaveCount(0);
          await expect(page.locator(panel.skeleton)).toHaveCount(panel.count);
          await expect.poll(() => geometry(page, panel.id, panel.skeleton)).toEqual(before);
          await page.screenshot({ path: testInfo.outputPath("data-loading.png") });
          releaseData();
          await expect(page.locator(panel.skeleton)).toHaveCount(0, { timeout: 8_000 });
          await expect(page.locator(`.workspace-stage[data-panel="${panel.id}"] .app-titlebar h2`).first()).toHaveText(before.title!);
          expect(errors).toEqual([]);
        } finally {
          releaseModule();
          releaseData();
        }
      });
    }
}
