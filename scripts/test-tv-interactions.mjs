import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath, URL } from "node:url";
import { createTvHarness, detail, title, playback, key, openDetail, snapshot, noOverflow, visualRows } from "./lib/tv-browser-fixture.mjs";

const library = createTvHarness();
const titles = Array.from({ length: 18 }, (_, index) => ({ ...title, id: `title-${index}`, title: `Library title ${index + 1}` }));
const fullHome = { continueWatching: titles, recentlyAdded: titles, movies: [], series: titles, watchlist: titles, upNext: titles.map(item => ({ title: item, fileId: "file-2", seasonNumber: 1, episodeNumber: 2 })), collections: [] };
const selected = element => element === globalThis.document.activeElement;
const frame = page => page.evaluate(() => new Promise(resolve => globalThis.requestAnimationFrame(() => globalThis.requestAnimationFrame(resolve))));

test("TV home uses independent cinematic composition and title-level horizontal rails", async t => {
  const { page, reads } = await library(t, { home: { ...fullHome, continueWatching: [...titles, titles[0]] } });
  await page.locator(".tv-hero").waitFor();
  assert.equal(await page.locator(".video-panel, .playback-bar").count(), 0);
  assert.equal(await page.locator(".tv-navigation button").count(), 5);
  assert.equal(await page.locator(".tv-home-rail").count(), 4);
  assert.equal(await page.locator(".tv-home-rail").first().locator(".tv-media-card").count(), 18);
  for (const rail of await page.locator(".tv-home-rail").all()) assert.equal((await visualRows(rail.locator("button"))).length, 1);
  assert.equal(await page.locator(".tv-episode").count(), 0);
  assert.ok(!reads.some(url => url.pathname === "/api/media/sources"));
  await noOverflow(page, ".tv-app, .tv-browse-shell, .tv-content");
});

test("horizontal rails reveal offscreen posters, stop at the right edge and remember row focus", async t => {
  const { page } = await library(t, { home: fullHome });
  const rails = page.locator(".tv-home-rail");
  const posters = rails.first().locator("button");
  await posters.first().focus();
  for (let index = 1; index < 18; index++) { await page.keyboard.press("ArrowRight"); assert.equal(await posters.nth(index).evaluate(selected), true); }
  assert.ok(await rails.first().evaluate(element => element.scrollLeft > 0));
  await page.keyboard.press("ArrowRight");
  assert.equal(await posters.last().evaluate(selected), true);
  await page.keyboard.press("ArrowDown");
  assert.equal(await rails.nth(1).evaluate(element => element.contains(globalThis.document.activeElement)), true);
  await page.keyboard.press("ArrowUp");
  assert.equal(await posters.last().evaluate(selected), true);
});

test("TV-specific card geometry and selected navigation override generic ghost buttons", async context => {
  const { page } = await library(context);
  await page.locator(".tv-media-card").first().waitFor();
  const poster = await page.locator(".tv-media-card").first().evaluate(element => ({ padding: globalThis.getComputedStyle(element).padding, border: globalThis.getComputedStyle(element).borderWidth }));
  assert.deepEqual(poster, { padding: "0px", border: "0px" });
  const navigation = await page.locator('[data-tv-nav="home"]').evaluate(element => {
    const sample = globalThis.document.createElement("span");
    sample.style.backgroundColor = "var(--cyber-accent)";
    element.append(sample);
    const result = { actual: globalThis.getComputedStyle(element).backgroundColor, expected: globalThis.getComputedStyle(sample).backgroundColor };
    sample.remove();
    return result;
  });
  assert.equal(navigation.actual, navigation.expected);
});

test("unavailable playback state cannot start an unguarded video request", async context => {
  const { page, writes } = await library(context, { playbackFailure: true });
  await openDetail(page);
  await page.locator("[data-tv-detail-primary]").click();
  await page.locator('.tv-detail [role="alert"]').waitFor();
  assert.equal(writes.length, 0);
  assert.equal(await page.locator(".music-dialog").count(), 0);
});

