/**
 * [INPUT]: 依赖产品 HTTP 动作与能力清单的映射契约。
 * [OUTPUT]: 提供补充映射和第一方专用接口的排除理由。
 * [POS]: 产品动作覆盖边界；凭据、屏保与 TV 输出保留第一方。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
/** Product actions omitted from an entry's original route list, with their implemented capability. */
export const ADDITIONAL_PRODUCT_ACTIONS: Readonly<Record<string, readonly string[]>> = {
  "cyberos.photos.status": ["GET /api/settings/photos"],
  "cyberos.photos.query": ["GET /api/photos"],
  "cyberos.photos.media": ["GET /api/photos/:id/original"],
  "cyberos.photos.manage-propose": ["PUT /api/photos/settings"],
  "cyberos.downloads.manage-propose": ["POST /api/downloads/:id/stop-seeding"],
  "cyberos.backup.run-propose": ["POST /api/settings/backup/initialize", "POST /api/settings/backup/validate"],
  "cyberos.docker.manage-propose": ["POST /api/docker/registries", "PATCH /api/docker/registries/:id", "DELETE /api/docker/registries/:id"],
  "cyberos.alerts.read": ["GET /api/monitoring/alerts/contacts", "GET /api/monitoring/alerts/groups", "GET /api/monitoring/alerts/schedules", "GET /api/monitoring/alerts/policies", "GET /api/monitoring/alerts/health-routing", "GET /api/monitoring/alerts/silences"],
  "cyberos.alerts.manage-propose": [
    "POST /api/monitoring/alerts/incidents/:id/acknowledge", "POST /api/monitoring/alerts/incidents/:id/read",
    "POST /api/monitoring/alerts/incidents/read-all", "DELETE /api/monitoring/alerts/silences/:id",
    "POST /api/monitoring/alerts/contacts", "PATCH /api/monitoring/alerts/contacts/:id", "DELETE /api/monitoring/alerts/contacts/:id",
    "POST /api/monitoring/alerts/groups", "PATCH /api/monitoring/alerts/groups/:id", "DELETE /api/monitoring/alerts/groups/:id",
    "POST /api/monitoring/alerts/schedules", "PATCH /api/monitoring/alerts/schedules/:id", "DELETE /api/monitoring/alerts/schedules/:id",
    "POST /api/monitoring/alerts/schedules/:id/overrides", "DELETE /api/monitoring/alerts/overrides/:id",
    "POST /api/monitoring/alerts/policies", "PATCH /api/monitoring/alerts/policies/:id", "DELETE /api/monitoring/alerts/policies/:id",
    "PATCH /api/monitoring/alerts/smtp", "PATCH /api/monitoring/alerts/health-routing"
  ],
  "cyberos.network.manage-propose": ["POST /api/system/network/ethernet/apply/:transactionId/confirm", "POST /api/system/network/ethernet/apply/:transactionId/rollback", "POST /api/system/network/wifi/hotspot/start", "POST /api/system/network/wifi/hotspot/stop", "DELETE /api/system/network/wifi/hotspot"],
  "cyberos.terminal.manage-propose": ["POST /api/terminal/tabs/initialize"],
  "cyberos.tailscale.status": ["GET /api/system/tailscale"],
  "cyberos.tailscale.manage-propose": ["POST /api/system/tailscale/login", "POST /api/system/tailscale/actions", "PUT /api/system/tailscale/service", "PUT /api/system/tailscale/settings", "POST /api/system/tailscale/apply/:id/confirm", "POST /api/system/tailscale/apply/:id/rollback"],
  "cyberos.bluetooth.manage-propose": [
    "PUT /api/system/bluetooth/adapter/power", "PUT /api/system/bluetooth/default-adapter",
    "POST /api/system/bluetooth/scan/start", "POST /api/system/bluetooth/scan/stop",
    "POST /api/system/bluetooth/devices/pair", "POST /api/system/bluetooth/devices/cancel-pairing",
    "POST /api/system/bluetooth/devices/connect", "POST /api/system/bluetooth/devices/disconnect", "POST /api/system/bluetooth/devices/unpair",
    "PUT /api/system/bluetooth/devices/trust", "PATCH /api/system/bluetooth/settings",
    "POST /api/system/bluetooth/transfers", "POST /api/system/bluetooth/transfers/:id/cancel"
  ],
  "cyberos.nvr.status": ["GET /api/nvr"],
  "cyberos.nvr.query": ["GET /api/nvr/devices/:id", "GET /api/nvr/segments", "GET /api/nvr/events", "GET /api/nvr/devices/:id/ptz"],
  "cyberos.nvr.resource-link": ["GET /api/nvr/devices/:id/snapshot", "GET /api/nvr/segments/:id", "GET /api/nvr/segments/:id/download"],
  "cyberos.nvr.manage-propose": ["POST /api/nvr/discover", "PUT /api/nvr/policy", "POST /api/nvr/devices", "PATCH /api/nvr/devices/:id", "DELETE /api/nvr/devices/:id", "POST /api/nvr/devices/:id/ptz"]
};

