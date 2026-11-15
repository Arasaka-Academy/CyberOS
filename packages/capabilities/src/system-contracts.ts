import type { JsonSchema } from "./contracts.js";
import type { ParityManifestEntry } from "./parity-manifest.js";
import { EMPTY_OBJECT_SCHEMA, PAGINATION_PROPERTIES, strictObject } from "./schemas.js";

const text = (maximum = 256): JsonSchema => ({ type: "string", minLength: 1, maxLength: maximum });
const flag: JsonSchema = { type: "boolean" };
const number = (minimum: number, maximum: number): JsonSchema => ({ type: "number", minimum, maximum });
const integer = (minimum: number, maximum: number): JsonSchema => ({ type: "integer", minimum, maximum });
const choice = (...values: string[]): JsonSchema => ({ type: "string", enum: values });
const nullable = (schema: JsonSchema): JsonSchema => ({ anyOf: [schema, { type: "null" }] });
const array = (items: JsonSchema, maximum = 200, minimum = 0): JsonSchema => ({ type: "array", items, maxItems: maximum, minItems: minimum, uniqueItems: true });
const relativePath: JsonSchema = { ...text(4096), pattern: "^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$)).+$" };
const revision = text(256);
const date: JsonSchema = { ...text(64), format: "date-time" };
const operation = (name: string, properties: Record<string, JsonSchema> = {}, required: string[] = []): JsonSchema => strictObject({ operation: { const: name }, ...properties }, ["operation", ...required]);
const proposal = (...variants: JsonSchema[]): JsonSchema => strictObject({ request: { oneOf: variants }, idempotencyKey: text(200) }, ["request"]);
const entry = (capabilityId: ParityManifestEntry["capabilityId"], domain: string, uiOutcome: string, rest: string[] = [], mutation = false, confirm = false): Omit<ParityManifestEntry, "owner"> => ({
  capabilityId, domain, uiOutcome, rest, risk: mutation ? confirm ? "critical" : "high" : "read", approval: mutation ? confirm ? "first_party_confirm" : "first_party" : "none"
});