test("empty library omits hero and rails, and failed home loading can retry", async context => {
  let failed = true;
  const { page } = await library(context, { homeFailure: () => failed, home: { continueWatching: [], recentlyAdded: [], movies: [], series: [], watchlist: [], upNext: [], collections: [] } });
  await page.locator(".tv-load-error").waitFor();
  assert.equal(await page.locator(".tv-home-rail, .tv-hero").count(), 0);
  failed = false;
  await page.locator(".tv-load-error button").click();
  await page.locator(".tv-empty").waitFor();
  assert.equal(await page.locator(".tv-load-error, .tv-home-rail, .tv-hero").count(), 0);
});

test("poster grid moves between visual rows, restores sidebar context and isolates filters", async context => {
  const { page } = await library(context, { titles });
  await page.locator('[data-tv-nav="movie"]').click();
  const posters = page.locator(".tv-poster-grid .tv-media-card");
  await posters.first().waitFor();
  const rows = await visualRows(posters);
  await posters.nth(rows[0][1]).focus();
  await page.keyboard.press("ArrowDown");
  assert.equal(await posters.nth(rows[1][1]).evaluate(selected), true);
  await page.keyboard.press("ArrowUp");
  assert.equal(await posters.nth(rows[0][1]).evaluate(selected), true);
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  assert.equal(await page.locator(".tv-sidebar").evaluate(element => element.contains(globalThis.document.activeElement)), true);
  await page.keyboard.press("ArrowRight");
  assert.equal(await posters.first().evaluate(selected), true);
  await page.getByRole("button", { name: "Filters", exact: true }).click();
  for (const direction of ["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"]) {
    await page.keyboard.press(direction);
    assert.equal(await page.locator(".tv-filter-dialog").evaluate(element => element.contains(globalThis.document.activeElement)), true);
  }
  await key(page, "BrowserBack");
  assert.equal(await page.getByRole("button", { name: "Filters", exact: true }).evaluate(selected), true);
});

test("search aborts obsolete queries and distinguishes empty results from loading", async context => {
  let releaseFirst;
  const waiting = new Promise(resolve => { releaseFirst = resolve; });
  const { page } = await library(context, { searchResults: async query => {
    if (query === "slow") { await waiting; return [{ ...title, id: "old-result", title: "Obsolete result" }]; }
    return query === "nothing" ? [] : [{ ...title, id: "fresh-result", title: "Current result" }];
  } });
  const aborted = [];
  page.on("requestfailed", request => { if (request.url().includes("query=slow")) aborted.push(request.failure()?.errorText); });
  try {
    await page.locator(".tv-search-button").click();
    const firstRequest = page.waitForRequest(request => request.url().includes("query=slow"));
    await page.locator(".tv-search-input").fill("slow");
    await page.waitForFunction(() => globalThis.document.querySelector(".tv-search-results").getAttribute("aria-busy") === "true");
    await firstRequest;
    assert.equal(await page.locator(".tv-search-empty").count(), 0);
    await page.locator(".tv-search-input").fill("current");
    await page.locator('[data-tv-title="fresh-result"]').waitFor();
    releaseFirst();
    await frame(page);
    assert.equal(await page.locator('[data-tv-title="old-result"]').count(), 0);
    assert.ok(aborted.length > 0);
    await page.locator(".tv-search-input").fill("nothing");
    await page.getByText("No matching titles", { exact: true }).waitFor();
    assert.equal(await page.locator(".tv-search-result").count(), 0);
  } finally { releaseFirst(); }
});

