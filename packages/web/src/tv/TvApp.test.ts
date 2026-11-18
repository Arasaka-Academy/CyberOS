/**
 * [INPUT]: 读取 TV 入口组件、样式和共享主题源码。
 * [OUTPUT]: 验证 TV 页面组合与原生待机职责边界。
 * [POS]: TV 独立入口及样式架构的回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readStylesheet } from "../styles/test-utils.js";

describe("TV display policy", () => {
  it("composes a TV-specific library instead of adapting the desktop panel", async () => {
    const component = await readFile(new URL("./TvApp.tsx", import.meta.url), "utf8");
    expect(component).not.toContain("VideoLibraryPanel");
    expect(component).not.toContain("PlaybackBar");
    expect(component).toContain("TvLibrary");
  });
  it("leaves idle timing to native display snapshots", async () => {
    const [component, styles] = await Promise.all([
      readFile(new URL("./useTvDisplay.ts", import.meta.url), "utf8"),
      readStylesheet(new URL("./tv.css", import.meta.url))
    ]);

    expect(component).not.toContain("IDLE_TIMEOUT_MS");
    expect(component).toContain('/api/tv/events');
    expect(component).not.toContain("tv-sleep");
    expect(styles).not.toContain(".tv-sleep");
  });

  it("uses shared CyberUI themes without moving focused controls", async () => {
    const [entry, styles, tokens] = await Promise.all([
      readFile(new URL("./main.tsx", import.meta.url), "utf8"),
      readStylesheet(new URL("./tv.css", import.meta.url)),
      readFile(new URL("../../../shared/src/hud-tokens.css", import.meta.url), "utf8")
    ]);

    expect(entry).toContain('@cyberos/ui/fonts.css');
    expect(entry).toContain('mountAppearance()');
    expect(entry).not.toContain("Newsreader");
    expect(styles).toContain('@import "@cyberos/shared/appearance.css"');
    expect(styles).toContain("outline: 3px solid var(--tv-focus)");
    expect(styles).not.toContain("transform: translateY(-6px)");
    expect(tokens).toContain("--cyberos-color-command: var(--cyberos-hud-yellow)");
    expect(tokens).toContain("--cyberos-color-focus: var(--cyberos-hud-cyan)");
    expect(styles).not.toContain('layer(legacy)');
    expect(styles).not.toContain('../styles/video.css');
  });
});
