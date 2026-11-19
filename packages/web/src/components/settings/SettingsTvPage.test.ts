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
import { TvSettingsFields, tvForm, validTvTimers, tvDeviceOptions } from "./SettingsTvPage.js";

const settings: TvSettingsRecord = { enabled: true, videoOutput: "wayland", drmConnector: "HDMI-A-1", audioDevice: null, hardwareDecoding: "auto-safe", screensaverSource: { kind: "builtin" }, screensaverEnabled: true, screenOffEnabled: true, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30, updatedAt: "2026-11-18T00:00:00Z" };
beforeAll(async () => { await initI18n(); });
describe("TV settings", () => {
  it("submits only TV form fields and rejects reversed/equal timers", () => {
    expect(tvForm(settings)).not.toHaveProperty("enabled");
    expect(tvForm(settings)).not.toHaveProperty("updatedAt");
    expect(validTvTimers(tvForm(settings))).toBe(true);
    expect(validTvTimers({ ...tvForm(settings), screenOffAfterMinutes: 5 })).toBe(false);
    expect(validTvTimers({ ...tvForm(settings), screenOffEnabled: false, screenOffAfterMinutes: 5 })).toBe(true);
    expect(validTvTimers({ ...tvForm(settings), screensaverEnabled: false, screensaverAfterMinutes: 60 })).toBe(true);
  });
  it("keeps an offline configured output instead of changing the draft to default", () => {
    expect(tvDeviceOptions([{ id: "alsa/hdmi", name: "TV HDMI" }], "alsa/old", "System default", "Not detected")).toEqual([
      { value: "", label: "System default" }, { value: "alsa/hdmi", label: "TV HDMI" }, { value: "alsa/old", label: "alsa/old · Not detected" }
    ]);
  });
  it("retains the remembered timeout while a timer is disabled", () => {
    expect(tvForm({ ...settings, screensaverEnabled: false, screensaverAfterMinutes: 17 })).toMatchObject({ screensaverEnabled: false, screensaverAfterMinutes: 17, screenOffEnabled: true });
  });
  it("renders separate localized switches and minute sliders without a never choice", async () => {
    for (const [locale, sourceLabel, saverLabel, folder] of [["en", "Screensaver source", "Screensaver", "Media/Wallpapers"], ["zh-CN", "屏保来源", "屏保", "Media/Wallpapers"]] as const) {
      await i18n.changeLanguage(locale);
      const html = renderToStaticMarkup(createElement(TvSettingsFields, { draft: { ...tvForm(settings), screensaverSource: { kind: "directory", storagePoolId: "pool-1", path: folder }, screensaverEnabled: false, screensaverAfterMinutes: 17 }, busy: false, onChange: vi.fn(), onChooseDirectory: vi.fn() }));
      expect(html).toContain(sourceLabel); expect(html).toContain(saverLabel); expect(html).toContain(folder); expect(html).toContain("HDMI-A-1");
      expect(html).not.toContain("<select"); expect(html).not.toContain('placeholder="HDMI-A-1"');
      expect(html).not.toContain(locale === "en" ? "Never" : "永不");
      expect(html).toContain('type="range"'); expect(html).toContain('role="switch"'); expect(html).toContain('value="17"');
    }
  });
});
