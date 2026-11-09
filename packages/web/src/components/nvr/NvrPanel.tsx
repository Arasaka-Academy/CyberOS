import { Button, EmptyState, Field, Input, Notice, Section, StatusBadge } from "@cyberos/ui";
import { CalendarDays, Download, Play, RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrEvent, NvrOverview, NvrSegment } from "@cyberos/shared";
import type { StoragePool } from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "../workspace/PanelHeader.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { NvrDevices } from "./NvrDevices.js";
import { NvrCameraDialog } from "./NvrCameraDialog.js";
import { NvrCameraCard, NvrOverviewCard } from "./NvrLive.js";
import { NvrVideo } from "./NvrVideo.js";
import { nvrRequest } from "./api.js";
import { statusText, eventText } from "./labels.js";
import "./nvr.css";

export function dayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start); end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}
function localDate(value = new Date()): string { return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`; }
type Tab = "live" | "playback" | "events" | "devices";
const tabs: Tab[] = ["live", "playback", "events", "devices"];

export function NvrPanel({ storagePools }: { storagePools: StoragePool[] }) {
  const { t, i18n } = useTranslation();
  const [tab, setTab] = useState<Tab>("live");
  const [overview, setOverview] = useState<NvrOverview | null>(null);
  const [error, setError] = useState("");
  const [ptzFault, setPtzFault] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [opened, setOpened] = useState("");
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState(localDate());
  const [segments, setSegments] = useState<NvrSegment[]>([]);
  const [events, setEvents] = useState<NvrEvent[]>([]);
  const [playback, setPlayback] = useState<{ deviceId: string; from: string; to: string } | null>(null);
  const currentRequest = useRef(0);
  const pending = useRef(false);
  const refresh = useCallback(async () => {
    if (pending.current) return;
    pending.current = true;
    const request = currentRequest.current;
    setRefreshing(true);
    try {
      const value = await nvrRequest<NvrOverview>("");
      if (request === currentRequest.current) {
        setOverview(value); setError("");
        setSelected((id) => value.devices.some((device) => device.id === id) ? id : value.devices.find((device) => !device.removedAt)?.id ?? value.devices[0]?.id ?? "");
        setOpened((id) => value.devices.some((device) => device.id === id && !device.removedAt) ? id : "");
      }
    } catch (cause) { if (request === currentRequest.current) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { pending.current = false; if (request === currentRequest.current) setRefreshing(false); }
  }, [t]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { currentRequest.current += 1; clearInterval(timer); };
  }, [refresh]);
  useEffect(() => {
    if ((tab !== "events" && tab !== "playback") || !selected) return;
    const controller = new AbortController();
    const q = new URLSearchParams({ deviceId: selected, ...dayRange(date) });
    void Promise.all([nvrRequest<NvrSegment[]>(`/segments?${q}`, "GET", undefined, controller.signal), nvrRequest<NvrEvent[]>(`/events?${q}`, "GET", undefined, controller.signal)]).then(([s, e]) => {
      if (!controller.signal.aborted) { setSegments(s); setEvents(e); }
    }).catch((cause: unknown) => { if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); });
    return () => controller.abort();
  }, [tab, selected, date, overview?.heartbeatAt, t]);

  const cameras = overview?.devices.filter((device) => !device.removedAt) ?? [];
  const activeDevice = tab === "live" ? cameras.find((device) => device.id === opened) : undefined;
  const time = (value: string) => new Date(value).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const name = (id: string) => overview?.devices.find((device) => device.id === id)?.name ?? t("nvr.camera");
  const changeTab = (next: Tab) => { setOpened(""); setTab(next); };
  const changeFilter = () => { setPlayback(null); setSegments([]); setEvents([]); };
  const play = (deviceId: string, occurredAt: string) => {
    const day = localDate(new Date(occurredAt));
    setDate(day); setSelected(deviceId);
    setPlayback({ deviceId, from: new Date(Math.max(Date.parse(dayRange(day).from), Date.parse(occurredAt) - 15000)).toISOString(), to: dayRange(day).to });
    changeTab("playback");
  };
  const range = dayRange(date);
  const dayLength = Date.parse(range.to) - Date.parse(range.from) + 1;
  return <section className="nvr-panel">
    <div className="nvr-panel-content" inert={Boolean(activeDevice)}>
      <PanelHeader icon={<Video size={20} />} title={t("nvr.title")} subtitle={t("nvr.subtitle")} actions={<PanelHeaderActions label={t("nvr.title")}><PanelHeaderAction label={t("nvr.refresh")} mobilePrimary aria-busy={refreshing} onClick={() => { void refresh(); }}><RefreshCw size={17} className={refreshing ? "is-spinning" : ""} /></PanelHeaderAction></PanelHeaderActions>} />
      <div className="view-tabs nvr-tabs" role="tablist" aria-label={t("nvr.title")} onKeyDown={(event) => {
        const index = tabs.indexOf(tab);
        const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
        if (next >= 0) { event.preventDefault(); changeTab(tabs[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
      }}>{tabs.map((id) => <Button key={id} variant="ghost" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`nvr-${id}`} id={`nvr-tab-${id}`} onClick={() => changeTab(id)}>{t(`nvr.${id}`)}</Button>)}</div>
      <div className="nvr-scroll" role="tabpanel" id={`nvr-${tab}`} aria-labelledby={`nvr-tab-${tab}`}>
        {error ? <Notice tone="danger" actions={<Button variant="secondary" onClick={() => { void refresh(); }}>{t("nvr.retry")}</Button>}>{error}</Notice> : null}
        {ptzFault ? <Notice tone="danger" actions={<Button variant="plain" onClick={() => setPtzFault("")}>{t("common.actions.close")}</Button>}>{ptzFault}</Notice> : null}
        {!overview && !error ? <PanelContentSkeleton /> : null}
        {overview && tab === "devices" ? <NvrDevices overview={overview} storagePools={storagePools} refresh={refresh} /> : null}
        {overview && tab === "live" ? <div className="nvr-card-grid nvr-live-grid">
          <NvrOverviewCard overview={overview} />
          {cameras.map((device) => <NvrCameraCard key={device.id} device={device} paused={Boolean(activeDevice)} onOpen={() => setOpened(device.id)} />)}
          {!cameras.length ? <EmptyState className="nvr-card nvr-full-width" icon={<Video />} title={t("nvr.empty")} description={t("nvr.emptyHint")} actions={<Button variant="primary" onClick={() => changeTab("devices")}>{t("nvr.add")}</Button>} /> : null}
        </div> : null}
        {overview && (tab === "playback" || tab === "events") ? <div className="nvr-history">
          <Section className="nvr-card" title={t("nvr.filters")} icon={<CalendarDays size={18} />}>
            <div className="nvr-filters"><Field label={t("nvr.camera")}><CustomSelect value={selected} disabled={!overview.devices.length} onChange={(id) => { setSelected(id); changeFilter(); }} options={overview.devices.map((device) => ({ value: device.id, label: device.name }))} /></Field><Field label={t("nvr.date")}><Input type="date" required value={date} max={localDate()} onChange={(event) => { if (event.target.value) { setDate(event.target.value); changeFilter(); } }} /></Field></div>
          </Section>
          {tab === "playback" ? <>
            <Section className="nvr-card nvr-playback-card" title={t("nvr.timeline")}>
              {playback ? <NvrVideo key={`${playback.deviceId}:${playback.from}`} {...playback} /> : null}
              <div className="nvr-timeline" aria-label={t("nvr.timeline")}><span>00:00</span><span>12:00</span><span>24:00</span>{segments.filter((segment) => segment.status === "ready" || segment.status === "recovered").map((segment) => {
                const left = Math.min(99.7, Math.max(0, (Date.parse(segment.startedAt) - Date.parse(range.from)) / dayLength * 100));
                return <Button variant="ghost" key={segment.id} className="nvr-timeline-segment" style={{ left: `${left}%`, width: `${Math.min(100 - left, Math.max(0.3, segment.durationSeconds * 100000 / dayLength))}%` }} aria-label={`${t("nvr.openPlayback")} ${time(segment.startedAt)}`} onClick={() => play(segment.deviceId, segment.startedAt)} />;
              })}</div>
              {!segments.length ? <EmptyState title={t("nvr.noRecordings")} /> : null}
            </Section>
            <ul className="nvr-card-grid nvr-recordings">{segments.map((segment) => <li className="ui-card nvr-card nvr-recording" data-padding="compact" key={segment.id}>
              <header className="nvr-card-header"><h3>{name(segment.deviceId)}</h3><StatusBadge state={segment.status}>{statusText(t, segment.status)}</StatusBadge></header>
              <p className="nvr-recording-time">{time(segment.startedAt)} – {time(segment.endedAt)}</p>
              <p className="metadata">{Math.round(segment.durationSeconds)} {t("nvr.seconds")} · {(segment.sizeBytes / 2 ** 20).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} MiB</p>
              {segment.status === "ready" || segment.status === "recovered" ? <div className="nvr-actions"><Button variant="secondary" onClick={() => play(segment.deviceId, segment.startedAt)}><Play size={16} aria-hidden="true" />{t("nvr.openPlayback")}</Button><a className="nvr-download" href={`/api/nvr/segments/${segment.id}/download`} download aria-label={t("nvr.download")} data-tooltip={t("nvr.download")}><Download size={16} aria-hidden="true" /></a></div> : null}
            </li>)}</ul>
          </> : !events.length ? <EmptyState className="nvr-card" title={t("nvr.noEvents")} /> : <ul className="nvr-card-grid nvr-events">{events.map((event) => <li className="ui-card nvr-card nvr-event" data-padding="compact" key={event.id} data-gap={event.gap}>
            <header className="nvr-card-header"><h3>{eventText(t, event.category)}</h3><time className="metadata" dateTime={event.occurredAt}>{time(event.occurredAt)}</time></header>
            <p>{name(event.deviceId)}</p><p className={event.gap ? "nvr-gap-label" : "metadata"}>{event.gap ? t("nvr.gap") : t(event.state === null ? "nvr.unknown" : event.state ? "nvr.on" : "nvr.off")}</p>
            {!event.gap ? <div className="nvr-actions"><Button variant="secondary" onClick={() => play(event.deviceId, event.occurredAt)}>{t("nvr.openPlayback")}</Button></div> : null}
          </li>)}</ul>}
        </div> : null}
      </div>
    </div>
    {activeDevice ? <NvrCameraDialog key={activeDevice.id} device={activeDevice} onClose={() => setOpened("")} onFault={setPtzFault} /> : null}
  </section>;
}
