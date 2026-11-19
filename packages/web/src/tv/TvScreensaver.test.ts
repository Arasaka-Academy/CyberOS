/**
 * [INPUT]: 依赖原生显示快照、屏保组件和 React 静态渲染。
 * [OUTPUT]: 验证内置内容、图片视频加载回退和息屏卸载。
 * [POS]: TV 屏保页面的静态渲染契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it } from "vitest";
import { initI18n } from "../i18n/index.js";
import type { TvDisplaySnapshot } from "./api.js";
import { TvScreensaver } from "./TvScreensaver.js";

beforeAll(async () => { await initI18n(); });
const snapshot: TvDisplaySnapshot = {
  settings: { enabled: true, videoOutput: "wayland", audioDevice: null, drmConnector: null, hardwareDecoding: "auto-safe", screensaverSource: { kind: "builtin" }, screensaverEnabled: true, screenOffEnabled: true, screensaverAfterMinutes: 5, screenOffAfterMinutes: 30, updatedAt: "2026-11-18T00:00:00Z" },
  display: { state: "screensaver", supported: true, reason: null, updatedAt: "2026-11-18T00:00:00Z" },
};
describe("TV screensaver surface", () => {
  it("renders built-in clock and local geometry without media requests", () => {
    const html = renderToStaticMarkup(createElement(TvScreensaver, { snapshot }));
    expect(html).toContain("<svg"); expect(html).toContain("<time>");
    expect(html).not.toContain("<img"); expect(html).not.toContain("http");
  });
  it("removes animation and image nodes for active/off display", () => {
    for (const state of ["active", "off"] as const) expect(renderToStaticMarkup(createElement(TvScreensaver, { snapshot: { ...snapshot, display: { ...snapshot.display, state } } }))).toBe("");
  });
  it("has an immediate built-in fallback while a NAS source is loading", () => {
    for (const kind of ["directory", "video-directory"] as const) {
      const html = renderToStaticMarkup(createElement(TvScreensaver, { snapshot: { ...snapshot, settings: { ...snapshot.settings, screensaverSource: { kind, storagePoolId: "pool", path: "Materials" } } } }));
      expect(html).toContain("tv-screensaver-builtin");
    }
  });
});
