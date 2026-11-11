import { Button } from "@cyberos/ui";
import { Film, Tv } from "lucide-react";
import { useEffect, useState } from "react";
import type { MediaTitleSummary } from "@cyberos/shared";
import { useTranslation } from "react-i18next";
import { mediaArtworkUrl } from "./api.js";
import type { HomeItem } from "./library-model.js";

export function MediaArtwork({ title, kind = "poster" }: { title: MediaTitleSummary; kind?: "poster" | "backdrop" }) {
  const artwork = kind === "poster" ? title.posterKey : title.backdropKey;
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [title.id, artwork]);
  return <span className={`tv-artwork tv-artwork-${kind}`} aria-hidden="true">
    {artwork && !failed ? <img src={`${mediaArtworkUrl(title.id, kind)}?v=${encodeURIComponent(artwork)}`} alt="" loading={kind === "poster" ? "lazy" : "eager"} onError={() => setFailed(true)} />
      : <span className="tv-artwork-placeholder">{title.kind === "series" ? <Tv /> : <Film />}<span>{title.title}</span></span>}
  </span>;
}

export function MediaCard({ item, onOpen, search = false }: { item: HomeItem; onOpen: () => void; search?: boolean }) {
  const { t: translate } = useTranslation();
  const { title } = item;
  const progress = title.progress;
  const percent = progress?.durationSeconds ? Math.min(100, Math.max(0, progress.positionSeconds / progress.durationSeconds * 100)) : 0;
  return <Button variant="ghost" className={`tv-media-card${search ? " tv-search-result" : ""}`} data-tv-focusable data-tv-title={title.id} data-tv-search-title={search ? title.id : undefined} onClick={onOpen}>
    <span className="tv-media-art"><MediaArtwork title={title} />
      {percent > 0 ? <span className="tv-media-progress" role="progressbar" aria-label={translate("video.continue")} aria-valuenow={Math.round(percent)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /></span> : null}
    </span>
    <span className="tv-media-caption"><strong>{title.title}</strong><small>{item.episodeNumber !== undefined
      ? [item.seasonNumber !== undefined ? translate("tv.season", { number: item.seasonNumber }) : null, translate("tv.episode", { number: item.episodeNumber })].filter(Boolean).join(" · ")
      : [title.year, translate(title.kind === "series" ? "video.series" : "video.movie")].filter(Boolean).join(" · ")}</small></span>
  </Button>;
}

export function TitleMetadata({ title }: { title: MediaTitleSummary }) {
  const { t: translate } = useTranslation();
  return <p className="tv-title-metadata">{[title.year, ...title.genres.slice(0, 2), title.runtimeMinutes ? translate("tv.minutes", { count: title.runtimeMinutes }) : null].filter(Boolean).join(" / ")}</p>;
}
