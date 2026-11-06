// Generated from packages/react/src/badge.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type NativeProps, cx } from "./shared.js";
import s from "./badge.module.css";
export interface BadgeProps extends NativeProps<HTMLSpanElement> {
    tone?: 'default' | 'accent' | 'success' | 'warning' | 'danger';
    dot?: boolean;
}
export function Badge({ tone = 'default', dot, className, children, ...props }: BadgeProps) {
    return <span {...props} className={cx(s.badge, className)} data-tone={tone}>{dot && <span aria-hidden>▪</span>}{children}</span>;
}
