import { Button, DialogActions, DialogHeader, Notice } from "@cyberos/ui";
import { AudioLines, Pause, Play, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePlayback } from "../components/playback/PlaybackProvider.js";
import { useMusicRemote } from "../components/music/MusicProvider.js";
import { ModalPortal } from "../components/common/ModalPortal.js";
import { useModalDialog } from "../components/workspace/useModalDialog.js";
import { isActiveVodPlayback } from "./player-controls.js";

export function TvPlaybackDock({ onError }: { onError: (error: string) => void }) {
  const playback = usePlayback();
  const music = useMusicRemote();
  const { t: translate } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const nas = playback.nas;
  const video = nas?.owner === "video" && isActiveVodPlayback(nas.video);
  const active = video || nas?.owner === "music" && ["playing", "paused"].includes(nas.music.state);
  const dialog = useModalDialog(() => setOpen(false), busy, open && Boolean(active));
  useEffect(() => { setOpen(false); }, [nas?.serviceInstanceId, nas?.sessionId, nas?.owner]);
  if (!active || !nas) return null;
  const playing = video ? nas.video.state === "playing" : nas.music.state === "playing";
  const item = nas.music.queue.find(candidate => candidate.id === nas.music.currentItemId);
  const title = video ? nas.video.fileName : item?.title;
  const command = async (stop = false) => {
    if (lock.current || !nas.sessionId) return;
    lock.current = true;
    setBusy(true);
    try {
      if (stop) { await playback.control({ type: "stop", sessionId: nas.sessionId }); setOpen(false); }
      else if (video) await playback.control({ type: playing ? "pause" : "resume", sessionId: nas.sessionId });
      else await music.execute({ type: playing ? "pause" : "resume" });
    } catch (failure) { onError(failure instanceof Error ? failure.message : String(failure)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <>
    <div className="tv-playback-dock" data-tv-region="playback"><Button variant="secondary" data-tv-focusable data-playback-restore onClick={() => setOpen(true)}><AudioLines /><span><small>{translate("playback.nowPlaying")}</small><strong>{title ?? translate("playback.tvOutput")}</strong></span>{playing ? <Pause /> : <Play />}</Button></div>
    {open ? <ModalPortal className="tv-dialog-backdrop"><section ref={dialog} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tv-playback-title" className="tv-dialog">
      <DialogHeader title={translate("playback.nowPlaying")} headingId="tv-playback-title" /><p>{title}</p><Notice>{translate("playback.tvOutput")}</Notice>
      <DialogActions><Button onClick={() => setOpen(false)} disabled={busy}>{translate("video.close")}</Button><Button variant="danger" disabled={busy} onClick={() => void command(true)}><Square />{translate("video.stop")}</Button><Button variant="primary" busy={busy} onClick={() => void command()}>{playing ? <Pause /> : <Play />}{translate(playing ? "tv.pause" : "tv.resume")}</Button></DialogActions>
    </section></ModalPortal> : null}
  </>;
}
