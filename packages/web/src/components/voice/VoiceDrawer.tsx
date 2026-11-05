import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, ArrowUpRight, AudioLines, Bot, Check, CircleStop, Mic, Pause, Play, RotateCcw, Send, Settings, ShieldCheck, X } from "lucide-react";
import type { VoiceMedia, VoiceTurnRecord } from "@cyberos/shared";
import { createClientId } from "../../lib/client-id.js";
import { ModalPortal, usePopoverBack } from "../common/ModalPortal.js";
import { usePlayback } from "../playback/PlaybackProvider.js";
import { useVoiceHistory, voiceState } from "./useVoiceHistory.js";
import { useVoicePlayback, type VoiceClip } from "./useVoicePlayback.js";
import { useVoiceRecorder, type VoiceDraft } from "./useVoiceRecorder.js";

export function VoiceButton({ open, unread, state, onClick }: { open: boolean; unread: boolean; state: ReturnType<typeof voiceState>; onClick: () => void; mobilePrimary?: boolean }) {
  const { t } = useTranslation();
  const label = `${t("voice.title")} · ${t(`voice.states.${state}`)}${unread ? ` · ${t("voice.newMessages")}` : ""}`;
  return <button type="button" className="voice-entry" data-active={open} data-state={state} onClick={onClick}
    aria-label={label} data-tooltip={label} aria-expanded={open} aria-controls="voice-drawer">
    <Mic size={18} aria-hidden="true" />{unread ? <i className="voice-unread" aria-hidden="true" /> : null}
  </button>;
}
export const voiceTime = (seconds: number) => `${Math.floor(Math.max(0, seconds) / 60)}:${String(Math.floor(Math.max(0, seconds) % 60)).padStart(2, "0")}`;
const clipsFor = (media: VoiceMedia[]): VoiceClip[] => media.map((clip) => ({ url: `/api/audio/media/${clip.id}`, duration: clip.durationMs / 1000 }));