test("pinyin candidate paging and deletion leave the fixed keyboard in place", async context => {
  const { page } = await library(context);
  await page.locator(".tv-search-button").click();
  const letter = page.locator('[data-tv-key="q"]');
  await letter.focus();
  await page.keyboard.press("Enter");
  await page.locator("[data-tv-candidate]").first().waitFor();
  const geometry = await letter.boundingBox();
  const initialCandidates = await page.locator("[data-tv-candidate]").allTextContents();
  await page.getByRole("button", { name: "Next candidates", exact: true }).click();
  assert.notDeepEqual(await page.locator("[data-tv-candidate]").allTextContents(), initialCandidates);
  await page.getByRole("button", { name: "Previous candidates", exact: true }).click();
  assert.deepEqual(await page.locator("[data-tv-candidate]").allTextContents(), initialCandidates);
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  assert.equal(await page.locator("[data-tv-candidate]").count(), 0);
  assert.deepEqual(await letter.boundingBox(), geometry);
});

test("chosen episode resumes its own file progress rather than another episode", async context => {
  const progress = { "file-1": { fileId: "file-1", positionSeconds: 99, durationSeconds: 120, completed: false }, "file-2": { fileId: "file-2", positionSeconds: 42, durationSeconds: 120, completed: false } };
  const { page, writes } = await library(context, { detail: { ...detail, nextFileId: "file-2", fileProgress: progress } });
  await openDetail(page);
  await page.locator('[data-tv-episode="episode-2"]').click();
  await page.locator('.music-dialog [data-variant="primary"]').click();
  await page.waitForFunction(() => !globalThis.document.querySelector(".music-dialog"));
  const request = writes.find(write => write.path.endsWith("/file-2/play"));
  assert.equal(request?.body.startPositionSeconds, 42);
});

test("media progress refreshes home without resetting category grid focus", async context => {
  const { page, reads } = await library(context, { titles, home: fullHome });
  const firstRefresh = page.waitForResponse(response => response.url().endsWith("/api/media/home"));
  await snapshot(page, { status: { stamp: 1 }, progress: { stamp: 1 } }, "/api/media/events");
  await firstRefresh;
  await page.locator('[data-tv-nav="series"]').click();
  const poster = page.locator(".tv-poster-grid .tv-media-card").nth(10);
  await poster.waitFor();
  await poster.focus();
  const listingReads = reads.filter(url => url.pathname === "/api/media/titles").length;
  const nextRefresh = page.waitForResponse(response => response.url().endsWith("/api/media/home"));
  await snapshot(page, { status: { stamp: 1 }, progress: { stamp: 2 } }, "/api/media/events");
  await nextRefresh;
  await frame(page);
  assert.equal(reads.filter(url => url.pathname === "/api/media/titles").length, listingReads);
  assert.equal(await poster.evaluate(selected), true);
});

test("live progress preserves the chosen detail version and updates its resume position", async context => {
  const currentDetail = globalThis.structuredClone(detail);
  const { page, writes } = await library(context, { detailResponse: () => currentDetail });
  const firstRefresh = page.waitForResponse(response => response.url().endsWith("/api/media/home"));
  await snapshot(page, { status: { stamp: 1 }, progress: { stamp: 1 } }, "/api/media/events");
  await firstRefresh;
  await openDetail(page);
  const version = page.locator(".tv-version-choice .custom-select-trigger");
  await version.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => globalThis.document.querySelector(".tv-version-choice .custom-select-trigger").textContent.includes("2160p"));
  currentDetail.fileProgress["file-1-4k"] = { fileId: "file-1-4k", positionSeconds: 42, durationSeconds: 120, completed: false };
  const refreshed = page.waitForResponse(response => response.url().endsWith("/api/media/titles/series-1"));
  await snapshot(page, { status: { stamp: 1 }, progress: { stamp: 2 } }, "/api/media/events");
  await refreshed;
  await page.locator("[data-tv-detail-primary]").filter({ hasText: "Resume" }).waitFor();
  assert.match(await version.textContent(), /2160p/);
  assert.equal(await version.evaluate(selected), true);
  await page.locator("[data-tv-detail-primary]").click();
  await page.locator('.music-dialog [data-variant="primary"]').click();
  await page.locator(".music-dialog").waitFor({ state: "detached" });
  assert.equal(writes.find(write => write.path.endsWith("/file-1-4k/play"))?.body.startPositionSeconds, 42);
});