/** Additive capabilities; existing identifiers and scopes retain their meaning. */
export const SYSTEM_CAPABILITY_ENTRIES = [
  entry("cyberos.system.health", "system", "Read live system health and storage readiness", ["GET /api/system/health"]),
  entry("cyberos.system.info", "system", "Read host hardware and operating system information", ["GET /api/settings/system-info"]),
  entry("cyberos.system.services", "system", "Read allowlisted CyberOS service status", ["GET /api/system/services"]),
  entry("cyberos.system.logs", "system", "Read bounded, redacted logs for an allowlisted CyberOS service", ["GET /api/system/services/:unit/logs"]),
  entry("cyberos.files.history", "files", "Read file operation history and restorable trash entries", ["GET /api/operations"]),
  entry("cyberos.files.batches", "files", "Read bounded file batch progress", ["GET /api/files/batches"]),
  entry("cyberos.files.restore-propose", "files", "Request approval to restore a trash entry", ["POST /api/trash/:id/restore"], true),
  entry("cyberos.files.extract-propose", "files", "Request approval to safely extract an archive", ["POST /api/files/extract"], true),
  entry("cyberos.files.batch-propose", "files", "Request approval for a batch move or trash operation", ["POST /api/files/batches"], true),
  entry("cyberos.files.batch-cancel-propose", "files", "Request cancellation of a file batch", ["POST /api/files/batches/:id/cancel"], true),
  entry("cyberos.photos.metadata", "photos", "Read non-sensitive photo metadata fields or asset metadata", ["GET /api/photos/metadata/fields", "GET /api/photos/:id/metadata"]),
  entry("cyberos.photos.semantic-status", "photos", "Read redacted semantic search settings", ["GET /api/settings/photos/semantic-search"]),
  entry("cyberos.photos.semantic-propose", "photos", "Request semantic search configuration, testing, rebuild or retry", ["PATCH /api/settings/photos/semantic-search", "POST /api/settings/photos/semantic-search/test", "POST /api/photos/semantic-index/rebuild", "POST /api/photos/semantic-index/retry"], true),
  entry("cyberos.downloads.preview", "downloads", "Read a torrent preview before selecting files", ["GET /api/downloads/torrent-previews/:id"]),
  entry("cyberos.downloads.preview-propose", "downloads", "Request bounded Magnet or storage-file torrent discovery, or discard a preview", ["POST /api/downloads/torrent-previews", "DELETE /api/downloads/torrent-previews/:id"], true),
  entry("cyberos.downloads.files", "downloads", "Read a torrent task file list", ["GET /api/downloads/:id/files"]),
  entry("cyberos.docker.get", "docker", "Read container, app, network, volume, daemon configuration or bounded logs", ["GET /api/docker/apps/:id", "GET /api/docker/containers/:id", "GET /api/docker/networks/:id", "GET /api/docker/volumes/:name", "GET /api/docker/daemon/config", "GET /api/docker/containers/:id/logs"]),
  entry("cyberos.alerts.get", "alerts", "Read an incident, delivery or redacted SMTP configuration", ["GET /api/monitoring/alerts/incidents/:id", "GET /api/monitoring/alerts/deliveries/:id", "GET /api/monitoring/alerts/smtp"]),
  entry("cyberos.nvr.status", "nvr", "Read cameras, recording policy and NVR readiness"),
  entry("cyberos.nvr.query", "nvr", "Query cameras, recording segments, events or PTZ status"),
  entry("cyberos.nvr.resource-link", "nvr", "Create an authenticated one-time camera snapshot or recording download link"),
  entry("cyberos.nvr.manage-propose", "nvr", "Request camera discovery, registration, recording policy or PTZ changes", [], true, true),
  entry("cyberos.tailscale.status", "tailscale", "Read Tailscale or Headscale state, peers, routes and pending transaction"),
  entry("cyberos.tailscale.manage-propose", "tailscale", "Request login, connection, service, routes, exit node, confirmation or rollback", [], true, true),
  entry("cyberos.bluetooth.status", "bluetooth", "Read BlueZ devices, adapters and transfer settings", ["GET /api/system/bluetooth", "GET /api/system/bluetooth/settings"]),
  entry("cyberos.bluetooth.transfers", "bluetooth", "Read Bluetooth transfers and daemon health", ["GET /api/system/bluetooth/transfers"]),
  entry("cyberos.bluetooth.manage-propose", "bluetooth", "Request adapter, pairing, trust, connection, transfer or inbox changes; pairing challenges remain human-only", [], true, true),
  entry("cyberos.iscsi.status", "iscsi", "Read iSCSI targets, LUNs, sessions and capacity", ["GET /api/storage/iscsi"]),
  entry("cyberos.iscsi.manage-propose", "iscsi", "Request revision-guarded iSCSI target and LUN changes", ["POST /api/storage/iscsi/actions"], true, true),
  entry("cyberos.audio.status", "audio", "Read audio service, devices, settings or bounded voice history", ["GET /api/audio/status", "GET /api/audio/devices", "GET /api/audio/history", "GET /api/settings/audio"]),
  entry("cyberos.audio.control-propose", "audio", "Request audio configuration, explicit diagnostic tests, stop or context reset", ["PATCH /api/settings/audio", "POST /api/audio/test/service", "POST /api/audio/test/recording", "POST /api/audio/test/speech", "POST /api/audio/stop", "POST /api/audio/session/reset"], true, true),
  entry("cyberos.settings.proxy", "settings", "Read non-secret system proxy configuration", ["GET /api/settings/proxy"]),
  entry("cyberos.settings.proxy-propose", "settings", "Request system proxy configuration", ["PATCH /api/settings/proxy"], true),
  entry("cyberos.backup.snapshots", "backup", "Read bounded backup repository snapshots", ["GET /api/backup/snapshots"]),
  entry("cyberos.backup.coverage", "backup", "Read protected and excluded data with backup limitations", ["GET /api/backup/coverage"]),
  entry("cyberos.backup.restore-propose", "backup", "Request a verified v2 snapshot restore to fresh staging, preserving live data", ["POST /api/backup/restore"], true, true),
  entry("cyberos.tasks.get", "tasks", "Read the domain task linked to an owned capability run"),
  entry("cyberos.tasks.list", "tasks", "List domain tasks linked to owned capability runs"),
  entry("cyberos.tasks.wait", "tasks", "Wait briefly for an owned domain task to change or complete"),
  entry("cyberos.tasks.cancel-propose", "tasks", "Request cancellation of an owned cancellable domain task", [], true)
];

