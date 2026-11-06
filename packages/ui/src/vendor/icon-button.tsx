// Generated from packages/react/src/icon-button.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type ButtonProps, Button } from "./button.js";
import { forwardRef } from 'react';
import { cx } from "./shared.js";
import s from "./icon-button.module.css";
export interface IconButtonProps extends Omit<ButtonProps, 'children' | 'icon'> {
    icon: string;
    'aria-label': string;
}
export const IconButton = forwardRef<HTMLButtonElement, IconButtonProps>(function IconButton({ className, corners = 'none', ...props }, ref) {
    return <Button {...props} ref={ref} corners={corners} className={cx(s.iconButton, className)}/>;
});