test("deferred initial detail focus respects a newer version-selection intent", async context => {
  const { page } = await library(context);
  await page.locator(".tv-media-card").first().waitFor();
  await page.evaluate(() => { globalThis.window.__originalFrame = globalThis.requestAnimationFrame; globalThis.window.__heldFrames = []; globalThis.requestAnimationFrame = callback => { globalThis.window.__heldFrames.push(callback); return 1; }; });
  await openDetail(page);
  const version = page.locator(".tv-version-choice .custom-select-trigger");
  await version.focus();
  await page.evaluate(() => { globalThis.requestAnimationFrame = globalThis.window.__originalFrame; for (const callback of globalThis.window.__heldFrames) callback(globalThis.performance.now()); });
  assert.equal(await version.evaluate(selected), true);
});

test("long multilingual titles, many seasons and missing files keep detail actions reachable", async context => {
  const longTitle = "超长剧集名称VeryLongUnbrokenMediaTitle".repeat(8);
  const { page } = await library(context, { viewport: { width: 1280, height: 720 }, detail: { ...detail, title: longTitle, files: [], seasons: Array.from({ length: 24 }, (_, index) => ({ id: `season-${index}`, seasonNumber: index + 1, name: `Season ${index + 1}`, episodes: [] })), nextFileId: null } });
  await openDetail(page);
  assert.equal(await page.locator("[data-tv-detail-primary]").isDisabled(), true);
  const seasons = page.locator(".tv-seasons button");
  await seasons.last().focus();
  await page.keyboard.press("ArrowUp");
  await noOverflow(page, ".tv-detail, .tv-detail-content, .tv-section-heading");
  await key(page, "BrowserBack");
  await page.locator(".tv-detail").waitFor({ state: "detached" });
});

test("QWERTY search starts at Q with fixed rows, CyberUI key faces and independent results", async t => {
  const { page } = await library(t);
  await page.locator(".tv-search-button").click();
  await page.waitForFunction(() => globalThis.document.activeElement?.dataset.tvKey === "q");
  assert.equal(await page.locator(".tv-keyboard-row").first().locator("[data-tv-key]").allTextContents().then(items => items.join("")), "1234567890");
  assert.equal(await page.locator(".tv-keyboard [data-slot='decoration']").count(), 40);
  const position = await page.locator('[data-tv-key="q"]').boundingBox();
  await page.keyboard.press("Enter");
  await page.locator("[data-tv-candidate]").first().waitFor();
  assert.deepEqual(await page.locator('[data-tv-key="q"]').boundingBox(), position);
  assert.equal(await page.locator('[data-tv-key="q"]').evaluate(selected), true);
  await noOverflow(page, ".tv-search, .tv-search-entry, .tv-keyboard");
});

for (const name of ["BrowserHome", "Home", "BrowserBack", "GoBack"]) test(`${name} returns a category to home`, async t => {
  const { page } = await library(t);
  await page.locator('[data-tv-nav="movie"]').click();
  assert.equal(await key(page, name), true);
  await page.waitForFunction(() => globalThis.document.querySelector('[data-tv-nav="home"]').getAttribute("aria-current") === "page");
});

test("media keys route to the active music session without activating navigation", async t => {
  const { page, writes } = await library(t);
  await page.locator('[data-tv-nav="series"]').focus();
  await key(page, "MediaPlayPause");
  await page.waitForTimeout(100);
  assert.equal(await page.locator('[data-tv-nav="home"]').getAttribute("aria-current"), "page");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, "/api/music/player/command");
  assert.equal(writes[0].body.type, "resume");
});