const bluetoothDevice = { adapterId: text(), address: { ...text(17), pattern: "^(?:[0-9A-Fa-f]{2}:){5}[0-9A-Fa-f]{2}$" } };
const iscsiTarget = { name: text(128), address: text(45), port: integer(1, 65535), initiators: array(text(), 64, 1), chap: strictObject({ enabled: flag, username: { type: "string", maxLength: 128 }, replacePassword: flag }, ["enabled", "username"]) };
const ptz = { oneOf: [
  ...["absolute_move", "relative_move", "continuous_move"].map((action) => strictObject({ action: { const: action }, pan: number(-1, 1), tilt: number(-1, 1) }, ["action", "pan", "tilt"])),
  ...["stop", "home"].map((action) => strictObject({ action: { const: action } }, ["action"])),
  strictObject({ action: { const: "set_preset" }, name: text(64), token: nullable(text(64)) }, ["action", "name", "token"]),
  ...["goto_preset", "remove_preset"].map((action) => strictObject({ action: { const: action }, token: text(64) }, ["action", "token"]))
] };
const numericRange = strictObject({ min: { type: "number" }, max: { type: "number" } });
const location = { oneOf: [
  strictObject({ kind: { const: "near" }, latitude: number(-90, 90), longitude: number(-180, 180), radiusMeters: number(1, 40_100_000) }, ["kind", "latitude", "longitude", "radiusMeters"]),
  strictObject({ kind: { const: "bounds" }, west: number(-180, 180), east: number(-180, 180), south: number(-90, 90), north: number(-90, 90) }, ["kind", "west", "east", "south", "north"])
] };

