import { Button, Card, EmptyState, Notice, Section } from "@cyberos/ui";
import { ArrowRight, Disc3, Heart, ListMusic, Pause, Play, Radio } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { MusicHome as MusicHomeData, MusicPage, MusicPlaylist, MusicTrack } from "@cyberos/shared";
import { musicRequest } from "../../lib/music-api.js";
import { musicTime } from "../../lib/music-state.js";
import { useAppViewState } from "../../mobile/MobileNavigation.js";
import { useOptionalPlayback } from "../playback/PlaybackProvider.js";
import { MusicCover } from "./MusicCover.js";
import { MusicMediaCard } from "./MusicMediaCard.js";
import { MusicPlaylistSkeleton } from "./MusicLibrarySkeleton.js";
import { useMusicRemote } from "./MusicProvider.js";

export function MusicHome({ home, renderAlbums, renderTracks, onView, onFavorites, onSettings, onPlayTracks, onPlayCollection, onOpenPlaylist, collectionBusy }: {
  home: MusicHomeData;
  renderAlbums: (albums: MusicHomeData["recentlyAdded"]) => ReactNode;
  renderTracks: (tracks: MusicTrack[], scope: string) => ReactNode;
  onView: (view: "albums" | "playlists") => void;
  onFavorites: () => void;
  onSettings: () => void;
  onPlayTracks: (tracks: MusicTrack[]) => void;
  onPlayCollection: (kind: "album" | "playlist", id: string) => void;
  onOpenPlaylist: (playlist: MusicPlaylist) => void;
  collectionBusy: string | null;
}) {
  const { t } = useTranslation();
  const remote = useMusicRemote();
  const playback = useOptionalPlayback();
  const [history, setHistory] = useAppViewState<"recentlyPlayed" | "mostPlayed">("music.homeHistory", "recentlyPlayed");
  const current = remote.status?.queue.find(item => item.id === remote.status?.currentItemId) ?? remote.status?.queue[0];
  const recent = home.recentlyPlayed.find(track => !track.missing);
  const album = home.recentlyAdded[0];
  const playing = Boolean(current && remote.status?.owner === "music" && remote.status.state === "playing");
  const title = current?.title ?? recent?.title ?? album?.title;
  const artist = current?.artist ?? recent?.artists.join(" · ") ?? album?.artists.join(" · ");
  const duration = current ? remote.status?.durationSeconds ?? current.durationSeconds : null;
  const position = current ? remote.status?.positionSeconds ?? 0 : 0;
  const unavailable = Boolean(remote.error || playback?.error);
  const playFeatured = () => {
    if (remote.busy || collectionBusy !== null) return;
    if (current) void remote.execute({ type: playing ? "pause" : "resume" });
    else if (recent) onPlayTracks([recent]);
    else if (album) onPlayCollection("album", album.id);
  };
  const allLink = (view: "albums" | "playlists") => <Button variant="plain" type="button" onClick={() => onView(view)}>
    {t("music.showAll")}<ArrowRight size={15} aria-hidden="true" />
  </Button>;
  return <div className="music-home">
    <div className="music-home-featured">
      <Card padding="none" className="music-home-player">
        {title ? <>
          <MusicCover coverKey={(current ? current.coverKey : recent ? recent.coverKey : album?.coverKey) ?? null} />
          <div className="music-home-player-copy">
            <small className="music-home-eyebrow"><Radio size={14} aria-hidden="true" />{t(playing ? "music.nowPlaying" : current ? "music.continueListening" : "music.readyToPlay")}</small>
            <h3 data-tooltip={title}>{title}</h3>
            <p data-tooltip={artist}>{artist || t("music.unknownArtist")}</p>
            <small className="music-home-player-album">{current?.album ?? recent?.album ?? t("music.kind.album")}</small>
            {current ? <div className="music-home-progress">
              <progress max={Math.max(duration ?? 0, 1)} value={Math.max(0, Math.min(position, duration ?? position))} aria-label={t("music.seek")} />
              <span>{musicTime(position)}<span>{musicTime(duration)}</span></span>
            </div> : null}
            <div className="music-home-player-actions">
              <Button variant="primary" type="button" aria-disabled={remote.busy || collectionBusy !== null} aria-busy={remote.busy || collectionBusy !== null || undefined} onClick={playFeatured}>
                {playing ? <Pause size={17} /> : <Play size={17} />}{t(playing ? "music.pause" : current ? "music.resume" : "music.play")}
              </Button>
              {current ? <Button variant="plain" type="button" onClick={() => remote.setDrawerOpen(true)}>{t("music.playbackDetails")}<ArrowRight size={15} /></Button> : null}
            </div>
            {unavailable ? <p className="music-home-unavailable" role="status">{t("music.playerUnavailable")}</p> : null}
          </div>
        </> : <EmptyState className="music-home-empty" icon={<Disc3 size={40} />} title={t("music.emptyTitle")} description={t("music.emptyBody")} actions={<Button variant="primary" type="button" onClick={onSettings}>{t("music.manageLibrary")}</Button>} />}
      </Card>
      <div className="music-home-shortcuts">
        <Card padding="none" className="music-home-shortcut">
          <Button variant="plain" type="button" onClick={onFavorites}>
            <Heart size={28} aria-hidden="true" /><span><strong>{t("music.myFavorites")}</strong><small>{t("music.favoriteSongs")}</small></span><ArrowRight size={18} aria-hidden="true" />
          </Button>
        </Card>
        <Card padding="none" className="music-home-shortcut">
          <Button variant="plain" type="button" disabled={!home.mostPlayed.some(track => !track.missing)} aria-disabled={remote.busy || collectionBusy !== null} onClick={() => { if (!remote.busy && collectionBusy === null) onPlayTracks(home.mostPlayed); }}>
            <Radio size={28} aria-hidden="true" /><span><strong>{t("music.quickMix")}</strong><small>{t("music.mostPlayed")}</small></span><Play size={18} aria-hidden="true" />
          </Button>
        </Card>
      </div>
    </div>
    {home.recentlyAdded.length ? <Section className="music-home-releases" title={t("music.recentlyAdded")} actions={allLink("albums")}>
      {renderAlbums(home.recentlyAdded.slice(0, 8))}
    </Section> : null}
    <div className="music-home-lower">
      <Section className="music-home-history" title={t("music.listenAgain")}>
        <div className="music-history-tabs view-tabs" role="group" aria-label={t("music.listenAgain")}>
          {(["recentlyPlayed", "mostPlayed"] as const).map(tab => <Button key={tab} variant="plain" type="button" aria-pressed={history === tab} className={history === tab ? "is-active" : undefined} onClick={() => setHistory(tab)}>{t(`music.${tab}`)}</Button>)}
        </div>
        {home[history].length ? renderTracks(home[history].slice(0, 6), `home:${history}`) : <p className="music-home-muted">{t("music.noHistory")}</p>}
      </Section>
      <HomePlaylists libraryVersion={remote.libraryVersion} allLink={allLink("playlists")} onOpen={onOpenPlaylist} onPlay={id => onPlayCollection("playlist", id)} collectionBusy={collectionBusy} disabled={remote.busy} />
    </div>
  </div>;
}

