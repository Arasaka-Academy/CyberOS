import { Button, DescriptionList, DialogActions, Field, Input, Notice, Section } from "@cyberos/ui";
import type { NvrOverview, RecordingPolicy } from "@cyberos/shared";
import { Check, HardDrive } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { StoragePool } from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { HelpLabel } from "../common/HelpTip.js";
import { nvrRequest } from "../nvr/api.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";

export function SettingsNvrPage({ storagePools }: { storagePools: StoragePool[] }) {
  const { t } = useTranslation();
  const [form, setForm] = useState<RecordingPolicy | null>(null);
  const [usedBytes, setUsedBytes] = useState(0);
  const [error, setError] = useState<string | true>("");
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const submitting = useRef(false);
  const active = useRef(true);
  useEffect(() => {
    active.current = true;
    const controller = new AbortController();
    setError("");
    void nvrRequest<NvrOverview>("", "GET", undefined, controller.signal).then(value => {
      if (!controller.signal.aborted) { setForm(value.policy); setUsedBytes(value.usedBytes); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : true); });
    return () => { active.current = false; controller.abort(); };
  }, [attempt]);
  const save = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form || submitting.current) return;
    submitting.current = true; setBusy(true); setError(""); setSaved(false);
    try {
      const value = await nvrRequest<RecordingPolicy>("/policy", "PUT", form);
      if (active.current) { setForm(value); setSaved(true); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { submitting.current = false; if (active.current) setBusy(false); }
  };
  if (!form && !error) return <div className="settings-content-body" aria-busy="true"><PanelContentSkeleton /></div>;
  return <SettingsNvrContent form={form} storagePools={storagePools} usedBytes={usedBytes} busy={busy} error={error === true ? t("nvr.serviceUnavailable") : error} saved={saved} onChange={value => { setForm(value); setSaved(false); }} onSubmit={event => { void save(event); }} onRetry={() => setAttempt(value => value + 1)} />;
}

export function SettingsNvrContent({ form, storagePools, usedBytes, busy, error, saved, onChange, onSubmit, onRetry }: {
  form: RecordingPolicy | null; storagePools: StoragePool[]; usedBytes: number; busy: boolean; error: string; saved: boolean;
  onChange: (value: RecordingPolicy) => void; onSubmit: (event: FormEvent<HTMLFormElement>) => void; onRetry: () => void;
}) {
  const { t, i18n } = useTranslation();
  const selectedPool = storagePools.find(pool => pool.id === form?.storagePoolId);
  const unavailable = Boolean(form?.storagePoolId && selectedPool?.status !== "ready");
  return <form className="settings-form" onSubmit={onSubmit}>
    <div className="settings-content-body">
      {error ? <Notice className="settings-inline-error" tone="danger" role="alert" actions={!form ? <Button type="button" variant="secondary" onClick={onRetry}>{t("nvr.retry")}</Button> : undefined}>{error}</Notice> : null}
      {form ? <div className="settings-page-grid"><Section className="settings-section-card" title={t("nvr.storage")} icon={<HardDrive size={18} aria-hidden="true" />}>
        <DescriptionList items={[{ label: t("nvr.used"), value: `${(usedBytes / 2 ** 30).toLocaleString(i18n.language, { maximumFractionDigits: 2 })} GiB` }]} />
        {unavailable ? <Notice tone="warning">{t("nvr.settings.poolUnavailable")}</Notice> : null}
        <fieldset className="settings-field-grid settings-field-grid-single" disabled={busy}>
          <Field label={<HelpLabel label={t("nvr.pool")} content={t("nvr.recordingHint")} />}><CustomSelect required ariaLabel={t("nvr.pool")} disabled={busy} value={form.storagePoolId ?? ""} onChange={storagePoolId => onChange({ ...form, storagePoolId: storagePoolId || null })} options={[{ value: "", label: t("nvr.selectPool"), disabled: true }, ...(!selectedPool && form.storagePoolId ? [{ value: form.storagePoolId, label: `${form.storagePoolId} · ${t("nvr.status.unavailable")}`, disabled: true }] : []), ...storagePools.map(pool => ({ value: pool.id, label: pool.status === "ready" ? pool.name : `${pool.name} · ${t("nvr.status.unavailable")}`, disabled: pool.status !== "ready" }))]} /></Field>
          <Field label={t("nvr.directory")}><Input value={form.directory} required maxLength={2048} onChange={event => onChange({ ...form, directory: event.target.value })} /></Field>
          <Field label={<HelpLabel label={t("nvr.retention")} content={t("nvr.policyHint")} />}><Input type="number" required min={1} max={3650} step={1} value={form.retentionDays} onChange={event => onChange({ ...form, retentionDays: Number(event.target.value) })} /></Field>
          <Field label={t("nvr.quota")}><Input type="number" required min={1} max={8388607} step={1} value={form.quotaBytes / 2 ** 30} onChange={event => onChange({ ...form, quotaBytes: Number(event.target.value) * 2 ** 30 })} /></Field>
        </fieldset>
      </Section></div> : null}
    </div>
    {form ? <DialogActions className="settings-actions">{saved ? <span role="status">{t("nvr.settings.saved")}</span> : null}<Button type="submit" variant="primary" disabled={busy || unavailable || !form.storagePoolId} aria-busy={busy}><Check size={16} aria-hidden="true" />{t("common.actions.saveChanges")}</Button></DialogActions> : null}
  </form>;
}
