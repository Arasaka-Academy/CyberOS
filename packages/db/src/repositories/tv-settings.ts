/**
 * [INPUT]: 依赖共享空闲策略校验与 SQLite 设置存储。
 * [OUTPUT]: 提供兼容旧记录的整机 TV 设置持久化。
 * [POS]: 隔离 TV 输出与空闲策略；不执行宿主操作。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { normalizeTvIdleSettings, type TvIdleSettings, type TvSettingsRecord } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import { normalizeNullableText, settingRow, saveSetting, currentSettingsObject, currentSettingsUpdatedAt, isNullableString } from "./settings-storage.js";
const TV_SETTING_KEY = "tv_settings";
const EPOCH = new Date(0).toISOString();

export const DEFAULT_TV_SETTINGS: Omit<TvSettingsRecord, "updatedAt"> = {
  enabled: true,
  videoOutput: "wayland",
  drmConnector: null,
  audioDevice: null,
  hardwareDecoding: "auto-safe",
  ...normalizeTvIdleSettings({})
};

export function defaultTvSettings(): TvSettingsRecord {
  return { ...DEFAULT_TV_SETTINGS, updatedAt: EPOCH };
}

export function getTvSettings(db: CyberOsDatabase): TvSettingsRecord | null {
  const row = settingRow(db, TV_SETTING_KEY);
  if (!row) return null;
  const parsed = currentSettingsObject(JSON.parse(row.value_json), [
    "enabled",
    "videoOutput",
    "drmConnector",
    "audioDevice",
    "hardwareDecoding",
    "updatedAt"
  ], "TV");
  return normalizeTvSettings(parsed, currentSettingsUpdatedAt(parsed, "TV"));
}

export function saveTvSettings(
  db: CyberOsDatabase,
  settings: Omit<TvSettingsRecord, "updatedAt" | keyof TvIdleSettings> & Partial<TvIdleSettings>
): TvSettingsRecord {
  const updatedAt = new Date().toISOString();
  const record = normalizeTvSettings(settings, updatedAt);
  saveSetting(db, TV_SETTING_KEY, record, updatedAt);
  return record;
}

export function validateTvSettings(
  settings: Omit<TvSettingsRecord, "updatedAt">
): Omit<TvSettingsRecord, "updatedAt"> {
  const validated = normalizeTvSettings(settings, EPOCH);
  return {
    enabled: validated.enabled,
    videoOutput: validated.videoOutput,
    drmConnector: validated.drmConnector,
    audioDevice: validated.audioDevice,
    hardwareDecoding: validated.hardwareDecoding,
    screensaverSource: validated.screensaverSource,
    screensaverAfterMinutes: validated.screensaverAfterMinutes,
    screenOffAfterMinutes: validated.screenOffAfterMinutes
  };
}

function normalizeTvSettings(value: Record<string, unknown>, updatedAt: string): TvSettingsRecord {
  if (typeof value.enabled !== "boolean") throw new Error("TV enabled must be a boolean");
  if (value.videoOutput !== "drm" && value.videoOutput !== "wayland") {
    throw new Error("TV video output must be drm or wayland");
  }
  if (value.hardwareDecoding !== "auto-safe" && value.hardwareDecoding !== "auto" && value.hardwareDecoding !== "no") {
    throw new Error("TV hardware decoding mode is invalid");
  }
  if (!isNullableString(value.drmConnector) || !isNullableString(value.audioDevice)) {
    throw new Error("TV output device settings must be text or null");
  }
  if (value.enabled && value.videoOutput !== "wayland") {
    throw new Error("TV mode requires Wayland video output");
  }
  return {
    enabled: value.enabled,
    videoOutput: value.videoOutput,
    drmConnector: normalizeNullableText(value.drmConnector, 128),
    audioDevice: normalizeNullableText(value.audioDevice, 256),
    hardwareDecoding: value.hardwareDecoding,
    ...normalizeTvIdleSettings(value),
    updatedAt
  };
}
