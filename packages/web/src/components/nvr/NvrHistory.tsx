import { Button, EmptyState, Field, Notice, StatusBadge } from "@cyberos/ui";
import type { NvrDevice, NvrEvent, NvrSegment } from "@cyberos/shared";
import { AlertTriangle, CalendarDays, ChevronLeft, ChevronRight, Download, Film, Play, Radio } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { CustomSelect } from "../common/CustomSelect.js";
import { DatePicker } from "../common/DatePicker.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { eventText, statusState, statusText } from "./labels.js";
import { historyPage, localDate, playable, segmentPlaybackAt, segmentPosition, type PlaybackSelection } from "./history.js";
import { useNvrHistory } from "./useNvrHistory.js";
import { NvrVideo } from "./NvrVideo.js";

export type NvrPlaybackSelection = PlaybackSelection & { at: string };

export function NvrHistory({ kind, devices, selected, date, playback, refreshToken, onFilter, onPlay }: {
  kind: "playback" | "events"; devices: NvrDevice[]; selected: string; date: string; playback: NvrPlaybackSelection | null;
  refreshToken: number; onFilter: (deviceId: string, date: string) => void; onPlay: (deviceId: string, at: string) => void;
}) {
  const { t } = useTranslation();
  const name = (id: string) => devices.find(device => device.id === id)?.name ?? t("nvr.camera");
  return <div className="nvr-history">
    <div className="nvr-history-toolbar" role="group" aria-label={t("nvr.filters")}>
      <Field label={t("nvr.camera")}><CustomSelect value={selected} disabled={!devices.length} onChange={value => onFilter(value, date)} options={devices.map(device => ({ value: device.id, label: device.removedAt ? t("nvr.history.removed", { name: device.name }) : device.name }))} /></Field>
      <Field label={t("nvr.date")}><DatePicker required value={date} max={localDate()} onChange={value => { if (value) onFilter(selected, value); }} /></Field>
    </div>
    {kind === "playback" ? <NvrPlayback key={`${selected}:${date}`} deviceId={selected} date={date} name={name(selected)} playback={playback} refreshToken={refreshToken} onPlay={onPlay} /> : <NvrEvents key={`${selected}:${date}`} deviceId={selected} date={date} name={name} refreshToken={refreshToken} onPlay={onPlay} />}
  </div>;
}

function NvrHistoryFooter({ count, page, pages, limit, onPage }: { count: number; page: number; pages: number; limit: number; onPage: (page: number) => void }) {
  const { t } = useTranslation();
  return <><div className="nvr-table-footer"><span className="metadata">{t("nvr.history.loaded", { count })}</span><div className="nvr-pagination" role="group" aria-label={t("nvr.history.pagination")}><Button variant="plain" iconOnly disabled={page <= 1} aria-label={t("nvr.history.previous")} data-tooltip={t("nvr.history.previous")} onClick={() => onPage(page - 1)}><ChevronLeft size={16} /></Button><span aria-live="polite">{t("nvr.history.page", { page, count: pages })}</span><Button variant="plain" iconOnly disabled={page >= pages} aria-label={t("nvr.history.next")} data-tooltip={t("nvr.history.next")} onClick={() => onPage(page + 1)}><ChevronRight size={16} /></Button></div></div>{count >= limit ? <Notice tone="warning">{t("nvr.history.limit", { count: limit })}</Notice> : null}</>;
}

