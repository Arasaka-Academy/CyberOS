// Generated from packages/react/src/spinner.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type DOMProps, cx } from "./shared.js";
import { useCyberUI } from "./provider.js";
import s from "./spinner.module.css";
export interface SpinnerProps extends DOMProps<HTMLSpanElement> {
    label?: string;
}
export function Spinner({ label, className, ...props }: SpinnerProps) {
    const { t } = useCyberUI();
    return <span {...props} role="status" aria-label={label ?? t('Loading', '加载中')} className={cx(s.spinner, className)}/>;
}
