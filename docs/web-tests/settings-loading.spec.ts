import { test, expect, type Page } from "@playwright/test";
import { fixtures } from "./fixtures";
import { defaultToolPolicyForm } from "../../packages/web/src/config/settings";

const provider = { providerName: "openai", baseUrl: null, model: "fixture-model", apiKeyConfigured: true, updatedAt: "2026-11-08T00:00:00.000Z" };
const configurationPaths = ["/api/settings/model-provider", "/api/settings/agent-capability-policy", "/api/settings/docker", "/api/settings/vm"] as const;

async function readyApp(page: Page, locale = "en") {
  await fixtures(page, locale);
  await page.route("**/api/settings/model-provider", route => route.fulfill({ json: { settings: provider } }));
  await page.goto("/");
  await expect(page.locator(".composer textarea")).toBeVisible();
  await expect(page.getByRole("button", { name: "System settings", exact: true })).toBeEnabled();
}

async function section(page: Page, name: string | RegExp) {
  await page.locator(".settings-nav button").filter({ hasText: name }).click();
}

test("settings shell opens within 500ms while detail code and API are suspended", async ({ page }, info) => {
  await readyApp(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route(/\/components\/settings\/Settings(?:Modal|Content)\.tsx(?:\?|$)/, async route => { await gate; await route.continue(); });
  await page.route("**/api/settings/system-info", async route => { await gate; await route.fulfill({ json: { info: null } }); });
  try {
    await page.getByRole("button", { name: "System settings", exact: true }).click();
    await expect(page.locator(".settings-modal")).toBeVisible({ timeout: 500 });
    await expect(page.locator(".settings-nav button")).toHaveCount(25);
    await page.screenshot({ path: info.outputPath("shell-pending-details.png") });
    await expect(page.getByRole("button", { name: "Close settings", exact: true })).toBeEnabled();
    const search = page.getByRole("textbox", { name: "Search settings" });
    await expect(search).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(page.getByRole("button", { name: "Close settings", exact: true })).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(search).toBeFocused();
    await search.fill("Appearance");
    await section(page, /^Appearance$/);
    await expect(page.locator(".appearance-picker")).toBeVisible();
    await page.locator('[data-theme-swatch="amber"]').click();
    await expect(page.locator("html")).toHaveAttribute("data-cyber-scheme", "amber");
    await page.screenshot({ path: info.outputPath("shell-local-page-during-load.png") });
    await page.keyboard.press("Escape");
    await expect(page.locator(".settings-modal")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "System settings", exact: true })).toBeFocused();
  } finally { release(); }
});

for (const [name, endpoint] of [["Model Providers", configurationPaths[0]], ["Pi Agent", configurationPaths[1]], ["Docker", configurationPaths[2]], ["Virtual Machines", configurationPaths[3]]] as const) {
  test(`${name} saves only its own configuration`, async ({ page }) => {
    await readyApp(page);
    const writes: string[] = [];
    await page.route(/\/api\/settings\/(?:model-provider|agent-capability-policy|docker|vm)$/, async route => {
      const path = new URL(route.request().url()).pathname;
      if (route.request().method() !== "GET") writes.push(path);
      const settings = path === configurationPaths[0] ? provider : path === configurationPaths[1] ? defaultToolPolicyForm() : { enabled: true, updatedAt: provider.updatedAt };
      await route.fulfill({ json: { settings } });
    });
    await page.getByRole("button", { name: "System settings", exact: true }).click();
    await section(page, new RegExp(`^${name}$`));
    await page.locator('.settings-content button[type="submit"]').click();
    await expect.poll(() => writes.length).toBeGreaterThan(0);
    await expect(page.locator('.settings-content button[type="submit"]')).toBeEnabled();
    expect(writes).toEqual([endpoint]);
  });
}

const pageReads = [
  ["Overview", ["/api/settings/system-info"]],
  ["Version", ["/api/system/build-info"]],
  ["Model Providers", [configurationPaths[0]]],
  ["Pi Agent", [configurationPaths[1]]],
  ["Docker", [configurationPaths[2]]],
  ["Virtual Machines", [configurationPaths[3]]],
  ["Downloads", ["/api/settings/downloads"]],
  ["Indexer", ["/api/settings/indexer", "/api/indexer/status"]],
  ["Photos", ["/api/photos/settings", "/api/settings/photos", "/api/photos/status"]],
  ["Wireless", ["/api/system/network"]],
  ["Bluetooth", ["/api/system/bluetooth"]]
] as const;

