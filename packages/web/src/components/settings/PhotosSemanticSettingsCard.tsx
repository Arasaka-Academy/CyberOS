import { Button as UiButton, Field, Input, Notice, Section } from "@cyberos/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { PhotosEmbeddingModel, PhotosSemanticIndexStatus, PhotosSemanticSettingsPatch } from "@cyberos/shared";
import {
  getPhotosSemanticSettings, runPhotosSemanticIndex, savePhotosSemanticSettings, testPhotosSemanticSettings,
  type PhotosSemanticSettingsResponse
} from "../../api.js";
import { Switch } from "../common/Switch.js";
import { HelpTip } from "../common/HelpTip.js";
import { SettingsSecretField } from "./SettingsSecretField.js";
import { formatBytes } from "../../i18n/format.js";
import { resolveSupportedLocale } from "../../i18n/locale.js";

export function PhotosSemanticSettingsCard() {
  const { t, i18n } = useTranslation();
  const [saved, setSaved] = useState<PhotosSemanticSettingsResponse["settings"] | null>(null);
  const [draft, setDraft] = useState<PhotosSemanticSettingsPatch | null>(null);
  const [status, setStatus] = useState<PhotosSemanticIndexStatus | null>(null);
  const [tested, setTested] = useState<PhotosEmbeddingModel | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [confirmRebuild, setConfirmRebuild] = useState(false);
  const revision = useRef(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll(initial = false) {
      try {
        const response = await getPhotosSemanticSettings();
        if (stopped) return;
        setSaved(response.settings); setStatus(response.status);
        // A later successful poll also recovers a failed initial load, without replacing edits.
        setDraft((current) => current ?? { enabled: response.settings.enabled, baseUrl: response.settings.baseUrl, model: response.settings.model });
        setLoadError(null);
      } catch (cause) { if (initial && !stopped) setLoadError(String(cause instanceof Error ? cause.message : cause)); }
      finally { if (!stopped) timer = setTimeout(() => void poll(), 5000); }
    }
    void poll(true);
    return () => { stopped = true; alive.current = false; clearTimeout(timer); };
  }, []);

  function edit(patch: PhotosSemanticSettingsPatch) {
    revision.current++; setDraft((current) => ({ ...current, ...patch }));
    setTested(null); setMessage(null); setError(null); setConfirmRebuild(false);
  }
  async function run(action: "save" | "test" | "retry" | "rebuild") {
    if (!draft || busy) return;
    setBusy(true); setError(null); setMessage(null);
    const version = revision.current;
    try {
      if (action === "test") {
        const result = await testPhotosSemanticSettings(draft);
        if (alive.current && revision.current === version) { setTested(result.model); setMessage(t("settings.photos.semantic.connected")); }
      } else if (action === "save") {
        const result = await savePhotosSemanticSettings(draft);
        if (alive.current) {
          setSaved(result.settings); setStatus(result.status);
          if (revision.current === version) { setDraft({ enabled: result.settings.enabled, baseUrl: result.settings.baseUrl, model: result.settings.model }); setMessage(t("settings.photos.saved")); }
        }
      } else {
        const result = await runPhotosSemanticIndex(action);
        if (alive.current) { setStatus(result.status); setConfirmRebuild(false); setMessage(t("settings.photos.semantic.queued")); }
      }
    } catch (cause) { if (alive.current && revision.current === version) setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { if (alive.current) setBusy(false); }
  }
  const dimensions = tested?.dimensions ?? saved?.dimensions;
  const space = tested?.embeddingSpaceId ?? status?.embeddingSpaceId;
  return <Section className="settings-section-card photos-semantic-settings" aria-busy={busy || !draft} title={<>{t("settings.photos.semantic.title")}<HelpTip label={t("settings.photos.semantic.title")} content={t("settings.photos.semantic.help")} /></>}>

    <fieldset className="settings-field-grid" disabled={!draft || busy}>
      <div className="settings-switch-row settings-field-wide"><strong>{t("settings.photos.semantic.enabled")}</strong><Switch checked={draft?.enabled ?? false} ariaLabel={t("settings.photos.semantic.enabled")} onCheckedChange={(enabled) => edit({ enabled })} /></div>
      <Field className="settings-field-wide" label={t("settings.photos.semantic.url")}><Input type="url" value={draft?.baseUrl ?? ""} placeholder="https://mac-mini.example.ts.net:9443" onChange={(event) => edit({ baseUrl: event.target.value })} /></Field>
      <Field className="settings-field-wide" label={t("settings.photos.semantic.model")}><Input value={draft?.model ?? ""} spellCheck={false} onChange={(event) => edit({ model: event.target.value })} /></Field>
      <SettingsSecretField id="photos-semantic-api-key" label={t("settings.photos.semantic.key")} value={draft?.apiKey ?? ""} configured={saved?.apiKeyConfigured ?? false} clearSaved={draft?.clearApiKey ?? false}
        placeholder={saved?.apiKeyConfigured ? t("settings.photos.semantic.keySaved") : t("settings.photos.semantic.key")}
        clearLabel={t("settings.photos.semantic.clearKey")} onChange={(apiKey, clearApiKey) => edit({ apiKey, clearApiKey })} />
    </fieldset>
    {status ? <dl className="settings-summary-list">
      <div><dt>{t("settings.photos.semantic.status")}</dt><dd>{t(`settings.photos.semantic.states.${status.state}`)}</dd></div>
      <div><dt>{t("settings.photos.semantic.coverage")}</dt><dd>{status.indexed.toLocaleString()} / {status.total.toLocaleString()} · {status.total ? Math.round(status.indexed / status.total * 100) : 0}%</dd></div>
      <div><dt>{t("settings.photos.semantic.pending")}</dt><dd>{status.pending.toLocaleString()} · {t("settings.photos.semantic.failed", { count: status.failed })}</dd></div>
      {status.cache ? <div><dt>{t("settings.photos.semantic.cache")}</dt><dd>{formatBytes(status.cache.bytes, resolveSupportedLocale(i18n.language))} · {t("settings.photos.semantic.retiredSpaces", { count: status.cache.retiredSpaces })}</dd></div> : null}
      {dimensions ? <div><dt>{t("settings.photos.semantic.dimensions")}</dt><dd>{dimensions}</dd></div> : null}
      {space ? <div><dt>{t("settings.photos.semantic.version")}</dt><dd className="is-mono">{space}</dd></div> : null}
      {status.estimatedRemainingSeconds !== null ? <div><dt>{t("settings.photos.semantic.remaining")}</dt><dd>{Math.ceil(status.estimatedRemainingSeconds / 60).toLocaleString()} {t("settings.photos.semantic.minutes")}</dd></div> : null}
    </dl> : null}
    {error || loadError || status?.error ? <Notice className="settings-inline-alert" role="alert" tone="danger">{error ?? loadError ?? status?.error}</Notice> : null}
    {message ? <p role="status">{message}</p> : null}
    <div className="settings-card-actions">
      <UiButton variant="primary" type="button" className="primary-button" disabled={!draft || busy} onClick={() => void run("save")}>{t("settings.photos.semantic.save")}</UiButton>
      <UiButton variant="secondary" type="button" className="secondary-button" disabled={!draft?.baseUrl || busy} onClick={() => void run("test")}>{t("settings.photos.semantic.test")}</UiButton>
      <UiButton variant="secondary" type="button" className="secondary-button" disabled={!saved?.enabled || busy} onClick={() => void run("retry")}>{t("settings.photos.semantic.retry")}</UiButton>
      <UiButton variant="secondary" type="button" className="secondary-button" disabled={!status?.embeddingSpaceId || busy} onClick={() => setConfirmRebuild(!confirmRebuild)}>{t("settings.photos.semantic.rebuild")}</UiButton>
    </div>
    {confirmRebuild ? <Notice className="settings-inline-alert" role="alert" tone="warning" actions={<><UiButton variant="secondary" className="secondary-button" type="button" onClick={() => void run("rebuild")} disabled={busy}>{t("settings.photos.semantic.confirmRebuild")}</UiButton></>}><span>{t("settings.photos.semantic.rebuildHelp")}</span></Notice> : null}
  </Section>;
}
