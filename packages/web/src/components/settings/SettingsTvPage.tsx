/**
 * [INPUT]: 依赖 TV 配置、输出库存、运行状态和目录选择器。
 * [OUTPUT]: 提供独立 TV 配置、输出应用确认和运行状态页面。
 * [POS]: 设置的 TV 边界；状态轮询不写入表单草稿。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, DescriptionList, DialogActions, DialogHeader, Notice, Section, StatusBadge } from "@cyberos/ui";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TvOutputOptions } from "@cyberos/shared";
import { applyTvOutput, getTvOutputOptions, getTvSettings, getTvStatus, updateTvSettings, type TvSettings, type TvModeStatus } from "../../api.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { ModalPortal } from "../common/ModalPortal.js";
import { useModalDialog } from "../workspace/useModalDialog.js";
import { TvSettingsFields, tvForm, validTvTimers, type TvForm } from "./SettingsTvPageFields.js";
export { TvSettingsFields, tvForm, validTvTimers, tvDeviceOptions, type TvForm } from "./SettingsTvPageFields.js";
import { Switch } from "../common/Switch.js";
import { StorageFilePickerDialog, type StorageFilePickerPool } from "../workspace/StorageFilePickerDialog.js";

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
  const [outputs, setOutputs] = useState<TvOutputOptions | null>(null);
  const [outputsError, setOutputsError] = useState<string | null>(null);
  const [outputsBusy, setOutputsBusy] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [applyError, setApplyError] = useState<string | null>(null);
  const confirmationId = useId();
  const mounted = useRef(true);
  const outputSequence = useRef(0);
  const closeConfirmation = () => { if (!busy) setConfirmApply(false); };
  const dialogRef = useModalDialog(closeConfirmation, busy, confirmApply);
  const refreshOutputs = useCallback(async () => {
    const sequence = ++outputSequence.current;
    setOutputsBusy(true);
    try {
      const next = await getTvOutputOptions();
      if (mounted.current && sequence === outputSequence.current) { setOutputs(next); setOutputsError(null); }
    } catch (error) {
      if (mounted.current && sequence === outputSequence.current) setOutputsError(error instanceof Error ? error.message : String(error));
    } finally { if (mounted.current && sequence === outputSequence.current) setOutputsBusy(false); }
  }, []);
  useEffect(() => {
    mounted.current = true;
    void refreshOutputs();
    return () => { mounted.current = false; outputSequence.current += 1; };
  }, [refreshOutputs]);
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
      if (!mounted.current) return;
      setSettings(next);
      if (syncDraft) setDraft(tvForm(next));
      void getTvStatus().then(value => { if (mounted.current) setStatus(value); }).catch(() => {});
      setSettingsError(null); void refreshOutputs(); onNotifySuccess(t("settings.media.tvSettingsSaved"));
    } catch (failure) { if (mounted.current) onNotifyError(failure instanceof Error ? failure.message : String(failure)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
  };
  const applyOutput = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setApplyError(null);
    try {
      await applyTvOutput();
      if (!mounted.current) return;
      setConfirmApply(false);
      await refreshOutputs();
      void getTvStatus().then(value => { if (mounted.current) setStatus(value); }).catch(() => {});
      onNotifySuccess(t("tvIdle.outputApplied"));
    } catch (error) { if (mounted.current) setApplyError(error instanceof Error ? error.message : String(error)); }
    finally { lock.current = false; if (mounted.current) setBusy(false); }
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
          <TvSettingsFields draft={draft} busy={busy} onChange={patch} onChooseDirectory={() => setPicker(true)} outputs={outputs} />
          <div className="settings-tv-output-actions">
            <Button type="button" variant="secondary" disabled={busy || outputsBusy} busy={outputsBusy} onClick={() => void refreshOutputs()}>{t("tvIdle.refreshOutputs")}</Button>
            <Button type="button" variant="secondary" disabled={busy || !settings.enabled || !outputs?.restartRequired || draft.drmConnector !== settings.drmConnector} onClick={() => { setApplyError(null); setConfirmApply(true); }}>{t("tvIdle.applyOutput")}</Button>
          </div>
          {outputsError ? <Notice role="alert" tone="danger">{outputsError}</Notice> : null}
          {outputs?.drm.error ? <Notice role="alert" tone="danger">{t("tvIdle.drmUnavailable")}: {outputs.drm.error}</Notice> : null}
          {outputs?.audio.error ? <Notice role="alert" tone="danger">{t("tvIdle.audioUnavailable")}: {outputs.audio.error}</Notice> : null}
          {draft.drmConnector !== settings.drmConnector || outputs?.restartRequired ? <p className="settings-tv-pending" role="status">{t(draft.drmConnector !== settings.drmConnector ? "tvIdle.saveOutputFirst" : "tvIdle.outputPending")}</p> : null}
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
    <footer className="settings-actions"><div><Button type="submit" variant="primary" disabled={busy || !draft || !validTvTimers(draft) || draft.screensaverSource.kind !== "builtin" && !draft.screensaverSource.storagePoolId} busy={busy}>{t("common.actions.saveChanges")}</Button></div></footer>
    </form>
    {confirmApply ? <ModalPortal className="management-modal-backdrop" role="presentation" onMouseDown={closeConfirmation}>
      <section ref={dialogRef} className="management-dialog" role="alertdialog" aria-modal="true" aria-labelledby={confirmationId} aria-describedby={`${confirmationId}-description`} tabIndex={-1} onMouseDown={event => event.stopPropagation()}>
        <DialogHeader title={t("tvIdle.applyOutput")} headingId={confirmationId} actions={<Button type="button" variant="ghost" disabled={busy} onClick={closeConfirmation}>{t("common.actions.close")}</Button>} />
        <p id={`${confirmationId}-description`}>{t("tvIdle.applyOutputConfirm")}</p>
        {applyError ? <Notice tone="danger" role="alert">{applyError}</Notice> : null}
        <DialogActions><Button type="button" variant="secondary" disabled={busy} onClick={closeConfirmation}>{t("common.actions.cancel")}</Button><Button type="button" variant="primary" disabled={busy} busy={busy} onClick={() => void applyOutput()}>{t("tvIdle.applyOutput")}</Button></DialogActions>
      </section>
    </ModalPortal> : null}
    {picker ? <StorageFilePickerDialog pools={pools} locale={locale} initialPoolId={draft && draft.screensaverSource.kind !== "builtin" ? draft.screensaverSource.storagePoolId : pools[0]?.id ?? ""} mode="directory" directoryPurpose="tvScreensaver" onCancel={() => setPicker(false)} onSelect={selection => { patch({ screensaverSource: { kind: draft?.screensaverSource.kind === "video-directory" ? "video-directory" : "directory", storagePoolId: selection.storagePoolId, path: selection.path } }); setPicker(false); }} /> : null}
  </>;
}
