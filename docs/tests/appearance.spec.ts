import { expect, test } from "@playwright/test";

const schemes = ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"];

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
