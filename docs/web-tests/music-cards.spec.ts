import { expect, test } from "@playwright/test";
import { musicFixtures } from "./music-fixtures.js";

test("home resumes the existing queue without replacing it and requests only four playlist summaries", async ({ page }) => {
  const { commands, requests } = await musicFixtures(page);
  await page.goto("/#/app/music");
  const hero = page.locator(".music-home-player");
  await expect(hero).toContainText("夜航 / Night Flight");
  await expect(page.locator(".music-home-releases .music-media-card")).toHaveCount(8);
  await expect(page.locator(".music-home-history .music-track-card")).toHaveCount(6);
  await expect(page.locator(".music-home-playlists .music-media-card")).toHaveCount(4);
  expect(commands).toEqual([]);
  expect(requests.filter(url => /^GET \/(?:albums|playlists)\//.test(url))).toEqual([]);
  // StrictMode can remount a newly loaded view in development. Each home load
  // still makes only the one bounded summary request, never a per-card fetch.
  expect(requests.filter(url => url.startsWith("GET /playlists?"))).toEqual(requests.filter(url => url === "GET /home").map(() => "GET /playlists?limit=4"));
  await hero.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(hero.getByRole("button", { name: "Resume", exact: true })).toBeVisible();
  await hero.getByRole("button", { name: "Resume", exact: true }).click();
  expect(commands.map(command => command.type)).toEqual(["pause", "resume"]);
  expect(commands[1]).toMatchObject({ expectedQueueVersion: 7, serviceInstanceId: "music-instance", playbackSessionId: "music-session" });
});

test("album play is separate from opening details and skips unavailable songs", async ({ page }) => {
  const { commands, requests } = await musicFixtures(page, { queue: false });
  await page.goto("/#/app/music");
  await page.getByRole("navigation", { name: "Music navigation" }).getByRole("button", { name: "Albums", exact: true }).click();
  const album = page.locator('.music-media-card[data-music-entity="album"]').first();
  await expect(album).toBeVisible();
  expect(requests.filter(url => url.startsWith("GET /albums/"))).toEqual([]);
  await album.hover();
  await album.getByRole("button", { name: "Play 城市回声 0 / City Echoes", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: "replace", trackIds: ["song-0", "song-2"] });
  await expect(page.locator(".music-detail-header")).toHaveCount(0);
  await album.getByRole("button", { name: /Open 城市回声 0/ }).click();
  await expect(page.locator(".music-detail-header")).toContainText("城市回声 0");
  await expect(page.locator(".music-track-list")).toBeVisible();
});

test("home falls back to history then albums without autoplay", async ({ page }) => {
  const { commands } = await musicFixtures(page, { queue: false, history: false });
  await page.goto("/#/app/music");
  const hero = page.locator(".music-home-player");
  await expect(hero).toContainText("城市回声 0 / City Echoes");
  expect(commands).toEqual([]);
  await hero.getByRole("button", { name: "Play", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: "replace", trackIds: ["song-0", "song-2"] });
});

test("playlist preview failure stays local and can be retried", async ({ page }) => {
  await musicFixtures(page);
  let unavailable = true;
  await page.route("**/api/music/playlists?limit=4", route => unavailable
    ? route.fulfill({ status: 503, json: { error: "Playlist summaries unavailable" } })
    : route.fallback());
  await page.goto("/#/app/music");
  await expect(page.locator(".music-home-player")).toContainText("夜航");
  await expect(page.locator(".music-home-playlists")).toContainText("Playlist summaries unavailable");
  unavailable = false;
  await page.locator(".music-home-playlists").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator(".music-home-playlists .music-media-card")).toHaveCount(4);
});

test("hero resume keeps video takeover confirmation", async ({ page }) => {
  const { commands } = await musicFixtures(page, { owner: "video" });
  await page.goto("/#/app/music");
  await page.locator(".music-home-player").getByRole("button", { name: "Resume", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("Video is playing on the NAS");
  expect(commands).toHaveLength(1);
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator(".music-home-player").getByRole("button", { name: "Resume", exact: true })).toBeFocused();
  expect(commands).toHaveLength(1);
  await page.locator(".music-home-player").getByRole("button", { name: "Resume", exact: true }).click();
  await dialog.getByRole("button", { name: "Switch playback", exact: true }).click();
  await expect.poll(() => commands.length).toBe(3);
  expect(commands[2]).toMatchObject({ type: "resume", expectedSessionId: "music-session" });
});

test("playlist play preserves duplicate songs and stays separate from opening the playlist", async ({ page }) => {
  const { commands, requests } = await musicFixtures(page);
  await page.goto("/#/app/music");
  const card = page.locator(".music-home-playlists .music-media-card").first();
  await expect(card).toContainText("3 songs · 12:15");
  expect(requests.filter(url => url.startsWith("GET /playlists/"))).toEqual([]);
  await card.getByRole("button", { name: "Play 夜间漫游 / After Hours", exact: true }).click();
  await expect.poll(() => commands.length).toBe(1);
  expect(commands[0]).toMatchObject({ type: "replace", trackIds: ["song-0", "song-2", "song-0"] });
  await expect(page.locator(".music-detail-header")).toHaveCount(0);
  await card.getByRole("button", { name: "Open 夜间漫游 / After Hours", exact: true }).click();
  await expect(page.locator(".music-track-list > .music-track")).toHaveCount(3);
  expect(commands).toHaveLength(1);
});
