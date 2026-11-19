/**
 * [INPUT]: 依赖跨进程 TV 设置输入。
 * [OUTPUT]: 提供图片和视频来源、独立空闲开关及显示状态。
 * [POS]: TV 设置、原生显示控制与 Web 共用的契约。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export type TvScreensaverSource = { kind: "builtin" } | { kind: "directory" | "video-directory"; storagePoolId: string; path: string };
export interface TvIdleSettings {
  screensaverSource: TvScreensaverSource;
  screensaverEnabled: boolean;
  screenOffEnabled: boolean;
  // 旧客户端仍能提交 null。规范化记录保留分钟值与独立开关。
  screensaverAfterMinutes: number | null;
  screenOffAfterMinutes: number | null;
}
export interface TvDisplayStatus {
  state: "active" | "screensaver" | "off";
  supported: boolean;
  reason: string | null;
  updatedAt: string;
}
export interface TvScreensaverItems {
  items: Array<{ id: string; url: string; kind: "image" | "video"; mimeType: string }>;
  nextCursor: string | null;
  sourceKey: string;
  fallbackReason: string | null;
}
export const TV_SCREENSAVER_MINUTES = [1, 2, 5, 10, 15, 30, 60] as const;
export const TV_SCREEN_OFF_MINUTES = [5, 10, 15, 30, 60, 120] as const;
export const TV_SCREENSAVER_MAX_MINUTES = 60;
export const TV_SCREEN_OFF_MAX_MINUTES = 120;

export function normalizeTvIdleSettings(value: Record<string, unknown>): TvIdleSettings {
  const screensaverAfterMinutes = timeout(value.screensaverAfterMinutes, TV_SCREENSAVER_MAX_MINUTES, 5);
  const screenOffAfterMinutes = timeout(value.screenOffAfterMinutes, TV_SCREEN_OFF_MAX_MINUTES, 30);
  const screensaverEnabled = timerEnabled(value.screensaverEnabled, value.screensaverAfterMinutes);
  const screenOffEnabled = timerEnabled(value.screenOffEnabled, value.screenOffAfterMinutes);
  if (screensaverEnabled && screenOffEnabled && screenOffAfterMinutes <= screensaverAfterMinutes) {
    throw new Error("Screen-off time must be later than screensaver time");
  }
  return { screensaverSource: source(value.screensaverSource), screensaverEnabled, screenOffEnabled, screensaverAfterMinutes, screenOffAfterMinutes };
}

function timeout(value: unknown, maximum: number, fallback: number): number {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > maximum) throw new Error("TV idle timeout is invalid");
  return value;
}
function timerEnabled(value: unknown, minutes: unknown): boolean {
  if (value !== undefined && typeof value !== "boolean") throw new Error("TV idle enabled must be a boolean");
  if (minutes === null) return false;
  return value !== false;
}

function source(value: unknown): TvScreensaverSource {
  if (value === undefined) return { kind: "builtin" };
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Screensaver source is invalid");
  const record = value as Record<string, unknown>;
  if (record.kind === "builtin" && Object.keys(record).length === 1) return { kind: "builtin" };
  if ((record.kind !== "directory" && record.kind !== "video-directory") || Object.keys(record).some(key => !["kind", "storagePoolId", "path"].includes(key)) ||
    typeof record.storagePoolId !== "string" || !record.storagePoolId.trim() || record.storagePoolId.length > 256 ||
    typeof record.path !== "string" || !record.path || record.path.length > 4096 ||
    record.path.startsWith("/") || record.path.includes("\\") || [...record.path].some(character => character.charCodeAt(0) < 32) ||
    record.path.split("/").some(part => part === ".." || part === "" || part === "." && record.path !== ".")) {
    throw new Error("Screensaver directory must be a normalized path inside a storage pool");
  }
  return { kind: record.kind, storagePoolId: record.storagePoolId.trim(), path: record.path };
}
