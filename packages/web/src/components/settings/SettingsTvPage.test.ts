/**
 * [INPUT]: 依赖 TV 设置记录、表单函数和 React 静态渲染。
 * [OUTPUT]: 验证提交字段、计时阈值和多语言渲染。
 * [POS]: 独立 TV 设置页的表单与渲染契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { TvSettingsRecord } from "@cyberos/shared";
import { initI18n, i18n } from "../../i18n/index.js";
import { TvSettingsFields, tvForm, validTvTimers } from "./SettingsTvPage.js";

const settings: TvSettingsRecord = { enabled: true, videoOutput: "wayland", drmConnector: "HDMI-A-1", audioDevice: null, hardwareDecoding: "auto-safe", screensaverSource: { kind: "builtin" }, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30, updatedAt: "2026-11-18T00:00:00Z" };
beforeAll(async () => { await initI18n(); });
describe("TV settings", () => {
  it("submits only TV form fields and rejects reversed/equal timers", () => {
    expect(tvForm(settings)).not.toHaveProperty("enabled");
    expect(tvForm(settings)).not.toHaveProperty("updatedAt");
    expect(validTvTimers(tvForm(settings))).toBe(true);
    expect(validTvTimers({ ...tvForm(settings), screenOffAfterMinutes: 5 })).toBe(false);
    expect(validTvTimers({ ...tvForm(settings), screenOffAfterMinutes: null })).toBe(true);
    expect(validTvTimers({ ...tvForm(settings), screensaverAfterMinutes: null })).toBe(true);
  });
  it("renders localized TV output and custom idle selectors with NAS folder picker", async () => {
    for (const [locale, title, never, folder] of [["en", "Screensaver source", "Never", "Media/Wallpapers"], ["zh-CN", "屏保来源", "永不", "Media/Wallpapers"]] as const) {
      await i18n.changeLanguage(locale);
      const html = renderToStaticMarkup(createElement(TvSettingsFields, { draft: { ...tvForm(settings), screensaverSource: { kind: "directory", storagePoolId: "pool-1", path: folder }, screensaverAfterMinutes: null }, busy: false, onChange: vi.fn(), onChooseDirectory: vi.fn() }));
      expect(html).toContain(title); expect(html).toContain(never); expect(html).toContain(folder); expect(html).toContain("HDMI-A-1");
      expect(html).not.toContain("<select"); expect(html).toContain('aria-haspopup="listbox"');
    }
  });
});
