import type { ComponentPropsWithRef, ReactNode } from "react";

export interface DialogHeaderProps extends Omit<ComponentPropsWithRef<"header">, "title"> {
  title: ReactNode;
  description?: ReactNode;
  eyebrow?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  headingId?: string | undefined;
  descriptionId?: string | undefined;
  headingLevel?: 2 | 3;
  headingTooltip?: string;
}
/** Layout only: ModalPortal and useModalDialog retain layer, Escape and focus ownership. */
export function DialogHeader({ title, description, eyebrow, icon, actions, headingId, descriptionId, headingLevel = 2, headingTooltip, className, ...props }: DialogHeaderProps) {
  const Heading = headingLevel === 2 ? "h2" : "h3";
  return <header {...props} className={["ui-dialog-header", className].filter(Boolean).join(" ")}>
    {icon ? <span className="ui-dialog-icon" aria-hidden="true">{icon}</span> : null}
    <div className="ui-dialog-heading">
      {eyebrow ? <span className="ui-dialog-eyebrow">{eyebrow}</span> : null}
      <Heading id={headingId} data-tooltip={headingTooltip}>{title}</Heading>
      {description ? <p id={descriptionId}>{description}</p> : null}
    </div>
    {actions ? <div className="ui-dialog-header-actions">{actions}</div> : null}
  </header>;
}

export function DialogActions({ className, ...props }: ComponentPropsWithRef<"footer">) {
  return <footer {...props} className={["ui-dialog-actions", className].filter(Boolean).join(" ")} />;
}
