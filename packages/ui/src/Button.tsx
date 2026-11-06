import type { ComponentPropsWithRef, ReactNode } from "react";
import shape from "./vendor/button.module.css";

export type ButtonVariant = "primary" | "secondary" | "danger" | "plain" | "ghost";
export interface ButtonProps extends ComponentPropsWithRef<"button"> {
  variant?: ButtonVariant;
  size?: "default" | "compact";
  iconOnly?: boolean;
  busy?: boolean;
}

/** Native events, form submission and refs stay native; presentation is explicit. */
export function Button({ variant = "secondary", size = "default", iconOnly = false, busy = false, className, children, disabled, ...props }: ButtonProps) {
  const command = variant === "primary" || variant === "secondary" || variant === "danger";
  return <button {...props} disabled={disabled || busy} aria-busy={busy || props["aria-busy"]}
    className={["cyberos-button", className].filter(Boolean).join(" ")}
    data-variant={variant} data-size={size} data-icon-only={iconOnly || undefined} data-corners={command && !iconOnly ? "tr-bl" : "none"}>
    {command && !iconOnly ? <span aria-hidden="true" data-slot="decoration" className={shape.shape} /> : null}
    {busy ? <><span className="ui-button-label">{children}</span><span aria-hidden="true" className="ui-button-spinner" /></> : children}
  </button>;
}

export function IconButton({ label, tooltip = label, children, ...props }: Omit<ButtonProps, "iconOnly" | "aria-label"> & { label: string; tooltip?: string; children: ReactNode }) {
  return <Button variant="ghost" {...props} iconOnly aria-label={label} data-tooltip={tooltip}>{children}</Button>;
}
