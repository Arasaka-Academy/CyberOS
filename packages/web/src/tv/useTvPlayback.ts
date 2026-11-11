import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaFileRecord, VideoTitleDetail } from "@cyberos/shared";
import { usePlayback } from "../components/playback/PlaybackProvider.js";
import { mediaRequest } from "../lib/video-api.js";
import { resumePosition } from "./library-model.js";

export function useTvPlayback() {
  const playback = usePlayback();
  const latest = useRef(playback);
  latest.current = playback;
  const { t: translate } = useTranslation();
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ file: MediaFileRecord; detail: VideoTitleDetail; instance: string; sessionId: string } | null>(null);

  const start = async (file: MediaFileRecord, detail: VideoTitleDetail, confirmation?: typeof pending) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError(null);
    try {
      const current = latest.current.nas;
      if (!current) throw new Error(translate("playback.unavailable"));
      if (confirmation && (current.serviceInstanceId !== confirmation.instance || current.sessionId !== confirmation.sessionId)) throw new Error(translate("playback.stale"));
      await mediaRequest(`media/files/${encodeURIComponent(file.id)}/play`, "POST", {
        startPositionSeconds: resumePosition(detail, file.id),
        serviceInstanceId: current.serviceInstanceId,
        playbackSessionId: current.sessionId,
        ...(confirmation ? { expectedSessionId: confirmation.sessionId } : {}),
      });
      latest.current.setTarget("nas");
      await latest.current.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      lock.current = false;
      setBusy(false);
      setPending(null);
    }
  };
  const play = (file: MediaFileRecord, detail: VideoTitleDetail) => {
    if (lock.current || pending) return;
    const current = latest.current.nas;
    if (current?.owner === "music" && current.sessionId) setPending({ file, detail, instance: current.serviceInstanceId, sessionId: current.sessionId });
    else void start(file, detail);
  };
  return { play, busy, error, pending, cancel: () => { if (!lock.current) setPending(null); }, confirm: () => { if (pending) void start(pending.file, pending.detail, pending); } };
}