test("idle playback has no dock and media keys cannot activate focused actions", async t => {
  const idle = globalThis.structuredClone(playback);
  idle.owner = null; idle.sessionId = null; idle.music = { ...idle.music, owner: null, sessionId: null, queue: [], state: "idle" };
  const { page, writes } = await library(t, { playback: idle });
  await page.locator('[data-tv-nav="series"]').focus();
  for (const name of ["MediaPlayPause", "MediaPlay", "MediaPause", "MediaStop"]) await key(page, name);
  assert.equal(writes.length, 0);
  assert.equal(await page.locator(".tv-playback-dock").count(), 0);
});

for (const name of ["BrowserBack", "BrowserHome"]) test(`${name} dismisses the compact playback dialog`, async t => {
  const { page } = await library(t);
  await page.locator("[data-playback-restore]").click();
  await page.locator('[aria-labelledby="tv-playback-title"]').waitFor();
  await key(page, name);
  await page.locator('[aria-labelledby="tv-playback-title"]').waitFor({ state: "detached" });
});

test("detail restores both vertical and horizontal browsing context", async t => {
  const { page } = await library(t, { home: fullHome });
  const rail = page.locator(".tv-home-rail").last();
  const poster = rail.locator("button").nth(15);
  await poster.scrollIntoViewIfNeeded();
  const before = await page.locator(".tv-content").evaluate(element => element.scrollTop);
  const horizontal = await rail.evaluate(element => element.scrollLeft);
  await poster.click();
  await page.waitForFunction(() => globalThis.document.activeElement?.hasAttribute("data-tv-detail-primary"));
  await key(page, "BrowserBack");
  await page.waitForFunction(() => globalThis.document.activeElement?.dataset.tvTitle === "title-15");
  assert.equal(await page.locator(".tv-content").evaluate(element => element.scrollTop), before);
  assert.equal(await rail.evaluate(element => element.scrollLeft), horizontal);
});

test("up-next cards retain the recommended episode and default its correct season", async t => {
  const { page } = await library(t, { home: fullHome });
  await page.locator('[data-tv-row-id="upNext"] .tv-media-card').first().click();
  await page.locator(".tv-detail-content").waitFor();
  assert.match(await page.locator('.tv-episode-card[data-selected="true"]').textContent(), /Episode two/);
});

test("episode takeover submits the chosen file with CAS and blocks busy Back and Home", async t => {
  let release;
  const held = new Promise(resolve => { release = resolve; });
  const { page, writes } = await library(t, { onWrite: () => held });
  t.after(() => release());
  await openDetail(page);
  await page.locator('[data-tv-episode="episode-2"]').click();
  await page.locator(".music-dialog .primary-button").click();
  await page.waitForFunction(() => globalThis.document.querySelector(".music-dialog .primary-button")?.disabled);
  await key(page, "BrowserBack"); await key(page, "BrowserHome");
  assert.equal(await page.locator(".music-dialog").count(), 1);
  assert.equal(await page.locator(".tv-detail").count(), 1);
  assert.equal(writes[0].path, "/api/media/files/file-2/play");
  assert.equal(writes[0].body.expectedSessionId, "music-1");
  assert.equal(writes[0].body.serviceInstanceId, "instance-1");
  release();
  await page.locator(".music-dialog").waitFor({ state: "detached" });
});

test("a stale takeover is rejected without sending a play request", async t => {
  const { page, writes } = await library(t);
  await openDetail(page);
  await page.locator('[data-tv-episode="episode-2"]').click();
  await snapshot(page, { ...playback, revision: 2, sessionId: "changed-session" });
  await page.locator(".music-dialog .primary-button").click();
  await page.locator(".music-dialog").waitFor({ state: "detached" });
  assert.equal(writes.length, 0);
  assert.match(await page.locator(".tv-detail [role='alert']").textContent(), /Playback changed/);
});

