import { Card, CardHeader, DescriptionList, StatusBadge } from "@cyberos/ui";
import type { NvrDevice, NvrOverview } from "@cyberos/shared";
import { ArrowUpRight, Camera, HardDrive, Move, ScanEye } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";
import { NvrCameraMedia } from "./NvrCameraMedia.js";
import type { NvrMediaState } from "./NvrMedia.js";
import { statusState, statusText } from "./labels.js";

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
  return <section className="ui-card nvr-card nvr-overview" data-padding="compact" aria-labelledby={heading}>
    <CardHeader className="nvr-card-header" headingId={heading} title={t("nvr.overview")} icon={<Camera size={18} aria-hidden="true" />} actions={<span className="metadata">{t("nvr.deviceCount", { count: stats.total })}</span>} />
    <dl className="nvr-overview-stats">{(["total", "online", "video", "recording", "analytics", "ptz"] as const).map((key) => <div key={key} data-metric={key}><dt>{t(`nvr.metrics.${key}`)}</dt><dd>{stats[key]}</dd></div>)}</dl>
    <div className="nvr-storage-summary"><HardDrive size={16} aria-hidden="true" /><span>{t("nvr.used")}: <strong>{number(overview.usedBytes)} GiB</strong> / {number(overview.policy.quotaBytes)} GiB</span><span className="metadata">{t("nvr.retentionSummary", { count: overview.policy.retentionDays })}</span></div>
  </section>;
}

export function NvrConnectionBadge({ connection }: { connection: string }) {
  const { t } = useTranslation();
  return <StatusBadge className="nvr-camera-header-status" state={statusState(connection)}>
    {connection === "connected" ? t("nvr.online") : connection === "disconnected" ? t("nvr.offline") : statusText(t, connection)}
  </StatusBadge>;
}

export function NvrDeviceState({ device, mediaState }: { device: NvrDevice; mediaState?: NvrMediaState }) {
  const { t } = useTranslation();
  const video = device.connection === "disconnected" || mediaState === "offline" ? "unavailable" : mediaState ?? device.video;
  return <DescriptionList className="nvr-device-state" items={([
    ["connection", device.connection], ["video", video],
    ["recording", device.recording], ["analytics", device.analytics === null ? "unknown" : device.analytics ? "available" : "unavailable"], ["ptz", device.ptz]
  ] as const).map(([key, value]) => ({ id: key, label: t(`nvr.${key}`), value: <StatusBadge state={statusState(value)}>{value === "loading" ? t("nvr.loading") : statusText(t, value)}</StatusBadge> }))} />;
}

export function NvrCameraCard({ device, paused, onOpen }: { device: NvrDevice; paused: boolean; onOpen: () => void }) {
  const { t } = useTranslation();
  return <Card className="nvr-card nvr-camera" padding="none">
    <CardHeader className="nvr-card-header" title={device.name} icon={<Camera size={18} aria-hidden="true" />} actions={<><NvrConnectionBadge connection={device.connection} /><ArrowUpRight size={16} aria-hidden="true" /></>} />
    <NvrCameraMedia key={`${device.id}:${device.connection}:${paused}`} device={device} paused={paused} />
    <dl className="nvr-camera-summary">{([
      ["recording", device.recording, HardDrive],
      ["analytics", device.analytics === null ? "unknown" : device.analytics ? "available" : "unavailable", ScanEye],
      ["ptz", device.ptz, Move]
    ] as const).map(([key, value, Icon]) => <div key={key}><dt><Icon size={13} aria-hidden="true" />{t(`nvr.${key}`)}</dt><dd data-state={statusState(value)}>{statusText(t, value)}</dd></div>)}</dl>
    <button type="button" className="nvr-camera-open" aria-label={t("nvr.openCamera", { name: device.name })} aria-haspopup="dialog" onClick={onOpen} />
  </Card>;
}
