import assert from "node:assert/strict";
import { test } from "node:test";
import { createTvHarness, key } from "./lib/tv-browser-fixture.mjs";

const library = createTvHarness();
async function search(t, locale) {
  const { page } = await library(t, { locale });
  await page.locator('[data-tv-nav="movie"]').click();
  await page.locator(".tv-search-button").focus();
  await page.keyboard.press("Enter");
  await page.locator(".tv-search-input").focus();
  return page;
}

for (const locale of ["en-US", "zh-CN"]) {
  for (const [name, code] of [["BrowserBack", 0], ["GoBack", 0], ["Unidentified", 461]]) test(`${locale}: ${name}/${code} closes search without changing category`, async t => {
    const page = await search(t, locale);
    assert.equal(await key(page, name, code), true);
    await page.locator(".tv-search").waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-tv-nav="movie"]').getAttribute("aria-current"), "page");
    await page.waitForFunction(() => globalThis.document.activeElement === globalThis.document.querySelector(".tv-search-button"));
  });
  for (const name of ["BrowserHome", "Home"]) test(`${locale}: ${name} closes search and goes home`, async t => {
    const page = await search(t, locale);
    assert.equal(await key(page, name), true);
    await page.locator(".tv-search").waitFor({ state: "detached" });
    assert.equal(await page.locator('[data-tv-nav="home"]').getAttribute("aria-current"), "page");
  });
}
test("Escape dismisses input help before closing search", async t => {
  const page = await search(t, "en-US");
  await page.getByRole("tooltip").waitFor();
  await page.keyboard.press("Escape"); await page.getByRole("tooltip").waitFor({ state: "hidden" });
  assert.equal(await page.locator(".tv-search").count(), 1);
  await page.keyboard.press("Escape"); await page.locator(".tv-search").waitFor({ state: "detached" });
});
test("remote Enter activates the search close button", async t => {
  const page = await search(t, "en-US");
  await page.getByRole("button", { name: "Close search", exact: true }).focus(); await page.keyboard.press("Enter");
  await page.locator(".tv-search").waitFor({ state: "detached" });
});
