/**
 * [INPUT]: 依赖本机显示快照与独立的屏保素材轮播层。
 * [OUTPUT]: 提供内置时钟、素材组合和 DOM 提交后的就绪信号。
 * [POS]: TV 屏保内容；计时回退避免被 mpv 遮挡时等待帧回调。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { reportTvRenderer, type TvDisplaySnapshot } from "./api.js";
import { ScreensaverDirectory } from "./TvScreensaverMedia.js";

export function TvScreensaver({ snapshot }: { snapshot: TvDisplaySnapshot | null }) {
  const visible = snapshot?.display.state === "screensaver";
  const source = snapshot?.settings.screensaverSource;
  const sourceKey = source && source.kind !== "builtin" ? `${source.kind}\n${source.storagePoolId}\n${source.path}` : "builtin";
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
  if (!visible) return null;
  return <div className="tv-screensaver" aria-hidden="true">
    {sourceKey === "builtin" ? <BuiltinScreensaver /> : <ScreensaverDirectory key={sourceKey} kind={source?.kind === "video-directory" ? "video" : "image"} fallback={<BuiltinScreensaver />} />}
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
