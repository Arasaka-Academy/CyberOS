import { Button as UiButton, Field, Input, Notice, Section } from "@cyberos/ui";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { AudioLines, Check, LoaderCircle, Mic, RefreshCw, RotateCcw, Square, Volume2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { normalizeCyberAudioBaseUrl, type AudioSettingsPatch } from "@cyberos/shared";
import {
  getAudioSettings, updateAudioSettings, getAudioDevices, getAudioStatus, testAudioService,
  testAudioRecording, testAudioSpeech, stopAudioSpeech, resetAudioContext,
  type AudioSettings, type AudioStatus, type AudioDevice, type AudioServiceStatus
} from "../../api.js";
import { HelpLabel } from "../common/HelpTip.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { Switch } from "../common/Switch.js";
import { CustomSelect } from "../common/CustomSelect.js";

export function audioSettingsPatch(settings: AudioSettings, token: string, clear: boolean): AudioSettingsPatch {
  const { tokenConfigured: _configured, updatedAt: _updated, ...fields } = settings;
  return { ...fields, ...(token.trim() ? { cyberAudioToken: token.trim() } : clear ? { cyberAudioToken: null } : {}) };
}

export function AudioDiagnostics({ service }: { service: AudioServiceStatus | null }) {
  const { t } = useTranslation();
  const state = (ready: boolean | undefined) => t(`settings.audio.${ready === undefined ? "untested" : ready ? "ready" : "notReady"}`);
  return <>
    <dl className="settings-summary-list" aria-live="polite">
      <div><dt>{t("settings.audio.reachable")}</dt><dd>{state(service?.reachable)}</dd></div>
      <div><dt>{t("settings.audio.authenticated")}</dt><dd>{state(service?.authenticated)}</dd></div>
      <div><dt>STT</dt><dd>{state(service?.sttReady)}</dd></div>
      <div><dt>TTS</dt><dd>{state(service?.ttsReady)}</dd></div>
    </dl>
    {service?.error ? <Notice className="settings-inline-error" role="alert" tone="danger">{service.error}</Notice> : null}
  </>;
}

export function SettingsAudioPage({ onNotifySuccess, onOpenVoiceSession }: {
  onNotifySuccess: (message: string) => void;
  onOpenVoiceSession?: (sessionId: string) => void;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AudioSettings | null>(null);
  const [token, setToken] = useState("");
  const [clearToken, setClearToken] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ inputs: AudioDevice[]; outputs: AudioDevice[] }>({ inputs: [], outputs: [] });
  const [status, setStatus] = useState<AudioStatus | null>(null);
  const [service, setService] = useState<AudioServiceStatus | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const operation = useRef(false);
  const mounted = useRef(false);

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoading(true);
    void getAudioSettings().then((next) => {
      if (active) { setSettings(next); setDirty(false); setError(null); }
    }).catch(() => { if (active) setError(t("settings.audio.loadFailed")); })
      .finally(() => { if (active) setLoading(false); });
    void getAudioDevices().then((next) => { if (active) setDevices(next); }).catch(() => {});
    return () => { active = false; };
  }, [loadAttempt, t]);
  useEffect(() => {
    let active = true;
    let polling = false;
    const refresh = async () => {
      if (polling) return;
      polling = true;
      try { const next = await getAudioStatus(); if (active) setStatus(next); }
      catch { if (active) setStatus(null); }
      finally { polling = false; }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1500);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  function change(patch: Partial<AudioSettings>) {
    setSettings((current) => current ? { ...current, ...patch } : current);
    setDirty(true); setError(null);
  }
  async function action(name: string, execute: () => Promise<void>) {
    if (operation.current) return;
    operation.current = true; setBusy(name); setError(null);
    try { await execute(); }
    catch { if (mounted.current) setError(t(name === "save" ? "settings.audio.saveFailed" : "settings.audio.testFailed")); }
    finally { operation.current = false; if (mounted.current) setBusy(null); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!settings) return;
    let address: string | null;
    try { address = normalizeCyberAudioBaseUrl(settings.cyberAudioBaseUrl); }
    catch { setError(t("settings.audio.invalidAddress")); return; }
    await action("save", async () => {
      const next = await updateAudioSettings(audioSettingsPatch({ ...settings, cyberAudioBaseUrl: address }, token, clearToken));
      if (!mounted.current) return;
      setSettings(next); setToken(""); setClearToken(false); setDirty(false);
      onNotifySuccess(t("settings.audio.saved"));
    });
  }
  const deviceOptions = (list: AudioDevice[], selected: string | null) => [
    { value: "", label: t("settings.audio.selectDevice") },
    ...list.map((device) => ({ value: device.id, label: `${device.name}${device.connected ? "" : ` · ${t("settings.audio.offline")}`}` })),
    ...(selected && !list.some((device) => device.id === selected) ? [{ value: selected, label: `${selected} · ${t("settings.audio.offline")}`, disabled: true }] : [])
  ];
  const languages = [{ value: "auto" as const, label: t("settings.audio.autoLanguage") }, { value: "zh" as const, label: "中文" }, { value: "en" as const, label: "English" }];
  const testDisabled = Boolean(busy) || dirty;
  if (loading) return <div className="settings-content-body" aria-busy="true"><PanelContentSkeleton /></div>;
  if (!settings) return <div className="settings-content-body"><Notice className="settings-inline-error" role="alert" tone="danger">{error}</Notice><UiButton variant="secondary" type="button" className="secondary-button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("common.actions.refresh")}</UiButton></div>;

  return <form className="settings-content-body audio-settings" onSubmit={save}>
    {error ? <Notice className="settings-inline-error" role="alert" tone="danger">{error}</Notice> : null}
    <div className="settings-page-grid">
      <Section className="settings-section-card settings-field-wide" title={<>CyberAudio</>} icon={<AudioLines size={18} aria-hidden="true" />}>

        <div className="settings-field-grid">
          <div className="settings-field-wide"><HelpLabel htmlFor="cyberaudio-base-url" label={t("settings.audio.serviceAddress")} content={t("settings.audio.addressHint")} />
            <Input id="cyberaudio-base-url" type="url" value={settings.cyberAudioBaseUrl ?? ""} maxLength={2048} placeholder="https://audio.example.com:8443" autoComplete="off" spellCheck={false} disabled={Boolean(busy)} onChange={(event) => change({ cyberAudioBaseUrl: event.target.value })} />
          </div>
          <Field label={t("settings.audio.token")} htmlFor="cyberaudio-token"><Input id="cyberaudio-token" type="password" value={token} maxLength={4096} autoComplete="new-password" placeholder={t(settings.tokenConfigured ? "settings.audio.tokenConfigured" : "settings.audio.tokenMissing")} disabled={Boolean(busy)} onChange={(event) => { setToken(event.target.value); setClearToken(false); setDirty(true); }} /></Field>
          <div className="settings-card-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={Boolean(busy) || !settings.tokenConfigured} onClick={() => { setClearToken(true); setToken(""); setDirty(true); }}>{t(clearToken ? "settings.audio.tokenWillClear" : "settings.audio.clearToken")}</UiButton></div>
        </div>
        <AudioDiagnostics service={service} />
        <div className="settings-card-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={testDisabled} aria-busy={busy === "service" || undefined} onClick={() => void action("service", async () => { const result = await testAudioService(); if (mounted.current) setService(result); })}>{busy === "service" ? <LoaderCircle size={15} className="is-spinning" /> : <RefreshCw size={15} />}{t("settings.audio.testService")}</UiButton></div>
      </Section>
      <Section className="settings-section-card settings-field-wide" title={t("settings.audio.voiceInput")} icon={<Mic size={18} aria-hidden="true" />}>

        <Switch checked={settings.enabled} disabled={Boolean(busy)} onCheckedChange={(enabled) => change({ enabled })} label={t("settings.audio.enabled")} description={t("settings.audio.inputHint")} />
        <div className="settings-field-grid">
          <Field label={t("settings.audio.inputDevice")} htmlFor="audio-input"><CustomSelect id="audio-input" value={settings.inputDeviceId ?? ""} options={deviceOptions(devices.inputs, settings.inputDeviceId)} onChange={(value) => change({ inputDeviceId: value || null })} disabled={Boolean(busy)} /></Field>
          <Field label={t("settings.audio.maxSeconds")} htmlFor="audio-max-seconds"><Input id="audio-max-seconds" type="number" min={1} max={30} value={settings.maxRecordingSeconds} disabled={Boolean(busy)} onChange={(event) => change({ maxRecordingSeconds: Number(event.target.value) })} /></Field>
        </div>
        <dl className="settings-summary-list"><div><dt>{t("settings.audio.deviceState")}</dt><dd>{t(status?.daemon.connected ? "settings.audio.ready" : "settings.audio.offline")}</dd></div><div><dt>{t("settings.audio.protocol")}</dt><dd>{status?.daemon.protocol ?? t("settings.audio.untested")}</dd></div></dl>
        <div className="settings-card-actions">
          <UiButton variant="secondary" type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void action("devices", async () => { const result = await getAudioDevices(); if (mounted.current) setDevices(result); })}>{t("settings.audio.refreshDevices")}</UiButton>
          <UiButton variant="secondary" type="button" className="secondary-button" disabled={testDisabled || status?.test.armed} onClick={() => void action("recording", async () => { await testAudioRecording(); })}>{t(status?.test.armed ? "settings.audio.waitingRecording" : "settings.audio.testRecording")}</UiButton>
        </div>
        <p className="settings-help">{t("settings.audio.recordingHint")}</p>
        {status?.test.transcript ? <output className="audio-test-result" aria-live="polite">{status.test.transcript}</output> : null}
        {status?.test.error ? <Notice className="settings-inline-error" role="alert" tone="danger">{status.test.error}</Notice> : null}
      </Section>
      <Section className="settings-section-card settings-field-wide" title={<>STT / TTS</>}>

        <div className="settings-field-grid">
          <Field label={t("settings.audio.sttLanguage")} htmlFor="audio-stt-language"><CustomSelect id="audio-stt-language" value={settings.sttLanguage} options={languages} onChange={(value) => change({ sttLanguage: value })} disabled={Boolean(busy)} /></Field>
          <Field label={t("settings.audio.ttsLanguage")} htmlFor="audio-tts-language"><CustomSelect id="audio-tts-language" value={settings.ttsLanguage} options={languages} onChange={(value) => change({ ttsLanguage: value })} disabled={Boolean(busy)} /></Field>
          <Field label={t("settings.audio.voice")} htmlFor="audio-voice"><CustomSelect id="audio-voice" value={settings.ttsVoice} options={[...new Set([settings.ttsVoice, ...(service?.voices ?? [])])].map((voice) => ({ value: voice, label: voice }))} onChange={(value) => change({ ttsVoice: value })} disabled={Boolean(busy)} /></Field>
          <Field label={t("settings.audio.instructions")} htmlFor="audio-instructions"><Input id="audio-instructions" value={settings.ttsInstructions} maxLength={200} disabled={Boolean(busy)} onChange={(event) => change({ ttsInstructions: event.target.value })} /></Field>
        </div>
        <Switch checked={settings.speechEnabled} disabled={Boolean(busy)} onCheckedChange={(speechEnabled) => change({ speechEnabled })} label={t("settings.audio.speechEnabled")} />
      </Section>
      <Section className="settings-section-card settings-field-wide" title={t("settings.audio.output")} icon={<Volume2 size={18} aria-hidden="true" />}>

        <div className="settings-field-grid">
          <Field label={t("settings.audio.outputDevice")} htmlFor="audio-output"><CustomSelect id="audio-output" value={settings.outputDeviceId ?? ""} options={deviceOptions(devices.outputs, settings.outputDeviceId)} onChange={(value) => change({ outputDeviceId: value || null })} disabled={Boolean(busy)} /></Field>
          <div><label htmlFor="audio-volume">{t("settings.audio.volume")} · {settings.volume}%</label><input id="audio-volume" type="range" min={0} max={100} value={settings.volume} disabled={Boolean(busy)} onChange={(event) => change({ volume: Number(event.target.value) })} /></div>
        </div>
        <p className="settings-help">{t("settings.audio.outputHint")}</p>
        <div className="settings-card-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={testDisabled} aria-busy={busy === "speech" || undefined} onClick={() => void action("speech", async () => { await testAudioSpeech(); if (mounted.current) onNotifySuccess(t("settings.audio.speechTestDone")); })}>{busy === "speech" ? <LoaderCircle size={15} className="is-spinning" /> : <Volume2 size={15} />}{t("settings.audio.testSpeech")}</UiButton><UiButton variant="secondary" type="button" className="secondary-button" onClick={() => void stopAudioSpeech().catch(() => { if (mounted.current) setError(t("settings.audio.testFailed")); })}><Square size={15} />{t("settings.audio.stopSpeech")}</UiButton></div>
      </Section>
      <Section className="settings-section-card settings-field-wide" title={t("settings.audio.voiceSession")}>

        <p className="settings-help">{t(status?.awaitingApproval ? "settings.audio.approvalHint" : "settings.audio.sessionHint")}</p>
        <div className="settings-card-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={!status?.sessionId || !onOpenVoiceSession} onClick={() => { if (status?.sessionId) onOpenVoiceSession?.(status.sessionId); }}>{t("settings.audio.openHistory")}</UiButton><UiButton variant="secondary" type="button" className="secondary-button" disabled={Boolean(busy) || !status?.sessionId} onClick={() => setConfirmReset(true)}><RotateCcw size={15} />{t("settings.audio.resetContext")}</UiButton></div>
        {confirmReset ? <div><p>{t("settings.audio.resetHint")}</p><div className="settings-card-actions"><UiButton variant="danger" type="button" className="danger-button" disabled={Boolean(busy)} onClick={() => void action("reset", async () => { await resetAudioContext(); if (mounted.current) { setConfirmReset(false); onNotifySuccess(t("settings.audio.contextReset")); } })}>{t("settings.audio.confirmReset")}</UiButton><UiButton variant="secondary" type="button" className="secondary-button" onClick={() => setConfirmReset(false)}>{t("common.actions.cancel")}</UiButton></div></div> : null}
        <dl className="settings-summary-list" aria-live="polite">{status?.turns.slice(0, 4).map((turn) => <div key={turn.recordingId}><dt>{turn.recordingId.slice(-8)}</dt><dd>{t(`settings.audio.stages.${turn.status}`)}<small>{Object.entries(turn.timings).map(([stage, milliseconds]) => `${stage} ${milliseconds} ms`).join(" · ")}</small>{turn.error ? <span className="settings-inline-error">{turn.error}</span> : null}</dd></div>)}</dl>
        {status?.error || status?.daemon.error ? <Notice className="settings-inline-error" role="status" tone="danger">{status.error ?? status.daemon.error}</Notice> : null}
      </Section>
    </div>
    {dirty ? <p className="settings-help">{t("settings.audio.saveBeforeTest")}</p> : null}
    <div className="settings-card-actions"><UiButton variant="primary" type="submit" className="primary-button" disabled={Boolean(busy) || !dirty} aria-busy={busy === "save" || undefined}>{busy === "save" ? <LoaderCircle size={15} className="is-spinning" /> : <Check size={15} />}{t("common.actions.save")}</UiButton></div>
  </form>;
}
