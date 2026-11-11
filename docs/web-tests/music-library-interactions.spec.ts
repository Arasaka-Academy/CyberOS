import { expect, test } from "@playwright/test";
import { musicFixtures, musicTracks } from "./music-fixtures.js";

test("history fallback starts the historical song and quick mix uses the existing most-played collection", async ({ page }) => {
  const { commands, home } = await musicFixtures(page, { queue: false });
  await page.goto("/#/app/music");
  const hero = page.locator(".music-home-player");
  await expect(hero).toContainText("Ready to play");
  await expect(hero.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  expect(commands).toEqual([]);
  await hero.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: "replace", trackIds: ["song-0"] });
  await page.getByRole("button", { name: "Quick mix Most played", exact: true }).click();
  await expect.poll(() => commands.length).toBe(2);
  expect(commands[1]).toMatchObject({ type: "replace", trackIds: home.mostPlayed.filter(track => !track.missing).map(track => track.id) });
  await page.locator(".music-home-history").getByRole("button", { name: "Most played", exact: true }).click();
  await expect(page.locator(".music-home-history .music-track-card")).toHaveCount(6);
  await expect(page.locator(".music-home-history .music-track-card").first()).toContainText("声音 13");
});

test("narrow song cards retain favorites, keyboard menu return and add-to-playlist dialog focus", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { mutations, requests } = await musicFixtures(page);
  await page.goto("/#/app/music");
  await page.getByRole("button", { name: "My favorites Your saved songs", exact: true }).click();
  const row = page.locator(".music-track-card").first();
  await expect(row).toContainText("夜航");
  expect(requests.some(url => url.startsWith("GET /tracks?") && url.includes("favorite=true"))).toBe(true);
  const more = row.getByRole("button", { name: "Song actions", exact: true });
  await more.click();
  await page.keyboard.press("Tab");
  await expect(row.locator(".music-track-actions").getByRole("button", { name: "Favorite", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(more).toBeFocused();
  await more.click();
  await row.locator(".music-track-actions").getByRole("button", { name: "Favorite", exact: true }).click();
  await expect.poll(() => mutations.filter(item => item.path === "/favorites").length).toBe(1);
  expect(mutations.find(item => item.path === "/favorites")?.body).toEqual({ kind: "track", id: "song-0", favorite: false });
  await expect(page.locator(".music-track-card").first()).toContainText("远方的声音 2");
  const nextRow = page.locator(".music-track-card").first();
  const nextMore = nextRow.getByRole("button", { name: "Song actions", exact: true });
  await nextMore.click();
  await nextRow.getByRole("button", { name: "Add to playlist", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(nextMore).toBeFocused();
});

test("search pagination appends song cards without resetting the album results", async ({ page }) => {
  await musicFixtures(page);
  await page.route("**/api/music/tracks?**", async route => {
    const url = new URL(route.request().url());
    if (!url.searchParams.has("query")) return route.fallback();
    return route.fulfill({ json: { items: url.searchParams.has("cursor") ? musicTracks.slice(2, 4) : musicTracks.slice(0, 2), nextCursor: url.searchParams.has("cursor") ? null : "songs-page-2" } });
  });
  await page.goto("/#/app/music");
  const input = page.getByRole("searchbox", { name: "Search songs, albums, artists", exact: true });
  await input.fill("夜航");
  await input.press("Enter");
  await expect(page.locator(".music-track-card")).toHaveCount(2);
  await expect(page.locator('[data-music-entity="album"]')).toHaveCount(12);
  await page.getByRole("button", { name: "More songs", exact: true }).click();
  await expect(page.locator(".music-track-card")).toHaveCount(4);
  await expect(page.locator('[data-music-entity="album"]')).toHaveCount(12);
  await expect(page.getByRole("button", { name: "More songs", exact: true })).toHaveCount(0);
});

test("playlist duplicate occurrences keep their order and focus after regenerated entry IDs", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  const { mutations } = await musicFixtures(page);
  await page.goto("/#/app/music");
  await page.locator(".music-home-playlists .music-media-open").first().click();
  const rows = page.locator(".music-track-list > .music-track");
  await expect(rows).toHaveCount(3);
  await rows.nth(2).getByRole("button", { name: "Move up", exact: true }).click();
  await expect(rows.nth(1).getByRole("button", { name: "Move up", exact: true })).toBeFocused();
  expect(mutations.find(item => item.method === "PATCH")?.body).toEqual({ trackIds: ["song-0", "song-0", "song-2"] });
  await expect(rows.nth(1)).toHaveAttribute("data-music-track-id", "song-0");
  await rows.nth(1).getByRole("button", { name: "Song actions", exact: true }).click();
  await rows.nth(1).getByRole("button", { name: "Remove", exact: true }).click();
  await expect(rows).toHaveCount(2);
  expect(mutations.filter(item => item.method === "PATCH").at(-1)?.body).toEqual({ trackIds: ["song-0", "song-2"] });
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page.getByRole("dialog").getByRole("textbox").fill("夜间漫游 · 新名称");
  await page.getByRole("dialog").getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.locator(".music-detail-header h3")).toHaveText("夜间漫游 · 新名称");
});

test("leaving home aborts its slow playlist preview and preserves the songs view", async ({ page }) => {
  await musicFixtures(page);
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  let requested!: () => void;
  const started = new Promise<void>(resolve => { requested = resolve; });
  await page.route("**/api/music/playlists?limit=4", async route => {
    requested();
    await pending;
    await route.fallback();
  });
  try {
    await page.goto("/#/app/music");
    await started;
    const aborted = page.waitForEvent("requestfailed", request => request.url().endsWith("/api/music/playlists?limit=4"));
    await page.getByRole("navigation", { name: "Music navigation" }).getByRole("button", { name: "Songs", exact: true }).click();
    await aborted;
    await expect(page.locator(".music-track-card")).toHaveCount(14);
    release();
    await expect(page.locator(".music-home-playlists")).toHaveCount(0);
    await expect(page.locator(".music-track-card")).toHaveCount(14);
  } finally { release(); }
});

test("empty library offers setup while player failure still permits browsing albums", async ({ page }) => {
  const { commands } = await musicFixtures(page, { empty: true });
  await page.goto("/#/app/music");
  await expect(page.locator(".music-home-player")).toContainText("Your music starts here");
  await expect(page.locator(".music-home-player").getByRole("button", { name: "Manage music library", exact: true })).toBeVisible();
  expect(commands).toEqual([]);
  await page.unrouteAll({ behavior: "wait" });
  await musicFixtures(page, { unavailable: true });
  await page.reload();
  await expect(page.locator(".music-home-player")).toContainText("NAS player unavailable");
  await page.locator(".music-home-releases .music-media-open").first().click();
  await expect(page.locator(".music-track-list")).toBeVisible();
});

test("keyboard detail navigation returns focus to its album card", async ({ page }) => {
  await musicFixtures(page);
  await page.goto("/#/app/music");
  const opener = page.locator(".music-home-releases .music-media-open").nth(3);
  await opener.focus();
  await page.keyboard.press("Enter");
  const back = page.locator(".music-back");
  await expect(back).toBeFocused();
  await back.press("Enter");
  await expect(opener).toBeFocused();
});

test("restored album browsing retains its skeleton and scroll position", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 900 });
  await musicFixtures(page);
  await page.goto("/#/app/music");
  await page.getByRole("navigation", { name: "Music navigation" }).getByRole("button", { name: "Albums", exact: true }).click();
  await expect(page.locator('[data-music-entity="album"]')).toHaveCount(12);
  await page.locator(".music-content").evaluate(element => { element.scrollTop = 500; });
  await expect.poll(() => page.locator(".music-content").evaluate(element => element.scrollTop)).toBeGreaterThan(400);
  await page.getByRole("button", { name: "Home screen", exact: true }).click();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  await page.route("**/api/music/albums?**", async route => { await pending; await route.fallback(); });
  try {
    await page.getByRole("button", { name: "Music", exact: true }).click();
    await expect(page.locator('[data-music-skeleton="albums"]')).toBeVisible();
    await expect(page.locator(".panel-content-skeleton")).toHaveCount(0);
    release();
    await expect(page.locator('[data-music-entity="album"]')).toHaveCount(12);
    await expect.poll(() => page.locator(".music-content").evaluate(element => element.scrollTop)).toBeGreaterThan(400);
  } finally { release(); }
});
