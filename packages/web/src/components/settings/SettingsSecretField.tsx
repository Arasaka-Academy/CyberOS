import { Button as UiButton, Field, Input, InputGroup } from "@cyberos/ui";
import { useRef } from "react";
import { Undo2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { HelpTip } from "../common/HelpTip.js";

export function SettingsSecretField({
  id,
  label,
  help,
  value,
  configured,
  clearSaved,
  placeholder,
  clearLabel,
  onChange
}: {
  id: string;
  label: string;
  help?: string;
  value: string;
  configured: boolean;
  clearSaved: boolean;
  placeholder: string;
  clearLabel: string;
  onChange: (value: string, clearSaved: boolean) => void;
}) {
  const { t } = useTranslation();
  const inputRef = useRef<HTMLInputElement>(null);
  const actionLabel = clearSaved
    ? t("settings.secretInput.undoClear")
    : configured ? clearLabel : t("common.actions.clear");

  return (
    <Field className="settings-field-wide settings-secret-field" htmlFor={id} label={label} help={help ? <HelpTip label={label} content={help} /> : null}>
      <InputGroup className="settings-secret-input" data-clear-pending={clearSaved || undefined} trailing={<UiButton variant="ghost" iconOnly
          className="settings-icon-button settings-secret-action"
          type="button"
          aria-label={actionLabel}
          data-tooltip={actionLabel}
          aria-pressed={clearSaved}
          disabled={!configured && !value && !clearSaved}
          onClick={() => {
            onChange("", !clearSaved && configured);
            inputRef.current?.focus();
          }}
        >
          {clearSaved ? <Undo2 aria-hidden="true" size={16} /> : <X aria-hidden="true" size={16} />}
        </UiButton>}>
        <Input
          ref={inputRef}
          id={id}
          type="password"
          autoComplete="new-password"
          spellCheck={false}
          value={value}
          placeholder={clearSaved ? t("settings.secretInput.clearOnSave") : placeholder}
          onChange={(event) => onChange(event.target.value, false)}
        />

      </InputGroup>
    </Field>
  );
}
