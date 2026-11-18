/**
 * [INPUT]: 依赖 TV 设置、状态接口和存储目录选择器。
 * [OUTPUT]: 提供独立 TV 配置与运行状态页面。
 * [POS]: 设置的 TV 边界；状态轮询不写入表单草稿。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, DescriptionList, Field, Input, Notice, Section, StatusBadge } from "@cyberos/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { TV_SCREENSAVER_MINUTES, TV_SCREEN_OFF_MINUTES } from "@cyberos/shared";
import { getTvSettings, getTvStatus, updateTvSettings, type TvSettings, type TvModeStatus } from "../../api.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { Switch } from "../common/Switch.js";
import { StorageFilePickerDialog, type StorageFilePickerPool } from "../workspace/StorageFilePickerDialog.js";

export type TvForm = Pick<TvSettings, "audioDevice" | "drmConnector" | "hardwareDecoding" | "screensaverSource" | "screensaverAfterMinutes" | "screenOffAfterMinutes">;
export function tvForm(settings: TvSettings): TvForm {
  return { audioDevice: settings.audioDevice, drmConnector: settings.drmConnector, hardwareDecoding: settings.hardwareDecoding,
    screensaverSource: settings.screensaverSource, screensaverAfterMinutes: settings.screensaverAfterMinutes, screenOffAfterMinutes: settings.screenOffAfterMinutes };
}
export function validTvTimers(form: TvForm): boolean {
  return form.screensaverAfterMinutes === null || form.screenOffAfterMinutes === null || form.screenOffAfterMinutes > form.screensaverAfterMinutes;
}
export function SettingsTvPage({ pools, locale, onNotifySuccess, onNotifyError }: {
  pools: StorageFilePickerPool[]; locale: SupportedLocale; onNotifySuccess: (message: string) => void; onNotifyError: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<TvSettings | null>(null);
  const [draft, setDraft] = useState<TvForm | null>(null);
  const [status, setStatus] = useState<TvModeStatus | null>(null);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [statusError, setStatusError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [busy, setBusy] = useState(false);
  const [picker, setPicker] = useState(false);
  const lock = useRef(false);
  useEffect(() => {
    let active = true;
    setSettingsError(null);
    void getTvSettings().then(value => { if (active) { setSettings(value); setDraft(tvForm(value)); } }).catch(failure => { if (active) setSettingsError(String(failure.message)); });
    return () => { active = false; };
  }, [retry]);
  useEffect(() => {
    let active = true;
    const refresh = () => void getTvStatus().then(value => { if (active) { setStatus(value); setStatusError(null); } }).catch(failure => { if (active) setStatusError(String(failure.message)); });
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { active = false; clearInterval(timer); };
  }, []);
  const run = async (patch: Parameters<typeof updateTvSettings>[0], syncDraft: boolean) => {
    if (lock.current) return;
    lock.current = true; setBusy(true);
    try {
      const next = await updateTvSettings(patch);
      setSettings(next);
      if (syncDraft) setDraft(tvForm(next));
      void getTvStatus().then(setStatus).catch(() => {});
      setSettingsError(null); onNotifySuccess(t("settings.media.tvSettingsSaved"));
    } catch (failure) { onNotifyError(failure instanceof Error ? failure.message : String(failure)); }
    finally { lock.current = false; setBusy(false); }
  };
  const patch = (value: Partial<TvForm>) => setDraft(current => current ? { ...current, ...value } : current);
  return <>
    <form className="settings-form" onSubmit={event => { event.preventDefault(); if (draft && validTvTimers(draft)) void run(draft, true); }}>
    <div className="settings-content-body"><div className="settings-page-grid settings-media-page">
      {settingsError ? <Notice tone="danger" role="alert">{settingsError}<Button variant="secondary" type="button" onClick={() => setRetry(value => value + 1)}>{t("common.actions.retry")}</Button></Notice> : null}
      {statusError ? <Notice tone="danger" role="alert">{statusError}</Notice> : null}
      {!draft || !settings ? settingsError ? null : <p role="status">{t("settings.media.loading")}</p> : <>
        <Section className="settings-section-card" title={t("tvIdle.title")} actions={<Switch checked={settings.enabled} disabled={busy} label={t("settings.media.tvMode")} onCheckedChange={enabled => {
          if (window.confirm(t(enabled ? "settings.media.tvEnableConfirm" : "settings.media.tvDisableConfirm"))) void run({ enabled, ...(enabled ? { videoOutput: "wayland" as const } : {}), confirmed: true }, false);
        }} />}>
          <TvSettingsFields draft={draft} busy={busy} onChange={patch} onChooseDirectory={() => setPicker(true)} />
        </Section>
        {!validTvTimers(draft) ? <Notice role="alert" tone="danger">{t("tvIdle.invalidTimers")}</Notice> : null}
      </>}
      {status ? <Section className="settings-section-card settings-tv-status" title={t("settings.media.tvStatusTitle")} description={t("settings.media.tvStatusDescription")}>
        <strong className={`settings-tv-overall is-${status.state}`}>{t(`settings.media.tvStates.${status.state}`)}</strong>
        {status.display ? <DescriptionList items={[{ label: t("tvIdle.display"), value: t(`tvIdle.${status.display.state}`), detail: status.display.reason ?? undefined }]} /> : null}
        <DescriptionList items={(["weston", "chromium", "vodPlayer", "cec", "gamepad"] as const).map(component => ({
          id: component, label: t(`settings.media.tvComponents.${component}`),
          value: <StatusBadge state={status[component].state === "ready" ? "ready" : status[component].state === "degraded" ? "warning" : status[component].state === "unavailable" ? "offline" : status[component].state}>{t(`settings.media.componentStates.${status[component].state}`)}</StatusBadge>,
          detail: status[component].detail ?? t("settings.media.noStatusDetail"),
        }))} />
      </Section> : null}
    </div></div>
    <footer className="settings-actions"><div><Button type="submit" variant="primary" disabled={busy || !draft || !validTvTimers(draft) || draft.screensaverSource.kind === "directory" && !draft.screensaverSource.storagePoolId} busy={busy}>{t("common.actions.saveChanges")}</Button></div></footer>
    </form>
    {picker ? <StorageFilePickerDialog pools={pools} locale={locale} initialPoolId={draft?.screensaverSource.kind === "directory" ? draft.screensaverSource.storagePoolId : pools[0]?.id ?? ""} mode="directory" directoryPurpose="tvScreensaver" onCancel={() => setPicker(false)} onSelect={selection => { patch({ screensaverSource: { kind: "directory", storagePoolId: selection.storagePoolId, path: selection.path } }); setPicker(false); }} /> : null}
  </>;
}

export function TvSettingsFields({ draft, busy, onChange, onChooseDirectory }: { draft: TvForm; busy: boolean; onChange: (patch: Partial<TvForm>) => void; onChooseDirectory: () => void }) {
  const { t } = useTranslation();
  const options = (minutes: readonly number[]) => [{ value: "never", label: t("tvIdle.never") }, ...minutes.map(count => ({ value: String(count), label: t("tvIdle.minutes", { count }) }))];
  return <fieldset className="settings-field-grid" disabled={busy}>
    <Field label={t("settings.media.audioDevice")}><Input value={draft.audioDevice ?? ""} onChange={event => onChange({ audioDevice: event.target.value || null })} placeholder="default" /></Field>
    <Field label={t("settings.media.drmConnector")}><Input value={draft.drmConnector ?? ""} onChange={event => onChange({ drmConnector: event.target.value || null })} placeholder="HDMI-A-1" /></Field>
    <Field label={t("settings.media.hardwareDecoding")}><CustomSelect value={draft.hardwareDecoding} ariaLabel={t("settings.media.hardwareDecoding")} options={[{ value: "auto-safe", label: t("settings.media.hwdec.autoSafe") }, { value: "auto", label: t("settings.media.hwdec.auto") }, { value: "no", label: t("settings.media.hwdec.no") }]} onChange={hardwareDecoding => onChange({ hardwareDecoding })} /></Field>
    <Field label={t("tvIdle.source")}><CustomSelect value={draft.screensaverSource.kind} ariaLabel={t("tvIdle.source")} options={[{ value: "builtin", label: t("tvIdle.builtin") }, { value: "directory", label: t("tvIdle.directory") }]} onChange={kind => onChange({ screensaverSource: kind === "builtin" ? { kind } : { kind, storagePoolId: "", path: "." } })} /></Field>
    {draft.screensaverSource.kind === "directory" ? <Field label={t("tvIdle.directory")}><Button variant="secondary" onClick={onChooseDirectory}>{draft.screensaverSource.storagePoolId ? draft.screensaverSource.path : t("tvIdle.chooseDirectory")}</Button></Field> : null}
    <Field label={t("tvIdle.saverAfter")}><CustomSelect value={draft.screensaverAfterMinutes === null ? "never" : String(draft.screensaverAfterMinutes)} ariaLabel={t("tvIdle.saverAfter")} options={options(TV_SCREENSAVER_MINUTES)} onChange={value => onChange({ screensaverAfterMinutes: value === "never" ? null : Number(value) })} /></Field>
    <Field label={t("tvIdle.offAfter")}><CustomSelect value={draft.screenOffAfterMinutes === null ? "never" : String(draft.screenOffAfterMinutes)} ariaLabel={t("tvIdle.offAfter")} options={options(TV_SCREEN_OFF_MINUTES)} onChange={value => onChange({ screenOffAfterMinutes: value === "never" ? null : Number(value) })} /></Field>
  </fieldset>;
}
