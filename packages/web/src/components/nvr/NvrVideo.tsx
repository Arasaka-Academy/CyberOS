import Hls, { FetchLoader } from "hls.js";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrSession } from "@cyberos/shared";
import { nvrRequest } from "./api.js";
import { NvrMedia, type NvrPreviewState } from "./NvrMedia.js";

export function NvrVideo({ deviceId, from, to, onStateChange, onRetry, retrying = false }: {
  deviceId: string; from?: string; to?: string; onStateChange?: (state: NvrPreviewState) => void;
  onRetry?: (() => void) | undefined; retrying?: boolean;
}) {
  const { t } = useTranslation(); const video = useRef<HTMLVideoElement>(null); const [error, setError] = useState("");
  const [state, setState] = useState<NvrPreviewState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);
  useEffect(() => {
    let disposed = false; let failed = false; let session: NvrSession | null = null; let hls: Hls | null = null; let renewal: ReturnType<typeof setInterval> | undefined;
    setError(""); setState("loading");
    const fail = (message: string) => { if (!disposed) { failed = true; setError(message); setState("unavailable"); } };
    const ready = () => { if (!disposed && !failed) { setError(""); setState("available"); } };
    const node = video.current;
    const mediaError = () => fail(t("nvr.videoUnavailable"));
    node?.addEventListener("loadeddata", ready); node?.addEventListener("error", mediaError);
    const remove = () => { if (session) void nvrRequest(`/sessions/${session.id}`, "DELETE").catch(() => undefined); };
    void nvrRequest<NvrSession>("/sessions", "POST", { deviceId, kind: from ? "playback" : "live", ...(from && to ? { from, to } : {}) }).then((result) => {
      session = result;
      if (disposed) { remove(); return; }
      renewal = setInterval(() => { void nvrRequest(`/sessions/${result.id}`, "POST").catch(() => fail(t("nvr.sessionExpired"))); }, 30000);
      const node = video.current;
      if (!node) return;
      if (Hls.isSupported()) {
        // Event streams share the browser's HTTP/1 connection pool. Prioritize
        // media over status polling and include queue time in relay deadlines.
        const deadlines = { maxTimeToFirstByteMs: 30000, maxLoadTimeMs: 60000 };
        hls = new Hls({ maxBufferLength: 20, loader: FetchLoader,
          fetchSetup: (context, init: RequestInit) => new Request(context.url, { ...init, priority: "high" }),
          manifestLoadPolicy: { default: { ...Hls.DefaultConfig.manifestLoadPolicy.default, ...deadlines,
            errorRetry: { maxNumRetry: 12, retryDelayMs: 1000, maxRetryDelayMs: 10000 } } },
          playlistLoadPolicy: { default: { ...Hls.DefaultConfig.playlistLoadPolicy.default, ...deadlines } },
          fragLoadPolicy: { default: { ...Hls.DefaultConfig.fragLoadPolicy.default, ...deadlines } },
        });
        hls.attachMedia(node); hls.loadSource(result.url);
        hls.on(Hls.Events.ERROR, (_event, data) => { if (data.fatal) fail(t("nvr.videoUnavailable")); });
      } else if (node.canPlayType("application/vnd.apple.mpegurl")) node.src = result.url;
      else fail(t("nvr.hlsUnsupported"));
    }).catch((cause: unknown) => fail(cause instanceof Error ? cause.message : t("nvr.videoUnavailable")));
    return () => { disposed = true; clearInterval(renewal); hls?.destroy(); node?.removeEventListener("loadeddata", ready); node?.removeEventListener("error", mediaError); if (node) { node.pause(); node.removeAttribute("src"); node.load(); } remove(); };
  }, [deviceId, from, to, t, attempt]);
  return <NvrMedia className="nvr-video" state={state} message={error} onRetry={onRetry ?? (() => setAttempt(attempt + 1))} retrying={retrying}>
    <video ref={video} controls autoPlay muted playsInline hidden={state !== "available"} aria-label={t(from ? "nvr.playbackVideo" : "nvr.liveVideo")} />
  </NvrMedia>;
}
