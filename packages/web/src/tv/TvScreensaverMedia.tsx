/**
 * [INPUT]: 依赖安全素材清单与浏览器图片、静音视频解码。
 * [OUTPUT]: 提供目录轮播、故障跳过和卸载时的媒体释放。
 * [POS]: 屏保媒体层；不依赖共享播放器或保持亮屏租约。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { TvScreensaverItems } from "@cyberos/shared";
import { getTvScreensaverItems } from "./api.js";

type Item = TvScreensaverItems["items"][number];
const STALL_TIMEOUT_MS = 15_000;
const IMAGE_DURATION_MS = 20_000;
const MAX_ITEMS = 1_000;

export function ScreensaverDirectory({ kind, fallback }: { kind: "image" | "video"; fallback: ReactNode }) {
  const [selection, setSelection] = useState<{ item: Item; sequence: number } | null>(null);
  const advance = useRef<(failed: boolean) => void>(() => {});
  useEffect(() => {
    const controller = new AbortController();
    let items: Item[] = [];
    let index = -1;
    let sequence = 0;
    const failedIds = new Set<string>();
    advance.current = failed => {
      if (controller.signal.aborted) return;
      const previous = items[index];
      if (failed && previous) failedIds.add(previous.id);
      for (let attempt = 0; attempt < items.length; attempt++) {
        index = (index + 1) % items.length;
        const item = items[index]!;
        if (!failedIds.has(item.id)) { setSelection({ item, sequence: ++sequence }); return; }
      }
      setSelection(null);
    };
    void (async () => {
      try {
        let cursor: string | null = null;
        const cursors = new Set<string>();
        do {
          const page = await getTvScreensaverItems(cursor, controller.signal);
          if (controller.signal.aborted) return;
          items.push(...page.items.filter(item => (item.kind ?? "image") === kind));
          items = items.slice(0, MAX_ITEMS);
          cursor = page.nextCursor;
          if (cursor && cursors.has(cursor)) break;
          if (cursor) cursors.add(cursor);
        } while (cursor && items.length < MAX_ITEMS && cursors.size < 10);
        advance.current(false);
      } catch { if (!controller.signal.aborted) setSelection(null); }
    })();
    return () => { controller.abort(); advance.current = () => {}; };
  }, [kind]);
  if (!selection) return fallback;
  return selection.item.kind === "video"
    ? <ScreensaverVideo key={selection.sequence} item={selection.item} fallback={fallback} onFinish={failed => advance.current(failed)} />
    : <ScreensaverImage key={selection.sequence} item={selection.item} fallback={fallback} onFinish={failed => advance.current(failed)} />;
}

function ScreensaverVideo({ item, fallback, onFinish }: { item: Item; fallback: ReactNode; onFinish: (failed: boolean) => void }) {
  const ref = useRef<HTMLVideoElement>(null);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const video = ref.current!;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    let position = 0;
    const complete = (failed: boolean) => { if (!disposed) { disposed = true; clearTimeout(timer); finish.current(failed); } };
    const arm = () => { clearTimeout(timer); timer = setTimeout(() => complete(true), STALL_TIMEOUT_MS); };
    const progress = () => { if (video.currentTime > position) { position = video.currentTime; arm(); } };
    const playing = () => { if (!disposed) setReady(true); };
    const ended = () => complete(false);
    const error = () => complete(true);
    video.addEventListener("playing", playing);
    video.addEventListener("timeupdate", progress);
    video.addEventListener("ended", ended);
    video.addEventListener("error", error);
    video.muted = true;
    video.src = item.url;
    arm();
    void video.play().catch(error);
    return () => {
      disposed = true;
      clearTimeout(timer);
      video.removeEventListener("playing", playing);
      video.removeEventListener("timeupdate", progress);
      video.removeEventListener("ended", ended);
      video.removeEventListener("error", error);
      video.pause();
      video.removeAttribute("src");
      video.load();
    };
  }, [item.url]);
  return <>{!ready ? fallback : null}<video ref={ref} className={`tv-screensaver-video${ready ? "" : " is-loading"}`} src={item.url} muted autoPlay playsInline preload="auto" disablePictureInPicture /></>;
}

function ScreensaverImage({ item, fallback, onFinish }: { item: Item; fallback: ReactNode; onFinish: (failed: boolean) => void }) {
  const [ready, setReady] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const finish = useRef(onFinish);
  finish.current = onFinish;
  useEffect(() => {
    timer.current = setTimeout(() => finish.current(true), STALL_TIMEOUT_MS);
    return () => clearTimeout(timer.current);
  }, []);
  return <>{!ready ? fallback : null}<img className={`tv-screensaver-image${ready ? "" : " is-loading"}`} src={item.url} alt="" onLoad={() => { setReady(true); clearTimeout(timer.current); timer.current = setTimeout(() => finish.current(false), IMAGE_DURATION_MS); }} onError={() => { clearTimeout(timer.current); finish.current(true); }} /></>;
}
