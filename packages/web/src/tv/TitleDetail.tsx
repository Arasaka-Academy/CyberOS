import { Button, EmptyState, Notice, Skeleton } from "@cyberos/ui";
import { ArrowLeft, Bookmark, Check, Film, Heart, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaFileRecord, VideoTitleDetail } from "@cyberos/shared";
import { CustomSelect } from "../components/common/CustomSelect.js";
import { MusicTakeoverDialog } from "../components/music/MusicProvider.js";
import { getVideoDetail, setEpisodeState, setVideoState } from "../lib/video-api.js";
import { MediaArtwork, TitleMetadata } from "./MediaCard.js";
import { selectTitleFile, titleFiles, type TitleTarget } from "./library-model.js";
import { useTvPlayback } from "./useTvPlayback.js";

export function TitleDetail({ target, version, onClose, onChanged, onBusy }: { target: TitleTarget; version: number; onClose: () => void; onChanged: () => void; onBusy: (busy: boolean) => void }) {
  const { t: translate } = useTranslation();
  const [detail, setDetail] = useState<VideoTitleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  const [selected, setSelected] = useState("");
  const [season, setSeason] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const playback = useTvPlayback();
  const autoplay = useRef(false);
  const region = useRef<HTMLElement>(null);
  const busy = playback.busy || editing;
  useEffect(() => { onBusy(busy); return () => onBusy(false); }, [busy, onBusy]);
  useEffect(() => {
    const abort = new AbortController();
    setError(null);
    void getVideoDetail(target.id, abort.signal).then(next => {
      if (abort.signal.aborted) return;
      const file = selectTitleFile(next, target.fileId);
      setDetail(next);
      setSelected(previous => titleFiles(next).some(candidate => candidate.id === previous) ? previous : file?.id ?? "");
      setSeason(previous => next.seasons.some(item => item.seasonNumber === previous) ? previous : next.seasons.find(item => item.episodes.some(episode => episode.files.some(candidate => candidate.id === file?.id)))?.seasonNumber ?? next.seasons[0]?.seasonNumber ?? null);
    }).catch(failure => { if (!abort.signal.aborted) setError(String(failure.message)); });
    return () => abort.abort();
  }, [target.id, target.fileId, retry, version]);
  const files = detail ? titleFiles(detail) : [];
  const file = files.find(candidate => candidate.id === selected);
  useEffect(() => {
    if (!detail) return;
    const frame = requestAnimationFrame(() => {
      if (document.activeElement instanceof HTMLElement && region.current?.contains(document.activeElement)) return;
      const primary = region.current?.querySelector<HTMLButtonElement>("[data-tv-detail-primary]:not(:disabled)");
      (primary ?? region.current?.querySelector<HTMLButtonElement>(".tv-back-button"))?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [detail?.id]);
  useEffect(() => {
    if (target.autoplay && detail && file && !autoplay.current) { autoplay.current = true; playback.play(file, detail); }
  }, [target.autoplay, detail, file, playback.play]);

  const change = async (work: () => Promise<unknown>) => {
    if (!detail || busy) return;
    setEditing(true);
    setError(null);
    try { await work(); setDetail(await getVideoDetail(detail.id)); onChanged(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setEditing(false); }
  };
  const versions = file?.episodeId ? files.filter(candidate => candidate.episodeId === file.episodeId) : detail?.files ?? [];
  const episodes = detail?.seasons.find(item => item.seasonNumber === season)?.episodes ?? [];
  const versionLabel = (candidate: MediaFileRecord, index: number) => [
    `${translate("video.version")} ${index + 1}`,
    ...(detail?.technical[candidate.id] ?? []).filter(track => track.type === "video" && track.height).map(track => `${track.height}p`),
    candidate.videoCodec, `${(candidate.sizeBytes / 1024 ** 3).toFixed(1)} GB`,
  ].filter(Boolean).join(" · ");

  return <section ref={region} className="tv-detail" aria-label={detail?.title ?? translate("tv.loading")}>
    <Button className="tv-back-button" variant="ghost" disabled={busy} data-tv-focusable onClick={onClose}><ArrowLeft />{translate("tv.back")}</Button>
    {detail ? <>
      <section className="tv-detail-hero">
        <MediaArtwork title={detail} kind="backdrop" />
        <div className="tv-detail-copy"><span className="tv-eyebrow">{translate(detail.kind === "series" ? "video.series" : "video.movie")}</span>
          <h1>{detail.title}</h1><TitleMetadata title={detail} /><p className="tv-synopsis">{detail.overview || translate("video.noOverview")}</p>
          <div className="tv-actions" data-tv-region="detail">
            <Button variant="primary" data-tv-detail-primary data-tv-focusable disabled={!file} busy={playback.busy} onClick={() => { if (file) playback.play(file, detail); }}><Play />{translate(file && detail.fileProgress[file.id] && !detail.fileProgress[file.id]?.completed ? "tv.resume" : "tv.play")}</Button>
            <Button data-tv-focusable disabled={busy} aria-pressed={detail.personal.watchlist} onClick={() => void change(() => setVideoState(detail.id, { watchlist: !detail.personal.watchlist }))}><Bookmark />{translate("video.watchlist")}</Button>
            <Button data-tv-focusable disabled={busy} aria-pressed={detail.personal.favorite} onClick={() => void change(() => setVideoState(detail.id, { favorite: !detail.personal.favorite }))}><Heart />{translate("video.favorites")}</Button>
            <Button variant="ghost" data-tv-focusable disabled={busy} aria-pressed={detail.watched} onClick={() => void change(() => setVideoState(detail.id, { watched: !detail.watched }))}><Check />{translate("video.watched")}</Button>
          </div>
        </div>
      </section>
      <div className="tv-detail-content">
        {error || playback.error ? <Notice tone="danger">{error ?? playback.error}</Notice> : null}
        {!files.length ? <EmptyState title={translate("video.fileUnavailable")} /> : null}
        {detail.seasons.length ? <section className="tv-episodes-section">
          <header className="tv-section-heading"><h2>{translate("tv.episodes")}</h2><div className="tv-seasons" data-tv-region="seasons">
            {detail.seasons.map(item => <Button variant={season === item.seasonNumber ? "primary" : "secondary"} data-tv-focusable aria-pressed={season === item.seasonNumber} key={item.id} onClick={() => setSeason(item.seasonNumber)}>{item.name || translate("tv.season", { number: item.seasonNumber })}</Button>)}
          </div></header>
          <div className="tv-episode-rail" data-tv-region="rail" data-tv-region-id={`season-${season}`}>
            {episodes.map(episode => {
              const episodeFile = episode.files.find(candidate => candidate.id === selected) ?? episode.files.find(candidate => detail.fileProgress[candidate.id] && !detail.fileProgress[candidate.id]?.completed) ?? episode.files[0];
              const progress = episodeFile ? detail.fileProgress[episodeFile.id] : null;
              const artwork = detail.artwork.find(item => item.episodeId === episode.id && item.kind === "still");
              return <article className="tv-episode-card" key={episode.id} data-selected={episodeFile?.id === selected}>
                <Button variant="ghost" className="tv-episode" data-tv-focusable data-tv-episode={episode.id} disabled={!episodeFile || busy} onClick={() => { if (episodeFile) { setSelected(episodeFile.id); playback.play(episodeFile, detail); } }}>
                  <span className="tv-episode-art" aria-hidden="true"><Film />{artwork ? <img src={`/api/media/artwork/${encodeURIComponent(artwork.id)}`} loading="lazy" alt="" onError={event => { event.currentTarget.hidden = true; }} /> : null}<span className="tv-episode-number">{String(episode.episodeNumber).padStart(2, "0")}</span></span>
                  <span className="tv-episode-caption"><strong>{translate("tv.episode", { number: episode.episodeNumber })}{episode.name ? ` · ${episode.name}` : ""}</strong><small>{detail.episodeWatched[episode.id] ? translate("video.watched") : progress && !progress.completed ? translate("video.continue") : episode.runtimeMinutes ? translate("tv.minutes", { count: episode.runtimeMinutes }) : translate("video.unwatched")}</small></span>
                  {progress?.durationSeconds ? <span className="tv-media-progress"><span style={{ width: `${Math.min(100, Math.max(0, progress.positionSeconds / progress.durationSeconds * 100))}%` }} /></span> : null}
                </Button>
                <div className="tv-episode-tools">
                  {episode.files.length > 1 ? <CustomSelect ariaLabel={`${translate("tv.episode", { number: episode.episodeNumber })} · ${translate("video.version")}`} value={episodeFile?.id ?? ""} options={episode.files.map((candidate, index) => ({ value: candidate.id, label: versionLabel(candidate, index) }))} onChange={setSelected} /> : null}
                  <Button variant="ghost" iconOnly disabled={busy} aria-label={translate(detail.episodeWatched[episode.id] ? "video.unwatched" : "video.watched")} aria-pressed={Boolean(detail.episodeWatched[episode.id])} onClick={() => void change(() => setEpisodeState(episode.id, !detail.episodeWatched[episode.id]))}><Check /></Button>
                </div>
              </article>;
            })}
          </div>
        </section> : null}
        {file ? <section className="tv-file-section" data-tv-region="versions">
          <div className="tv-version-choice"><span>{translate("video.version")}</span><CustomSelect ariaLabel={translate("video.version")} value={selected} options={versions.map((candidate, index) => ({ value: candidate.id, label: versionLabel(candidate, index) }))} onChange={setSelected} /></div>
          <details className="tv-file-details"><summary data-tv-focusable>{translate("tv.fileDetails")}</summary><dl><dt>{translate("tv.fileName")}</dt><dd>{file.name}</dd><dt>{translate("tv.filePath")}</dt><dd>{file.relativePath}</dd><dt>{translate("tv.trackDetails")}</dt><dd>{JSON.stringify(detail.technical[file.id] ?? [])}</dd></dl></details>
        </section> : null}
      </div>
    </> : error ? <Notice className="tv-load-error" tone="danger" actions={<Button onClick={() => setRetry(previous => previous + 1)}>{translate("tv.retry")}</Button>}>{error}</Notice> : <Skeleton className="tv-detail-skeleton" aria-label={translate("tv.loading")} />}
    {playback.pending ? <MusicTakeoverDialog title={translate("music.takeoverTitle")} body={translate("music.takeoverMusic")} busy={playback.busy} onCancel={playback.cancel} onConfirm={playback.confirm} /> : null}
  </section>;
}