test("requests only the visible page and reuses resources during the same opening", async ({ page }) => {
  await readyApp(page);
  const watched = new Set<string>(pageReads.flatMap(([, paths]) => [...paths]));
  const counts = new Map<string, number>();
  await page.route("**/api/**", async route => {
    const path = new URL(route.request().url()).pathname;
    if (!watched.has(path)) return route.fallback();
    counts.set(path, (counts.get(path) ?? 0) + 1);
    await route.fulfill({ status: 503, json: { error: `Unavailable: ${path}` } });
  });
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  const expected: string[] = [];
  for (const [name, paths] of pageReads) {
    await section(page, new RegExp(`^${name}$`));
    expected.push(...paths);
    await expect.poll(() => [...counts.keys()].sort()).toEqual([...expected].sort());
    for (const path of paths) expect(counts.get(path)).toBe(1);
    await expect(page.locator(".settings-resource-errors")).toBeVisible();
    await expect(page.locator(".app-notification-error")).toHaveCount(0);
  }
  await section(page, /^Appearance$/);
  await section(page, /^Files & Preview$/);
  await section(page, /^Overview$/);
  expect([...counts.values()]).toEqual(expected.map(() => 1));
});

test("failed configuration retries locally and keeps a draft across page switches and save failures", async ({ page }) => {
  await readyApp(page);
  let reads = 0;
  let saves = 0;
  await page.route("**/api/settings/model-provider", route => {
    if (route.request().method() !== "GET") {
      saves += 1;
      return route.fulfill({ status: 409, json: { error: "Keep this draft" } });
    }
    reads += 1;
    return route.fulfill(reads === 1 ? { status: 503, json: { error: "Provider temporarily unavailable" } } : { json: { settings: provider } });
  });
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  await section(page, /^Model Providers$/);
  const error = page.locator('[data-settings-resource="providers"]');
  await expect(error).toContainText("Provider temporarily unavailable");
  await expect(page.locator('input[placeholder="provider/model-name"]')).toHaveCount(0);
  await error.getByRole("button", { name: "Retry", exact: true }).click();
  const model = page.locator('input[placeholder="provider/model-name"]');
  await expect(model).toHaveValue(provider.model);
  await model.fill("unsaved-draft");
  await section(page, /^Appearance$/);
  await section(page, /^Model Providers$/);
  await expect(model).toHaveValue("unsaved-draft");
  expect(reads).toBe(2);
  await page.locator('.settings-content button[type="submit"]').click();
  await expect(page.locator(".settings-resource-errors")).toContainText("Keep this draft");
  await expect(model).toHaveValue("unsaved-draft");
  expect(saves).toBe(1);
});

