import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { i18n, initI18n } from "../i18n/index.js";
import { MobileDock, MobileHome } from "./MobileHome.js";
import { WORKSPACE_PANEL_IDS } from "../lib/workspace-panel-settings.js";

beforeAll(async () => { await initI18n(); });
beforeEach(async () => { await i18n.changeLanguage("en"); });

describe("mobile home", () => {
  it.each([
    ["en", "PERSONAL OS FOR THE CYBER ERA"],
    ["zh-CN", "赛博时代的个人操作系统"]
  ])("shows the project positioning in %s", async (language, tagline) => {
    await i18n.changeLanguage(language);
    const html = renderToStaticMarkup(createElement(MobileHome, { connection: "online", unreadCount: 0, approvalCount: 0, onOpenApp: vi.fn(), onOpenNotifications: vi.fn() }));
    expect(html).toContain(`<span>${tagline}</span>`);
    expect(html).not.toContain("PERSONAL NETWORK SYSTEM");
  });

  it("exposes fourteen named app buttons across home and Dock", () => {
    const html = renderToStaticMarkup(createElement("div", null,
      createElement(MobileHome, { connection: "online", unreadCount: 3, approvalCount: 0, onOpenApp: vi.fn(), onOpenNotifications: vi.fn() }),
      createElement(MobileDock, { approvalCount: 2, onOpenApp: vi.fn() })
    ));
    expect(html.match(/data-app-id=/gu)).toHaveLength(WORKSPACE_PANEL_IDS.length + 2);
    expect(html.match(/data-app-id="files"/gu)).toHaveLength(1);
    expect(html).toContain('aria-label="Open notifications, 3 unread"');
    expect(html).toContain('data-app-id="agent"');
    expect(html).toContain("Connected");
  });

  it("shows an offline connection without claiming the NAS is ready", () => {
    const html = renderToStaticMarkup(createElement(MobileHome, { connection: "offline", unreadCount: 0, approvalCount: 0, onOpenApp: vi.fn(), onOpenNotifications: vi.fn() }));
    expect(html).toContain("Disconnected");
    expect(html).not.toContain(">Connected<");
    expect(html).not.toContain('data-app-id="files"');
  });
});
