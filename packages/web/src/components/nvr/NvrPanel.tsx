import { Button, EmptyState, Notice } from "@cyberos/ui";
import { RefreshCw, Video } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrOverview } from "@cyberos/shared";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "../workspace/PanelHeader.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { NvrDevices } from "./NvrDevices.js";
import { NvrCameraDialog } from "./NvrCameraDialog.js";
import { NvrCameraCard, NvrOverviewCard } from "./NvrLive.js";
import { NvrHistory, type NvrPlaybackSelection } from "./NvrHistory.js";
import { localDate, playbackRange } from "./history.js";
import { nvrRequest } from "./api.js";
import "./nvr.css";

type Tab = "live" | "playback" | "events" | "devices";
const tabs: Tab[] = ["live", "playback", "events", "devices"];

export function NvrPanel() {
  const { t } = useTranslation();
  const [tab, setTab] = useState<Tab>("live");
  const [overview, setOverview] = useState<NvrOverview | null>(null);
  const [error, setError] = useState("");
  const [ptzFault, setPtzFault] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [refreshToken, setRefreshToken] = useState(0);
  const [opened, setOpened] = useState("");
  const [selected, setSelected] = useState("");
  const [date, setDate] = useState(localDate());
  const [playback, setPlayback] = useState<NvrPlaybackSelection | null>(null);
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
        setSelected(id => value.devices.some(device => device.id === id) ? id : value.devices.find(device => !device.removedAt)?.id ?? value.devices[0]?.id ?? "");
        setOpened(id => value.devices.some(device => device.id === id && !device.removedAt) ? id : "");
      }
    } catch (cause) { if (request === currentRequest.current) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { pending.current = false; if (request === currentRequest.current) setRefreshing(false); }
  }, [t]);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
    return () => { currentRequest.current += 1; clearInterval(timer); };
  }, [refresh]);
  const cameras = overview?.devices.filter(device => !device.removedAt) ?? [];
  const activeDevice = cameras.find(device => device.id === opened);
  const changeTab = (next: Tab) => { setOpened(""); setTab(next); };
  const refreshPage = () => { setRefreshToken(value => value + 1); void refresh(); };
  const play = (deviceId: string, at: string) => {
    setDate(localDate(new Date(at))); setSelected(deviceId);
    setPlayback({ ...playbackRange(deviceId, at), at }); changeTab("playback");
  };
  return <section className="nvr-panel">
    <div className="nvr-panel-content" inert={Boolean(activeDevice)}>
      <PanelHeader icon={<Video size={20} />} title={t("nvr.title")} subtitle={t("nvr.subtitle")} actions={<PanelHeaderActions label={t("nvr.title")}><PanelHeaderAction label={t("nvr.refresh")} mobilePrimary aria-busy={refreshing} onClick={refreshPage}><RefreshCw size={17} className={refreshing ? "is-spinning" : ""} /></PanelHeaderAction></PanelHeaderActions>} />
      <div className="view-tabs nvr-tabs" role="tablist" aria-label={t("nvr.title")} onKeyDown={(event) => {
        const index = tabs.indexOf(tab);
        const next = event.key === "ArrowRight" ? (index + 1) % 4 : event.key === "ArrowLeft" ? (index + 3) % 4 : event.key === "Home" ? 0 : event.key === "End" ? 3 : -1;
        if (next >= 0) { event.preventDefault(); changeTab(tabs[next]!); event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus(); }
      }}>{tabs.map(id => <Button key={id} variant="ghost" role="tab" tabIndex={tab === id ? 0 : -1} aria-selected={tab === id} aria-controls={`nvr-${id}`} id={`nvr-tab-${id}`} onClick={() => changeTab(id)}>{t(`nvr.${id}`)}</Button>)}</div>
      <div className="nvr-scroll" role="tabpanel" id={`nvr-${tab}`} aria-labelledby={`nvr-tab-${tab}`}>
        {error ? <Notice tone="danger" actions={<Button variant="secondary" onClick={refreshPage}>{t("nvr.retry")}</Button>}>{error}</Notice> : null}
        {ptzFault ? <Notice tone="danger" actions={<Button variant="plain" onClick={() => setPtzFault("")}>{t("common.actions.close")}</Button>}>{ptzFault}</Notice> : null}
        {!overview && !error ? <PanelContentSkeleton /> : null}
        {overview && tab === "devices" ? <NvrDevices overview={overview} refresh={refresh} onOpen={setOpened} /> : null}
        {overview && tab === "live" ? <div className="nvr-card-grid nvr-live-grid">
          <NvrOverviewCard overview={overview} />
          {cameras.map(device => <NvrCameraCard key={device.id} device={device} paused={Boolean(activeDevice)} onOpen={() => setOpened(device.id)} />)}
          {!cameras.length ? <EmptyState className="nvr-card nvr-full-width" icon={<Video />} title={t("nvr.empty")} description={t("nvr.emptyHint")} actions={<Button variant="primary" onClick={() => changeTab("devices")}>{t("nvr.add")}</Button>} /> : null}
        </div> : null}
        {overview && (tab === "playback" || tab === "events") ? <NvrHistory kind={tab} devices={overview.devices} selected={selected} date={date} playback={playback} refreshToken={refreshToken} onFilter={(id, value) => { setSelected(id); setDate(value); setPlayback(null); }} onPlay={play} /> : null}
      </div>
    </div>
    {activeDevice ? <NvrCameraDialog key={activeDevice.id} device={activeDevice} onClose={() => setOpened("")} onFault={setPtzFault} onRefresh={refresh} /> : null}
  </section>;
}
