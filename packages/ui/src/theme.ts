import { APPEARANCE_EVENT, APPEARANCE_STORAGE_KEY, parseAppearance, readAppearance, writeAppearance, type AppearancePreference } from "@cyberos/shared/appearance";

let current: AppearancePreference | undefined;
export function getAppearance(): AppearancePreference { return current ??= readAppearance(); }
export function applyAppearance(preference: AppearancePreference): void {
  current = parseAppearance(preference);
  const root = document.documentElement;
  root.dataset.cyberScheme = current.scheme;
  root.dataset.cyberMode = current.mode;
  root.dataset.theme = current.mode;
  root.style.colorScheme = current.mode;
  root.dispatchEvent(new CustomEvent(APPEARANCE_EVENT, { detail: current, bubbles: true }));
}
export function setAppearance(preference: AppearancePreference): void {
  writeAppearance(preference);
  applyAppearance(preference);
}
export function subscribeAppearance(listener: () => void): () => void {
  window.addEventListener(APPEARANCE_EVENT, listener);
  return () => window.removeEventListener(APPEARANCE_EVENT, listener);
}
let mounted = false;
export function mountAppearance(): void {
  if (mounted) return;
  mounted = true;
  applyAppearance(readAppearance());
  window.addEventListener("storage", event => {
    if (event.key === APPEARANCE_STORAGE_KEY || event.key === null) applyAppearance(readAppearance());
  });
}
