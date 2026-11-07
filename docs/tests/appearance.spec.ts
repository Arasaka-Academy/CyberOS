import { expect, test } from "@playwright/test";

const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];

async function linkContrast(page: import("@playwright/test").Page) {
  return page.locator(".sl-markdown-content a[href], .sidebar-content a[aria-current='page']").evaluateAll(elements => elements
    .filter(element => element.getClientRects().length && element.textContent?.trim()).map(element => {
      const canvas = document.createElement("canvas"); canvas.width = canvas.height = 1;
      const context = canvas.getContext("2d")!;
      const rgba = (color: string) => { context.clearRect(0, 0, 1, 1); context.fillStyle = color; context.fillRect(0, 0, 1, 1); return [...context.getImageData(0, 0, 1, 1).data]; };
      const over = (front: number[], back: number[]) => front.slice(0, 3).map((value, index) => value * front[3]! / 255 + back[index]! * (1 - front[3]! / 255)).concat(255);
      const ancestors: Element[] = []; for (let parent: Element | null = element; parent; parent = parent.parentElement) ancestors.unshift(parent);
      const background = ancestors.reduce((color, node) => over(rgba(getComputedStyle(node).backgroundColor), color), [255, 255, 255, 255]);
      const luminance = (color: number[]) => color.slice(0, 3).map(value => value / 255).map(value => value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index]!, 0);
      const a = luminance(over(rgba(getComputedStyle(element).color), background)), b = luminance(background);
      return { text: element.textContent, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
    }));
}

test("documentation applies every palette to content and diagrams and restores it on reload", async ({ page }, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto("/docs/architecture/system-overview/");
  await expect(page.locator("pre.mermaid svg")).toBeVisible();
  for (const scheme of schemes) for (const mode of ["dark", "light"]) {
    const details = page.locator(".docs-appearance:visible");
    if (!(await details.evaluate(node => (node as HTMLDetailsElement).open))) await details.locator("summary").click();
    await page.locator(`.docs-appearance:visible [data-scheme-choice="${scheme}"]`).click();
    await page.locator(`.docs-appearance:visible [data-mode-choice="${mode}"]`).click();
    await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", scheme);
    await expect(page.locator("html")).toHaveAttribute("data-theme", mode);
    await expect(page.locator(`.docs-appearance:visible [data-scheme-choice="${scheme}"]`)).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("pre.mermaid")).toHaveAttribute("data-processed", "true");
    const paint = await page.locator("pre.mermaid .node rect").first().evaluate(node => {
      const probe = document.createElement("span"); probe.style.color = "var(--cyber-soft)"; document.body.append(probe);
      const value = { actual: getComputedStyle(node).fill, expected: getComputedStyle(probe).color }; probe.remove(); return value;
    });
    expect(paint.actual).toBe(paint.expected);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.keyboard.press("Escape");
    if (await details.evaluate(node => (node as HTMLDetailsElement).open)) await page.keyboard.press("Escape");
    await expect(details).not.toHaveAttribute("open");
    if (scheme === "neon") await page.screenshot({ path: info.outputPath(`docs-${mode}.png`) });
  }
  await page.reload(); await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", "amber"); await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  await page.goto("/docs/operations/cybermachine/");
  const code = page.locator(".expressive-code .code").first(); await expect(code).toBeVisible();
  const lightColor = await code.evaluate(node => getComputedStyle(node).color);
  await page.locator(".docs-appearance:visible summary").click(); await page.locator('.docs-appearance:visible [data-mode-choice="dark"]').click();
  await expect.poll(() => code.evaluate(node => getComputedStyle(node).color)).not.toBe(lightColor);
  await page.keyboard.press("Escape"); await page.setViewportSize({ width: 320, height: 700 });
  await page.locator(".sl-menu-button").click();
  await page.locator(".docs-appearance:visible summary").click();
  const bounds = await page.locator(".docs-appearance-panel:visible").boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0); expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(320);
  expect(bounds!.y).toBeGreaterThanOrEqual(56); expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(700);
  await page.screenshot({ path: info.outputPath("docs-mobile.png") });
  await page.mouse.move(310, 650);
  await page.keyboard.press("Escape");
  await expect(page.locator(".docs-appearance:visible")).not.toHaveAttribute("open");
  await expect(page.locator(".docs-appearance:visible summary")).toBeFocused();
  await expect(page.locator("#starlight__sidebar")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.locator("#starlight__sidebar")).not.toBeVisible();
  expect(errors).toEqual([]);
});

test("documentation links retain AA contrast in every theme", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/docs/operations/cybermachine/");
  for (const scheme of schemes) for (const mode of ["dark", "light"]) {
    await page.evaluate(({ scheme, mode }) => Object.assign(document.documentElement.dataset, { cyberScheme: scheme, cyberMode: mode, theme: mode }), { scheme, mode });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(250);
    for (const hover of [false, true]) {
      if (hover) { await page.locator(".sl-markdown-content a[href]").first().hover(); await page.waitForTimeout(250); }
      const links = await linkContrast(page);
      expect(links.length).toBeGreaterThan(1);
      for (const link of links) expect(link.ratio, `${scheme}/${mode}, hover=${hover}: ${link.text}`).toBeGreaterThanOrEqual(4.5);
    }
  }
});
