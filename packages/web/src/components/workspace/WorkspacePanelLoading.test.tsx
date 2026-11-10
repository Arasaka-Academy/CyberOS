import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { i18n, initI18n } from "../../i18n/index.js";
import { WORKSPACE_PANEL_IDS } from "../../lib/workspace-panel-settings.js";
import { WorkspacePanelLoading } from "./WorkspacePanelLoading.js";

beforeAll(async () => { await initI18n(); });
beforeEach(async () => { await i18n.changeLanguage("en"); });

describe("workspace module loading", () => {
  it.each(WORKSPACE_PANEL_IDS)("keeps the %s titlebar and an accessible busy button during a cold load", (panel) => {
    const html = renderToStaticMarkup(createElement(WorkspacePanelLoading, { panel }));
    const header = html.match(/<header\b[\s\S]*?<\/header>/u)?.[0] ?? "";
    expect(header).toContain("app-titlebar");
    expect(header).toMatch(/<h2[^>]*>[^<]+<\/h2>/u);
    expect(header).toContain('aria-busy="true"');
    expect(header).toContain('aria-label="Loading"');
    expect(html).toContain('class="management-skeleton-block');
  });
});
