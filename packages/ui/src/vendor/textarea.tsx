// Generated from packages/react/src/textarea.tsx. Regenerate in CyberUI with pnpm registry:build; after installation, edit this file freely.
'use client';
import { type TextareaHTMLAttributes, forwardRef, useId } from 'react';
import { Field } from "./field.js";
import { cx } from "./shared.js";

import inputStyles from "./input.module.css";
export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
    label: string;
    description?: string;
    error?: string;
}
export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ label, description = "", error = "", className, id, ...props }, ref) {
    const generated = useId();
    const fieldId = id ?? generated;
    return <Field label={label} htmlFor={fieldId} description={description} error={error} isRequired={props.required ?? false}>
    <textarea rows={4} {...props} ref={ref} id={fieldId} className={cx(inputStyles.input, className)}/>
  </Field>;
});