test("versions are remote-selectable and full technical metadata stays available", async t => {
  const { page, writes } = await library(t);
  await openDetail(page);
  const version = page.getByRole("button", { name: "Version", exact: true });
  await version.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter");
  assert.match(await version.textContent(), /Version 2.*2160p.*hevc/);
  await frame(page);
  await page.locator(".tv-file-details summary").focus(); await page.keyboard.press("Enter");
  assert.equal(await page.locator(".tv-file-details").getAttribute("open"), "");
  assert.match(await page.locator(".tv-file-details").textContent(), /Test.Series.S01E01.2160p.HDR.Extended.Version.mkv/);
  assert.equal(writes.length, 0);
});

test("English virtual editing preserves key focus, caret, replacement, space and clear", async t => {
  const { page } = await library(t);
  await page.locator(".tv-search-button").click(); await page.locator(".tv-keyboard-tools button").first().click();
  const input = page.locator(".tv-search-input");
  for (const [name, expected] of [["Q", "q"], ["W", "qw"], ["1", "qw1"], ["Delete", "qw"], ["Space", "qw "], ["Z", "qw z"]]) {
    const button = page.getByRole("button", { name, exact: true }); await button.click(); await frame(page);
    assert.equal(await input.inputValue(), expected); assert.equal(await input.evaluate(element => element.selectionStart), expected.length); assert.equal(await button.evaluate(selected), true);
  }
  await input.focus(); await input.evaluate(element => element.setSelectionRange(1, 3));
  await page.getByRole("button", { name: "A", exact: true }).focus(); await page.keyboard.press("Enter"); await frame(page);
  assert.equal(await input.inputValue(), "qaz"); assert.equal(await input.evaluate(element => element.selectionStart), 2);
  await page.getByRole("button", { name: "Clear search", exact: true }).click(); await frame(page);
  assert.equal(await input.inputValue(), "");
});

test("physical keyboard input works while a virtual key has focus", async t => {
  const { page } = await library(t);
  await page.locator(".tv-search-button").click(); await page.locator(".tv-keyboard-tools button").first().click();
  await page.locator('[data-tv-key="q"]').focus(); await page.keyboard.type("test42");
  assert.equal(await page.locator(".tv-search-input").inputValue(), "test42");
  await page.keyboard.press("Backspace"); assert.equal(await page.locator(".tv-search-input").inputValue(), "test4");
});

test("deferred key focus cannot override a newer navigation intent", async t => {
  const { page } = await library(t);
  await page.locator(".tv-search-button").click(); await page.locator(".tv-keyboard-tools button").first().click(); await frame(page);
  await page.evaluate(() => { globalThis.window.__originalFrame = globalThis.requestAnimationFrame; globalThis.window.__heldFrames = []; globalThis.requestAnimationFrame = callback => { globalThis.window.__heldFrames.push(callback); return 1; }; });
  await page.getByRole("button", { name: "Q", exact: true }).click();
  await page.locator('[data-tv-key="w"]').focus();
  await page.evaluate(() => { globalThis.requestAnimationFrame = globalThis.window.__originalFrame; for (const callback of globalThis.window.__heldFrames) callback(globalThis.performance.now()); });
  assert.equal(await page.locator('[data-tv-key="w"]').evaluate(selected), true);
});

test("Chinese composition, remote candidate selection and Back keep keyboard context", async t => {
  const { page } = await library(t);
  await page.locator(".tv-search-button").click();
  const letter = page.locator('[data-tv-key="q"]'); await letter.focus(); await page.keyboard.press("Enter");
  const candidate = page.locator("[data-tv-candidate]").first(); await candidate.waitFor();
  const word = (await candidate.textContent()).trim(); await candidate.focus(); await page.keyboard.press("Enter"); await frame(page);
  assert.equal(await page.locator(".tv-search-input").inputValue(), word); assert.equal(await letter.evaluate(selected), true);
  await page.keyboard.press("Enter"); await candidate.waitFor(); await key(page, "BrowserBack");
  assert.equal(await page.locator("[data-tv-candidate]").count(), 0); assert.equal(await page.locator(".tv-search").count(), 1);
});

