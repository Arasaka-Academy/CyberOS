import { DatePicker as CyberDatePicker, useFieldControl } from "@cyberos/ui";
import { useContext, useRef, useState, type AriaAttributes } from "react";
import { useTranslation } from "react-i18next";
import { ModalDepthContext, usePopoverBack } from "./ModalPortal.js";

interface DatePickerProps {
  value: string;
  onChange: (value: string) => void;
  id?: string;
  min?: string;
  max?: string;
  required?: boolean;
  disabled?: boolean;
  includeTime?: boolean;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: AriaAttributes["aria-invalid"];
}

/** CyberOS only owns Field association, locale and its mobile/modal navigation. */
export function DatePicker({ value, onChange, min, max, required, disabled, includeTime, ...props }: DatePickerProps) {
  const field = useFieldControl(props);
  const { i18n } = useTranslation();
  const rootRef = useRef<HTMLDivElement>(null);
  const depth = useContext(ModalDepthContext);
  const [open, setOpen] = useState(false);
  usePopoverBack(open, () => {
    const trigger = rootRef.current?.querySelector<HTMLButtonElement>("button[aria-expanded='true']");
    trigger?.click(); trigger?.focus();
  }, 15);
  return <CyberDatePicker {...field} ref={rootRef} label={props["aria-label"] ?? ""} hideLabel className="date-picker"
    value={value} onChange={next => onChange(next ?? "")} locale={i18n.resolvedLanguage ?? i18n.language}
    isRequired={Boolean(required)} isDisabled={Boolean(disabled)} includeTime={Boolean(includeTime)}
    {...(min ? { minValue: min } : {})} {...(max ? { maxValue: max } : {})}
    popoverZIndex={95 + depth * 10} onOpenChange={setOpen}
    portalContainer={() => typeof document === "undefined" ? null : rootRef.current?.closest<HTMLElement>("[data-modal-layer]")
      ?? document.fullscreenElement as HTMLElement | null ?? document.querySelector<HTMLElement>(".app-shell, .tv-library-shell") ?? document.body}
  />;
}
