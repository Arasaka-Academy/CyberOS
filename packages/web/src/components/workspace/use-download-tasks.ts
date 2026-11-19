/**
 * [INPUT]: 依赖分页 REST、可视窗口 SSE 和版本化批次删除。
 * [OUTPUT]: 提供下载筛选、历史加载、全局统计与串行任务控制。
 * [POS]: 下载面板的数据边界；缓存保留历史，窗口快照校准可见任务。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useRef, useState } from "react";
import type { DownloadFilter, DownloadObservation, DownloadSummary, DownloadTaskKey, DownloadTaskPage, DownloadWindowSnapshot } from "@cyberos/shared";
import { actOnDownloadObserved, deleteDownloadObserved, DownloadRequestError, getDownloadPage, type DownloadTask, type DownloadWorkerHealth } from "../../api.js";
import { DownloadTaskCache } from "./download-task-cache.js";
import { deleteDownloadBatch, type DownloadDeleteProgress, type DownloadDeleteTarget } from "./download-task-deletion.js";

export type DownloadAction = "pause" | "resume" | "cancel" | "retry" | "stop-seeding";
import { advanceDownloadHistoryGap, createDownloadHistoryGap, DownloadGapRequests, resetDownloadHistoryGaps, type DownloadGap } from "./download-history-gaps.js";
export type { DownloadGap } from "./download-history-gaps.js";
export interface DownloadViewport { newest: DownloadTaskKey; oldest: DownloadTaskKey; anchor: DownloadTaskKey }
const emptySummary: DownloadSummary = { total: 0, active: 0, queued: 0, completed: 0, failed: 0, speedBytesPerSecond: 0 };
const errorMessage = (error: unknown) => error instanceof Error ? error.message : String(error);

export function useDownloadTasks(filter: DownloadFilter, onError: (message: string | null) => void) {
  const [tasks, setTasks] = useState<DownloadTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [health, setHealth] = useState<DownloadWorkerHealth | null>(null);
  const [summary, setSummary] = useState(emptySummary);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [deletionProgress, setDeletionProgress] = useState<DownloadDeleteProgress | null>(null);
  const [windowKey, setWindowKey] = useState("");
  const [gaps, setGaps] = useState<DownloadGap[]>([]);
  const gapsRef = useRef<DownloadGap[]>([]);
  const gapRequests = useRef(new DownloadGapRequests());
  const gapCounter = useRef(0);
  const cache = useRef(new DownloadTaskCache(filter));
  const generation = useRef(0);
  const paginationBusy = useRef(false);
  const actionBusy = useRef(false);
  const cursor = useRef<string | null>(null);
  const cursorObservation = useRef<DownloadObservation | null>(null);
  const viewport = useRef<DownloadViewport | null>(null);
  const metaObservation = useRef<DownloadObservation | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;
  const refreshRef = useRef<() => void>(() => undefined);

  function accept(observation: DownloadObservation): boolean {
    const previous = cache.current.serverId;
    if (!cache.current.observe(observation)) return false;
    if (previous && previous !== observation.serverId) {
      generation.current += 1;
      paginationBusy.current = false;
      setLoadingMore(false);
      gapRequests.current.reset();
      gapsRef.current = resetDownloadHistoryGaps(gapsRef.current); setGaps(gapsRef.current);
      metaObservation.current = null;
      queueMicrotask(() => refreshRef.current());
    }
    return true;
  }
  function applyMeta(page: Pick<DownloadTaskPage, "health" | "summary" | "observation">) {
    const previous = metaObservation.current;
    if (previous?.serverId === page.observation.serverId && previous.sequence > page.observation.sequence) return;
    metaObservation.current = page.observation;
    setHealth(page.health);
    setSummary(page.summary);
  }
  async function readPage(kind: "initial" | "more" | "refresh") {
    if (kind === "more" && (paginationBusy.current || !cursor.current)) return;
    const scope = generation.current;
    const currentCache = cache.current;
    let accepted = false;
    if (kind === "more") { paginationBusy.current = true; setLoadingMore(true); }
    setLoadError(null);
    try {
      const anchor = kind === "refresh" ? viewport.current?.anchor : undefined;
      const page = await getDownloadPage({ filter: currentCache.filter, ...(kind === "more" && cursor.current ? { cursor: cursor.current } : {}), ...(anchor ? { anchor } : {}) });
      if (scope !== generation.current || currentCache !== cache.current || !accept(page.observation)) return;
      accepted = true;
      if (kind === "refresh" && viewport.current) {
        const range = viewport.current;
        const first = page.tasks[0]; const last = page.tasks.at(-1);
        currentCache.replaceRange(page.tasks, first ?? range.newest, last ?? range.oldest, page.observation);
        if (first && last) {
          viewport.current = { newest: first, oldest: last, anchor: range.anchor };
          setWindowKey(JSON.stringify({ newest: { createdAt: first.createdAt, id: first.id }, oldest: { createdAt: last.createdAt, id: last.id } }));
        }
      } else currentCache.merge(page.tasks, page.observation);
      setTasks(currentCache.tasks());
      applyMeta(page);
      const currentCursorVersion = cursorObservation.current;
      if (kind === "more" || (kind === "initial" && (!currentCursorVersion || currentCursorVersion.serverId !== page.observation.serverId || currentCursorVersion.sequence <= page.observation.sequence))) {
        cursor.current = page.nextCursor; cursorObservation.current = page.observation; setNextCursor(page.nextCursor);
      }
    } catch (error) {
      if (scope !== generation.current || currentCache !== cache.current) return;
      setLoadError(errorMessage(error));
      if (kind === "initial") onErrorRef.current(errorMessage(error));
    } finally {
      if ((scope === generation.current || accepted) && currentCache === cache.current) {
        setLoading(false);
        if (kind === "more") { paginationBusy.current = false; setLoadingMore(false); }
      }
    }
  }
  refreshRef.current = () => { void readPage("refresh"); };

  useEffect(() => {
    generation.current += 1;
    cache.current = new DownloadTaskCache(filter);
    cursor.current = null; cursorObservation.current = null;
    viewport.current = null;
    metaObservation.current = null;
    paginationBusy.current = false;
    gapsRef.current = []; gapRequests.current.reset(); setGaps([]);
    setTasks([]); setSummary(emptySummary); setNextCursor(null); setLoading(true); setLoadingMore(false); setWindowKey("");
    void readPage("initial");
    const sync = () => { if (document.visibilityState === "visible") refreshRef.current(); };
    document.addEventListener("visibilitychange", sync);
    window.addEventListener("online", sync);
    return () => {
      generation.current += 1;
      document.removeEventListener("visibilitychange", sync);
      window.removeEventListener("online", sync);
    };
  }, [filter]);

  useEffect(() => {
    let source: EventSource | undefined;
    const currentCache = cache.current;
    let alive = true;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ mode: "window", filter });
      if (windowKey) {
        const bounds = JSON.parse(windowKey) as { newest: DownloadTaskKey; oldest: DownloadTaskKey };
        query.set("newest", JSON.stringify(bounds.newest));
        query.set("oldest", JSON.stringify(bounds.oldest));
      }
      source = new EventSource(`/api/downloads/events?${query}`);
      let opened = false;
      source.addEventListener("open", () => { if (opened && alive) refreshRef.current(); opened = true; });
      source.addEventListener("window", (event: MessageEvent<string>) => {
        if (!alive || currentCache !== cache.current) return;
        try {
          const snapshot = JSON.parse(event.data) as DownloadWindowSnapshot;
          if (snapshot.filter !== filter || !accept(snapshot.observation)) return;
          const previousTasks = currentCache.tasks();
          if (previousTasks.length === 0 && snapshot.headTasks.length > 0) {
            cursor.current = snapshot.headNextCursor; cursorObservation.current = snapshot.observation; setNextCursor(snapshot.headNextCursor);
          }
          const gap = createDownloadHistoryGap(`gap-${++gapCounter.current}`, snapshot.headTasks, previousTasks, snapshot.headNextCursor);
          if (gap) { gapsRef.current = [...gapsRef.current, gap]; setGaps(gapsRef.current); }
          currentCache.window(snapshot);
          setTasks(currentCache.tasks());
          applyMeta(snapshot);
          if (snapshot.window.overflow) refreshRef.current();
        } catch { /* 保留最后一次有效快照，等待下一次窗口更新。 */ }
      });
    }, 160);
    return () => { alive = false; window.clearTimeout(timer); source?.close(); };
  }, [filter, windowKey]);

  async function loadGap(id: string) {
    const gap = gapsRef.current.find((item) => item.id === id);
    if (!gap) return;
    const token = gapRequests.current.start(id);
    if (!token) return;
    const scope = generation.current; const currentCache = cache.current;
    gapsRef.current = gapsRef.current.map((item) => item.id === id ? { ...item, loading: true, error: null } : item); setGaps(gapsRef.current);
    try {
      const page = await getDownloadPage({ filter: currentCache.filter, cursor: gap.cursor });
      if (scope !== generation.current || currentCache !== cache.current || !accept(page.observation)) return;
      currentCache.merge(page.tasks, page.observation); applyMeta(page); setTasks(currentCache.tasks());
      const next = advanceDownloadHistoryGap(gap, page);
      gapsRef.current = gapsRef.current.flatMap((item) => item.id !== id ? [item] : next ? [next] : []);
      setGaps(gapsRef.current);
    } catch (error) {
      if (scope === generation.current) { gapsRef.current = gapsRef.current.map((item) => item.id === id ? { ...item, loading: false, error: errorMessage(error) } : item); setGaps(gapsRef.current); }
    } finally { gapRequests.current.finish(id, token); }
  }
  function setViewport(next: DownloadViewport | null) {
    viewport.current = next;
    const key = next ? JSON.stringify({ newest: next.newest, oldest: next.oldest }) : "";
    setWindowKey((previous) => previous === key ? previous : key);
  }
  async function runAction(task: DownloadTask, action: DownloadAction) {
    if (actionBusy.current) return;
    actionBusy.current = true; setPendingAction(`${action}:${task.id}`);
    const scope = generation.current;
    try {
      const result = await actOnDownloadObserved(task.id, action);
      if (scope !== generation.current || !accept(result.observation)) return;
      cache.current.merge([result.task], result.observation);
      setTasks(cache.current.tasks());
    } catch (error) { if (scope === generation.current) onErrorRef.current(errorMessage(error)); }
    finally { actionBusy.current = false; setPendingAction(null); }
  }
  async function removeTasks(targets: readonly DownloadDeleteTarget[]) {
    if (actionBusy.current || targets.length === 0) return null;
    actionBusy.current = true; setPendingAction("delete:batch");
    const currentCache = cache.current;
    try {
      return await deleteDownloadBatch(targets, async (task) => {
        let observation: DownloadObservation;
        try { observation = await deleteDownloadObserved(task.id); }
        catch (error) {
          if (!(error instanceof DownloadRequestError) || error.status !== 404) throw error;
          // 404 确认任务已消失；读取新的观察版本，防止旧分页恢复记录。
          const page = await getDownloadPage({ filter: currentCache.filter, limit: 1 });
          observation = page.observation;
          if (cache.current === currentCache && accept(observation)) applyMeta(page);
        }
        if (cache.current !== currentCache || !accept(observation)) return;
        currentCache.remove(task.id, observation); setTasks(currentCache.tasks());
      }, (progress) => {
        setDeletionProgress(progress);
        setPendingAction(`delete:${progress.currentId ?? "batch"}`);
      });
    } finally {
      actionBusy.current = false; setPendingAction(null); setDeletionProgress(null);
      if (cache.current === currentCache) refreshRef.current();
    }
  }
  return { tasks, gaps, loadGap: (id: string) => void loadGap(id), loading, loadingMore, loadError, hasMore: nextCursor !== null, health, summary, pendingAction, deletionProgress, setViewport, runAction, removeTasks, loadMore: () => void readPage(cursor.current ? "more" : "initial"), refresh: () => refreshRef.current() };
}
