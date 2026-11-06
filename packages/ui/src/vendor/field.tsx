// Generated from packages/react/src/field.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type DOMProps, cx } from "./shared.js";
import { type ReactNode, useId, isValidElement, type ReactElement, type InputHTMLAttributes, cloneElement } from 'react';
import s from "./field.module.css";
export interface FieldProps extends DOMProps {
    label: string;
    description?: string;
    error?: string;
    isRequired?: boolean;
    children: ReactNode;
    htmlFor?: string;
}
export function Field({ label, description, error, isRequired, children, htmlFor, className, ...props }: FieldProps) {
    const generated = useId();
    const child = isValidElement(children) ? children as ReactElement<InputHTMLAttributes<HTMLInputElement>> : null;
    const id = htmlFor ?? child?.props.id ?? generated;
    const described = [child?.props['aria-describedby'], description ? `${id}-help` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined;
    return <div {...props} className={cx(s.field, className)}>
    {label && <label className={s.label ?? ""} htmlFor={id}>{label}{isRequired && <span aria-hidden> *</span>}</label>}
    {child ? cloneElement(child, { id, 'aria-describedby': described, 'aria-invalid': error ? true : child.props['aria-invalid'] }) : children}
    {description && <span className={s.helper ?? ""} id={`${id}-help`}>{description}</span>}
    {error && <span className={s.error ?? ""} id={`${id}-error`} role="alert">{error}</span>}
  </div>;
}
