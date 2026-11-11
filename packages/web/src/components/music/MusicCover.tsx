import { useEffect, useState } from "react";
import { Disc3, ListMusic } from "lucide-react";
import { musicCoverUrl } from "../../lib/music-api.js";

export function MusicCover({ coverKey, className = "" }: { coverKey: string | null; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [coverKey]);
  return <span className={`music-cover ${className}`}>
    {coverKey && !failed ? <img src={musicCoverUrl(coverKey)} alt="" loading="lazy" onError={() => setFailed(true)} /> : <Disc3 aria-hidden="true" />}
  </span>;
}

/** A local, theme-aware cover: playlist summaries do not carry artwork. */
export function MusicPlaylistCover({ id }: { id: string }) {
  const variant = [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0) % 3;
  return <span className="music-cover music-playlist-cover" data-pattern={variant} aria-hidden="true">
    <svg viewBox="0 0 200 200" fill="none">
      <path className="music-playlist-lines" d="M-20 150 150-20M0 180 180 0M20 210 210 20M50 230 230 50" />
      <circle cx="100" cy="100" r="65" /><circle cx="100" cy="100" r="43" />
    </svg>
    <ListMusic className="music-playlist-glyph" />
  </span>;
}
