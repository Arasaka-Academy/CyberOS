import { Card } from "@cyberos/ui";

export type MusicLibraryView = "home" | "albums" | "artists" | "tracks" | "playlists" | "search";
export type MusicDetail = { kind: "album" | "artist" | "playlist"; id: string; title: string };

function Bar({ short = false }: { short?: boolean }) {
  return <span className={`management-skeleton-block music-skeleton-bar${short ? " is-short" : ""}`} />;
}
function MediaSkeleton({ count = 8 }: { count?: number }) {
  return <div className="music-media-grid">{Array.from({ length: count }, (_, index) => <Card key={index} padding="none" className="music-media-skeleton"><span className="management-skeleton-block music-skeleton-cover" /><div className="music-media-copy"><Bar /><Bar short /></div><div className="music-skeleton-card-footer"><Bar short /></div></Card>)}</div>;
}
function TrackSkeleton({ rows = false }: { rows?: boolean }) {
  return <div className={rows ? "music-skeleton-tracks" : "music-track-grid"}>{Array.from({ length: 6 }, (_, index) => <div key={index} className={`music-skeleton-track${rows ? "" : " ui-card"}`}><span className="management-skeleton-block music-skeleton-thumb" /><div><Bar /><Bar short /></div><span className="management-skeleton-block music-skeleton-control" /></div>)}</div>;
}
export function MusicPlaylistSkeleton() {
  return <div className="music-playlist-cards music-playlist-skeleton" aria-hidden="true">{Array.from({ length: 4 }, (_, index) => <Card key={index} padding="none" className="music-skeleton-track music-playlist-skeleton-row"><span className="management-skeleton-block music-skeleton-thumb" /><div><Bar /><Bar short /></div><span className="management-skeleton-block music-skeleton-control" /></Card>)}</div>;
}

/** Shared by the eager module fallback and the library's first data request. */
export function MusicLibrarySkeleton({ view = "home", detail = null }: { view?: MusicLibraryView; detail?: MusicDetail | null }) {
  return <div className="music-library-skeleton" data-music-skeleton={detail ? "detail" : view} aria-hidden="true">
    {detail ? <><div className="music-skeleton-back"><Bar short /></div><div className="music-detail-header music-detail-skeleton"><span className="management-skeleton-block music-skeleton-cover" /><div><Bar short /><Bar /><Bar /><div className="music-skeleton-detail-actions"><Bar short /><Bar short /></div></div></div><TrackSkeleton rows /></> : view === "home" ? <>
      <div className="music-home-featured">
        <Card padding="none" className="music-home-player music-home-player-skeleton"><span className="management-skeleton-block music-skeleton-cover" /><div className="music-home-player-copy"><Bar short /><Bar /><Bar /><div className="music-home-progress"><Bar /></div><div className="music-skeleton-detail-actions"><Bar short /><Bar short /></div></div></Card>
        <div className="music-home-shortcuts">{[0, 1].map(index => <Card key={index} padding="none" className="music-home-shortcut music-shortcut-skeleton"><span className="management-skeleton-block music-skeleton-control" /><div><Bar /><Bar short /></div></Card>)}</div>
      </div>
      <section className="music-skeleton-section"><Bar short /><MediaSkeleton /></section>
      <div className="music-home-lower"><section><Bar short /><div className="music-skeleton-history-tabs"><Bar short /></div><TrackSkeleton /></section><section><Bar short /><MusicPlaylistSkeleton /></section></div>
    </> : view === "tracks" ? <TrackSkeleton /> : view === "search" ? <><section className="music-skeleton-section"><Bar short /><MediaSkeleton count={4} /></section><section className="music-skeleton-section"><Bar short /><MediaSkeleton count={2} /></section><TrackSkeleton /></> : <MediaSkeleton />}
  </div>;
}
