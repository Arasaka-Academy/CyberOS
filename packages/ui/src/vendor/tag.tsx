// Generated from packages/react/src/tag.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type NativeProps, cx } from "./shared.js";
import { useCyberUI } from "./provider.js";
import s from "./tag.module.css";
import { Icon } from "./icon.js";
export interface TagProps extends NativeProps<HTMLSpanElement> {
    onRemove?: () => void;
    removeLabel?: string;
}
export function Tag({ children, onRemove, removeLabel, className, ...props }: TagProps) {
    const { t } = useCyberUI();
    return <span {...props} className={cx(s.tag, className)}><span>{children}</span>{onRemove && <button type="button" onClick={onRemove} aria-label={removeLabel ?? t(`Remove ${children}`, `移除 ${children}`)}><Icon name="close" size={12}/></button>}</span>;
}