test("search retry and detail return preserve query, result focus and scroll", async t => {
  let fail = true;
  const { page } = await library(t, { searchFailure: () => fail });
  await page.locator(".tv-search-button").click(); await page.locator(".tv-search-input").fill("Test");
  await page.locator(".tv-search-error").waitFor(); assert.equal(await page.locator(".tv-search-empty").count(), 0);
  fail = false; await page.locator(".tv-search-error button").click(); await page.locator(".tv-search-result").first().click();
  await page.locator("[data-tv-detail-primary]").waitFor(); await key(page, "BrowserBack");
  await page.waitForFunction(() => globalThis.document.activeElement?.classList.contains("tv-search-result"));
  assert.equal(await page.locator(".tv-search-input").inputValue(), "Test");
});

test("filters are separate, use full library options and close nested select before dialog", async t => {
  const { page, reads } = await library(t);
  await page.locator('[data-tv-nav="movie"]').click(); await page.getByRole("button", { name: "Filters", exact: true }).click();
  const year = page.getByRole("button", { name: "Year", exact: true }); await year.waitFor();
  await page.waitForFunction(() => !globalThis.document.querySelector('[aria-label="Year"]').disabled);
  await year.focus(); await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); assert.match(await year.textContent(), /2024/);
  const genre = page.getByRole("button", { name: "Genre", exact: true }); await genre.focus(); await page.keyboard.press("ArrowDown"); await key(page, "Unidentified", 461);
  assert.equal(await page.locator('[role="listbox"]').count(), 0); assert.equal(await page.locator(".tv-filter-dialog").count(), 1);
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.getByRole("button", { name: "Apply", exact: true }).click();
  await page.waitForTimeout(150);
  assert.ok(reads.some(url => url.searchParams.get("year") === "2024" && url.searchParams.get("genre") === "Drama" && url.searchParams.get("kind") === "movie"));
});

test("collection Back restores its collection before returning home", async t => {
  const { page } = await library(t);
  await page.locator('[data-tv-nav="collections"]').click(); await page.locator("[data-tv-collection]").first().click();
  await page.locator(".tv-poster-grid .tv-media-card").first().waitFor(); await key(page, "BrowserBack");
  await page.waitForFunction(() => globalThis.document.activeElement?.hasAttribute("data-tv-collection"));
  await key(page, "BrowserBack"); assert.equal(await page.locator('[data-tv-nav="home"]').getAttribute("aria-current"), "page");
});

test("native Home ignores historical and duplicate requests and sends no stop", async t => {
  const initial = globalThis.structuredClone(playback); initial.video.tvHomeRequestId = "historical-home";
  const { page, writes } = await library(t, { playback: initial }); await page.locator('[data-tv-nav="movie"]').click();
  await snapshot(page, { ...initial, revision: 2 }); assert.equal(await page.locator('[data-tv-nav="movie"]').getAttribute("aria-current"), "page");
  const next = { ...initial, revision: 3, video: { ...initial.video, tvHomeRequestId: "new-home" } }; await snapshot(page, next);
  await page.waitForFunction(() => globalThis.document.querySelector('[data-tv-nav="home"]').getAttribute("aria-current") === "page");
  await page.locator('[data-tv-nav="movie"]').click(); await snapshot(page, { ...next, revision: 4 }); await frame(page);
  assert.equal(await page.locator('[data-tv-nav="movie"]').getAttribute("aria-current"), "page"); assert.equal(writes.length, 0);
});