function NvrPlayback({ deviceId, date, name, playback, refreshToken, onPlay: selectPlayback }: {
  deviceId: string; date: string; name: string; playback: NvrPlaybackSelection | null; refreshToken: number; onPlay: (deviceId: string, at: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { items: segments, loading, loaded, error, retry } = useNvrHistory<NvrSegment>("segments", deviceId, date, refreshToken);
  const [page, setPage] = useState(1);
  const current = historyPage(segments, page);
  const time = (value: string) => new Date(value).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const selected = (segment: NvrSegment) => Boolean(playback && segment.deviceId === playback.deviceId && Date.parse(segment.startedAt) <= Date.parse(playback.at) && Date.parse(segment.endedAt) > Date.parse(playback.at));
  const onPlay = (cameraId: string, startedAt: string) => selectPlayback(cameraId, segmentPlaybackAt({ startedAt }, date));
  return <>
    <section className="nvr-playback-view" aria-label={t("nvr.playback")}>
      <div className="nvr-history-heading"><Film size={17} aria-hidden="true" /><h3>{name}</h3><span className="metadata">{playback ? time(playback.at) : date}</span></div>
      {playback ? <NvrVideo key={`${playback.deviceId}:${playback.from}`} deviceId={playback.deviceId} from={playback.from} to={playback.to} /> : <div className="nvr-video nvr-playback-placeholder"><EmptyState className="nvr-media-state" icon={<Play />} title={t("nvr.history.choose")} description={t("nvr.history.chooseHint")} /></div>}
      <div className="nvr-recording-map" aria-label={t("nvr.timeline")}><div className="nvr-timeline-scale"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div><div className="nvr-timeline">
        {segments.filter(playable).map(segment => {
          const position = segmentPosition(segment, date);
          return position ? <Button key={segment.id} variant="ghost" className="nvr-timeline-segment" style={{ left: `${position.left}%`, width: `${position.width}%` }} aria-pressed={selected(segment)} aria-label={`${t("nvr.openPlayback")} ${time(segment.startedAt)}`} data-tooltip={`${time(segment.startedAt)} – ${time(segment.endedAt)}`} onClick={() => onPlay(segment.deviceId, segment.startedAt)} /> : null;
        })}
      </div></div>
    </section>
    {error ? <Notice tone="danger" role="alert" actions={<Button variant="secondary" disabled={loading} onClick={retry}>{t("nvr.retry")}</Button>}>{error}</Notice> : null}
    {loading && !loaded && !error ? <PanelContentSkeleton /> : null}
    {loaded && !error && !segments.length ? <EmptyState icon={<CalendarDays />} title={t("nvr.noRecordings")} /> : null}
    {segments.length ? <section aria-label={t("nvr.history.recordings")} aria-busy={loading}>
      <div className="nvr-history-heading"><h3>{t("nvr.history.recordings")}</h3></div>
      <div className="nvr-table-wrap" role="region" aria-label={t("nvr.history.recordings")} tabIndex={0}><table className="nvr-table nvr-recordings" aria-label={t("nvr.history.recordings")}><thead><tr>{(["period", "duration", "size", "status", "actions"] as const).map(label => <th key={label} scope="col">{t(`nvr.history.${label}`)}</th>)}</tr></thead><tbody>{current.items.map(segment => <tr key={segment.id} data-selected={selected(segment)}><td className="nvr-time"><time dateTime={segment.startedAt}>{time(segment.startedAt)}</time><span className="metadata"> – {time(segment.endedAt)}</span></td><td>{Math.round(segment.durationSeconds).toLocaleString(i18n.language)} {t("nvr.seconds")}</td><td>{(segment.sizeBytes / 2 ** 20).toLocaleString(i18n.language, { maximumFractionDigits: 1 })} MiB</td><td><StatusBadge state={statusState(segment.status)}>{statusText(t, segment.status)}</StatusBadge></td><td>{playable(segment) ? <div className="nvr-row-actions"><Button variant="secondary" iconOnly aria-label={`${t("nvr.openPlayback")} ${time(segment.startedAt)}`} data-tooltip={t("nvr.openPlayback")} onClick={() => onPlay(segment.deviceId, segment.startedAt)}><Play size={16} aria-hidden="true" /></Button><a className="nvr-download" href={`/api/nvr/segments/${segment.id}/download`} download aria-label={t("nvr.download")} data-tooltip={t("nvr.download")}><Download size={16} aria-hidden="true" /></a></div> : <span className="metadata">—</span>}</td></tr>)}</tbody></table></div>
      <NvrHistoryFooter count={current.total} page={current.page} pages={current.pages} limit={10000} onPage={setPage} />
    </section> : null}
  </>;
}

function NvrEvents({ deviceId, date, name, refreshToken, onPlay }: {
  deviceId: string; date: string; name: (id: string) => string; refreshToken: number; onPlay: (deviceId: string, at: string) => void;
}) {
  const { t, i18n } = useTranslation();
  const { items, loading, loaded, error, retry } = useNvrHistory<NvrEvent>("events", deviceId, date, refreshToken);
  const [page, setPage] = useState(1);
  const current = historyPage([...items].sort((left, right) => Date.parse(right.occurredAt) - Date.parse(left.occurredAt)), page);
  return <section aria-label={t("nvr.events")} aria-busy={loading}>
    <div className="nvr-history-heading"><Radio size={17} aria-hidden="true" /><h3>{t("nvr.events")}</h3><span className="metadata">{date}</span></div>
    {error ? <Notice tone="danger" role="alert" actions={<Button variant="secondary" disabled={loading} onClick={retry}>{t("nvr.retry")}</Button>}>{error}</Notice> : null}
    {loading && !loaded && !error ? <PanelContentSkeleton /> : null}
    {loaded && !error && !items.length ? <EmptyState icon={<Radio />} title={t("nvr.noEvents")} /> : null}
    {items.length ? <><div className="nvr-table-wrap" role="region" aria-label={t("nvr.events")} tabIndex={0}><table className="nvr-table nvr-events" aria-label={t("nvr.events")}><thead><tr><th scope="col">{t("nvr.history.time")}</th><th scope="col">{t("nvr.camera")}</th><th scope="col">{t("nvr.history.eventType")}</th><th scope="col">{t("nvr.history.status")}</th><th scope="col">{t("nvr.history.actions")}</th></tr></thead><tbody>{current.items.map(event => <tr key={event.id} data-gap={event.gap}><td className="nvr-time"><time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time></td><td className="nvr-event-camera">{name(event.deviceId)}</td><td><span className="nvr-event-type">{event.gap ? <AlertTriangle size={15} aria-hidden="true" /> : <Radio size={15} aria-hidden="true" />}{eventText(t, event.category)}</span></td><td><StatusBadge state={event.gap ? "warning" : event.state === true ? "ready" : "neutral"}>{event.gap ? t("nvr.gap") : t(event.state === null ? "nvr.unknown" : event.state ? "nvr.on" : "nvr.off")}</StatusBadge></td><td>{!event.gap ? <Button variant="secondary" iconOnly aria-label={`${t("nvr.openPlayback")} · ${name(event.deviceId)}`} data-tooltip={t("nvr.openPlayback")} onClick={() => onPlay(event.deviceId, event.occurredAt)}><Play size={16} aria-hidden="true" /></Button> : <span className="metadata">—</span>}</td></tr>)}</tbody></table></div><NvrHistoryFooter count={current.total} page={current.page} pages={current.pages} limit={1000} onPage={setPage} /></> : null}
  </section>;
}
