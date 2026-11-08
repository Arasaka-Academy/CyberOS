import { StatusBadge } from "@cyberos/ui";
import type { NvrDevice, NvrOverview } from "@cyberos/shared";
import { ArrowUpRight, Camera, HardDrive } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { NvrPreview } from "./NvrPreview.js";
import { statusText } from "./labels.js";

export function cameraStats(devices: NvrDevice[]) {
  const active = devices.filter((device) => !device.removedAt);
  return {
    total: active.length,
    online: active.filter((device) => device.connection === "connected").length,
    video: active.filter((device) => device.video === "available").length,
    recording: active.filter((device) => device.recording === "recording").length,
    analytics: active.filter((device) => device.analytics === true).length,
    ptz: active.filter((device) => device.ptz === "running").length
  };
}

export function NvrOverviewCard({ overview }: { overview: NvrOverview }) {
  const { t, i18n } = useTranslation();
  const heading = useId();
  const stats = cameraStats(overview.devices);
  const number = (bytes: number) => (bytes / 2 ** 30).toLocaleString(i18n.language, { maximumFractionDigits: 2 });
  return <section className="nvr-card nvr-overview" aria-labelledby={heading}>
    <header className="nvr-card-header"><Camera size={18} aria-hidden="true" /><h3 id={heading}>{t("nvr.overview")}</h3><span className="metadata">{t("nvr.deviceCount", { count: stats.total })}</span></header>
    <dl className="nvr-overview-stats">{(["total", "online", "video", "recording", "analytics", "ptz"] as const).map((key) => <div key={key} data-metric={key}><dt>{t(`nvr.metrics.${key}`)}</dt><dd>{stats[key]}</dd></div>)}</dl>
    <div className="nvr-storage-summary"><HardDrive size={16} aria-hidden="true" /><span>{t("nvr.used")}: <strong>{number(overview.usedBytes)} GiB</strong> / {number(overview.policy.quotaBytes)} GiB</span><span className="metadata">{t("nvr.retentionSummary", { count: overview.policy.retentionDays })}</span></div>
  </section>;
}

export function NvrDeviceState({ device, videoError = false }: { device: NvrDevice; videoError?: boolean }) {
  const { t } = useTranslation();
  return <dl className="nvr-device-state">{([
    ["connection", device.connection], ["video", videoError ? "unavailable" : device.video],
    ["recording", device.recording], ["analytics", device.analytics === null ? "unknown" : device.analytics ? "available" : "unavailable"], ["ptz", device.ptz]
  ] as const).map(([key, value]) => <div key={key}><dt>{t(`nvr.${key}`)}</dt><dd><StatusBadge state={value}>{statusText(t, value)}</StatusBadge></dd></div>)}</dl>;
}

export function NvrCameraCard({ device, paused, onOpen }: { device: NvrDevice; paused: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  const [videoError, setVideoError] = useState(false);
  return <article className="nvr-card nvr-camera">
    <header className="nvr-card-header"><Camera size={17} aria-hidden="true" /><h3>{device.name}</h3><ArrowUpRight size={17} aria-hidden="true" /></header>
    <div className="nvr-preview">
      {!paused ? <NvrPreview deviceId={device.id} name={device.name} attempt={0} onErrorChange={setVideoError} /> : null}
      {videoError ? <span>{t("nvr.videoUnavailable")}</span> : null}
    </div>
    <NvrDeviceState device={device} videoError={videoError} />
    {device.lastError ? <p className="nvr-device-error">{device.lastError}</p> : null}
    <button type="button" className="nvr-camera-open" aria-label={t("nvr.openCamera", { name: device.name })} aria-haspopup="dialog" onClick={onOpen} />
  </article>;
}
