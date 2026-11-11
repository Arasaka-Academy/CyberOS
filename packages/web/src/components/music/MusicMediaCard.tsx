import { Button, Card } from "@cyberos/ui";
import { Heart, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { MusicCover, MusicPlaylistCover } from "./MusicCover.js";

export function MusicMediaCard({ kind, id, title, subtitle, metadata, coverKey = null, compact = false, favorite, disabled = false, playDisabled = false, playing = false, onOpen, onPlay, onFavorite }: {
  kind: "album" | "artist" | "playlist";
  id: string;
  title: string;
  subtitle?: string;
  metadata: string;
  coverKey?: string | null;
  compact?: boolean;
  favorite?: boolean;
  disabled?: boolean;
  playDisabled?: boolean;
  playing?: boolean;
  onOpen: () => void;
  onPlay?: () => void;
  onFavorite?: () => void;
}) {
  const { t } = useTranslation();
  return <Card padding="none" className={`music-media-card${compact ? " music-media-card--compact" : ""}`} data-music-entity={kind} data-music-id={id}>
    <Button variant="plain" type="button" className="music-media-open" aria-label={t("music.openItem", { title })} onClick={onOpen}>
      {kind === "playlist" ? <MusicPlaylistCover id={id} /> : <MusicCover coverKey={coverKey} />}
      <span className="music-media-copy">
        <strong data-tooltip={title}>{title}</strong>
        {subtitle ? <span data-tooltip={subtitle}>{subtitle}</span> : null}
        <small className="metadata">{metadata}</small>
      </span>
    </Button>
    <div className="music-media-actions">
      {onFavorite ? <Button iconOnly variant="plain" type="button" aria-label={t("music.favorite")} aria-pressed={favorite} data-tooltip={t("music.favorite")} disabled={disabled} onClick={onFavorite}>
        <Heart size={16} fill={favorite ? "currentColor" : "none"} />
      </Button> : null}
      {onPlay ? <Button iconOnly variant="secondary" type="button" className="music-media-play" aria-label={t("music.playTrack", { title })} data-tooltip={t("music.playTrack", { title })} aria-disabled={playDisabled} aria-busy={playing || undefined} onClick={() => { if (!playDisabled) onPlay(); }}>
        <Play size={17} />
      </Button> : null}
    </div>
  </Card>;
}
