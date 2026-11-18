/**
 * [INPUT]: 依赖 SQLite 设置表与 JSON 记录。
 * [OUTPUT]: 提供设置读写、格式校验和文本规范化。
 * [POS]: 设置仓库与 TV 设置仓库共用的存储边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { CyberOsDatabase } from "../connection.js";
import type { DbSystemSettingRow } from "./repository-rows.js";

export function normalizeNullableText(value: string | null, maximum: number): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  if (normalized.length > maximum) throw new Error(`Setting text cannot exceed ${maximum} characters`);
  return normalized || null;
}

export function settingRow(
  db: CyberOsDatabase,
  key: string
): Pick<DbSystemSettingRow, "value_json" | "updated_at"> | undefined {
  return db.prepare("SELECT value_json, updated_at FROM system_settings WHERE key = ?")
    .get(key) as Pick<DbSystemSettingRow, "value_json" | "updated_at"> | undefined;
}

export function saveSetting(db: CyberOsDatabase, key: string, record: object, updatedAt: string): void {
  db.prepare(`
    INSERT INTO system_settings (key, value_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at
  `).run(key, JSON.stringify(record), updatedAt);
}

export function currentSettingsObject(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (
    !value
    || typeof value !== "object"
    || Array.isArray(value)
    || keys.some((key) => !Object.hasOwn(value, key))
  ) {
    throw new Error(`${label} settings do not match the CyberOS 2.0 format`);
  }
  return value as Record<string, unknown>;
}

export function currentSettingsUpdatedAt(value: Record<string, unknown>, label: string): string {
  if (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))) {
    throw new Error(`${label} settings require a valid updatedAt timestamp`);
  }
  return value.updatedAt;
}

export function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}
