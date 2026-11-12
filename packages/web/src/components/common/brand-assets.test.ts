import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const publicRoot = new URL("../../../public/", import.meta.url);
const docsRoot = new URL("../../../../../docs/", import.meta.url);
const assets = [
  "cyberos-icon.svg", "cyberos-icon-white.svg", "cyberos-icon-small.svg", "cyberos-icon-small-white.svg",
  "cyberos-wordmark.svg", "cyberos-wordmark-white.svg", "favicon.svg"
];

describe("Cutline brand assets", () => {
  it.each(assets)("ships %s as standalone outlined vector artwork", (name) => {
    const file = new URL(name, publicRoot);
    expect(existsSync(file)).toBe(true);
    const svg = readFileSync(file, "utf8");
    expect(svg).toContain("Cutline");
    expect(svg).toContain("<title>");
    expect(svg).toMatch(/viewBox="0 0 [\d.]+ [\d.]+"/u);
    expect(svg).toContain("<path ");
    expect(svg).not.toMatch(/<(?:image|text|filter|mask)\b|data:image|<script\b/u);
  });

  it("keeps dedicated small and optically corrected white masters", () => {
    const read = (name: string) => readFileSync(new URL(name, publicRoot), "utf8");
    const paths = (svg: string) => [...svg.matchAll(/ d="([^"]+)"/gu)].map(match => match[1]).join(" ");
    expect(paths(read("cyberos-icon-small.svg"))).not.toBe(paths(read("cyberos-icon.svg")));
    expect(paths(read("cyberos-icon-small-white.svg"))).not.toBe(paths(read("cyberos-icon-small.svg")));
    expect(paths(read("cyberos-wordmark-white.svg"))).not.toBe(paths(read("cyberos-wordmark.svg")));
  });

  it("shares the exact small-size masters and favicon with the documentation site", () => {
    for (const [source, target] of [
      ["cyberos-icon-small.svg", "src/assets/cyberos-icon.svg"],
      ["cyberos-icon-small-white.svg", "src/assets/cyberos-icon-white.svg"],
      ["favicon.svg", "public/favicon.svg"]
    ]) {
      const file = new URL(target!, docsRoot);
      expect(existsSync(file)).toBe(true);
      expect(readFileSync(file, "utf8")).toBe(readFileSync(new URL(source!, publicRoot), "utf8"));
    }
  });

  it("uses the small-size favicon on both Web entrypoints", () => {
    for (const entry of ["index.html", "tv/index.html"]) {
      const html = readFileSync(new URL(`../../../${entry}`, import.meta.url), "utf8");
      expect(html).toContain('rel="icon" type="image/svg+xml" href="/favicon.svg"');
      expect(html).not.toContain('rel="icon" type="image/svg+xml" href="/cyberos-icon.svg"');
    }
  });
});