/** Exact exclusions are reviewed when a product route changes; there is no catch-all exclusion. */
export const PRODUCT_ACTION_EXCLUSIONS: readonly { reason: string; actions: readonly string[] }[] = [
  { reason: "First-party approval decisions and Agent job recovery must remain outside model-callable tools.", actions: [
    "GET /api/approvals", "POST /api/capability-approvals/:id/decision", "POST /api/jobs/:id/cancel", "POST /api/jobs/:id/retry"
  ] },
  { reason: "秘密输入仅由第一方界面提交；完全权限不允许模型取得或提交用户凭据。", actions: [
    "POST /api/capability-approvals/:id/input"
  ] },
  { reason: "Conversation and session administration belong to the first-party chat host; model tools cannot recursively operate that host.", actions: [
    "GET /api/sessions", "POST /api/sessions", "PATCH /api/sessions/:id", "DELETE /api/sessions/:id", "GET /api/sessions/:id/commands",
    "GET /api/sessions/:id/events", "GET /api/sessions/:id/transcript", "POST /api/sessions/:id/commands", "POST /api/sessions/:id/messages"
  ] },
  { reason: "Streaming transport or binary delivery; use bounded status tools, approved playback or authenticated one-time resources.", actions: [
    "GET /api/audio/device", "GET /api/audio/history/events", "GET /api/audio/media/:id", "POST /api/audio/recordings",
    "GET /api/docker/console/:id", "GET /api/docker/daemon/events", "GET /api/downloads/events",
    "GET /api/files/blob", "GET /api/files/exports/:token", "GET /api/files/video", "PUT /api/files/upload",
    "GET /api/photos/exports/:token", "PUT /api/photos/upload", "GET /api/photos/map/archive",
    "GET /api/music/artwork/:key", "GET /api/music/events", "GET /api/media/artwork/:id",
    "GET /api/media/titles/:id/artwork/:kind", "GET /api/media/tmdb/images/:size/:file", "GET /api/media/events",
    "GET /api/monitoring/events", "GET /api/playback/events", "GET /api/terminal", "GET /api/vms/console/:id",
    "GET /api/system/bluetooth/events", "GET /api/system/bluetooth/transfers/events", "GET /api/system/network/ethernet/events",
    "GET /api/system/network/wifi/events", "GET /api/system/tailscale/events", "GET /api/nvr/devices/:id/preview-socket",
    "GET /api/nvr/devices/:id/preview", "POST /api/nvr/sessions", "POST /api/nvr/sessions/:id",
    "DELETE /api/nvr/sessions/:id", "GET /api/nvr/sessions/:id/assets/:name"
  ] },
  { reason: "NVR dispatch proxy; concrete Rust routes are inventoried separately.", actions: [
    "GET /api/nvr*", "POST /api/nvr*", "PUT /api/nvr*", "PATCH /api/nvr*", "DELETE /api/nvr*"
  ] },
  { reason: "Browser-local playback sessions and TV presentation are independent from approved NAS playback.", actions: [
    "GET /api/media/playback-sessions/:id", "GET /api/media/playback-sessions/:id/assets/:name", "POST /api/media/playback-sessions",
    "POST /api/media/playback-sessions/:id/progress", "DELETE /api/media/playback-sessions/:id", "GET /api/tv/status", "POST /api/tv/stop-video",
    "GET /api/tv/events", "GET /api/tv/screensaver/items", "GET /api/tv/screensaver/image/:id",
    "GET /api/tv/screensaver/video/:id", "HEAD /api/tv/screensaver/video/:id", "POST /api/tv/renderer"
  ] },
  { reason: "TV 物理输出候选与立即重启由第一方设置界面确认；设置能力读取和保存配置，不提供宿主输出重配动作。", actions: [
    "GET /api/settings/tv/outputs", "POST /api/settings/tv/apply-output"
  ] },
  { reason: "Presentation-only filter choices, map clustering and notification badges; domain queries expose the underlying records.", actions: [
    "GET /api/media/filter-options", "GET /api/music/filter-options", "POST /api/photos/map/query",
    "PATCH /api/notifications/bluetooth/:id/read", "POST /api/notifications/bluetooth/read-all"
  ] },
  { reason: "Human pairing challenge response must be entered in the first-party interface.", actions: ["POST /api/system/bluetooth/pairing/respond"] },
  { reason: "Host directory selection, offline map provisioning and management feature installation remain first-party administration.", actions: [
    "GET /api/settings/backup/directories", "GET /api/photos/map/settings", "POST /api/photos/map/download",
    "PATCH /api/settings/docker", "PATCH /api/settings/vm"
  ] },
  { reason: "Wi-Fi discovery refresh and deletion of saved credentials remain first-party network maintenance; approved connection and profile editing are available.", actions: [
    "POST /api/system/network/wifi/scan", "DELETE /api/system/network/wifi/profiles/:id"
  ] },
  { reason: "Compose draft validation is an editor aid; approved Compose submission performs the same backend validation.", actions: ["POST /api/docker/apps/validate"] }
];
