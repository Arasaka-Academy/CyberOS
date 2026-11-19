/**
 * [INPUT]: 依赖静态 React 渲染、通知设置和中英文资源。
 * [OUTPUT]: 验证当前浏览器状态、权限阻止说明和三类通知选择。
 * [POS]: 通知设置的可访问内容契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { i18n, initI18n } from "../../i18n/index.js";
import { SettingsNotificationsContent } from "./SettingsNotificationsPage.js";
import type { BrowserNotificationState } from "../../lib/browser-notifications.js";
import { SETTINGS_SECTIONS } from "../../config/settings.js";
import { settingsSectionResources } from "./settings-resources.js";

beforeAll(async () => { await initI18n(); });
const state: BrowserNotificationState = {
  support: "supported", permission: "granted", available: true,
  subscription: { id: "browser", enabled: true, preferences: { replies: true, actionRequired: true, failures: false }, locale: "en", origin: "https://cyberos.test", createdAt: "now", updatedAt: "now", lastSuccessAt: null, lastError: null }
};
function render(overrides: Partial<BrowserNotificationState> = {}) {
  return renderToStaticMarkup(createElement(SettingsNotificationsContent, { state: { ...state, ...overrides }, busy: false, error: null, testSent: false, onRefresh: vi.fn(), onEnabledChange: vi.fn(), onPreferencesChange: vi.fn(), onTest: vi.fn() }));
}
describe("browser notification settings", () => {
  it("has a self-loading notification page in General", () => {
    expect(SETTINGS_SECTIONS.find(section => section.id === "notifications")?.group).toBe("general");
    expect(settingsSectionResources("notifications")).toEqual([]);
  });
  it.each(["en", "zh-CN"])("renders three categories and operational state in %s", async locale => {
    await i18n.changeLanguage(locale);
    const html = render();
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    expect(html).toContain(locale === "en" ? "Send test notification" : "发送测试通知");
    expect(html).not.toContain("browserNotifications.");
    expect(html).not.toContain("private-browser-token");
  });
  it("explains permission denial and disables the enable control", async () => {
    await i18n.changeLanguage("en");
    const html = render({ permission: "denied" });
    expect(html).toContain("Allow notifications in this site");
    expect(html).toContain("disabled=\"\"");
    expect(html).toContain("Refresh status");
  });
});