export const SYSTEM_CAPABILITY_SCHEMAS: Readonly<Record<string, JsonSchema>> = {
  "cyberos.system.health": EMPTY_OBJECT_SCHEMA,
  "cyberos.system.info": EMPTY_OBJECT_SCHEMA,
  "cyberos.system.services": strictObject({ unit: text(128) }),
  "cyberos.system.logs": strictObject({ unit: text(128), limit: integer(1, 200), since: date }, ["unit"]),
  "cyberos.files.history": strictObject({ ...PAGINATION_PROPERTIES, storagePoolId: text(128) }),
  "cyberos.files.batches": strictObject({ storagePoolId: text(128), limit: integer(1, 100) }),
  "cyberos.files.restore-propose": proposal(operation("restore", { trashEntryId: text(128) }, ["trashEntryId"])),
  "cyberos.files.extract-propose": proposal(operation("extract", { storagePoolId: text(128), path: relativePath }, ["storagePoolId", "path"])),
  "cyberos.files.batch-propose": proposal(...["move", "trash"].map((name) => operation(name, { storagePoolId: text(128), sourcePaths: array(relativePath, 500, 1), targetDirectory: relativePath }, name === "move" ? ["storagePoolId", "sourcePaths", "targetDirectory"] : ["storagePoolId", "sourcePaths"]))),
  "cyberos.files.batch-cancel-propose": proposal(operation("cancel", { batchId: text(128) }, ["batchId"])),
  "cyberos.photos.query": strictObject({ assetId: text(), ...PAGINATION_PROPERTIES, limit: integer(1, 100), filters: strictObject({ text: text(512), capturedAt: strictObject({ from: date, to: date }), mediaKinds: array(choice("image", "video", "raw"), 3), cameraModels: array(text()), lensModels: array(text()), iso: numericRange, aperture: numericRange, exposureTimeSeconds: numericRange, focalLengthMm: numericRange, rating: numericRange, keywords: array(text()), hasLocation: flag, location, advanced: strictObject({ mode: choice("all", "any"), conditions: array(strictObject({ key: text(128), operator: choice("eq", "prefix", "contains", "exists", "not_exists", "gt", "gte", "lt", "lte", "between", "in"), value: { anyOf: [{ type: "string", maxLength: 1024 }, { type: "number" }, flag, { type: "null" }, array({ anyOf: [text(1024), { type: "number" }] }, 100)] }  , valueTo: { anyOf: [text(1024), { type: "number" }] } }, ["key", "operator"]), 50) }, ["mode", "conditions"]) }), sort: strictObject({ field: choice("captured_at", "indexed_at", "name", "size_bytes", "rating", "distance", "relevance"), direction: choice("asc", "desc") }, ["field", "direction"]), includeFacets: flag }),
  "cyberos.photos.metadata": strictObject({ assetId: text(), query: text(256), limit: integer(1, 200) }),
  "cyberos.photos.semantic-status": EMPTY_OBJECT_SCHEMA,
  "cyberos.photos.semantic-propose": proposal(operation("rebuild"), operation("retry"), ...["configure", "test"].map((name) => operation(name, { enabled: flag, baseUrl: text(2048), model: text(256), minSimilarity: number(0, 1), replaceToken: flag, clearToken: flag }))),
  "cyberos.downloads.preview": strictObject({ previewId: text(128), limit: integer(1, 200), cursor: nullable(text(2048)) }, ["previewId"]),
  "cyberos.downloads.preview-propose": proposal(operation("magnet", { magnet: text(8192) }, ["magnet"]), operation("file", { storagePoolId: text(128), path: relativePath }, ["storagePoolId", "path"]), operation("delete", { previewId: text(128) }, ["previewId"])),
  "cyberos.downloads.files": strictObject({ taskId: text(128), ...PAGINATION_PROPERTIES }, ["taskId"]),
  "cyberos.docker.get": strictObject({ entity: choice("container", "app", "network", "volume", "daemon", "logs"), id: text(), tail: integer(1, 500), limit: integer(1, 100) }, ["entity"]),
  "cyberos.alerts.get": strictObject({ entity: choice("incident", "delivery", "smtp"), id: text() }, ["entity"]),
  "cyberos.nvr.status": strictObject({ limit: integer(1, 100) }),
  "cyberos.nvr.query": strictObject({ entity: choice("device", "segments", "events", "ptz"), deviceId: text(), from: date, to: date, ...PAGINATION_PROPERTIES }, ["entity"]),
  "cyberos.nvr.resource-link": strictObject({ variant: choice("snapshot", "segment"), id: text() }, ["variant", "id"]),
  "cyberos.nvr.manage-propose": proposal(operation("discover"), operation("add", { name: text(64), onvifUrl: text(2048) }, ["name", "onvifUrl"]), operation("update", { deviceId: text(), expectedUpdatedAt: date, name: text(64), recordingEnabled: flag, recordingProfile: choice("raw", "annotated") }, ["deviceId", "expectedUpdatedAt"]), operation("delete", { deviceId: text(), expectedUpdatedAt: date }, ["deviceId", "expectedUpdatedAt"]), operation("policy", { storagePoolId: nullable(text(128)), directory: relativePath, retentionDays: integer(1, 3650), quotaBytes: integer(1_073_741_824, Number.MAX_SAFE_INTEGER) }, ["storagePoolId", "directory", "retentionDays", "quotaBytes"]), operation("ptz", { deviceId: text(), expectedUpdatedAt: date, command: ptz }, ["deviceId", "expectedUpdatedAt", "command"])),
  "cyberos.tailscale.status": EMPTY_OBJECT_SCHEMA,
  "cyberos.tailscale.manage-propose": proposal(operation("login", { controlUrl: text(1024), method: choice("browser", "auth_key"), expectedRevision: revision }, ["controlUrl", "method", "expectedRevision"]), operation("service", { autoStart: flag, expectedRevision: revision }, ["autoStart", "expectedRevision"]), operation("action", { action: choice("connect", "disconnect", "logout", "start", "restart"), expectedRevision: revision }, ["action", "expectedRevision"]), operation("settings", { expectedRevision: revision, settings: strictObject({ acceptDns: flag, acceptRoutes: flag, exitNodeAllowLanAccess: flag, advertiseExitNode: flag, hostname: text(63), exitNodeId: { type: "string", maxLength: 256 }, advertisedRoutes: array(text(64), 128) }) }, ["expectedRevision", "settings"]), ...["confirm", "rollback"].map((name) => operation(name, { transactionId: text(128) }, ["transactionId"]))),
  "cyberos.bluetooth.status": EMPTY_OBJECT_SCHEMA,
  "cyberos.bluetooth.transfers": strictObject({ ...PAGINATION_PROPERTIES }),
  "cyberos.bluetooth.manage-propose": proposal(operation("power", { adapterId: text(), powered: flag }, ["adapterId", "powered"]), operation("default_adapter", { adapterId: text() }, ["adapterId"]), ...["scan_start", "scan_stop"].map((name) => operation(name, { adapterId: text() }, ["adapterId"])), ...["pair", "cancel_pairing", "connect", "disconnect", "unpair"].map((name) => operation(name, bluetoothDevice, ["adapterId", "address"])), operation("trust", { ...bluetoothDevice, trusted: flag }, ["adapterId", "address", "trusted"]), operation("send", { ...bluetoothDevice, storagePoolId: text(128), paths: array(relativePath, 100, 1) }, ["adapterId", "address", "storagePoolId", "paths"]), operation("cancel_transfer", { transferId: text(128) }, ["transferId"]), operation("settings", { defaultAudioDeviceId: nullable(text()), receiveEnabled: flag, inboxStoragePoolId: nullable(text(128)), inboxPath: relativePath })),
  "cyberos.iscsi.status": EMPTY_OBJECT_SCHEMA,
  "cyberos.iscsi.manage-propose": proposal(operation("create_target", { ...iscsiTarget, expectedRevision: revision, enabled: flag }, ["name", "address", "port", "initiators", "chap", "expectedRevision", "enabled"]), operation("update_target", { ...iscsiTarget, targetId: text(), expectedRevision: revision }, ["name", "address", "port", "initiators", "chap", "expectedRevision", "targetId"]), operation("set_target_enabled", { targetId: text(), enabled: flag, expectedRevision: revision }, ["targetId", "enabled", "expectedRevision"]), operation("delete_target", { targetId: text(), destroyImages: flag, confirmation: text(128), expectedRevision: revision }, ["targetId", "destroyImages", "expectedRevision"]), operation("create_lun", { targetId: text(), name: text(128), storagePoolId: text(128), sizeBytes: integer(1_073_741_824, Number.MAX_SAFE_INTEGER), expectedRevision: revision }, ["targetId", "name", "storagePoolId", "sizeBytes", "expectedRevision"]), operation("attach_lun", { targetId: text(), imageId: text(), expectedRevision: revision }, ["targetId", "imageId", "expectedRevision"]), operation("detach_lun", { targetId: text(), imageId: text(), destroyImage: flag, confirmation: text(128), expectedRevision: revision }, ["targetId", "imageId", "destroyImage", "expectedRevision"]), operation("destroy_image", { imageId: text(), confirmation: text(128), expectedRevision: revision }, ["imageId", "confirmation", "expectedRevision"])),
  "cyberos.audio.status": strictObject({ view: choice("status", "devices", "settings", "history"), before: text(16), limit: integer(1, 50) }),
  "cyberos.audio.control-propose": proposal(...["service_test", "recording_test", "stop", "reset"].map((name) => operation(name)), operation("speech_test", { text: text(500) }, ["text"]), operation("settings", { cyberAudioBaseUrl: nullable(text(2048)), replaceToken: flag, clearToken: flag, enabled: flag, inputDeviceId: nullable(text()), maxRecordingSeconds: integer(1, 30), sttLanguage: choice("auto", "zh", "en"), ttsLanguage: choice("auto", "zh", "en"), ttsVoice: { type: "string", maxLength: 100 }, ttsInstructions: { type: "string", maxLength: 200 }, speechEnabled: flag, outputDeviceId: nullable(text()), volume: integer(0, 100) })),
  "cyberos.settings.proxy": EMPTY_OBJECT_SCHEMA,
  "cyberos.settings.proxy-propose": proposal(operation("configure", { protocol: choice("http", "https", "socks5"), host: nullable({ type: "string", maxLength: 253 }), port: nullable(integer(1, 65535)) }, ["protocol", "host", "port"])),
  "cyberos.backup.snapshots": strictObject({ ...PAGINATION_PROPERTIES }),
  "cyberos.backup.coverage": EMPTY_OBJECT_SCHEMA,
  "cyberos.backup.restore-propose": proposal(operation("restore", { snapshotId: { ...text(64), pattern: "^[a-f0-9]{8,64}$" } }, ["snapshotId"])),
  "cyberos.tasks.get": strictObject({ runId: text(128) }, ["runId"]),
  "cyberos.tasks.list": strictObject({ ...PAGINATION_PROPERTIES }),
  "cyberos.tasks.wait": strictObject({ runId: text(128), timeoutMs: integer(0, 20_000), afterRevision: text(64) }, ["runId"]),
  "cyberos.tasks.cancel-propose": proposal(operation("cancel", { runId: text(128) }, ["runId"]))
};

export const ADDITIONAL_PROPOSAL_OPERATIONS: Readonly<Record<string, readonly JsonSchema[]>> = {
  "cyberos.downloads.manage-propose": [operation("create_torrent", { torrentPreviewId: text(128), selectedFileIndices: array(integer(0, 9999), 10000, 1), storagePoolId: text(128), targetDirectory: relativePath, fileName: text(255), seedRatioLimit: { const: 1 }, seedTimeLimitSeconds: { const: 7200 } }, ["torrentPreviewId", "selectedFileIndices", "storagePoolId", "targetDirectory", "fileName"]), operation("stop_seeding", { taskId: text(128) }, ["taskId"])]
};
