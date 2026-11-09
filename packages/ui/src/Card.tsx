import { useId, type ComponentPropsWithRef, type ReactNode } from "react";
import { SectionHeader, type SectionHeaderProps } from "./Section.js";

export type CardProps = Omit<ComponentPropsWithRef<"article">, "title"> & {
  title?: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  footer?: ReactNode;
  variant?: "soft" | "frame";
  padding?: "normal" | "compact" | "none";
};

/** CyberUI's soft card, with an explicit frame for independent tools. */
export function Card({ title, description, icon, actions, footer, variant = "soft", padding = "normal", className, children, ...props }: CardProps) {
  const headingId = useId();
  return <article {...props} aria-labelledby={props["aria-labelledby"] ?? (title ? headingId : undefined)}
    className={["ui-card", variant === "frame" && "ui-card-frame", className].filter(Boolean).join(" ")} data-padding={padding}>
    {title ? <CardHeader title={title} description={description} icon={icon} actions={actions} headingId={headingId} /> : description ? <p className="ui-card-description">{description}</p> : null}
    {children}
    {footer ? <footer className="ui-card-footer">{footer}</footer> : null}
  </article>;
}

export function CardHeader({ className, ...props }: SectionHeaderProps) {
  return <SectionHeader {...props} className={["ui-card-header", className].filter(Boolean).join(" ")} />;
}
