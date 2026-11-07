import { createContext, useContext, useSyncExternalStore, type CSSProperties, type ReactNode } from "react";
import { DEFAULT_APPEARANCE, appearanceSchemes, type AppearancePreference } from "@cyberos/shared/appearance";
import { CyberUIProvider } from "./vendor/provider.js";
import { getAppearance, setAppearance, subscribeAppearance } from "./theme.js";
import { Button as CyberButton } from "./vendor/button.js";

export function useAppearance(): AppearancePreference {
  return useSyncExternalStore(subscribeAppearance, getAppearance, () => DEFAULT_APPEARANCE);
}
const LocaleContext = createContext<"en" | "zh-CN">("zh-CN");
export function AppearanceProvider({ children, locale = "zh-CN" }: { children: ReactNode; locale?: "en" | "zh-CN" }) {
  const preference = useAppearance();
  return <LocaleContext.Provider value={locale}><CyberUIProvider {...preference} locale={locale} className="cyberos-ui-root"
    style={{ "--cyber-muted": "var(--cyberos-color-text-muted)", "--cyber-accent-text": "var(--cyberos-color-command-text)" } as CSSProperties}>{children}</CyberUIProvider></LocaleContext.Provider>;
}

export function ThemePicker() {
  const appearance = useAppearance();
  const locale = useContext(LocaleContext);
  const zh = locale === "zh-CN";
  return <div className="appearance-picker">
    <div className="appearance-schemes" role="group" aria-label={zh ? "配色" : "Color scheme"}>
      {appearanceSchemes.map(scheme => <CyberButton key={scheme} variant={appearance.scheme === scheme ? "primary" : "secondary"} size="sm" aria-pressed={appearance.scheme === scheme} onPress={() => setAppearance({ ...appearance, scheme })} data-theme-swatch={scheme}>{scheme}</CyberButton>)}
    </div>
    <div className="appearance-modes" role="group" aria-label={zh ? "显示模式" : "Display mode"}>
      {(["dark", "light"] as const).map(mode => <CyberButton key={mode} variant={appearance.mode === mode ? "accent2" : "secondary"} size="sm" aria-pressed={appearance.mode === mode} onPress={() => setAppearance({ ...appearance, mode })}>{zh ? mode === "dark" ? "深色" : "浅色" : mode === "dark" ? "Dark" : "Light"}</CyberButton>)}
    </div>
  </div>;
}
