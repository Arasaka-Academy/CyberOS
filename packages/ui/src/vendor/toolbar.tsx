// Generated from packages/react/src/toolbar.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type ToolbarProps as AriaToolbarProps, Toolbar as AriaToolbar } from 'react-aria-components';
import { type ReactNode, type Ref } from 'react';
import { cx } from "./shared.js";
import s from "./toolbar.module.css";
export interface ToolbarProps extends Omit<AriaToolbarProps, 'children' | 'className'> {
    children: ReactNode;
    label?: string;
    className?: string;
    ref?: Ref<HTMLDivElement>;
}
export function Toolbar({ children, label = 'Actions', ...props }: ToolbarProps) {
    return <AriaToolbar {...props} aria-label={label} className={cx(s.toolbar, props.className)}>{children}</AriaToolbar>;
}