export function VoiceDrawer({ open, onClose, history, onOpenSession, onOpenSettings }: {
  open: boolean;
  onClose: () => void;
  history: ReturnType<typeof useVoiceHistory>;
  onOpenSession: (id: string) => void;
  onOpenSettings: () => void;
}) {
  const { t, i18n } = useTranslation();
  const { acquireBrowserAudioFocus } = usePlayback();
  const playback = useVoicePlayback(acquireBrowserAudioFocus);
  const recorder = useVoiceRecorder(history.snapshot?.maxRecordingSeconds ?? 30, acquireBrowserAudioFocus, playback.stop);
  const { stop: stopRecording } = recorder;
  const { stop: stopPlayback } = playback;
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const [sendError, setSendError] = useState(false);
  const [newMessages, setNewMessages] = useState(false);
  const [manualReply, setManualReply] = useState<string | null>(null);
  const pending = useRef(new Set<string>());
  const submittedDraft = useRef<(Omit<VoiceDraft, "url"> & { recordingId: string; afterRevision: number }) | null>(null);
  const [clientId] = useState(createClientId);
  const eligibility = useRef(0);
  const openRef = useRef(open); openRef.current = open;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const dialogRef = useRef<HTMLElement | null>(null);
  const nearBottom = useRef(true);
  const scrollPosition = useRef<number | null>(null);
  const previousHeight = useRef<number | null>(null);
  const previousStamp = useRef("");
  usePopoverBack(open, onClose, 9);
  const deactivate = useCallback(() => {
    eligibility.current++; pending.current.clear(); stopRecording(); stopPlayback();
  }, [stopPlayback, stopRecording]);
  useEffect(() => { if (!open) deactivate(); }, [open, deactivate]);
  useEffect(() => {
    const hidden = () => { if (document.visibilityState !== "visible") deactivate(); };
    document.addEventListener("visibilitychange", hidden);
    window.addEventListener("pagehide", deactivate);
    return () => { document.removeEventListener("visibilitychange", hidden); window.removeEventListener("pagehide", deactivate); };
  }, [deactivate]);
  useEffect(() => {
    if (!open) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !event.defaultPrevented) { event.preventDefault(); onClose(); }
      if (event.key === "Tab") {
        const targets = [...(dialogRef.current?.querySelectorAll<HTMLElement>("button:not(:disabled), input:not(:disabled), [tabindex='0']") ?? [])];
        const first = targets[0]; const last = targets.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
    };
    window.addEventListener("keydown", keydown);
    const frame = requestAnimationFrame(() => closeRef.current?.focus({ preventScroll: true }));
    return () => { cancelAnimationFrame(frame); window.removeEventListener("keydown", keydown); trigger?.focus({ preventScroll: true }); };
  }, [open, onClose]);

  useLayoutEffect(() => {
    if (!open || !scrollRef.current) return;
    const element = scrollRef.current;
    element.scrollTop = scrollPosition.current ?? element.scrollHeight;
    nearBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
  }, [open]);
  useLayoutEffect(() => {
    if (!open || !scrollRef.current) return;
    const element = scrollRef.current;
    const stamp = history.items.map((turn) => `${turn.recordingId}:${turn.updatedAt}:${turn.assistantText}:${turn.awaitingApproval}:${turn.assistantAudio.length}`).join("|");
    if (previousHeight.current !== null) {
      element.scrollTop += element.scrollHeight - previousHeight.current;
      previousHeight.current = null;
    } else if (stamp !== previousStamp.current) {
      if (nearBottom.current) { element.scrollTop = element.scrollHeight; setNewMessages(false); }
      else setNewMessages(true);
    }
    previousStamp.current = stamp;
    scrollPosition.current = element.scrollTop;
  }, [history.items, open]);
  useEffect(() => {
    const draft = submittedDraft.current;
    if (!draft) return;
    const turn = history.items.find((item) => item.recordingId === draft.recordingId);
    if (turn?.jobId) submittedDraft.current = null;
    else if (turn?.status === "failed" && turn.revision > draft.afterRevision && !recorder.recording && !recorder.requesting && !recorder.draft) {
      submittedDraft.current = null;
      recorder.setDraft({ blob: draft.blob, duration: draft.duration, key: draft.key, url: URL.createObjectURL(draft.blob) });
      setSendError(true);
    }
  }, [history.items, recorder.draft, recorder.recording, recorder.requesting, recorder.setDraft]);
  useEffect(() => {
    if (!open || document.visibilityState !== "visible" || recorder.recording || recorder.requesting) return;
    for (const turn of history.items) {
      if (!pending.current.has(turn.recordingId)) continue;
      if (!["completed", "interrupted", "failed"].includes(turn.status)) continue;
      pending.current.delete(turn.recordingId);
      if (turn.source === "browser" && turn.clientId === clientId && !turn.speechSuppressed && turn.assistantAudio.length) {
        setManualReply(turn.recordingId);
        void playback.play(`assistant:${turn.recordingId}`, clipsFor(turn.assistantAudio));
      }
    }
  }, [clientId, history.items, open, playback.play, recorder.recording, recorder.requesting]);
  const loadOlder = async () => {
    const element = scrollRef.current;
    if (!element || history.olderLoading) return;
    previousHeight.current = element.scrollHeight;
    const loaded = await history.loadOlder();
    if (!loaded) previousHeight.current = null;
  };
  const jumpLatest = () => {
    if (scrollRef.current) { scrollRef.current.scrollTop = scrollRef.current.scrollHeight; scrollPosition.current = scrollRef.current.scrollTop; }
    nearBottom.current = true; setNewMessages(false);
  };
  const send = async () => {
    const draft = recorder.draft;
    if (!draft || sendingRef.current) return;
    sendingRef.current = true; setSending(true); setSendError(false); playback.stop();
    const revision = eligibility.current;
    const form = new FormData(); form.set("file", draft.blob, draft.blob.type.includes("mp4") ? "recording.mp4" : "recording.webm");
    try {
      const response = await fetch("/api/audio/recordings", { method: "POST", headers: { "x-voice-client": clientId, "idempotency-key": draft.key }, body: form });
      if (!response.ok) throw new Error("Recording not accepted");
      const result = await response.json() as { turn: VoiceTurnRecord };
      submittedDraft.current = { blob: draft.blob, duration: draft.duration, key: draft.key, recordingId: result.turn.recordingId,
        afterRevision: history.items.find((turn) => turn.recordingId === result.turn.recordingId)?.revision ?? -1 };
      if (revision === eligibility.current && openRef.current && document.visibilityState === "visible") pending.current.add(result.turn.recordingId);
      recorder.setDraft(null); setSendError(false);
      await history.refresh();
    } catch { setSendError(true); }
    finally { sendingRef.current = false; setSending(false); }
  };
  const session = history.snapshot?.sessionId;
  const state = recorder.recording ? "recording" : sending ? "uploading" : voiceState(history.snapshot);
  const canRecord = Boolean(history.snapshot?.enabled && history.snapshot.configured);
  const audioBar = (key: string, clips: VoiceClip[], role: string) => {
    const active = playback.state.key === key;
    const total = clips.reduce((sum, clip) => sum + clip.duration, 0);
    const position = active ? Math.min(total, playback.state.position) : 0;
    const playing = active && playback.state.playing;
    return <div className="voice-audio" data-playing={playing}>
      <button type="button" aria-label={`${t(playing ? "voice.pause" : "voice.play")} · ${role}`} onClick={() => playback.toggle(key, clips)}>
        {playing ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
      </button>
      <div className="voice-audio-track">
        <input type="range" min={0} max={Math.max(0.01, total)} step={0.01} value={position} aria-label={`${t("voice.seek")} · ${role}`}
          style={{ "--voice-progress": `${total ? position / total * 100 : 0}%` } as CSSProperties}
          onChange={(event) => void playback.seek(key, clips, Number(event.currentTarget.value))} />
        <span className="voice-audio-time"><span>{voiceTime(position)}</span><span>{voiceTime(total)}</span></span>
      </div>
      {active && playback.state.error ? <span className="voice-audio-error" role="status">{t("voice.audioFailed")}</span> : null}
    </div>;
  };
  if (!open) return null;
  return <ModalPortal className="voice-backdrop" data-modal-drawer role="presentation" onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <aside id="voice-drawer" ref={dialogRef} className="voice-drawer" role="dialog" aria-modal="true" aria-labelledby="voice-title" tabIndex={-1}>
      <header className="voice-header">
        <div className="voice-heading"><span className="voice-heading-icon"><AudioLines size={20} aria-hidden="true" /></span><div><h2 id="voice-title">{t("voice.title")}</h2><p role="status" data-state={state}><i aria-hidden="true" />{t(`voice.states.${state}`)}</p></div></div>
        <div className="voice-header-actions">
          <button type="button" disabled={!session} onClick={() => { if (session) { onClose(); onOpenSession(session); } }} aria-label={t("voice.fullSession")} data-tooltip={t("voice.fullSession")}><ArrowUpRight size={18} aria-hidden="true" /></button>
          <button type="button" onClick={() => { onClose(); onOpenSettings(); }} aria-label={t("voice.settings")} data-tooltip={t("voice.settings")}><Settings size={17} aria-hidden="true" /></button>
          <button ref={closeRef} type="button" onClick={onClose} aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")}><X size={19} aria-hidden="true" /></button>
        </div>
      </header>
      <div className="voice-history-region">
        <div className="voice-history" ref={scrollRef} tabIndex={0} aria-label={t("voice.history")} onScroll={(event) => {
          const element = event.currentTarget;
          scrollPosition.current = element.scrollTop;
          nearBottom.current = element.scrollHeight - element.clientHeight - element.scrollTop < 48;
          if (nearBottom.current) setNewMessages(false);
        }}>
          {history.cursor ? <button type="button" className="voice-older" onClick={() => void loadOlder()} disabled={history.olderLoading}><ArrowUp size={13} aria-hidden="true" />{t(history.olderLoading ? "voice.loading" : "voice.older")}</button> : null}
          {history.error ? <div className="voice-inline-error" role="status"><span>{t("voice.loadFailed")}</span><button type="button" onClick={() => void history.refresh()}>{t("voice.retry")}</button></div> : null}
          {history.loading ? <div className="voice-empty" role="status"><AudioLines size={26} aria-hidden="true" /><p>{t("voice.loading")}</p></div>
            : !history.items.length && !history.error ? <div className="voice-empty"><span className="voice-empty-icon"><Mic size={28} aria-hidden="true" /></span><h3>{t("voice.emptyTitle")}</h3><p>{t("voice.emptyBody")}</p></div> : null}
          {history.items.map((turn, index) => {
            const date = new Date(turn.createdAt);
            const previous = history.items[index - 1];
            const dateKey = date.toLocaleDateString(i18n.language);
            const showDate = !previous || new Date(previous.createdAt).toLocaleDateString(i18n.language) !== dateKey;
            const time = date.toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" });
            return <Fragment key={turn.recordingId}>
              {showDate ? <div className="voice-date"><span>{dateKey}</span></div> : null}
              <article className="voice-turn" data-recording-id={turn.recordingId}>
                <div className="voice-message" data-role="user">
                  <div className="voice-message-meta"><span>{t("voice.you")}</span><span>{t(`voice.sources.${turn.source}`)}</span><time dateTime={turn.createdAt}>{time}</time></div>
                  <div className="voice-bubble"><p>{turn.userText || t(turn.status === "transcribing" ? "voice.transcribing" : "voice.noTranscript")}</p>
                    {turn.userAudio.length ? audioBar(`user:${turn.recordingId}`, clipsFor(turn.userAudio), t("voice.you")) : <span className="voice-no-audio">{t("voice.noAudio")}</span>}
                  </div>
                </div>
                {turn.assistantText || turn.awaitingApproval || turn.status !== "transcribing" ? <div className="voice-message" data-role="assistant">
                  <div className="voice-message-meta"><Bot size={12} aria-hidden="true" /><span>Agent</span><time dateTime={turn.updatedAt}>{new Date(turn.updatedAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" })}</time></div>
                  <div className="voice-bubble">
                    {turn.assistantText ? <p>{turn.assistantText}</p> : null}
                    {turn.awaitingApproval ? <button type="button" className="voice-approval" onClick={() => { if (session) { onClose(); onOpenSession(session); } }}><ShieldCheck size={15} aria-hidden="true" />{t("voice.approval") }<ArrowUpRight size={14} aria-hidden="true" /></button>
                      : !turn.assistantText && !["completed", "failed", "interrupted"].includes(turn.status) ? <span className="voice-pending"><i aria-hidden="true" />{t(`voice.turnStates.${turn.status}`)}</span> : null}
                    {turn.assistantAudio.length ? audioBar(`assistant:${turn.recordingId}`, clipsFor(turn.assistantAudio), "Agent") : turn.assistantText ? <span className="voice-no-audio">{t(["synthesizing", "speaking"].includes(turn.status) ? "voice.synthesizing" : "voice.noAudio")}</span> : null}
                    {turn.assistantAudioState === "incomplete" ? <span className="voice-no-audio">{t("voice.incompleteAudio")}</span> : null}
                    {turn.error ? <span className="voice-turn-error">{t(turn.jobId ? "voice.replyFailed" : "voice.transcriptionFailed")}</span> : null}
                    {manualReply === turn.recordingId && playback.state.key === `assistant:${turn.recordingId}` && playback.state.blocked ? <button type="button" className="voice-manual-reply" onClick={() => playback.toggle(`assistant:${turn.recordingId}`, clipsFor(turn.assistantAudio))}><Play size={14} aria-hidden="true" />{t("voice.playReply")}</button> : null}
                  </div>
                </div> : null}
              </article>
            </Fragment>;
          })}
        </div>
        {newMessages ? <button type="button" className="voice-new-messages" onClick={jumpLatest}><ArrowDown size={14} aria-hidden="true" />{t("voice.newMessages")}</button> : null}
      </div>
      <footer className="voice-composer">
        {recorder.error || sendError ? <div className="voice-record-error" role="alert">{t(sendError ? "voice.sendFailed" : `voice.errors.${recorder.error ?? "recordingFailed"}`)}</div> : null}
        {recorder.recording ? <div className="voice-capture">
          <div className="voice-capture-summary"><Mic size={15} aria-hidden="true" /><span>{t("voice.states.recording")}</span><time>{voiceTime(recorder.elapsed)} / {voiceTime(history.snapshot?.maxRecordingSeconds ?? 30)}</time></div>
          <div className="voice-capture-controls"><div className="voice-energy" aria-hidden="true">{Array.from({ length: 28 }, (_, index) => <i key={index} style={{ height: `${4 + recorder.energy * (12 + Math.sin(index * 1.8) * 9)}px` }} />)}</div><button type="button" onClick={recorder.stop} className="voice-stop"><CircleStop size={17} aria-hidden="true" />{t("voice.stopRecording")}</button></div>
        </div> : recorder.draft ? <div className="voice-preview">
          <div className="voice-draft-label"><Check size={13} aria-hidden="true" /><span>{t(sending ? "voice.states.uploading" : "voice.preview")}</span></div>
          {audioBar(`draft:${recorder.draft.key}`, [{ url: recorder.draft.url, duration: recorder.draft.duration }], t("voice.preview"))}
          <div className="voice-preview-actions"><button type="button" disabled={sending} onClick={() => { submittedDraft.current = null; playback.stop(); recorder.setDraft(null); setSendError(false); }} aria-label={t("common.actions.cancel")}><X size={16} aria-hidden="true" /></button><button type="button" disabled={sending} onClick={() => { submittedDraft.current = null; setSendError(false); void recorder.start(); }}><RotateCcw size={14} aria-hidden="true" />{t("voice.rerecord")}</button><button type="button" disabled={sending || !canRecord} onClick={() => void send()} className="voice-send"><Send size={14} aria-hidden="true" />{t(sending ? "voice.states.uploading" : "voice.send")}</button></div>
        </div> : <div className="voice-record-idle">
          <button type="button" className="voice-record-button" disabled={!canRecord || recorder.requesting} onClick={() => { submittedDraft.current = null; pending.current.clear(); setSendError(false); void recorder.start(); }}><Mic size={17} aria-hidden="true" />{t(recorder.requesting ? "voice.requesting" : "voice.startRecording")}</button>
          <span>{t(!history.snapshot?.enabled ? "voice.enableHint" : !history.snapshot.configured ? "voice.configureHint" : "voice.recordHint", { seconds: history.snapshot?.maxRecordingSeconds ?? 30 })}</span>
        </div>}
      </footer>
    </aside>
  </ModalPortal>;
}
