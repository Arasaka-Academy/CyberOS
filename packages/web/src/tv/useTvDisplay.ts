/**
 * [INPUT]: 依赖 TV 快照事件流、设置和显示状态接口。
 * [OUTPUT]: 提供本机显示状态与屏保策略。
 * [POS]: TV 外壳的显示订阅；断流时读取快照恢复。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useState } from "react";
import { getTvSettings } from "../api.js";
import { getTvModeStatus, type TvDisplaySnapshot } from "./api.js";

export function useTvDisplay(): TvDisplaySnapshot | null {
  const [snapshot, setSnapshot] = useState<TvDisplaySnapshot | null>(null);
  useEffect(() => {
    let live = true;
    let streamRevision = 0;
    let pending = false;
    const recover = async () => {
      if (pending) return;
      pending = true;
      const revision = streamRevision;
      try {
        const [status, settings] = await Promise.all([getTvModeStatus(), getTvSettings()]);
        if (live && revision === streamRevision && status.display) setSnapshot({ display: status.display, settings });
      } catch { /* EventSource reconnects with the authoritative snapshot. */ }
      finally { pending = false; }
    };
    void recover();
    const events = typeof EventSource === "undefined" ? null : new EventSource("/api/tv/events");
    events?.addEventListener("snapshot", event => {
      if (!live) return;
      try {
        const next = JSON.parse((event as MessageEvent<string>).data) as TvDisplaySnapshot;
        if (!next.settings || !["active", "screensaver", "off"].includes(next.display?.state)) return;
        streamRevision += 1; setSnapshot(next);
      } catch { void recover(); }
    });
    events?.addEventListener("error", () => void recover());
    events?.addEventListener("open", () => void recover());
    const timer = events ? undefined : setInterval(() => void recover(), 5000);
    return () => { live = false; clearInterval(timer); events?.close(); };
  }, []);
  return snapshot;
}
