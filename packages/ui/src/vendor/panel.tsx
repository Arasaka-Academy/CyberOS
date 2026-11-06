// Generated from packages/react/src/panel.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type NativeProps, cx } from "./shared.js";
import { type ReactNode } from 'react';
import s from "./panel.module.css";
export type PanelShape = 'frame' | 'chamfer' | 'brackets' | 'header' | 'rail' | 'none';
export interface PanelProps extends NativeProps<HTMLElement> {
    shape?: PanelShape;
    label?: string;
    title?: string;
    titleRight?: ReactNode;
}
export function Panel({ shape = 'frame', label, title, titleRight, children, className, ...props }: PanelProps) {
    return <section {...props} className={cx(s.panel, className)} data-shape={shape}>
    {shape === 'chamfer' && <span aria-hidden data-slot="decoration" className={s.shape ?? ""}/>}
    {shape === 'header' && title ? <div className={s.panelTitle ?? ""}><span>{title}</span>{titleRight}</div> : label || title ? <span className={s.panelLabel ?? ""}>{label ?? title}</span> : null}
    {children}
  </section>;
}
