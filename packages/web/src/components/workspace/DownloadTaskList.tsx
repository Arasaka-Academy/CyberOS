/**
 * [INPUT]: 依赖下载任务缓存、TanStack 可变行高窗口与任务行。
 * [OUTPUT]: 提供随滚动分页的下载列表及可见任务边界。
 * [POS]: 下载面板的滚动边界；保持阅读锚点并限制挂载行数。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton } from "@cyberos/ui";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Download, LoaderCircle } from "lucide-react";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { DownloadTask } from "../../api.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { DownloadTaskRow } from "./DownloadTaskRow.js";
import { compareDownloadKeys } from "./download-task-cache.js";
import type { DownloadAction, DownloadGap, DownloadViewport } from "./use-download-tasks.js";

interface Props {
  tasks: DownloadTask[]; gaps: DownloadGap[]; onLoadGap: (id: string) => void; locale: SupportedLocale; pendingAction: string | null;
  hasMore: boolean; loadingMore: boolean; loadError: string | null;
  onLoadMore: () => void; onViewport: (window: DownloadViewport | null) => void;
  onAction: (task: DownloadTask, action: DownloadAction) => void;
  onDelete: (task: DownloadTask) => void; onOpenDirectory: (task: DownloadTask) => void;
}
export function DownloadTaskList({ tasks, gaps, onLoadGap, locale, pendingAction, hasMore, loadingMore, loadError, onLoadMore, onViewport, onAction, onDelete, onOpenDirectory }: Props) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const entries = useMemo(() => {
    const rows: ({ kind: "task"; task: DownloadTask } | { kind: "gap"; gap: DownloadGap })[] = tasks.map((task) => ({ kind: "task", task }));
    for (const gap of gaps) {
      const index = rows.findIndex((row) => compareDownloadKeys(row.kind === "task" ? row.task : row.gap.after, gap.after) > 0);
      rows.splice(index < 0 ? rows.length : index, 0, { kind: "gap", gap });
    }
    return rows;
  }, [tasks, gaps]);
  const entriesRef = useRef(entries);
  const callbacks = useRef({ onViewport, onLoadMore, onLoadGap });
  callbacks.current = { onViewport, onLoadMore, onLoadGap };
  const anchor = useRef<{ task: DownloadTask; offset: number; index: number } | null>(null);
  const virtualizer = useVirtualizer({
    count: entries.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 118,
    getItemKey: (index) => { const row = entries[index]; return row?.kind === "task" ? row.task.id : row?.gap.id ?? index; },
    overscan: 8
  });
  virtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item, _delta, instance) => item.start < (instance.scrollOffset ?? 0);
  const items = virtualizer.getVirtualItems();
  const firstIndex = items[0]?.index ?? 0;
  const lastIndex = items.at(-1)?.index ?? -1;

  useLayoutEffect(() => {
    if (entriesRef.current !== entries && anchor.current && scrollRef.current) {
      const saved = anchor.current;
      let index = entries.findIndex((row) => row.kind === "task" && row.task.id === saved.task.id);
      if (index < 0) index = entries.findIndex((row) => row.kind === "task" && compareDownloadKeys(row.task, saved.task) >= 0);
      if (index < 0) index = entries.length - 1;
      const target = entries[index];
      if (index >= 0 && (index !== saved.index || (target?.kind === "task" ? target.task.id : null) !== saved.task.id)) {
        virtualizer.scrollToIndex(index, { align: "start" });
        scrollRef.current.scrollTop += saved.offset;
      }
    }
    entriesRef.current = entries;
  }, [entries, virtualizer]);

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const saveAnchor = () => {
      const item = virtualizer.getVirtualItems().find((row) => row.end > element.scrollTop);
      const row = item ? entriesRef.current[item.index] : undefined;
      const task = row?.kind === "task" ? row.task : undefined;
      if (item && task) anchor.current = { task, offset: element.scrollTop - item.start, index: item.index };
    };
    element.addEventListener("scroll", saveAnchor, { passive: true });
    saveAnchor();
    return () => element.removeEventListener("scroll", saveAnchor);
  }, [virtualizer]);

  const visibleTasks = entries.slice(firstIndex, lastIndex + 1).flatMap((row) => row.kind === "task" ? [row.task] : []);
  const newest = visibleTasks[0];
  const oldest = visibleTasks.at(-1);
  const viewportKey = newest && oldest ? JSON.stringify({ newest: { createdAt: newest.createdAt, id: newest.id }, oldest: { createdAt: oldest.createdAt, id: oldest.id } }) : "";
  useEffect(() => {
    if (!viewportKey) { callbacks.current.onViewport(null); return; }
    const range = JSON.parse(viewportKey) as Pick<DownloadViewport, "newest" | "oldest">;
    const saved = anchor.current?.task;
    callbacks.current.onViewport({ ...range, anchor: saved ? { createdAt: saved.createdAt, id: saved.id } : range.newest });
  }, [viewportKey]);
  useEffect(() => {
    if (lastIndex >= entries.length - 8 && lastIndex >= 0 && hasMore && !loadingMore && !loadError) callbacks.current.onLoadMore();
  }, [lastIndex, entries.length, hasMore, loadingMore, loadError]);

  const visibleGaps = entries.slice(firstIndex, lastIndex + 1).flatMap((row) => row.kind === "gap" && !row.gap.loading && !row.gap.error ? [row.gap.id] : []).join(",");
  useEffect(() => { for (const id of visibleGaps.split(",").filter(Boolean)) callbacks.current.onLoadGap(id); }, [visibleGaps]);

  return <div ref={scrollRef} className="downloads-list" tabIndex={0} aria-label={t("workspace.downloads.title")}>
    {tasks.length === 0 && !loadError ? <div className="downloads-state"><Download aria-hidden="true" size={22} /><strong>{t("workspace.downloads.emptyTitle")}</strong><span>{t("workspace.downloads.emptyBody")}</span></div> : null}
    <div className="downloads-virtual-list" role="list" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => {
        const entry = entries[item.index];
        if (!entry) return null;
        if (entry.kind === "gap") return <div key={item.key} data-index={item.index} ref={virtualizer.measureElement} className="downloads-virtual-row downloads-pagination" style={{ transform: `translateY(${item.start}px)` }} role={entry.gap.error ? "alert" : "status"}>
          {entry.gap.error ? <><span>{entry.gap.error}</span><UiButton variant="secondary" onClick={() => onLoadGap(entry.gap.id)}>{t("common.actions.retry")}</UiButton></> : <><LoaderCircle size={16} className="is-spinning" aria-hidden="true" /><span>{t("common.states.loading")}</span></>}
        </div>;
        const task = entry.task;
        return <div key={item.key} role="listitem" data-index={item.index} ref={virtualizer.measureElement} className="downloads-virtual-row" style={{ transform: `translateY(${item.start}px)` }}>
          <DownloadTaskRow task={task} locale={locale} pendingAction={pendingAction} onAction={(action) => onAction(task, action)} onDelete={() => onDelete(task)} onOpenDirectory={() => onOpenDirectory(task)} />
        </div>;
      })}
    </div>
    {loadingMore ? <div className="downloads-pagination" role="status"><LoaderCircle size={16} className="is-spinning" aria-hidden="true" /><span>{t("common.states.loading")}</span></div> : null}
    {loadError ? <div className="downloads-pagination is-error" role="alert"><span>{loadError}</span><UiButton variant="secondary" onClick={onLoadMore}>{t("common.actions.retry")}</UiButton></div> : null}
  </div>;
}