test("all fourteen CyberUI appearances keep controls and theme sync intact", async t => {
  const { page } = await library(t);
  const output = fileURLToPath(new URL("../.cyberos/tv-review/redesign/themes/", import.meta.url));
  await mkdir(output, { recursive: true });
  await page.getByRole("button", { name: "Appearance", exact: true }).click();
  for (const scheme of ["neon", "mono", "graphite", "synthwave", "bloodline", "terminal", "amber"]) for (const mode of ["Dark", "Light"]) {
    await page.locator(`[data-theme-swatch="${scheme}"]`).click(); await page.locator(".appearance-modes").getByRole("button", { name: mode, exact: true }).click();
    assert.equal(await page.locator("html").getAttribute("data-cyber-scheme"), scheme); assert.equal(await page.locator("html").getAttribute("data-cyber-mode"), mode.toLowerCase());
    await noOverflow(page, ".tv-theme-dialog");
    await page.screenshot({ path: `${output}/${scheme}-${mode.toLowerCase()}.png` });
  }
  await key(page, "BrowserBack"); await page.locator(".tv-theme-dialog").waitFor({ state: "detached" });
});

for (const locale of ["en-US", "zh-CN"]) for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) test(`${locale}: TV visual acceptance at ${width}x${height}`, async t => {
  const { page } = await library(t, { locale, viewport: { width, height }, home: fullHome });
  const output = fileURLToPath(new URL("../.cyberos/tv-review/redesign/", import.meta.url)); await mkdir(output, { recursive: true });
  await page.locator(".tv-hero").waitFor(); await page.screenshot({ path: `${output}/home-${locale}-${width}.png` });
  const clippedLabels = await page.locator(".tv-sidebar button span").evaluateAll(elements => elements.filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent));
  assert.deepEqual(clippedLabels, []);
  await noOverflow(page, ".tv-app, .tv-content, .tv-browse-shell"); await openDetail(page);
  await noOverflow(page, ".tv-detail, .tv-detail-hero, .tv-detail-content"); await page.screenshot({ path: `${output}/detail-${locale}-${width}.png` }); await key(page, "BrowserBack");
  await page.locator(".tv-search-button").click(); await page.locator('[data-tv-key="q"]').focus(); await page.keyboard.press("Enter"); await page.locator("[data-tv-candidate]").first().waitFor();
  await noOverflow(page, ".tv-search, .tv-search-entry, .tv-keyboard"); await page.screenshot({ path: `${output}/search-${locale}-${width}.png` });
  const candidateSize = await page.locator("[data-tv-candidate]").first().evaluate(element => parseFloat(globalThis.getComputedStyle(element).fontSize)); assert.ok(candidateSize >= 26);
  await key(page, "BrowserHome"); await page.locator(".tv-search").waitFor({ state: "detached" });
});

for (const locale of ["en-US", "zh-CN"]) for (const width of [1440, 820, 560, 390, 320]) test(`Web ${locale} ${width}px keeps its existing wrapped library layout`, async t => {
  const longText = "很长的名称VeryLongUnbrokenMediaMetadata".repeat(12);
  const longTitles = titles.slice(0, 14).map(item => ({ ...item, title: `${longText} ${item.id}` }));
  const { page } = await library(t, { tv: false, locale, viewport: { width, height: 900 }, panelWidth: width > 820 ? 980 : width,
    home: { ...fullHome, continueWatching: longTitles, recentlyAdded: longTitles, watchlist: longTitles, upNext: longTitles.map(item => ({ title: item, fileId: "file-2" })) },
    detail: { ...detail, title: longText, genres: [longText], seasons: Array.from({ length: 12 }, (_, index) => ({ ...detail.seasons[0], id: `season-${index}`, seasonNumber: index + 1, name: index === 11 ? longText : `Season ${index + 1}` })) } });
  const groups = page.locator(".video-home-row > div"); assert.equal(await groups.count(), 4);
  for (const group of await groups.all()) assert.ok((await visualRows(group.locator(".video-poster"))).length > 1);
  await noOverflow(page, ".video-panel, .video-content, .video-navigation, .video-home-row > div");
  await groups.first().locator("button").first().click(); await page.locator(".video-detail").waitFor();
  assert.ok((await visualRows(page.locator(".video-seasons nav button"))).length > 1);
  await noOverflow(page, ".video-panel, .video-content, .video-detail, .video-detail-main, .video-actions, .video-version, .video-seasons nav");
});