test("a slow Bluetooth read never blocks switching, and closed-round responses cannot replace a new form", async ({ page }) => {
  await readyApp(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let dockerReads = 0;
  let bluetoothReads = 0;
  await page.route("**/api/system/bluetooth", async route => {
    bluetoothReads += 1;
    await gate;
    await route.fulfill({ status: 503, json: { error: "Old Bluetooth error" } });
  });
  await page.route("**/api/settings/docker", async route => {
    dockerReads += 1;
    const old = dockerReads === 1;
    if (old) await gate;
    await route.fulfill({ json: { settings: { enabled: old, updatedAt: provider.updatedAt } } });
  });
  try {
    await page.getByRole("button", { name: "System settings", exact: true }).click();
    await section(page, /^Bluetooth$/);
    await expect.poll(() => bluetoothReads).toBe(1);
    await section(page, /^Docker$/);
    await expect.poll(() => dockerReads).toBe(1);
    await section(page, /^Appearance$/);
    await expect(page.locator(".appearance-picker")).toBeVisible();
    await section(page, /^Docker$/);
    expect(dockerReads).toBe(1);
    await page.getByRole("button", { name: "Close settings", exact: true }).click();
    await page.getByRole("button", { name: "System settings", exact: true }).evaluate(button => { if (button instanceof HTMLButtonElement) { button.click(); button.click(); } });
    await section(page, /^Docker$/);
    const toggle = page.getByRole("switch", { name: "Enable Docker management", exact: true });
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    const oldBluetoothResponse = page.waitForResponse(response => response.url().endsWith("/api/system/bluetooth"));
    release();
    await expect.poll(() => dockerReads).toBe(2);
    await oldBluetoothResponse;
    await expect(toggle).toHaveAttribute("aria-checked", "false");
    await expect(page.locator(".settings-resource-errors")).toHaveCount(0);
    await expect(page.locator(".app-notification").filter({ hasText: "Old Bluetooth error" })).toHaveCount(0);
  } finally { release(); }
});

test("pending Provider startup is shared with settings and cannot reset an edited form", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let reads = 0;
  await page.route("**/api/settings/model-provider", async route => {
    reads += 1;
    await gate;
    await route.fulfill({ json: { settings: provider } });
  });
  try {
    await page.goto("/#/app/settings");
    await section(page, /^Model Providers$/);
    await expect(page.locator('.settings-content [role="status"][aria-label="Loading"]')).toBeVisible();
    expect(reads).toBe(1);
    release();
    const model = page.locator('input[placeholder="provider/model-name"]');
    await expect(model).toHaveValue(provider.model);
    await model.fill("startup-safe-draft");
    await page.locator(".mobile-app-back:visible").click();
    await section(page, /^Appearance$/);
    await page.locator(".mobile-app-back:visible").click();
    await section(page, /^Model Providers$/);
    await expect(model).toHaveValue("startup-safe-draft");
    expect(reads).toBe(1);
  } finally { release(); }
});

test("indexer configuration is usable before status finishes and a status retry reads no configuration", async ({ page }) => {
  await readyApp(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let configurationReads = 0;
  let statusReads = 0;
  await page.route("**/api/settings/indexer", route => {
    configurationReads += 1;
    return route.fulfill({ json: { settings: {
      scanConcurrency: 4, extractionConcurrency: 2, reconciliationIntervalMs: 1_800_000,
      maxExtractedTextBytes: 2 * 1024 ** 2, maxSourceDocumentBytes: 512 * 1024 ** 2,
      commandTimeoutMs: 120_000, maxPdfTextPages: 500, maxOcrPages: 20, ocrStoragePoolIds: [], updatedAt: provider.updatedAt
    } } });
  });
  await page.route("**/api/indexer/status", async route => {
    statusReads += 1;
    await gate;
    await route.fulfill({ status: 503, json: { error: "Status temporarily offline" } });
  });
  try {
    await page.getByRole("button", { name: "System settings", exact: true }).click();
    await section(page, /^Indexer$/);
    await expect(page.locator('.settings-content button[type="submit"]')).toBeEnabled();
    await expect(page.locator('.settings-indexer-status [role="status"]')).toBeVisible();
    release();
    const statusError = page.locator('[data-settings-resource="indexerStatus"]');
    await expect(statusError).toContainText("Status temporarily offline");
    await expect(page.locator('.settings-content button[type="submit"]')).toBeEnabled();
    await statusError.getByRole("button", { name: "Retry", exact: true }).click();
    await expect.poll(() => statusReads).toBe(2);
    expect(configurationReads).toBe(1);
  } finally { release(); }
});

test("a ready unconfigured photo library is editable independently of processing and status failures", async ({ page }) => {
  await readyApp(page);
  let processingReads = 0;
  await page.route("**/api/photos/settings", route => route.fulfill({ json: { settings: null } }));
  await page.route("**/api/photos/status", route => route.fulfill({ status: 503, json: { error: "Photo status offline" } }));
  await page.route("**/api/settings/photos", route => {
    processingReads += 1;
    return route.fulfill(processingReads === 1 ? { status: 503, json: { error: "Processing settings unavailable" } } : { json: { settings: {
      mapDownloadUseProxy: false, processingConcurrency: 1, scanIntervalMs: 1_800_000, maxAutoRetries: 5,
      retryBaseDelayMs: 2000, retryMaxDelayMs: 300_000, commandTimeoutMs: 120_000,
      maxFileSizeBytes: 512 * 1024 ** 2, maxXmpSizeBytes: 16 * 1024 ** 2, maxIntermediateBytes: 2 * 1024 ** 3,
      minFreeSpaceBytes: 0, maxDecodedPixels: 268_402_689, updatedAt: provider.updatedAt
    } } });
  });
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  await section(page, /^Photos$/);
  await expect(page.locator(".settings-photo-library-actions button")).toBeEnabled();
  await expect(page.locator('[data-settings-resource="photoStatus"]')).toContainText("Photo status offline");
  await page.locator('[data-settings-resource="photoProcessing"]').getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.locator('.settings-content button[type="submit"]')).toBeEnabled();
  expect(processingReads).toBe(2);
  await expect(page.locator('[data-settings-resource="photoLibrary"]')).toHaveCount(0);
});

