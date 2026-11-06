import { Children, createContext, isValidElement, useContext, useId, type ComponentPropsWithRef, type HTMLAttributes, type ReactNode } from "react";

interface FieldControl {
  id?: string | undefined;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: HTMLAttributes<HTMLElement>["aria-invalid"];
}
interface FieldContextValue { id: string; descriptionId?: string; errorId?: string }
const FieldContext = createContext<FieldContextValue | null>(null);

/** Shared by native controls and the application select; never fabricates events. */
export function useFieldControl(props: FieldControl): FieldControl {
  const field = useContext(FieldContext);
  return {
    id: props.id ?? field?.id,
    "aria-describedby": [...new Set([props["aria-describedby"], field?.descriptionId, field?.errorId].filter(Boolean).join(" ").split(/\s+/).filter(Boolean))].join(" ") || undefined,
    "aria-invalid": field?.errorId ? true : props["aria-invalid"]
  };
}

export interface FieldProps extends Omit<HTMLAttributes<HTMLDivElement>, "children"> {
  label: ReactNode;
  children: ReactNode;
  help?: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  htmlFor?: string;
  wide?: boolean;
}
export function Field({ label, help, hint, error, htmlFor, wide, className, children, ...props }: FieldProps) {
  const generated = useId();
  const firstControl = Children.toArray(children).find(child => isValidElement<FieldControl>(child) && child.props.id);
  const id = htmlFor ?? (isValidElement<FieldControl>(firstControl) ? firstControl.props.id : undefined) ?? generated;
  const descriptionId = hint ? `${id}-field-help` : undefined;
  const errorId = error ? `${id}-field-error` : undefined;
  return <FieldContext.Provider value={{ id, ...(descriptionId ? { descriptionId } : {}), ...(errorId ? { errorId } : {}) }}>
    <div {...props} className={["ui-field", className].filter(Boolean).join(" ")} data-wide={wide || undefined}>
      <div className="ui-field-label"><label htmlFor={id}>{label}</label>{help}</div>
      {children}
      {hint ? <small className="ui-field-hint" id={descriptionId}>{hint}</small> : null}
      {error ? <span className="ui-field-error" id={errorId} role="alert">{error}</span> : null}
    </div>
  </FieldContext.Provider>;
}

export function Input({ className, ...props }: ComponentPropsWithRef<"input">) {
  const field = useFieldControl(props);
  return <input {...props} {...field} className={["ui-input", className].filter(Boolean).join(" ")} />;
}
export function Textarea({ className, ...props }: ComponentPropsWithRef<"textarea">) {
  const field = useFieldControl(props);
  return <textarea {...props} {...field} className={["ui-input", "ui-textarea", className].filter(Boolean).join(" ")} />;
}

export function InputGroup({ leading, trailing, className, children, ...props }: ComponentPropsWithRef<"div"> & { leading?: ReactNode; trailing?: ReactNode }) {
  return <div {...props} className={["ui-input-group", className].filter(Boolean).join(" ")}>
    {leading ? <span className="ui-input-leading">{leading}</span> : null}
    {children}
    {trailing ? <span className="ui-input-trailing">{trailing}</span> : null}
  </div>;
}

export function Checkbox({ className, ...props }: Omit<ComponentPropsWithRef<"input">, "type">) {
  const field = useFieldControl(props);
  return <input {...props} {...field} type="checkbox" className={["ui-checkbox", className].filter(Boolean).join(" ")} />;
}
