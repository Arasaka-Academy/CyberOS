'use client';
import './styles.css';
import { createContext, useContext, useRef, useState, useEffect, useLayoutEffect, useSyncExternalStore, useImperativeHandle, type CSSProperties, type HTMLAttributes, type ReactNode, type Ref } from 'react';
import { I18nProvider } from 'react-aria-components';
import { UNSAFE_PortalProvider } from 'react-aria';
import { createTheme, type Locale, type Mode, type Palette, type Scheme, type ThemeMode } from "./tokens.js";

interface ThemeContextValue { locale: Locale; scheme: Scheme; mode: Mode; portal: HTMLElement | null; t: (en: string, zh: string) => string }
const ThemeContext = createContext<ThemeContextValue>({ locale:'en', scheme:'neon', mode:'dark', portal: null, t: en => en });
const subscribe = (callback: () => void) => {
  const media = window.matchMedia('(prefers-color-scheme: dark)');
  media.addEventListener('change',callback); return () => media.removeEventListener('change',callback);
};
const snapshot = () => window.matchMedia('(prefers-color-scheme: dark)').matches;
export interface CyberUIProviderProps extends HTMLAttributes<HTMLDivElement> {
  scheme?: Scheme; mode?: ThemeMode; locale?: Locale; customColors?: Partial<Palette>; children: ReactNode; ref?:Ref<HTMLDivElement>;
}
export function CyberUIProvider({ scheme='neon',mode='dark',locale='en',customColors,children,style,ref,...props }: CyberUIProviderProps) {
  const dark = useSyncExternalStore(subscribe,snapshot,() => false);
  const resolved = mode==='system' ? dark?'dark':'light' : mode;
  const theme = createTheme(scheme,resolved,customColors);
  const root = useRef<HTMLDivElement>(null);
  const [portal, setPortal] = useState<HTMLDivElement | null>(null);
  useImperativeHandle(ref,()=>root.current!);
  useEffect(() => {
    const container = document.createElement('div');
    container.setAttribute('data-cyberui-portal', '');
    document.body.appendChild(container);
    setPortal(container);
    return () => { container.remove(); };
  }, []);
  useLayoutEffect(() => {
    if (!portal || !root.current) return;
    const computed = getComputedStyle(root.current);
    // Carry theme overrides out of the host without copying layout/transform styles.
    portal.style.cssText = 'display: contents;';
    for (const name of Array.from(computed)) {
      if (name.startsWith('--cyber-')) portal.style.setProperty(name, computed.getPropertyValue(name));
    }
    portal.lang = locale;
    portal.dir = computed.direction;
    portal.dataset.scheme = scheme;
    portal.dataset.mode = resolved;
  });
  const variables = Object.fromEntries(Object.entries(theme).map(([key,value]) => ['--cyber-'+key.replace(/[A-Z]/g,c=>'-'+c.toLowerCase()),value]));
  return <ThemeContext.Provider value={{ locale,scheme,mode:resolved,portal,t:(en,zh)=>locale==='zh-CN'?zh:en }}>
    <I18nProvider locale={locale}>
      <div {...props} ref={root} data-cyberui="" data-scheme={scheme} data-mode={resolved} lang={locale} style={{ ...variables,...style } as CSSProperties}>
        <UNSAFE_PortalProvider getContainer={() => portal}>{children}</UNSAFE_PortalProvider>
      </div>
    </I18nProvider>
  </ThemeContext.Provider>;
}
export const useCyberUI = () => useContext(ThemeContext);
