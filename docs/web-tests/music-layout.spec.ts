import { expect, test, type Page } from "@playwright/test";
import { musicFixtures } from "./music-fixtures.js";

async function noOverflow(page: Page) {
  const sizes = await page.evaluate(() => {
    const content = document.querySelector<HTMLElement>(".music-content")!;
    return { viewport: innerWidth, document: document.documentElement.scrollWidth, content: content.clientWidth, scroll: content.scrollWidth };
  });
  expect(sizes.document).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.scroll).toBeLessThanOrEqual(sizes.content + 1);
}

for (const width of [1440, 820, 560, 390, 320]) {
  for (const locale of ["en", "zh-CN"]) {
    for (const mode of ["dark", "light"]) {
      test(`music cards fit ${width}px ${locale} ${mode}`, async ({ page }, testInfo) => {
        await page.setViewportSize({ width, height: 1000 });
        await page.emulateMedia({ reducedMotion: "reduce" });
        await musicFixtures(page, { locale });
        await page.addInitScript(value => localStorage.setItem("cyberos:appearance:v1", JSON.stringify({ scheme: "neon", mode: value })), mode);
        const errors: string[] = [];
        page.on("pageerror", error => errors.push(error.message));
        await page.goto("/#/app/music");
        await expect(page.locator(".music-home-player")).toContainText("Night Flight");
        await expect(page.locator(".music-home-playlists .music-media-card")).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);
        await noOverflow(page);
        if (width <= 560) {
          const columns = await page.locator(".music-home-releases .music-media-grid").evaluate(element => getComputedStyle(element).gridTemplateColumns.split(" ").length);
          expect(columns).toBe(2);
          const tooSmall = await page.locator(".music-home button").evaluateAll(buttons => buttons.filter(button => {
            const box = button.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && (box.width < 44 || box.height < 44);
          }).map(button => button.getAttribute("aria-label") ?? button.textContent));
          expect(tooSmall).toEqual([]);
        }
        await page.screenshot({ path: testInfo.outputPath("home.png") });
        const nav = page.getByRole("navigation", { name: locale === "en" ? "Music navigation" : "音乐库导航" });
        for (const [en, zh, entity] of [["Albums", "专辑", "album"], ["Artists", "艺术家", "artist"], ["Playlists", "歌单", "playlist"]]) {
          await nav.getByRole("button", { name: locale === "en" ? en : zh, exact: true }).click();
          await expect(page.locator(`.music-media-card[data-music-entity="${entity}"]`).first()).toBeVisible();
          await noOverflow(page);
        }
        await page.locator(".music-media-open").first().click();
        await expect(page.locator(".music-detail-header")).toBeVisible();
        await noOverflow(page);
        await page.screenshot({ path: testInfo.outputPath("playlist-detail.png") });
        await nav.getByRole("button", { name: locale === "en" ? "Songs" : "歌曲", exact: true }).click();
        await expect(page.locator(".music-track-card")).toHaveCount(14);
        await page.locator(".music-track-card").nth(5).scrollIntoViewIfNeeded();
        await expect(page.locator(".music-track-card").nth(5).locator(".music-cover img")).toHaveCount(0);
        await noOverflow(page);
        expect(errors).toEqual([]);
      });
    }
  }
}
