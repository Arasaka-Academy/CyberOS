import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BrandBanner } from "./BrandBanner.js";
import { BrandLogo } from "./BrandLogo.js";

const appearance = vi.hoisted(() => ({ mode: "dark" as "dark" | "light" }));
vi.mock("@cyberos/ui", () => ({ useAppearance: () => appearance }));

describe("BrandBanner", () => {
  beforeEach(() => { appearance.mode = "dark"; });

  it("renders the Cutline symbol and outlined wordmark with one accessible name", () => {
    const html = renderToStaticMarkup(createElement(BrandBanner, { alt: "CyberOS" }));

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="CyberOS"');
    expect(html).toContain('src="/cyberos-icon-small-white.svg"');
    expect(html).toContain('src="/cyberos-wordmark-white.svg"');
    expect(html.match(/alt=""/g)).toHaveLength(2);
  });

  it("uses the black masters in light mode instead of inverting the white geometry", () => {
    appearance.mode = "light";
    const html = renderToStaticMarkup(createElement(BrandBanner, { alt: "CyberOS" }));

    expect(html).toContain('src="/cyberos-icon-small.svg"');
    expect(html).toContain('src="/cyberos-wordmark.svg"');
    expect(html).not.toContain("-white.svg");
  });

  it("stays hidden from assistive technology when decorative", () => {
    const html = renderToStaticMarkup(createElement(BrandBanner));

    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("aria-label");
  });

  for (const mode of ["dark", "light"] as const) {
    it(`selects the ${mode} standard symbol without changing its accessible name`, () => {
      appearance.mode = mode;
      const html = renderToStaticMarkup(createElement(BrandLogo, { variant: "symbol", alt: "CyberOS" }));
      expect(html).toContain(`src="/cyberos-icon${mode === "dark" ? "-white" : ""}.svg"`);
      expect(html).toContain('alt="CyberOS"');
      expect(html).not.toContain("aria-hidden");
    });
  }
});
