import { Button as UiButton, DialogActions, Field, Input, Notice, Section } from "@cyberos/ui";
import { useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle, UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import {
  getSystemProfileSettings,
  updateSystemProfileSettings,
  type SystemProfileSettings
} from "../../api.js";

export function SettingsSystemProfilePage() {
  const [settings, setSettings] = useState<SystemProfileSettings | null>(null);
  const [displayName, setDisplayName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSystemProfileSettings()
      .then((next) => {
        if (!active) return;
        setSettings(next);
        setDisplayName(next.adminDisplayName);
        setError(null);
      })
      .catch((nextError: unknown) => {
        if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
      });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const next = await updateSystemProfileSettings({ adminDisplayName: displayName });
      setSettings(next);
      setDisplayName(next.adminDisplayName);
      setError(null);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (!settings && !error) {
    return <div className="settings-content-body"><PanelContentSkeleton /></div>;
  }

  return <SettingsSystemProfileContent
    displayName={displayName}
    busy={busy}
    error={error}
    onDisplayNameChange={setDisplayName}
    onSubmit={save}
  />;
}

export function SettingsSystemProfileContent({
  displayName,
  busy,
  error,
  onDisplayNameChange,
  onSubmit
}: {
  displayName: string;
  busy: boolean;
  error: string | null;
  onDisplayNameChange: (displayName: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useTranslation();
  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        {error ? <Notice className="settings-inline-error" role="alert" tone="danger">{error}</Notice> : null}
        <div className="settings-page-grid">
          <Section className="settings-section-card" title={t("settings.systemProfile.title")} description={t("settings.systemProfile.description")} icon={<UserRound size={18} aria-hidden="true" />}>

            <Field className="settings-field-wide" label={t("settings.systemProfile.adminDisplayName")}>

              <Input required maxLength={80} value={displayName} onChange={(event) => onDisplayNameChange(event.target.value)} />
            </Field>
          </Section>
        </div>
      </div>
      <DialogActions className="settings-actions">
        <div><UiButton variant="primary" className="primary-button" type="submit" disabled={busy || !displayName.trim()} aria-busy={busy || undefined}>
          {busy ? <LoaderCircle className="is-spinning" size={15} /> : <Check size={15} />}
          {t("common.actions.saveChanges")}
        </UiButton></div>
      </DialogActions>
    </form>
  );
}
