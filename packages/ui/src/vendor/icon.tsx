// Generated from packages/react/src/icon.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type SVGProps } from 'react';
import { cx } from "./shared.js";
import s from "./icon.module.css";
import { iconPaths } from "./icons.generated.js";
export interface IconProps extends SVGProps<SVGSVGElement> {
    name: string;
    size?: number;
    label?: string;
}
export const extraIcons: Record<string, string> = {
    code: '<path d="m8 5-7 7 7 7 1.5-1.5L3.5 12l6-5.5ZM16 5l-1.5 1.5 6 5.5-6 5.5L16 19l7-7Z"/>',
    copy: '<path fill="none" stroke="currentColor" stroke-width="2" d="M8 8h12v13H8zM16 8V3H3v13h5"/>',
    external: '<path fill="none" stroke="currentColor" stroke-width="2" d="M14 3h7v7M21 3 10 14M10 3H3v18h18v-7"/>',
    chevron: '<path fill="none" stroke="currentColor" stroke-width="2" d="m9 5 7 7-7 7"/>',
    calendar: '<path fill="none" stroke="currentColor" stroke-width="2" d="M3 5h18v16H3zM3 10h18M7 2v6M17 2v6"/>',
    lock: '<path fill="none" stroke="currentColor" stroke-width="2" d="M5 10h14v11H5zM8 10V6a4 4 0 0 1 8 0v4"/>',
};
export function Icon({ name, size = 20, label, className, ...props }: IconProps) {
    return <svg {...props} width={size} height={size} style={{ width: size, height: size, ...props.style }} viewBox="0 0 24 24" className={cx(s.icon, className)} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} dangerouslySetInnerHTML={{ __html: iconPaths[name] ?? extraIcons[name] ?? iconPaths.tools ?? "" }}/>;
}
