import { contrast, createTheme, schemes, type Mode, type Scheme } from "./cyberui-tokens.js";

export { createTheme, schemes, type Mode, type Scheme } from "./cyberui-tokens.js";
export interface AppearancePreference { scheme: Scheme; mode: Mode }
export const appearanceSchemes = Object.keys(schemes) as Scheme[];
export const DEFAULT_APPEARANCE: AppearancePreference = { scheme: "neon", mode: "dark" };
export const APPEARANCE_STORAGE_KEY = "cyberos:appearance:v1";
export const APPEARANCE_EVENT = "cyberos:appearance-change";

export function parseAppearance(value: unknown): AppearancePreference {
  if (value && typeof value === "object" && "scheme" in value && "mode" in value
    && typeof value.scheme === "string" && appearanceSchemes.includes(value.scheme as Scheme)
    && (value.mode === "dark" || value.mode === "light")) {
    return { scheme: value.scheme as Scheme, mode: value.mode };
  }
  return { ...DEFAULT_APPEARANCE };
}

export function readAppearance(storage: Pick<Storage, "getItem"> | null = browserStorage()): AppearancePreference {
  try { return parseAppearance(JSON.parse(storage?.getItem(APPEARANCE_STORAGE_KEY) ?? "null")); }
  catch { return { ...DEFAULT_APPEARANCE }; }
}

export function writeAppearance(preference: AppearancePreference, storage: Pick<Storage, "setItem"> | null = browserStorage()): boolean {
  try { if (!storage) return false; storage.setItem(APPEARANCE_STORAGE_KEY, JSON.stringify(parseAppearance(preference))); return true; }
  catch { return false; }
}

function browserStorage(): Storage | null {
  try { return typeof window === "undefined" ? null : window.localStorage; }
  catch { return null; }
}

