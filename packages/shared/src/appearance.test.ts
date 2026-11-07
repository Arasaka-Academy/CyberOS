import { describe, expect, it } from "vitest";
import { contrast } from "./cyberui-tokens.js";
import { APPEARANCE_STORAGE_KEY, DEFAULT_APPEARANCE, appearanceSchemes, appearanceVariables, parseAppearance, readAppearance, writeAppearance } from "./appearance.js";

describe("browser appearance preferences", () => {
  it("accepts exactly the fourteen supported scheme and mode combinations", () => {
    expect(appearanceSchemes).toHaveLength(7);
    for (const scheme of appearanceSchemes) {
      for (const mode of ["light", "dark"] as const) {
        expect(parseAppearance({ scheme, mode })).toEqual({ scheme, mode });
        const variables = appearanceVariables({ scheme, mode });
        expect(contrast(variables["--cyber-ink"]!, variables["--cyber-bg"]!)).toBeGreaterThanOrEqual(4.5);
        expect(contrast(variables["--cyber-on-accent"]!, variables["--cyber-accent"]!)).toBeGreaterThanOrEqual(4.5);
        expect(variables["--cyberos-color-canvas"]).toBe(variables["--cyber-bg"]);
        expect(variables["--cyberos-color-text"]).toBe(variables["--cyber-ink"]);
      }
    }
  });

  it("defaults safely for malformed or legacy preferences", () => {
    for (const value of [undefined, null, "dark", {}, { scheme: "unknown", mode: "dark" }, { scheme: "neon", mode: "system" }]) {
      expect(parseAppearance(value)).toEqual(DEFAULT_APPEARANCE);
    }
    expect(readAppearance({ getItem: () => "{broken" })).toEqual(DEFAULT_APPEARANCE);
    expect(readAppearance({ getItem: () => { throw new Error("blocked storage"); } })).toEqual(DEFAULT_APPEARANCE);
  });

  it("provides readable text roles independently of accent fills in every theme", () => {
    for (const scheme of appearanceSchemes) for (const mode of ["light", "dark"] as const) {
      const variables = appearanceVariables({ scheme, mode });
      for (const role of ["command", "focus", "connected", "success", "warning", "danger"]) {
        const foreground = variables[`--cyberos-color-${role}-text`];
        expect(foreground, `${scheme}/${mode} ${role}`).toMatch(/^#[0-9a-f]{6}$/i);
        for (const background of ["--cyber-bg", "--cyber-soft"]) {
          expect(contrast(foreground!, variables[background]!), `${scheme}/${mode} ${role} on ${background}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    }
  });

  it("round trips the versioned browser preference and tolerates denied writes", () => {
    const values = new Map<string, string>();
    const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); } };
    expect(writeAppearance({ scheme: "terminal", mode: "light" }, storage)).toBe(true);
    expect(values.has(APPEARANCE_STORAGE_KEY)).toBe(true);
    expect(readAppearance(storage)).toEqual({ scheme: "terminal", mode: "light" });
    expect(writeAppearance(DEFAULT_APPEARANCE, { setItem: () => { throw new Error("quota"); } })).toBe(false);
  });
});
