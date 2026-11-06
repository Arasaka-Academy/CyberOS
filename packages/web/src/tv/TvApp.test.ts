import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readStylesheet } from "../styles/test-utils.js";

describe("TV display policy", () => {
  it("keeps the HDMI shell visible while idle", async () => {
    const [component, styles] = await Promise.all([
      readFile(new URL("./TvApp.tsx", import.meta.url), "utf8"),
      readStylesheet(new URL("./tv.css", import.meta.url))
    ]);

    expect(component).not.toContain("IDLE_TIMEOUT_MS");
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
    expect(styles).toContain('@import "@cyberos/shared/hud-tokens.css"');
    expect(styles).toContain("outline: 3px solid var(--tv-focus)");
    expect(styles).not.toContain("transform: translateY(-6px)");
    expect(tokens).toContain("--cyberos-color-command: var(--cyberos-hud-yellow)");
    expect(tokens).toContain("--cyberos-color-focus: var(--cyberos-hud-cyan)");
  });
});