test("Voice opens Audio directly without reading Overview", async ({ page }) => {
  await readyApp(page);
  const reads: string[] = [];
  page.on("request", request => { if (/\/api\/settings\/(system-info|audio)$/.test(new URL(request.url()).pathname)) reads.push(new URL(request.url()).pathname); });
  await page.locator(".voice-entry").click();
  await page.getByRole("button", { name: "Audio settings", exact: true }).click();
  await expect(page.locator('.settings-content[data-settings-section="audio"]')).toBeVisible();
  await expect.poll(() => [...new Set(reads)]).toEqual(["/api/settings/audio"]);
});

test("player opens Bluetooth directly without reading Overview", async ({ page }) => {
  await fixtures(page);
  await page.route("**/api/settings/model-provider", route => route.fulfill({ json: { settings: provider } }));
  const music = {
    owner: "music", state: "paused", sessionId: null, serviceInstanceId: "fixture", revision: 1, queueVersion: 1,
    queue: [{ id: "item-1", trackId: "track-1", storagePoolId: "pool-1", relativePath: "song.flac", title: "Retained song", artist: "Artist", album: null, durationSeconds: 180, coverKey: null }],
    currentItemId: "item-1", repeat: "off", shuffle: false, positionSeconds: 30, durationSeconds: 180, volume: 80,
    audioDeviceId: null, effectiveAudioDeviceId: null, error: null, errorCode: null, updatedAt: provider.updatedAt
  };
  await page.route("**/api/music/player", route => route.fulfill({ json: { status: music } }));
  await page.route("**/api/playback/status", route => route.fulfill({ json: { status: {
    target: "nas", owner: "music", sessionId: null, serviceInstanceId: "fixture", revision: 1, music,
    video: { state: "idle", sessionId: null }, audioDelayKey: "default",
    preferences: { videoVolume: 80, videoMuted: false, musicMuted: false, videoAudioDeviceId: null, audioDelays: {} },
    output: { requested: { kind: "default", deviceId: null }, effective: { kind: "default", deviceId: null } }
  } } }));
  const reads: string[] = [];
  page.on("request", request => { if (["/api/settings/system-info", "/api/system/bluetooth"].includes(new URL(request.url()).pathname)) reads.push(new URL(request.url()).pathname); });
  await page.goto("/");
  await page.locator(".agent-playback-button").click();
  await page.locator(".playback-menu .playback-title").click();
  await page.getByRole("button", { name: "Bluetooth settings", exact: true }).click();
  await expect(page.locator('.settings-content[data-settings-section="bluetooth"]')).toBeVisible();
  await expect.poll(() => reads).toEqual(["/api/system/bluetooth"]);
});

test("late reads from another page never restart self-loading pages or reset their drafts", async ({ page }) => {
  await readyApp(page);
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let shareReads = 0;
  await page.route("**/api/settings/docker", async route => {
    await gate;
    await route.fulfill({ json: { settings: { enabled: true, updatedAt: provider.updatedAt } } });
  });
  await page.route("**/api/settings/shares", route => {
    shareReads += 1;
    return route.fulfill({ json: { settings: { enabled: true, account: { username: "cyberos-share", passwordConfigured: true }, shares: [], updatedAt: provider.updatedAt } } });
  });
  try {
    await page.getByRole("button", { name: "System settings", exact: true }).click();
    await section(page, /^Docker$/);
    await section(page, /^Shares$/);
    const username = page.locator('.settings-content input[autocomplete="username"]');
    await expect(username).toHaveValue("cyberos-share");
    await username.fill("retained-share-draft");
    const initialReads = shareReads;
    const lateResponse = page.waitForResponse(response => response.url().endsWith("/api/settings/docker"));
    release();
    await lateResponse;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    await expect(username).toHaveValue("retained-share-draft");
    expect(shareReads).toBe(initialReads);
  } finally { release(); }
});

