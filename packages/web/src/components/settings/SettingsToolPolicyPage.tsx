/**
 * [INPUT]: 依赖权限表单、共享设置类型与通用界面组件。
 * [OUTPUT]: 提供完全权限开关及逐项权限设置页。
 * [POS]: Agent 设置的独立页面，保留被全局策略覆盖的配置。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton, Field, Section } from "@cyberos/ui";
import type { FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { Check, LoaderCircle } from "lucide-react";
import type { AgentCapabilityId } from "../../api.js";
import { AGENT_CAPABILITY_POLICY_OPTIONS, type ToolPolicyFormState } from "../../config/settings.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { Switch } from "../common/Switch.js";

type Translate = (key: string, options?: Record<string, unknown>) => unknown;
const READ_ONLY_CAPABILITIES: AgentCapabilityId[] = [
  "cyberos.files.list", "cyberos.files.read", "cyberos.files.search", "cyberos.files.grep", "cyberos.files.find"
];
const MUTATING_CAPABILITIES: AgentCapabilityId[] = [
  "cyberos.files.mutate", "cyberos.files.edit", "cyberos.files.write", "cyberos.shell.run"
];
const CAPABILITY_DESCRIPTION_KEY = {
  "cyberos.files.list": "list",
  "cyberos.files.read": "read",
  "cyberos.files.search": "search",
  "cyberos.files.grep": "grep",
  "cyberos.files.find": "find",
  "cyberos.files.mutate": "mutate",
  "cyberos.files.edit": "edit",
  "cyberos.files.write": "write",
  "cyberos.shell.run": "shell"
} as const satisfies Record<AgentCapabilityId, string>;

export function SettingsToolPolicyPage({
  form,
  loading,
  saving,
  onChange,
  onSubmit,
  onClose
}: {
  form: ToolPolicyFormState;
  loading: boolean;
  saving: boolean;
  onChange: (form: ToolPolicyFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const policyOptions = AGENT_CAPABILITY_POLICY_OPTIONS.map((mode) => ({
    value: mode,
    label: toolPolicyModeLabel(mode, t)
  }));
  const approvalRequiredPolicyOptions = policyOptions.filter((option) => option.value !== "auto");

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        <div className="settings-page-grid">
          <Section className="settings-section-card" title={t("settings.toolPolicy.fullAccessTitle")} description={t("settings.toolPolicy.fullAccessDescription")}>
            <Switch checked={form.fullAccess} disabled={loading || saving}
              label={t("settings.toolPolicy.fullAccessLabel")}
              onCheckedChange={(fullAccess) => onChange({ ...form, fullAccess })} />
            {form.fullAccess ? <p role="status">{t("settings.toolPolicy.fullAccessOverrides")}</p> : null}
          </Section>
          <Section className="settings-section-card" title={t("settings.toolPolicy.readOnlyTitle")} description={t("settings.toolPolicy.readOnlyDescription")}>

            <div className="settings-tool-policy-list">
              {READ_ONLY_CAPABILITIES.map((capabilityId) => (
                <Field key={capabilityId} className="settings-policy-row" label={<>
                    <strong>{capabilityId}</strong>
                    <small>{t(`settings.toolPolicy.capabilities.${CAPABILITY_DESCRIPTION_KEY[capabilityId]}`)}</small>
                  </>}>

                  <CustomSelect
                    id={`capability-policy-${capabilityId}`}
                    value={form.policies[capabilityId]}
                    options={policyOptions}
                    ariaLabel={`${capabilityId}: ${toolPolicyModeLabel(form.policies[capabilityId], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        policies: { ...form.policies, [capabilityId]: mode }
                      })
                    }
                    disabled={loading || saving || form.fullAccess}
                  />
                </Field>
              ))}
            </div>
          </Section>

          <Section className="settings-section-card" title={t("settings.toolPolicy.dangerousTitle")} description={t("settings.toolPolicy.dangerousDescription")}>

            <div className="settings-tool-policy-list">
              {MUTATING_CAPABILITIES.map((capabilityId) => (
                <Field key={capabilityId} className="settings-policy-row" label={<>
                    <strong>{capabilityId}</strong>
                    <small>{t(`settings.toolPolicy.capabilities.${CAPABILITY_DESCRIPTION_KEY[capabilityId]}`)}</small>
                  </>}>

                  <CustomSelect
                    id={`capability-policy-${capabilityId}`}
                    value={form.policies[capabilityId]}
                    options={capabilityId === "cyberos.files.mutate" ? approvalRequiredPolicyOptions : policyOptions}
                    ariaLabel={`${capabilityId}: ${toolPolicyModeLabel(form.policies[capabilityId], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        policies: { ...form.policies, [capabilityId]: mode }
                      })
                    }
                    disabled={loading || saving || form.fullAccess}
                  />
                </Field>
              ))}
            </div>
          </Section>

        </div>
      </div>

      <footer className="settings-actions">
        <span role="status">{saving ? t("common.actions.saving") : null}</span>
        <div>
          <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </UiButton>
          <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving} aria-busy={loading || saving || undefined}>
            {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
            {t("common.actions.saveChanges")}
          </UiButton>
        </div>
      </footer>
    </form>
  );
}

function toolPolicyModeLabel(mode: string, t: Translate): string {
  if (mode === "auto") {
    return String(t("settings.toolPolicy.modes.auto"));
  }
  if (mode === "approve") return String(t("settings.toolPolicy.modes.approve"));
  if (mode === "confirm") return String(t("settings.toolPolicy.modes.confirm"));
  return String(t("settings.toolPolicy.modes.disabled"));
}
