// Generated from packages/react/src/empty-state.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type DOMProps, cx } from "./shared.js";
import { type ReactNode } from 'react';
import s from "./empty-state.module.css";
import { Icon } from "./icon.js";
export interface EmptyStateProps extends DOMProps {
    title: string;
    description?: string;
    icon?: string;
    action?: ReactNode;
}
export function EmptyState({ title, description, icon = 'folder', action, className, ...props }: EmptyStateProps) {
    return <div {...props} className={cx(s.empty, className)}><Icon name={icon} size={36}/><h3>{title}</h3>{description && <p>{description}</p>}{action}</div>;
}
