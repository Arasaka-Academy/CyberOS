import type { Page } from "@playwright/test";

export const appIds = ["video", "downloads", "monitoring", "docker", "virtualMachines", "network", "storage", "shares", "terminal", "settings", "files", "photos", "music", "agent"];
export const stamp = "2026-11-02T00:00:00.000Z";
const session = { id: "session-1", currentPath: ".", firstMessage: "移动端会话 / Mobile session", lastMessage: null, pendingApprovalCount: 0, createdAt: stamp, updatedAt: stamp };
const tracks = Array.from({ length: 80 }, (_, i) => ({ id: `track-${i}`, title: `音乐 ${i} / Long song title`, artists: ["CyberOS"], artist: "CyberOS", album: "Test album", durationSeconds: 180, favorite: false, coverKey: null }));
const photos = Array.from({ length: 80 }, (_, i) => ({ id: `photo-${i}`, name: `照片 ${i}.jpg`, path: `photos/${i}.jpg`, storagePoolId: "pool-1", sizeBytes: 1024, width: 800, height: 600, takenAt: stamp, modifiedAt: stamp, mimeType: "image/jpeg", status: "ready", metadata: null }));
export const videoTitle = { id: "movie-1", sourceId: "source-1", kind: "movie", title: "CyberOS 测试影片", originalTitle: null, sourcePath: "media/test.webm", tmdbId: null, overview: "Test film", year: 2026, releaseDate: null, runtimeMinutes: 1, originalLanguage: null, genres: [], metadataSource: "local", matchStatus: "unmatched", matchConfidence: null, posterKey: null, backdropKey: null, addedAt: stamp, updatedAt: stamp, progress: null, personal: { favorite: false, watchlist: false, watched: null }, watched: false, rating: null, credits: [], seasons: [], artwork: [], fileProgress: {}, episodeWatched: {}, technical: {}, nextFileId: "movie-file", files: [{ id: "movie-file", titleId: "movie-1", name: "test.webm", relativePath: "media/test.webm", storagePoolId: "pool-1", available: true, sizeBytes: 1024, durationSeconds: 1, videoCodec: "vp8", audioCodec: null, width: 160, height: 90 }] };

export async function fixtures(page: Page, locale = "en") {
  page.on("pageerror", (error) => console.error(error.stack));
  await page.addInitScript((language) => {
    localStorage.setItem("cyberos:language", language);
    // Keep connection subscriptions observable without a real backend.
    class FixtureEvents extends EventTarget {
      static opened: Record<string, number> = {};
      constructor(public url: string) { super(); FixtureEvents.opened[url] = (FixtureEvents.opened[url] ?? 0) + 1; }
      close() {}
    }
    Object.defineProperty(window, "EventSource", { value: FixtureEvents });
  }, locale);
  await page.route("**/health", (route) => route.fulfill({ json: { ok: true } }));
  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    let body: unknown;
    if (path === "/api/system/storage") body = { storage: { pools: [{ id: "pool-1", mountpoint: "/cyberos/data/pool-1", filesystem: "btrfs", status: "ready", memberDevices: [], totalBytes: 102400, usedBytes: 1024, availableBytes: 101376, usedPercent: 1, raidLevel: null }], disks: [], arrays: [], mounts: [], issues: [], metrics: {}, capabilities: {} } };
    else if (path === "/api/sessions") body = { sessions: [session] };
    else if (path.endsWith("/transcript")) body = { transcript: [], liveEvents: [], activeJob: null, lastEventId: 0 };
    else if (path.endsWith("/approvals")) body = { capabilityApprovals: [] };
    else if (path === "/api/notifications/summary") body = { operations: 0, bluetoothTransfers: 0, alerts: 0 };
    else if (path === "/api/notifications") body = { notifications: [], bluetoothTransfers: [], unreadCount: 0, bluetoothUnreadCount: 0 };
    else if (path === "/api/monitoring/alerts/incidents") body = { incidents: [] };
    else if (path.endsWith("/operations") || path === "/api/operations") body = { operations: [] };
    else if (path === "/api/files/batches") body = { batches: [] };
    else if (path === "/api/files") {
      const dir = url.searchParams.get("path") ?? ".";
      body = { git: null, entries: Array.from({ length: 100 }, (_, i) => ({ name: i === 0 && dir === "." ? "Documents" : `${String(i).padStart(3, "0")} 超长中文文件名称 Long filename with spaces and details.txt`, path: dir === "." ? i === 0 ? "Documents" : `file-${i}.txt` : `${dir}/file-${i}.txt`, kind: i === 0 && dir === "." ? "directory" : "file", sizeBytes: 1024, modifiedAt: stamp, isSafe: true })) };
    }
    else if (path === "/api/photos/settings") body = { settings: { storagePoolId: "pool-1", path: "photos", updatedAt: stamp } };
    else if (path === "/api/photos/status") body = { status: { state: "ready", total: 80, processed: 80, scanned: 80, failed: 0, retryCount: 0, nextRetryAt: null, error: null, updatedAt: stamp }, workerHealth: { status: "ready", freshWorkers: 1, activeJobs: 0, queuedJobs: 0, retryingJobs: 0, lastHeartbeatAt: stamp } };
    else if (path === "/api/photos/query") body = { photos, total: photos.length, nextCursor: null, facets: null };
    else if (path === "/api/photos/metadata/fields") body = { fields: [] };
    else if (/\/api\/photos\/photo-\d+\/metadata/.test(path)) body = { fields: [], groups: [], privacy: {}, asset: photos[0] };
    else if (path.endsWith("/preview") || path.endsWith("/thumbnail")) return route.fulfill({ contentType: "image/svg+xml", body: '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="600"><rect width="800" height="600" fill="#211016"/></svg>' });
    else if (path === "/api/music/home") body = { recentlyAdded: [], recentlyPlayed: tracks.slice(0, 8), mostPlayed: [], favorites: [] };
    else if (path === "/api/music/tracks") body = { items: tracks, nextCursor: null };
    else if (path === "/api/music/albums") body = { items: [], nextCursor: null };
    else if (path === "/api/music/artists") body = { items: [], nextCursor: null };
    else if (path === "/api/music/playlists") body = { items: [], nextCursor: null };
    else if (path === "/api/music/sources") body = { sources: [] };
    else if (path === "/api/music/library") body = { state: "idle", tracks: 80, albums: 0, artists: 0 };
    else if (path === "/api/media/home") body = { continueWatching: [], upNext: [], recentlyAdded: [videoTitle], watchlist: [], movies: [videoTitle], series: [], collections: [] };
    else if (path === "/api/media/titles") body = { titles: [videoTitle], nextCursor: null };
    else if (path === "/api/media/titles/movie-1") body = { title: videoTitle };
    else if (path === "/api/media/collections") body = { collections: [] };
    else if (path === "/api/media/sources") body = { sources: [] };
    else return route.fulfill({ status: 503, json: { error: "Fixture service unavailable" } });
    return route.fulfill({ json: body });
  });
}