/** Pure CSS values also consumed by static Astro pages and the native-player generator. */
export function appearanceVariables(preference: AppearancePreference): Record<string, string> {
  const { scheme, mode } = parseAppearance(preference);
  const t = createTheme(scheme, mode);
  const mix = (color: string, amount: number, background = t.bg) => `color-mix(in srgb, ${color} ${amount}%, ${background})`;
  const shade = (color: string, background: string, amount: number) => "#" + [1, 3, 5].map(index =>
    Math.round(parseInt(color.slice(index, index + 2), 16) * amount + parseInt(background.slice(index, index + 2), 16) * (1 - amount))
      .toString(16).padStart(2, "0")).join("");
  // Text also appears on raised/hover surfaces and status washes. Accent fills
  // keep their upstream colors; a text role falls back to ink when necessary.
  const surfaces = [t.bg, t.soft, shade(t.ink, t.soft, .09)].flatMap(background =>
    [background, ...[t.accent, t.accent2, t.success, t.warning, t.danger].map(color => shade(color, background, .14))]);
  const text = (color: string) => surfaces.every(background => contrast(color, background) >= 4.5) ? color : t.ink;
  const values: Record<string, string> = Object.fromEntries(Object.entries(t).map(([key, value]) => [`--cyber-${key.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`)}`, value]));
  return {
    ...values,
    "--cyber-muted": text(t.muted), "--cyber-accent-text": text(t.accent), "--cyber-accent2-text": text(t.accent2),
    "--cyber-success-text": text(t.success), "--cyber-warning-text": text(t.warning), "--cyber-danger-text": text(t.danger),
    "--cyberos-font-ui": '"Oxanium", "Noto Sans SC Variable", "Noto Sans SC", sans-serif',
    "--cyberos-font-body": '"Noto Sans SC Variable", "Noto Sans SC", "Oxanium", sans-serif',
    "--cyberos-font-mono": '"Share Tech Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    "--cyber-font-body": '"Noto Sans SC Variable", "Noto Sans SC", "Oxanium", sans-serif',
    "--cyber-font-display": '"Oxanium", "Noto Sans SC Variable", sans-serif',
    "--cyber-font-mono": '"Share Tech Mono", ui-monospace, monospace',
    "--cyberos-logo-filter": mode === "dark" ? "brightness(0) invert(1)" : "brightness(0)",
    "--cyberos-hud-void": t.bg, "--cyberos-hud-deep": t.bg, "--cyberos-hud-panel": t.soft,
    "--cyberos-hud-panel-raised": mix(t.ink, 5, t.soft), "--cyberos-hud-panel-hover": mix(t.ink, 9, t.soft),
    "--cyberos-hud-text": t.ink, "--cyberos-hud-muted": text(t.muted), "--cyberos-hud-dim": text(t.muted),
    "--cyberos-hud-yellow": t.accent, "--cyberos-hud-red": t.danger, "--cyberos-hud-red-soft": t.danger,
    "--cyberos-hud-cyan": t.accent2, "--cyberos-hud-cyan-soft": t.accent2,
    "--cyberos-hud-green": t.success, "--cyberos-hud-amber": t.warning,
    "--cyberos-hud-line": t.line, "--cyberos-hud-line-soft": mix(t.line, 55), "--cyberos-hud-line-neutral": t.line,
    "--cyberos-hud-red-wash": mix(t.danger, 10), "--cyberos-hud-cyan-wash": mix(t.accent2, 10), "--cyberos-hud-yellow-wash": mix(t.accent, 10),
    "--cyberos-hud-overlay": "rgb(0 0 0 / 72%)", "--cyberos-hud-grid": "none", "--cyberos-hud-scanlines": "none",
    "--cyberos-color-canvas": t.bg, "--cyberos-color-surface": t.bg, "--cyberos-color-surface-raised": t.soft,
    "--cyberos-color-surface-strong": mix(t.ink, 5, t.soft), "--cyberos-color-surface-hover": mix(t.ink, 9, t.soft),
    "--cyberos-color-text": t.ink, "--cyberos-color-text-muted": text(t.muted), "--cyberos-color-text-dim": text(t.muted),
    "--cyberos-color-command": t.accent, "--cyberos-color-danger": t.danger, "--cyberos-color-focus": t.accent2,
    "--cyberos-color-connected": t.accent2, "--cyberos-color-success": t.success, "--cyberos-color-warning": t.warning,
    "--cyberos-color-command-text": text(t.accent), "--cyberos-color-focus-text": text(t.accent2), "--cyberos-color-connected-text": text(t.accent2),
    "--cyberos-color-success-text": text(t.success), "--cyberos-color-warning-text": text(t.warning), "--cyberos-color-danger-text": text(t.danger),
    "--cyberos-color-border": t.line, "--cyberos-color-border-emphasis": t.line,
    "--cyberos-panel-shadow": `4px 4px 0 ${mix(t.accent, 25)}`,
    "--cyberos-focus-ring": `0 0 0 2px ${t.bg}, 0 0 0 4px ${t.accent2}`,
    "--accent-contrast": t.onAccent, "--danger-contrast": t.onAccent, "--success-contrast": t.onAccent,
    "--accent-hover": mix(t.accent, 85, t.ink), "--red-hover": t.danger,
    "--danger-text": text(t.danger), "--danger-ui-text": text(t.danger), "--danger-strong-text": text(t.danger),
    "--danger-border-hover": t.danger, "--danger-bg-soft": mix(t.danger, 8), "--danger-soft": mix(t.danger, 12),
    "--subtle-bg": mix(t.ink, 3), "--subtle-bg-strong": mix(t.ink, 7), "--subtle-bg-inverse": mix(t.ink, 5),
    "--control-overlay": mix(t.ink, 7), "--success-bg": mix(t.success, 10), "--warning-bg": mix(t.warning, 10),
    "--selection-bg": mix(t.accent2, 25), "--code-text": t.ink, "--editor-backdrop": "rgb(0 0 0 / 82%)"
  };
}