test("a completed operation from a closed opening never refreshes the new opening", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixtures(page);
  await page.route("**/api/settings/model-provider", route => route.fulfill({ json: { settings: provider } }));
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let networkReads = 0;
  let radioWrites = 0;
  await page.route("**/api/system/network", route => {
    networkReads += 1;
    return route.fulfill({ json: { network: {
      status: "ready", capabilities: { backend: "NetworkManager", hostdReady: true, canManageWifi: true, canManageHotspot: false },
      ethernet: { backend: "NetworkManager", hostdReady: true },
      wifi: { backend: "NetworkManager", hostdReady: true, radioEnabled: false, profiles: [], hotspots: [], devices: [{
        id: "wlan0", name: "wlan0", state: "disconnected", mode: "client", activeConnectionId: null,
        capabilities: { accessPoint: false, bands: [], channels: [] }
      }] }
    } } });
  });
  await page.route("**/api/system/network/wifi/radio", async route => {
    radioWrites += 1;
    await gate;
    await route.fulfill({ json: { result: { accepted: true } } });
  });
  try {
    await page.goto("/#/app/settings");
    await section(page, /^Wireless$/);
    await page.getByRole("button", { name: "Scan", exact: true }).click();
    await page.getByRole("button", { name: "Enable Wi-Fi radio", exact: true }).click();
    await expect.poll(() => radioWrites).toBe(1);
    await page.evaluate(() => {
      window.history.pushState(window.history.state, "", "#/app/files");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await expect(page.locator(".settings-modal")).toHaveCount(0);
    await page.evaluate(() => {
      window.history.pushState(window.history.state, "", "#/app/settings");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    await expect(page.locator('.settings-modal[data-settings-view="list"]')).toBeVisible();
    const response = page.waitForResponse(result => result.url().endsWith("/api/system/network/wifi/radio"));
    release();
    await response;
    await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
    expect(networkReads).toBe(1);
    await expect(page.locator(".app-notification")).toHaveCount(0);
  } finally { release(); }
});

test("detail-module failure leaves menu, local settings and close available", async ({ page }) => {
  await readyApp(page);
  await page.route(/\/components\/settings\/SettingsContent\.tsx(?:\?|$)/, route => route.abort("failed"));
  await page.getByRole("button", { name: "System settings", exact: true }).click();
  await expect(page.getByRole("button", { name: "Reload page", exact: true })).toBeVisible();
  await section(page, /^Appearance$/);
  await expect(page.locator(".appearance-picker")).toBeVisible();
  await section(page, /^Files & Preview$/);
  await expect(page.locator("#preview-file-size-limit")).toBeEnabled();
  await page.getByRole("button", { name: "Close settings", exact: true }).click();
  await expect(page.locator(".settings-modal")).toHaveCount(0);
});

for (const locale of ["en", "zh-CN"] as const) {
  test(`mobile list and local settings never fetch the hidden overview (${locale})`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await fixtures(page, locale);
    let overviewReads = 0;
    await page.route("**/api/settings/system-info", route => { overviewReads += 1; return route.fulfill({ status: 503, json: { error: "Hidden overview must not load" } }); });
    await page.goto("/#/app/settings");
    await expect(page.locator('.settings-modal[data-settings-view="list"]')).toBeVisible();
    expect(overviewReads).toBe(0);
    await section(page, locale === "en" ? /^Appearance$/ : /^外观$/);
    await expect(page.locator(".appearance-picker")).toBeVisible();
    await page.locator(".mobile-app-back:visible").click();
    await expect(page.locator('.settings-modal[data-settings-view="list"]')).toBeVisible();
    await section(page, locale === "en" ? /^Files & Preview$/ : /^文件与预览$/);
    await expect(page.locator("#preview-file-size-limit")).toBeEnabled();
    expect(overviewReads).toBe(0);
  });
}
