/**
 * [INPUT]: 依赖隔离 SQLite 与 TV 设置仓库。
 * [OUTPUT]: 验证旧记录补齐、计时校验和来源持久化。
 * [POS]: TV 空闲策略的数据库契约回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultTvSettings, getTvSettings, openCyberOsDb, saveTvSettings, validateTvSettings, type CyberOsDatabase } from "./index.js";

let directory: string;
let db: CyberOsDatabase;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "tv-settings-")); db = openCyberOsDb(path.join(directory, "state.sqlite")); });
afterEach(async () => { db.close(); await rm(directory, { recursive: true, force: true }); });

describe("TV idle settings", () => {
  it("adds five/thirty minute defaults to existing TV output records", () => {
    const legacy = { enabled: true, videoOutput: "wayland", drmConnector: "HDMI-A-1", audioDevice: "alsa/hdmi", hardwareDecoding: "auto-safe", updatedAt: "2026-01-01T00:00:00.000Z" };
    db.prepare("INSERT INTO system_settings (key, value_json, updated_at) VALUES (?, ?, ?)").run("tv_settings", JSON.stringify(legacy), legacy.updatedAt);
    expect(getTvSettings(db)).toEqual({ ...legacy, screensaverSource: { kind: "builtin" }, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30 });
  });
  it("persists a directory source and independently disabled timers", () => {
    const record = saveTvSettings(db, { ...defaultTvSettings(), screensaverSource: { kind: "directory", storagePoolId: "pool-1", path: "Pictures" }, screensaverAfterMinutes: null, screenOffAfterMinutes: 30 });
    expect(getTvSettings(db)).toEqual(record);
    expect(validateTvSettings({ ...record, screensaverAfterMinutes: 5, screenOffAfterMinutes: null })).toMatchObject({ screensaverAfterMinutes: 5, screenOffAfterMinutes: null });
  });
  it("rejects invalid timer values, reversed deadlines and unsafe source shapes", () => {
    for (const updates of [
      { screensaverAfterMinutes: 0 }, { screensaverAfterMinutes: "5" }, { screenOffAfterMinutes: 0 },
      { screensaverAfterMinutes: 30, screenOffAfterMinutes: 30 }, { screensaverAfterMinutes: 60, screenOffAfterMinutes: 5 },
      { screensaverSource: { kind: "directory", storagePoolId: "pool-1", path: "../secrets" } },
      { screensaverSource: { kind: "directory", storagePoolId: "pool-1", path: "/etc" } },
      { screensaverSource: { kind: "online", url: "https://example.com" } }
    ]) expect(() => validateTvSettings({ ...defaultTvSettings(), ...updates } as Parameters<typeof validateTvSettings>[0])).toThrow();
  });
});
