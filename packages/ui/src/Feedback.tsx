import type { ComponentPropsWithRef, ReactNode } from "react";

export type FeedbackTone = "info" | "success" | "warning" | "danger";

function FeedbackIcon({ tone }: { tone: FeedbackTone }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    {tone === "success" ? <path d="M4 12l5 5L20 6" /> : tone === "warning" || tone === "danger"
      ? <><path d="M12 3L2 21h20L12 3Z" /><path d="M12 9v5m0 3v1" /></>
      : <><circle cx="12" cy="12" r="9" /><path d="M12 11v6m0-10v1" /></>}
  </svg>;
}

export interface NoticeProps extends ComponentPropsWithRef<"div"> {
  tone?: FeedbackTone;
  icon?: ReactNode;
  actions?: ReactNode;
}
/** Passive/background feedback can retain role="status" instead of interrupting reading. */
export function Notice({ tone = "info", icon, actions, role, className, children, ...props }: NoticeProps) {
  return <div {...props} role={role ?? (tone === "danger" ? "alert" : "status")} data-tone={tone} className={["ui-notice", className].filter(Boolean).join(" ")}>
    <span className="ui-notice-icon" aria-hidden="true">{icon ?? <FeedbackIcon tone={tone} />}</span>
    <div className="ui-notice-copy">{children}</div>
    {actions ? <div className="ui-notice-actions">{actions}</div> : null}
  </div>;
}

export interface EmptyStateProps extends Omit<ComponentPropsWithRef<"div">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
}
/** Empty content and retry/first-use states share layout while preserving feature actions. */
export function EmptyState({ title, description, icon, actions, className, children, ...props }: EmptyStateProps) {
  return <div role="status" {...props} className={["ui-empty-state", className].filter(Boolean).join(" ")}>
    {icon ? <span className="ui-empty-icon" aria-hidden="true">{icon}</span> : null}
    {title ? <strong className="ui-empty-title">{title}</strong> : null}
    {description ? <p className="ui-empty-description">{description}</p> : null}
    {children}
    {actions ? <div className="ui-empty-actions">{actions}</div> : null}
  </div>;
}

export interface StatusBadgeProps extends ComponentPropsWithRef<"span"> {
  state?: string;
  "data-state"?: string;
}
export function StatusBadge({ state, "data-state": dataState, className, children, ...props }: StatusBadgeProps) {
  return <span {...props} className={["ui-status", className].filter(Boolean).join(" ")} data-state={state ?? dataState}>{children}</span>;
}
