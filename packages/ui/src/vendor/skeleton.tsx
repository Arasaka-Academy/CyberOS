// Generated from packages/react/src/skeleton.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type NativeProps, cx } from "./shared.js";
import { useCyberUI } from "./provider.js";
import s from "./skeleton.module.css";
export function Skeleton({ className, style, ...props }: NativeProps<HTMLDivElement>) {
    const { t } = useCyberUI();
    return <div {...props} role="status" aria-label={t('Loading content', '正在加载内容')} className={cx(s.skeleton, className)} style={style}/>;
}
