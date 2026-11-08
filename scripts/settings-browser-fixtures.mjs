const timestamp = "2026-11-08T00:00:00.000Z";
const longName = "长期存储与自动化管理 / Long-running management ".repeat(3);
const longPath = `media/${"long-storage-directory/".repeat(8)}archive`;

export async function populatedSettings(api) {
  const overrides = new Map();
  const read = async url => {
    const response = await api.inject({ method: "GET", url });
    if (response.statusCode !== 200) throw new Error(`Fixture ${url}: ${response.statusCode}`);
    return response.json();
  };
  const set = (url, json) => overrides.set(url, { json });
  const storage = await read("/api/system/storage");
  storage.storage.pools = [{ id: "pool-1", name: longName, raidPath: "/dev/md0", raidLevel: "raid1", status: "ready", mountpoint: "/cyberos/data/pool-1", filesystem: "ext4", totalBytes: 1024000000, usedBytes: 512000000, availableBytes: 512000000, usedPercent: 50, memberDevices: [] }];
  set("/api/system/storage", storage);
  set("/api/files", { entries: [], git: null });
  const docker = await read("/api/docker/summary");
  docker.summary.capabilities.canUpdateDaemonConfiguration = true;
  set("/api/docker/summary", docker);
  set("/api/docker/daemon/config", { config: { path: "/etc/docker/daemon.json", content: "{\n  \"log-driver\": \"local\"\n}", revision: "fixture", exists: true, restartPending: false } });
  set("/api/settings/backup/directories", { roots: [{ id: "backup-root", name: "Backup destination", path: "/cyberos/backups" }], entries: [] });
  const mcp = await read("/api/settings/mcp");
  mcp.settings.servers = ["ready", "error", "untested"].map((testStatus, index) => ({
    id: `server-${index}`, name: longName, description: longName,
    url: `https://example.invalid/${longPath}/mcp`, timeoutSeconds: 30, exposure: "codemode",
    authMode: "bearer", credentialHeaderNames: [], enabled: index !== 2, allowInsecureHttp: false,
    testStatus, toolCount: 12, lastTestedAt: timestamp, lastError: testStatus === "error" ? longName : null,
    trustedAt: timestamp, generation: 1, createdAt: timestamp, updatedAt: timestamp, credentialsConfigured: true
  }));
  set("/api/settings/mcp", mcp);

  const skills = await read("/api/settings/skills");
  skills.settings.global = [0, 1, 2].map(index => ({
    id: `skill-${index}`, name: longName, description: longName, version: "1.0.0", sourceType: "git",
    sourceUrl: `https://example.invalid/${longPath}.git`, sourceRef: "main", sourceSubdirectory: longPath,
    sourceStoragePoolId: null, sourcePath: null, resolvedCommit: "a".repeat(40), digest: "b".repeat(64),
    enabled: index !== 2, diagnostics: index === 1 ? [longName] : [], generation: 1,
    createdAt: timestamp, updatedAt: timestamp
  }));
  skills.settings.project = {
    sessionId: null, path: longPath, trusted: false,
    skills: [{ name: longName, description: longName, path: `${longPath}/SKILL.md`, valid: false, diagnostics: [longName] }]
  };
  set("/api/settings/skills", skills);

  const network = await read("/api/system/network");
  network.network.status = "ready";
  Object.assign(network.network.capabilities, { backend: "NetworkManager", hostdReady: true, canManageWifi: true, canManageHotspot: true });
  Object.assign(network.network.wifi, {
    backend: "NetworkManager", radioEnabled: true, hostdReady: true,
    devices: [0, 1].map(index => ({
      id: `wlan${index}`, name: `wlan${index}`, mac: "12:34:56:78:90:AB", driver: "iwlwifi",
      state: "connected", mode: "client", activeConnectionId: `profile-${index}`, activeConnectionName: longName,
      ssid: longName, signal: 82, frequencyMHz: 5200, channel: 40, managementPath: true,
      capabilities: { accessPoint: true, bands: ["2.4", "5"], channels: [1, 6, 11, 36, 40] }
    })),
    profiles: [0, 1].map(index => ({
      id: `profile-${index}`, name: longName, ssid: longName, device: `wlan${index}`, security: "wpa2",
      autoconnect: true, active: true, managed: true, credentialConfigured: true, revision: "fixture"
    })),
    hotspots: [{ device: "wlan0", profileId: "hotspot-0", ssid: longName, band: "5", channel: 40, autostart: false, active: false, credentialConfigured: true, revision: "fixture", restoreProfileId: "profile-0" }]
  });
  set("/api/system/network", network);
  set("POST /api/system/network/wifi/scan", { scan: {
    device: "wlan0", scannedAt: timestamp,
    accessPoints: [{ ssid: longName, bssid: "12:34:56:78:90:AB", signal: 82, frequencyMHz: 5200, channel: 40, band: "5", security: "wpa2", active: true, savedProfileId: "profile-0" }]
  } });

  const bluetooth = await read("/api/system/bluetooth");
  Object.assign(bluetooth.bluetooth, {
    backend: "BlueZ", available: true, error: null,
    adapters: [0, 1].map(index => ({ id: `hci${index}`, address: "12:34:56:78:90:AB", name: `hci${index}`, alias: longName, state: "powered", powered: true, discovering: false, defaultAdapter: index === 0 })),
    devices: [0, 1, 2].map(index => ({ adapterId: "hci0", address: `12:34:56:78:90:0${index}`, name: longName, alias: longName, type: "speaker", rssi: -40, paired: true, trusted: true, connected: index === 0, servicesResolved: true, lastSeenAt: timestamp }))
  });
  set("/api/system/bluetooth", bluetooth);
  set("POST /api/system/bluetooth/scan/start", { result: { status: bluetooth.bluetooth, message: null } });
  set("POST /api/system/bluetooth/scan/stop", { result: { status: bluetooth.bluetooth, message: null } });
  const bluetoothSettings = await read("/api/system/bluetooth/settings");
  bluetoothSettings.audioDevices = [{ id: "speaker", adapterId: "hci0", address: "12:34:56:78:90:00", name: longName, connected: true }];
  set("/api/system/bluetooth/settings", bluetoothSettings);
  const transfers = await read("/api/system/bluetooth/transfers");
  transfers.health = { status: "ready", heartbeatAt: timestamp, error: null, activeTransfers: 1, queuedTransfers: 0 };
  transfers.transfers = ["running", "failed", "completed"].map((status, index) => ({
    id: `transfer-${index}`, direction: "send", adapterId: "hci0", deviceAddress: "12:34:56:78:90:00",
    storagePoolId: "pool-1", relativePath: longPath, displayName: `${longName}.zip`, status,
    transferredBytes: 2048, totalBytes: 4096, error: status === "failed" ? longName : null,
    obexTransferPath: null, controlRequested: null, readAt: null, createdAt: timestamp, updatedAt: timestamp,
    startedAt: timestamp, finishedAt: status === "running" ? null : timestamp, lastProgressAt: timestamp
  }));
  set("/api/system/bluetooth/transfers", transfers);

  const operations = await read("/api/system/operations?limit=5");
  Object.assign(operations.tasks.health, { status: "failed", lastRunAt: timestamp, lastSuccessAt: timestamp, lastDurationMs: 1234, error: longName });
  operations.runs = [0, 1, 2, 3, 4].map(index => ({ id: `run-${index}`, task: index % 2 ? "maintenance" : "health", status: index === 0 ? "failed" : "completed", startedAt: timestamp, heartbeatAt: timestamp, finishedAt: timestamp, summary: { scanned: 1240 }, error: index === 0 ? longName : null }));
  set("/api/system/operations?limit=5", operations);
  set("/api/system/operations?limit=5&task=health", { ...operations, runs: operations.runs.filter(run => run.task === "health") });
  set("/api/system/operations?limit=5&task=maintenance", { ...operations, runs: operations.runs.filter(run => run.task === "maintenance") });

  const tailscale = await read("/api/system/tailscale");
  Object.assign(tailscale.tailscale, {
    available: true, service: { installed: true, active: true, autoStart: true, state: "active" },
    version: "1.88.0", backendState: "Running", hostname: longName, dnsName: "management.example.invalid",
    account: "operator@example.invalid", tailnet: "example.invalid", ips: ["100.64.0.2", "fd7a:115c:a1e0::2"],
    health: [longName], error: null,
    peers: Array.from({ length: 12 }, (_, index) => ({
      id: `peer-${index}`, hostname: longName, dnsName: `peer-${index}.example.invalid`, os: "linux", ips: [`100.64.1.${index + 1}`],
      online: index % 2 === 0, active: true, directAddress: null, relay: "hkg", rxBytes: 102400, txBytes: 204800,
      lastSeen: timestamp, exitNodeOption: index === 0
    }))
  });
  set("/api/system/tailscale", tailscale);

  const source = { id: "music-source", name: longName, storagePoolId: "pool-1", path: longPath, enabled: true, createdAt: timestamp, updatedAt: timestamp };
  set("/api/music/sources", { sources: [source] });
  const music = await read("/api/music/status");
  Object.assign(music.status, { sourceCount: 1, trackCount: 12408, albumCount: 238, artistCount: 109,
    scans: [{ id: "music-scan", sourceId: source.id, status: "failed", generation: "fixture", scanned: 1200, added: 1100, updated: 100, removed: 0, currentPath: longPath, error: longName, createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp, finishedAt: timestamp }]
  });
  set("/api/music/status", music);
  const mediaSource = { ...source, id: "media-source", kind: "movie" };
  set("/api/media/sources", { sources: [mediaSource] });
  const mediaScan = { id: "media-scan", sourceId: mediaSource.id, status: "failed", generation: "fixture", scanned: 400, added: 300, updated: 100, removed: 0, unmatched: 12, currentPath: longPath, error: longName, workerId: null, leaseExpiresAt: null, createdAt: timestamp, updatedAt: timestamp, startedAt: timestamp, finishedAt: timestamp };
  set("/api/media/scans", { scans: [mediaScan] });
  set("/api/media/status", { status: { state: "degraded", sources: 1, titles: 400, movies: 300, series: 100, unmatched: 12, activeScan: null, latestScan: mediaScan } });
  set("/api/media/titles", { titles: [{ id: "unmatched-title", sourceId: mediaSource.id, kind: "movie", sourcePath: longPath, tmdbId: null, title: longName, originalTitle: null, overview: null, year: 2026, releaseDate: null, runtimeMinutes: null, originalLanguage: "zh", genres: [], metadataSource: "filename", matchStatus: "unmatched", matchConfidence: null, posterKey: null, backdropKey: null, addedAt: timestamp, updatedAt: timestamp, progress: null }] });
  set("/api/media/titles/unmatched-title/match-candidates", { candidates: [{ tmdbId: 1, kind: "movie", title: longName, originalTitle: null, overview: longName, year: 2026, releaseDate: null, originalLanguage: "zh", posterUrl: null, backdropUrl: null, popularity: 1 }] });

  const record = { revision: 1, createdAt: timestamp, updatedAt: timestamp };
  set("/api/monitoring/alerts/contacts", { contacts: [{ ...record, id: "contact-1", name: longName, email: "long-contact-address-for-oncall-management@example.invalid", enabled: true }] });
  set("/api/monitoring/alerts/groups", { groups: [{ ...record, id: "group-1", name: longName, contactIds: ["contact-1"] }] });
  set("/api/monitoring/alerts/schedules", { schedules: [{ ...record, id: "schedule-1", name: longName, timezone: "Asia/Shanghai", handoffWeekday: 1, handoffTime: "09:00", anchorDate: "2026-11-08", contactIds: ["contact-1"], overrides: [] }] });
  set("/api/monitoring/alerts/policies", { policies: [{ ...record, id: "policy-1", name: longName, enabled: true, stages: [{ delaySeconds: 0, repeatIntervalSeconds: 60, repeatCount: 3, targets: [{ type: "group", id: "group-1" }] }] }] });
  return overrides;
}
