import { expect, test } from "@playwright/test";

test("the documentation directory leads readers to each section and quick start", async ({ page }) => {
  await page.goto("/docs/");
  const directory = page.getByRole("navigation", { name: "文档栏目" });
  await expect(directory).toBeVisible();
  await expect(directory.getByRole("heading", { level: 2 })).toHaveText([
    "开始使用", "教程与操作", "架构与设计", "组件", "运维", "参考"
  ]);
  await expect(page.locator("main h1")).toHaveCount(1);
  await expect(page.locator("mobile-starlight-toc, starlight-toc")).toHaveCount(0);

  for (const link of await directory.getByRole("link").all()) {
    const response = await page.request.get(await link.getAttribute("href") ?? "");
    expect(response.status()).toBe(200);
  }
  await page.locator("main").getByRole("link", { name: "快速开始", exact: true }).first().click();
  await expect(page).toHaveURL(/\/docs\/start\/quick-start\/$/);
  await expect(page.locator("main h1")).toHaveText("快速开始");
});

for (const width of [1440, 820, 560, 390, 320]) {
  test(`reading and navigation stay inside a ${width}px viewport`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    for (const route of ["", "operations/cybermachine/", "reference/frontend-styles/", "architecture/system-overview/"]) {
      await page.goto(`/docs/${route}`);
      if (route === "reference/frontend-styles/") {
        const table = page.locator("main table").first();
        await expect(table).toBeVisible();
        if (width === 320) {
          const bounds = await table.evaluate((element) => ({ width: element.clientWidth, content: element.scrollWidth }));
          expect(bounds.content, "wide tables must scroll instead of breaking technical identifiers").toBeGreaterThan(bounds.width);
        }
      }
      if (route === "architecture/system-overview/") {
        await expect(page.locator("pre.mermaid svg")).toBeVisible({ timeout: 15_000 });
      }
      await expect(page.locator("main h1")).toBeVisible();
      const bounds = await page.evaluate(() => ({
        viewport: document.documentElement.clientWidth,
        document: document.documentElement.scrollWidth,
        article: document.querySelector(".sl-markdown-content")!.getBoundingClientRect().right
      }));
      expect(bounds.document, `${route} must not scroll the whole page horizontally`).toBeLessThanOrEqual(bounds.viewport + 1);
      expect(bounds.article).toBeLessThanOrEqual(bounds.viewport + 1);

      if (route === "architecture/system-overview/") {
        const diagram = page.getByRole("region", { name: "文档图表" });
        const edges = await diagram.evaluate((element) => {
          const frame = element.getBoundingClientRect();
          const svg = element.querySelector("svg")!.getBoundingClientRect();
          return { left: svg.left - frame.left + element.scrollLeft, top: svg.top - frame.top + element.scrollTop };
        });
        expect(edges.left, "the diagram's left edge must be reachable by scrolling").toBeGreaterThanOrEqual(0);
        expect(edges.top, "the diagram's top edge must be reachable by scrolling").toBeGreaterThanOrEqual(0);
        await diagram.focus();
        await page.keyboard.press("ArrowRight");
        await expect.poll(() => diagram.evaluate((element) => element.scrollLeft)).toBeGreaterThan(0);
      }

      const controls = page.locator('site-search [data-open-modal], .sl-menu-button, .expressive-code .copy button').filter({ visible: true });
      for (const control of await controls.all()) {
        const geometry = await control.evaluate((element) => {
          const style = getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return { width: rect.width, height: rect.height, corners: [
            style.borderTopLeftRadius, style.borderTopRightRadius,
            style.borderBottomLeftRadius, style.borderBottomRightRadius
          ] };
        });
        const minimum = width < 800 ? 44 : 32;
        expect(geometry.width).toBeGreaterThanOrEqual(minimum);
        expect(geometry.height).toBeGreaterThanOrEqual(minimum);
        expect(geometry.corners).toEqual(["0px", "0px", "0px", "0px"]);
      }
    }
  });
}

for (const width of [1440, 390, 320]) {
  test(`search at ${width}px returns Chinese results, restores focus, and opens an article`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/docs/");
    const trigger = page.locator("site-search [data-open-modal]");
    await trigger.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "搜索" });
    const input = dialog.getByRole("textbox");
    await expect(input).toBeFocused();
    await input.fill("备份");
    const result = dialog.locator(".pagefind-ui__result-link").filter({ hasText: "备份与恢复" }).first();
    await expect(result).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveText("搜索");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(trigger).toBeFocused();

    await page.keyboard.press("Control+k");
    await expect(input).toBeFocused();
    await input.fill("备份");
    await result.click();
    await expect(page).toHaveURL(/\/docs\/how-to\/backup-restore\//);
    await expect(page.locator("main h1")).toHaveText("备份与恢复");
  });
}

for (const width of [1440, 390]) {
  test(`search at ${width}px focuses its input after a delayed first load`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    let releaseSearch = () => {};
    const searchReady = new Promise<void>((resolve) => { releaseSearch = resolve; });
    await page.route("**/_astro/ui-core.*.js", async (route) => {
      await searchReady;
      await route.continue();
    });
    try {
      await page.goto("/docs/");
      await page.locator("site-search [data-open-modal]").focus();
      await page.keyboard.press("Enter");
      const dialog = page.getByRole("dialog", { name: "搜索" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByRole("textbox")).toHaveCount(0);
      releaseSearch();
      await expect(dialog.getByRole("textbox")).toBeFocused();
    } finally {
      releaseSearch();
    }
  });
}

test("mobile navigation closes with Escape and follows a section link", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/docs/");
  const trigger = page.locator(".sl-menu-button");
  const sidebar = page.locator("#starlight__sidebar");
  await trigger.click();
  await expect(sidebar).toBeVisible();
  await page.mouse.move(180, 500);
  await page.keyboard.press("Escape");
  await expect(sidebar).not.toBeVisible();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await sidebar.getByRole("link", { name: "快速开始", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/start\/quick-start\/$/);
  await expect(sidebar).not.toBeVisible();
});

test("article anchors and code copy remain usable with reduced motion", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("/docs/operations/cybermachine/");
  await expect(page.locator(".docs-page-heading")).toContainText("运维");
  await expect(page.locator(".docs-page-description")).toHaveText("在 cybermachine（Linux arm64）上原生构建、安装、验收和回滚 CyberOS。");
  const toc = page.locator("starlight-toc");
  await toc.getByRole("link", { name: "从 Mac 快速部署测试组件", exact: true }).click();
  const heading = page.getByRole("heading", { name: "从 Mac 快速部署测试组件", exact: true });
  await expect(heading).toBeInViewport();
  expect((await heading.boundingBox())!.y).toBeGreaterThanOrEqual(64);

  await page.goto("/docs/start/configuration/");
  const code = page.locator(".expressive-code").first();
  await code.hover();
  const expected = (await code.locator(".ec-line").allTextContents()).join("\n");
  await code.locator(".copy button").click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(expected.trimEnd());
  await page.getByRole("link", { name: "跳转到内容" }).focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("main h1")).toBeFocused();
});
