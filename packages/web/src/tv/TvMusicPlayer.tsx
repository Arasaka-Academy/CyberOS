/**
 * [INPUT]: 依赖共享 MusicProvider、封面、歌词解析和播放滑块。
 * [OUTPUT]: 提供 HDMI 音乐全屏页面和队列弹窗。
 * [POS]: TV 的音乐视图；复用现有音频会话和命令。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, DialogHeader, Notice } from "@cyberos/ui";
import { ListMusic, Pause, Play, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Volume2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MusicLyrics } from "@cyberos/shared";
import { MusicCover } from "../components/music/MusicCover.js";
import { useMusicRemote } from "../components/music/MusicProvider.js";
import { PlaybackSlider } from "../components/playback/PlaybackSlider.js";
import { ModalPortal } from "../components/common/ModalPortal.js";
import { useModalDialog } from "../components/workspace/useModalDialog.js";
import { musicRequest } from "../lib/music-api.js";
import { activeLyricIndex, musicTime, parseMusicLyrics } from "../lib/music-state.js";

export function TvMusicPlayer() {
  const { t } = useTranslation();
  const { status, execute, busy, error } = useMusicRemote();
  const [queueOpen, setQueueOpen] = useState(false);
  const [lyrics, setLyrics] = useState<MusicLyrics | null>(null);
  const [lyricsFailed, setLyricsFailed] = useState(false);
  const pause = useRef<HTMLButtonElement>(null);
  const activeLine = useRef<HTMLParagraphElement>(null);
  const dialog = useModalDialog(() => setQueueOpen(false), false, queueOpen);
  const current = status?.queue.find(item => item.id === status.currentItemId);
  useEffect(() => { pause.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    setLyrics(null); setLyricsFailed(false);
    if (!current) return;
    const controller = new AbortController();
    void musicRequest<MusicLyrics>(`/tracks/${encodeURIComponent(current.trackId)}/lyrics`, "GET", undefined, controller.signal)
      .then(value => { if (!controller.signal.aborted) setLyrics(value); })
      .catch(() => { if (!controller.signal.aborted) setLyricsFailed(true); });
    return () => controller.abort();
  }, [current?.trackId]);
  const lines = useMemo(() => parseMusicLyrics(lyrics?.text ?? ""), [lyrics]);
  const active = activeLyricIndex(lines, status?.positionSeconds ?? 0);
  useEffect(() => { activeLine.current?.scrollIntoView?.({ block: "nearest", behavior: "auto" }); }, [active]);
  if (!status) return null;
  const playing = status.state === "playing";
  return <section className="tv-music-player" aria-label={t("music.nowPlaying")}>
    <div className="tv-music-main" inert={queueOpen}>
      <MusicCover className="tv-music-cover" coverKey={current?.coverKey ?? null} />
      <div className="tv-music-copy"><span className="tv-eyebrow">{t("music.nowPlaying")}</span><h1>{current?.title ?? t("music.queue")}</h1><p className="tv-music-artist">{current?.artist}</p><p className="tv-music-album">{current?.album}</p>
        <div className="tv-music-lyrics" aria-label={t("music.lyrics")}>{lines.length ? lines.map((line, index) => <p key={index} ref={index === active ? activeLine : null} aria-current={index === active ? "true" : undefined}>{line.text || "\u00a0"}</p>) : <p>{t(lyricsFailed ? "music.lyricsFailed" : "music.noLyrics")}</p>}</div>
      </div>
    </div>
    <footer className="tv-music-controls" inert={queueOpen} data-tv-region="music-controls">
      <div className="tv-music-progress"><span>{musicTime(status.positionSeconds)}</span><PlaybackSlider label={t("music.seek")} max={Math.max(1, status.durationSeconds ?? 1)} value={status.positionSeconds} disabled={busy || !status.durationSeconds} onCommit={seconds => void execute({ type: "seek", seconds })} /><span>{musicTime(status.durationSeconds)}</span></div>
      <div className="tv-music-transport">
        <Button iconOnly variant="ghost" aria-label={t("music.previous")} disabled={busy} onClick={() => void execute({ type: "previous" })}><SkipBack /></Button>
        <Button ref={pause} variant="primary" disabled={busy} onClick={() => void execute({ type: playing ? "pause" : "resume" })}>{playing ? <Pause /> : <Play />}{t(playing ? "music.pause" : "music.play")}</Button>
        <Button iconOnly variant="ghost" aria-label={t("music.next")} disabled={busy} onClick={() => void execute({ type: "next" })}><SkipForward /></Button>
        <Button variant="secondary" onClick={() => setQueueOpen(true)}><ListMusic />{t("music.queue")} <span>{status.queue.length}</span></Button>
        <label className="tv-music-volume"><Volume2 aria-hidden="true" /><PlaybackSlider label={t("music.volume")} value={status.volume} max={100} disabled={busy} onCommit={volume => void execute({ type: "volume", volume })} /><span>{Math.round(status.volume)}</span></label>
      </div>
    </footer>
    {error || status.error ? <Notice tone="danger" role="alert">{error ?? status.error}</Notice> : null}
    {queueOpen ? <ModalPortal className="tv-dialog-backdrop"><section className="tv-dialog tv-music-queue" ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tv-music-queue-title" tabIndex={-1}>
      <DialogHeader headingId="tv-music-queue-title" title={t("tvIdle.queue")} actions={<Button variant="ghost" onClick={() => setQueueOpen(false)}>{t("tvIdle.close")}</Button>} />
      <div className="tv-actions"><Button variant="secondary" aria-pressed={status.shuffle} disabled={busy} onClick={() => void execute({ type: "mode", shuffle: !status.shuffle, repeat: status.repeat })}><Shuffle />{t("music.shuffle")}</Button><Button variant="secondary" disabled={busy} aria-pressed={status.repeat !== "off"} onClick={() => void execute({ type: "mode", shuffle: status.shuffle, repeat: status.repeat === "off" ? "all" : status.repeat === "all" ? "one" : "off" })}>{status.repeat === "one" ? <Repeat1 /> : <Repeat />}{t(`music.repeat.${status.repeat}`)}</Button></div>
      <div className="tv-music-queue-list" data-tv-region="music-queue">{status.queue.map((item, index) => <Button variant="ghost" key={item.id} aria-current={item.id === status.currentItemId ? "true" : undefined} disabled={busy} onClick={() => void execute({ type: "jump", itemId: item.id })}><span>{String(index + 1).padStart(2, "0")}</span><span><strong>{item.title}</strong><small>{item.artist}</small></span></Button>)}</div>
    </section></ModalPortal> : null}
  </section>;
}
