import { Button, EmptyState, Field, Input, Notice, StatusBadge } from "@cyberos/ui";
import { Download, Play, RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { NvrDevice, NvrEvent, NvrOverview, NvrSegment } from "@cyberos/shared";
import type { StoragePool } from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "../workspace/PanelHeader.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { NvrDevices } from "./NvrDevices.js";
import { NvrPtz } from "./NvrPtz.js";
import { NvrVideo } from "./NvrVideo.js";
import { NvrPreview } from "./NvrPreview.js";
import { nvrRequest } from "./api.js";
import "./nvr.css";
import { statusText, eventText } from "./labels.js";

export function dayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00`); const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}
function localDate(value = new Date()): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
export function NvrPanel({ storagePools }: { storagePools: StoragePool[] }) {
  const { t, i18n } = useTranslation(); const [tab, setTab] = useState<"live" | "playback" | "events" | "devices">("live");
  const [overview, setOverview] = useState<NvrOverview | null>(null); const [error, setError] = useState(""); const [refreshing, setRefreshing] = useState(false);
  const [selected, setSelected] = useState(""); const [date, setDate] = useState(localDate()); const [segments, setSegments] = useState<NvrSegment[]>([]); const [events, setEvents] = useState<NvrEvent[]>([]); const [playback, setPlayback] = useState<{ deviceId: string; from: string; to: string } | null>(null);
  const currentRequest = useRef(0); const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return; pending.current = true; const request = currentRequest.current; setRefreshing(true);
    try { const value = await nvrRequest<NvrOverview>(""); if (request === currentRequest.current) { setOverview(value); setError(""); setSelected((id) => id || value.devices.find((d) => !d.removedAt)?.id || ""); } }
    catch (cause) { if (request === currentRequest.current) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { pending.current = false; if (request === currentRequest.current) setRefreshing(false); }
  }, [t]);
  useEffect(() => { void refresh(); const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000); return () => { currentRequest.current += 1; clearInterval(timer); }; }, [refresh]);
  useEffect(() => {
    if ((tab !== "events" && tab !== "playback") || !selected) return;
    const controller = new AbortController(); const q = new URLSearchParams({ deviceId: selected, ...dayRange(date) });
    void Promise.all([nvrRequest<NvrSegment[]>(`/segments?${q}`, "GET", undefined, controller.signal), nvrRequest<NvrEvent[]>(`/events?${q}`, "GET", undefined, controller.signal)]).then(([s, e]) => { if (!controller.signal.aborted) { setSegments(s); setEvents(e); } }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); });
    return () => controller.abort();
  }, [tab, selected, date, overview?.heartbeatAt, t]);
  const cameras = overview?.devices.filter((d) => !d.removedAt) ?? [];
  const time = (value: string) => new Date(value).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const play = (deviceId: string, occurredAt: string) => { const day = localDate(new Date(occurredAt)); setDate(day); setSelected(deviceId); setPlayback({ deviceId, from: new Date(Math.max(new Date(dayRange(day).from).getTime(), Date.parse(occurredAt) - 15000)).toISOString(), to: dayRange(day).to }); setTab("playback"); };
  return <section className="nvr-panel">
    <PanelHeader icon={<Video size={20} />} title={t("nvr.title")} subtitle={t("nvr.subtitle")} actions={<PanelHeaderActions label={t("nvr.title")}><PanelHeaderAction label={t("nvr.refresh")} mobilePrimary aria-busy={refreshing} onClick={() => { void refresh(); }}><RefreshCw size={17} className={refreshing ? "is-spinning" : ""} /></PanelHeaderAction></PanelHeaderActions>} />
    <div className="view-tabs nvr-tabs" role="tablist" aria-label={t("nvr.title")} onKeyDown={(event) => {
      const tabs = ["live", "playback", "events", "devices"] as const; const index = tabs.indexOf(tab);
      const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
      if (next >= 0) { event.preventDefault(); setTab(tabs[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
    }}>{(["live", "playback", "events", "devices"] as const).map((id) => <Button key={id} variant="ghost" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`nvr-${id}`} id={`nvr-tab-${id}`} onClick={() => setTab(id)}>{t(`nvr.${id}`)}</Button>)}</div>
    <div className="nvr-scroll" role="tabpanel" id={`nvr-${tab}`} aria-labelledby={`nvr-tab-${tab}`}>
      {error ? <Notice tone="danger" actions={<Button variant="secondary" onClick={() => { void refresh(); }}>{t("nvr.retry")}</Button>}>{error}</Notice> : null}
      {!overview && !error ? <PanelContentSkeleton /> : null}
      {overview && tab === "devices" ? <NvrDevices overview={overview} storagePools={storagePools} refresh={refresh} /> : null}
      {overview && tab !== "devices" && cameras.length === 0 && !overview.devices.length ? <EmptyState icon={<Video />} title={t("nvr.empty")} description={t("nvr.emptyHint")} actions={<Button variant="primary" onClick={() => setTab("devices")}>{t("nvr.add")}</Button>} /> : null}
      {tab === "live" && cameras.length ? <><p className="metadata">{t("nvr.deviceCount", { count: cameras.length })} · {t("nvr.used")}: {((overview?.usedBytes ?? 0) / 2 ** 30).toFixed(2)} GiB</p><div className="nvr-camera-grid">{cameras.map((d) => <CameraTile key={d.id} device={d} selected={selected === d.id} onSelect={() => setSelected(d.id)} />)}</div>{cameras.some((d) => d.id === selected) ? <NvrPtz key={selected} deviceId={selected} /> : null}</> : null}
      {(tab === "playback" || tab === "events") && overview?.devices.length ? <>
        <div className="nvr-filters"><Field label={t("nvr.camera")}><CustomSelect value={selected} onChange={(id) => { setSelected(id); setPlayback(null); }} options={overview.devices.map((d) => ({ value: d.id, label: d.name }))} /></Field><Field label={t("nvr.date")}><Input type="date" required value={date} max={localDate()} onChange={(e) => { if (e.target.value) { setDate(e.target.value); setPlayback(null); } }} /></Field></div>
        {tab === "playback" ? <>
          {playback ? <NvrVideo key={`${playback.deviceId}:${playback.from}`} {...playback} /> : null}
          <div className="nvr-timeline" aria-label={t("nvr.timeline")}><span>00:00</span><span>12:00</span><span>24:00</span>{segments.filter((s) => s.status === "ready" || s.status === "recovered").map((s) => <Button variant="ghost" key={s.id} className="nvr-timeline-segment" style={{ left: `${Math.max(0, (Date.parse(s.startedAt) - Date.parse(dayRange(date).from)) / 86400000 * 100)}%`, width: `${Math.max(0.3, s.durationSeconds / 864)}%` } as CSSProperties} aria-label={`${t("nvr.openPlayback")} ${time(s.startedAt)}`} onClick={() => play(s.deviceId, s.startedAt)} />)}</div>
          {!segments.length ? <EmptyState title={t("nvr.noRecordings")} /> : <ul className="nvr-recordings">{segments.map((s) => <li key={s.id}><div><span>{time(s.startedAt)} – {time(s.endedAt)}</span><StatusBadge state={s.status}>{statusText(t, s.status)}</StatusBadge></div>{s.status === "ready" || s.status === "recovered" ? <div className="nvr-actions"><Button iconOnly variant="secondary" aria-label={t("nvr.openPlayback")} onClick={() => play(s.deviceId, s.startedAt)}><Play size={16} /></Button><a className="nvr-download" href={`/api/nvr/segments/${s.id}/download`} download aria-label={t("nvr.download")}><Download size={16} /></a></div> : null}</li>)}</ul>}
        </> : !events.length ? <EmptyState title={t("nvr.noEvents")} /> : <ul className="nvr-events">{events.map((event) => <li key={event.id} data-gap={event.gap}><div><time dateTime={event.occurredAt}>{time(event.occurredAt)}</time><strong>{eventText(t, event.category)}</strong><span>{event.gap ? t("nvr.gap") : t(event.state ? "nvr.on" : "nvr.off")}</span></div>{!event.gap ? <Button variant="secondary" onClick={() => play(event.deviceId, event.occurredAt)}>{t("nvr.openPlayback")}</Button> : null}</li>)}</ul>}
      </> : null}
    </div>
  </section>;
}
function CameraTile({ device, selected, onSelect }: { device: NvrDevice; selected: boolean; onSelect: () => void }) {
  const { t } = useTranslation(); const [raw, setRaw] = useState(false); const [videoError, setVideoError] = useState(false); const [attempt, setAttempt] = useState(0);
  return <article className="nvr-camera" data-selected={selected}><header><Button variant="plain" aria-pressed={selected} onClick={onSelect}>{device.name}</Button><Button variant="plain" aria-pressed={raw} onClick={() => { setRaw(!raw); setVideoError(false); }}>{t(raw ? "nvr.raw" : "nvr.annotated")}</Button></header>
    {raw ? <NvrVideo deviceId={device.id} /> : <div className="nvr-preview"><NvrPreview deviceId={device.id} name={device.name} attempt={attempt} onErrorChange={setVideoError} />{videoError ? <span>{t("nvr.videoUnavailable")} <Button variant="secondary" onClick={() => { setVideoError(false); setAttempt(attempt + 1); }}>{t("nvr.retry")}</Button></span> : null}</div>}
    <dl className="nvr-device-state">{([["connection", device.connection], ["video", videoError ? "unavailable" : device.video], ["recording", device.recording], ["ptz", device.ptz], ["analytics", device.analytics === null ? "unknown" : device.analytics ? "available" : "unavailable"]] as const).map(([key, value]) => <div key={key}><dt>{t(`nvr.${key}`)}</dt><dd><StatusBadge state={value}>{statusText(t, value ?? "unknown")}</StatusBadge></dd></div>)}</dl>
    {device.lastError ? <p className="nvr-device-error">{device.lastError}</p> : null}
  </article>;
}