function HomePlaylists({ libraryVersion, allLink, onOpen, onPlay, collectionBusy, disabled }: {
  libraryVersion: number;
  allLink: ReactNode;
  onOpen: (playlist: MusicPlaylist) => void;
  onPlay: (id: string) => void;
  collectionBusy: string | null;
  disabled: boolean;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState<MusicPlaylist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    void musicRequest<MusicPage<MusicPlaylist>>("/playlists?limit=4", "GET", undefined, controller.signal)
      .then(page => { if (!controller.signal.aborted) setItems(page.items.slice(0, 4)); })
      .catch((failure: unknown) => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : String(failure)); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [libraryVersion, retry]);
  return <Section className="music-home-playlists" title={t("music.views.playlists")} actions={allLink} aria-busy={loading}>
    {loading ? <MusicPlaylistSkeleton /> : error ? <Notice tone="danger" role="alert" actions={<Button variant="plain" type="button" onClick={() => setRetry(value => value + 1)}>{t("common.actions.retry")}</Button>}>{error}</Notice> : items.length ? <div className="music-playlist-cards">
      {items.map(playlist => <MusicMediaCard key={playlist.id} kind="playlist" id={playlist.id} title={playlist.name} metadata={`${t("music.trackCount", { count: playlist.trackCount })} · ${musicTime(playlist.durationSeconds)}`} compact onOpen={() => onOpen(playlist)} onPlay={() => onPlay(playlist.id)} playDisabled={disabled || collectionBusy !== null || !playlist.trackCount} playing={collectionBusy === playlist.id} />)}
    </div> : <p className="music-home-muted"><ListMusic size={18} aria-hidden="true" />{t("music.noPlaylists")}</p>}
  </Section>;
}
