// Generated from packages/react/src/input.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type InputHTMLAttributes, forwardRef, useId } from 'react';
import { cx } from "./shared.js";
import s from "./input.module.css";
import { Field } from "./field.js";
export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    description?: string;
    error?: string;
    wrapperClassName?: string;
}
export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, description = "", error = "", wrapperClassName, className = "", id, ...props }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    const input = <input {...props} id={fieldId} ref={ref} className={cx(s.input, className)} aria-invalid={error ? true : props['aria-invalid']}/>;
    return label || description || error || wrapperClassName ? <Field label={label ?? ''} htmlFor={fieldId} description={description} error={error} isRequired={props.required ?? false} className={wrapperClassName ?? ""}>{input}</Field> : input;
});
