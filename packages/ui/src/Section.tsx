import { useId, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from "react";

export interface SectionHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
  descriptionId?: string;
}
export function SectionHeader({ title, description, icon, actions, headingId, descriptionId, className, ...props }: SectionHeaderProps) {
  return <header {...props} className={["ui-section-header", className].filter(Boolean).join(" ")}>
    {icon ? <span className="ui-section-icon" aria-hidden="true">{icon}</span> : null}
    <div className="ui-section-heading"><h3 id={headingId}>{title}</h3>{description ? <p id={descriptionId}>{description}</p> : null}</div>
    {actions ? <div className="ui-section-actions">{actions}</div> : null}
  </header>;
}

export interface SectionProps extends Omit<ComponentPropsWithRef<"section">, "title"> {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  headingId?: string;
  descriptionId?: string;
}
/** Persistent content is separated by rules; frames belong to interactive items. */
export function Section({ title, description, icon, actions, headingId: providedId, descriptionId, className, children, ...props }: SectionProps) {
  const generated = useId();
  const headingId = providedId ?? generated;
  return <section {...props} aria-labelledby={title ? headingId : props["aria-labelledby"]} className={["ui-section", className].filter(Boolean).join(" ")}>
    {title ? <SectionHeader title={title} description={description} icon={icon} actions={actions} headingId={headingId} {...(descriptionId ? { descriptionId } : {})} /> : null}
    {children}
  </section>;
}
