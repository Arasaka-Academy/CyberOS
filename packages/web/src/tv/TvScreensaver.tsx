/**
 * [INPUT]: 依赖本机显示快照与经过路径校验的屏保图片接口。
 * [OUTPUT]: 提供内置时钟、目录轮播和 DOM 提交后的就绪信号。
 * [POS]: TV 屏保内容；计时回退避免被 mpv 遮挡时等待帧回调。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { getTvScreensaverItems, reportTvRenderer, type TvDisplaySnapshot } from "./api.js";

export function TvScreensaver({ snapshot }: { snapshot: TvDisplaySnapshot | null }) {
  const visible = snapshot?.display.state === "screensaver";
  const source = snapshot?.settings.screensaverSource;
  const sourceKey = source?.kind === "directory" ? `${source.storagePoolId}\n${source.path}` : "builtin";
  const [image, setImage] = useState<{ sourceKey: string; url: string } | null>(null);
  useEffect(() => {
    if (!visible) return;
    let frame = 0;
    let active = true;
    let ready = false;
    const reportReady = () => {
      if (!active || ready) return;
      ready = true;
      clearTimeout(fallback);
      cancelAnimationFrame(frame);
      void reportTvRenderer(true).catch(() => {});
    };
    const fallback = setTimeout(reportReady, 100);
    frame = requestAnimationFrame(() => { frame = requestAnimationFrame(reportReady); });
    return () => {
      if (!active) return;
      active = false;
      clearTimeout(fallback);
      cancelAnimationFrame(frame);
      void reportTvRenderer(false).catch(() => {});
    };
  }, [visible]);
  useEffect(() => {
    if (!visible || sourceKey === "builtin") return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let preload: HTMLImageElement | null = null;
    let items: { id: string; url: string }[] = [];
    let nextCursor: string | null = null;
    let index = 0;
    const show = async () => {
      try {
        if (index >= items.length) {
          const page = await getTvScreensaverItems(nextCursor, controller.signal);
          if (controller.signal.aborted) return;
          items = page.items; index = 0; nextCursor = page.nextCursor;
        }
        const item = items[index++];
        if (!item) { setImage(null); }
        else {
          const loaded = await new Promise<boolean>(resolve => {
            preload = new Image();
            preload.onload = () => resolve(true); preload.onerror = () => resolve(false); preload.src = item.url;
          });
          if (controller.signal.aborted) return;
          setImage(loaded ? { sourceKey, url: item.url } : null);
        }
      } catch { if (!controller.signal.aborted) setImage(null); }
      if (!controller.signal.aborted) timer = setTimeout(() => void show(), 20_000);
    };
    void show();
    return () => { controller.abort(); clearTimeout(timer); if (preload) { preload.onload = null; preload.onerror = null; preload.src = ""; } };
  }, [visible, sourceKey]);
  if (!visible) return null;
  return <div className="tv-screensaver" aria-hidden="true">
    {image?.sourceKey === sourceKey ? <img className="tv-screensaver-image" src={image.url} alt="" onError={() => setImage(null)} /> : <BuiltinScreensaver />}
  </div>;
}

export function BuiltinScreensaver() {
  const { i18n } = useTranslation();
  const [clock, setClock] = useState(new Date());
  useEffect(() => { const timer = setInterval(() => setClock(new Date()), 30_000); return () => clearInterval(timer); }, []);
  return <div className="tv-screensaver-builtin">
    <svg className="tv-screensaver-geometry" viewBox="0 0 1200 700" fill="none"><path d="M120 350 350 100 600 350 350 600ZM600 350 850 100 1100 350 850 600Z" /><circle cx="600" cy="350" r="250" /><path d="M100 350H1100M600 50V650" /></svg>
    <time>{new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(clock)}</time>
  </div>;
}
