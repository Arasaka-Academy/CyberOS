// Generated from packages/react/src/button.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type ButtonProps as AriaButtonProps, Button as AriaButton } from 'react-aria-components';
import { type ReactNode, forwardRef } from 'react';
import { cx } from "./shared.js";
import s from "./button.module.css";
import { Icon } from "./icon.js";
export interface ButtonProps extends Omit<AriaButtonProps, 'children' | 'className' | 'style'> {
    children?: ReactNode;
    className?: string;
    style?: React.CSSProperties;
    variant?: 'primary' | 'secondary' | 'accent2' | 'soft' | 'ghost' | 'danger';
    size?: 'sm' | 'md' | 'lg';
    corners?: 'tr-bl' | 'tl-br' | 'tr' | 'none';
    icon?: string;
    disabled?: boolean;
    isPending?: boolean;
}
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button({ children, variant = 'secondary', size = 'md', corners = 'tr-bl', icon, disabled, isDisabled, isPending = false, className, ...props }, ref) {
    return <AriaButton {...props} ref={ref} render={props.render ?? ((nativeProps) => <button {...nativeProps} aria-busy={isPending || undefined}/>)} className={cx(s.button, className)} isDisabled={disabled || isDisabled || isPending} isPending={isPending} aria-busy={isPending || undefined} data-variant={variant} data-size={size} data-corners={corners}>
    <span aria-hidden data-slot="decoration" className={s.shape ?? ""}/>{isPending ? <span aria-hidden className={s.spinner ?? ""}/> : icon ? <Icon name={icon}/> : null}
    {children && <span>{children}</span>}
  </AriaButton>;
});
