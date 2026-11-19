/**
 * [INPUT]: 依赖存储池、下载分页数据层和受控多选。
 * [OUTPUT]: 提供下载筛选、全局统计和确认后的单删与批删。
 * [POS]: 下载面板的选择与确认边界；任务执行由数据层串行完成。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton } from "@cyberos/ui";
import { Check, Download, ListChecks, LoaderCircle, Plus } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DownloadFilter } from "@cyberos/shared";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { DownloadCreateDialog } from "./DownloadCreateDialog.js";
import { DownloadTaskList } from "./DownloadTaskList.js";
import { DownloadDeleteDialog } from "./DownloadDeleteDialog.js";
import { DownloadSelectionToolbar } from "./DownloadSelectionToolbar.js";
import type { DownloadDeleteResult, DownloadDeleteTarget } from "./download-task-deletion.js";
import { loadedDownloadSelection, retainDownloadSelection, toggleDownloadSelection } from "./download-task-selection.js";
import { DownloadsInitialSkeleton } from "./PanelLoadingSkeletons.js";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "./PanelHeader.js";
import type { StorageFilePickerPool } from "./StorageFilePickerDialog.js";
import { useDownloadTasks } from "./use-download-tasks.js";

export { DownloadTaskRow } from "./DownloadTaskRow.js";
export { TorrentFileSelector } from "./DownloadCreateDialog.js";
export type HttpDownloaderPool = StorageFilePickerPool;
interface Props {
  pools: HttpDownloaderPool[];
  storagePoolsLoading: boolean;
  selectedStoragePoolId: string;
  locale: SupportedLocale;
  onSelectStoragePool: (poolId: string) => void;
  onOpenDirectory: (storagePoolId: string, path: string) => void;
  onOpenStorage: () => void;
  onRequestCreateFolder?: (input: { storagePoolId: string; parentPath: string; name: string }) => Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onNotifyWarning: (message: string | null) => void;
}
export function HttpDownloaderPanel({ pools, storagePoolsLoading, selectedStoragePoolId, locale, onSelectStoragePool, onOpenDirectory, onOpenStorage, onRequestCreateFolder, onNotifyError, onNotifySuccess, onNotifyWarning }: Props) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<DownloadFilter>("all");
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set<string>());
  const [selectionMode, setSelectionMode] = useState(false);
  const [deleteTargets, setDeleteTargets] = useState<DownloadDeleteTarget[] | null>(null);
  const [deleteResult, setDeleteResult] = useState<DownloadDeleteResult | null>(null);
  const [deleting, setDeleting] = useState(false);
  const deletingRef = useRef(false);
  const panelRef = useRef<HTMLElement>(null);
  const deleteTriggerRef = useRef<HTMLElement | null>(null);
  const data = useDownloadTasks(filter, onNotifyError);
  const selection = loadedDownloadSelection(data.tasks, selectedIds);
  const selectionBusy = deleting || data.pendingAction !== null;
  useEffect(() => {
    if (!data.loading && !deleting) setSelectedIds((previous) => retainDownloadSelection(previous, data.tasks));
  }, [data.tasks, data.loading, deleting]);
  const mountedPools = useMemo(() => pools.filter((pool) => pool.status !== "offline"), [pools]);
  const createControlState = downloadCreateControlState(data.loading, storagePoolsLoading, mountedPools.length > 0);
  function openCreateDialog() {
    if (data.loading || storagePoolsLoading) return;
    if (mountedPools.length === 0) { onNotifyWarning(t("workspace.downloads.configureStoragePool")); onOpenStorage(); return; }
    setCreateOpen(true);
  }
  const createLabel = t(data.loading ? "common.states.loading" : storagePoolsLoading ? "workspace.downloads.loadingStoragePools" : "workspace.downloads.newDownload");
  function clearSelection() { setSelectedIds(new Set()); setSelectionMode(false); }
  function requestDelete(targets: readonly DownloadDeleteTarget[]) {
    if (selectionBusy || targets.length === 0) return;
    deleteTriggerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDeleteTargets([...new Map(targets.map((task) => [task.id, { id: task.id, targetFileName: task.targetFileName }])).values()]);
  }
  async function confirmDelete() {
    if (!deleteTargets || deletingRef.current) return;
    deletingRef.current = true; setDeleting(true);
    try {
      const result = await data.removeTasks(deleteTargets);
      if (!result) return;
      setDeleteResult(result.failures.length > 0 ? result : null);
      setSelectedIds((previous) => {
        const next = new Set(previous);
        for (const id of result.deletedIds) next.delete(id);
        return next;
      });
      if (result.failures.length === 0) {
        const deletedIds = new Set(result.deletedIds);
        if ([...selectedIds].every((id) => deletedIds.has(id))) setSelectionMode(false);
        onNotifySuccess(t("workspace.downloads.deleteSuccess", { count: result.deletedIds.length }));
      }
      setDeleteTargets(null);
      window.requestAnimationFrame(() => {
        const trigger = deleteTriggerRef.current;
        if (!trigger?.isConnected || trigger.getClientRects().length === 0) panelRef.current?.querySelector<HTMLElement>(".downloads-list")?.focus();
      });
    } finally { deletingRef.current = false; setDeleting(false); }
  }
  return <section ref={panelRef} className="workspace-management http-downloader-panel" aria-label={t("workspace.downloads.title")} aria-busy={data.loading || undefined}>
    <PanelHeader className="downloads-header" icon={<Download aria-hidden="true" size={20} />} title={t("workspace.downloads.title")} subtitle={null} actions={<PanelHeaderActions label={t("workspace.management.actions.label")} className="downloads-header-actions">
      <PanelHeaderAction label={t(selectionMode ? "workspace.downloads.finishSelection" : "workspace.downloads.selectTasks")} type="button" className="downloads-selection-toggle" disabled={data.loading || selectionBusy} aria-pressed={selectionMode} mobilePrimary onClick={() => { if (selectionMode) clearSelection(); else setSelectionMode(true); }}>
        {selectionMode ? <Check size={17} aria-hidden="true" /> : <ListChecks size={17} aria-hidden="true" />}
      </PanelHeaderAction>
      <PanelHeaderAction label={createLabel} tooltip={createControlState === "needs-storage" ? t("workspace.downloads.configureStoragePool") : createLabel} type="button" className="download-create-button" onClick={openCreateDialog} disabled={createControlState === "loading"} aria-busy={createControlState === "loading" || undefined} mobilePrimary data-state={createControlState}>
        {createControlState === "loading" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={17} />}
      </PanelHeaderAction>
    </PanelHeaderActions>} />
    {data.loading ? <DownloadsInitialSkeleton /> : <>
      <div className="downloads-controls"><div className="downloads-toolbar">
        <div className="downloads-filters" role="tablist" aria-label={t("workspace.downloads.filters")}>
          {(["all", "active", "completed", "failed"] as const).map((value) => <UiButton variant="ghost" key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} disabled={selectionBusy} onClick={() => { clearSelection(); setFilter(value); }}>{t(`workspace.downloads.filter.${value}`)}</UiButton>)}
        </div>
        <DownloadSelectionToolbar count={selection.count} total={selection.ids.size} checked={selection.checked} indeterminate={selection.indeterminate} selectionMode={selectionMode} busy={selectionBusy} onSelectAll={(checked) => setSelectedIds(checked ? selection.ids : new Set())} onClear={clearSelection} onDelete={() => requestDelete(data.tasks.filter((task) => selectedIds.has(task.id)))} />
        {selection.count === 0 && !selectionMode ? <div className="downloads-toolbar-meta"><div className="downloads-summary" aria-label={t("workspace.downloads.title")}>
          <div className="download-header-stat"><strong>{formatLocaleNumber(data.summary.active, locale)}</strong><span>{t("workspace.downloads.active")}</span></div>
          <div className="download-header-stat"><strong>{formatLocaleNumber(data.summary.queued, locale)}</strong><span>{t("workspace.downloads.queued")}</span></div>
          <div className="download-header-stat"><strong>{formatBytes(data.summary.speedBytesPerSecond, locale)}/s</strong><span>{t("workspace.downloads.speed")}</span></div>
          <div className="download-header-stat" data-state={data.health?.status ?? "unavailable"}><strong>{t(`workspace.downloads.workerStatus.${data.health?.status ?? "unavailable"}`)}</strong><span>{t("workspace.downloads.worker")}</span></div>
        </div></div> : null}
      </div>
      {deleteResult ? <div className="downloads-delete-result" role="alert">
        <p>{t("workspace.downloads.deleteResult", { deleted: deleteResult.deletedIds.length, failed: deleteResult.failures.length })}</p>
        <ul>{deleteResult.failures.map(({ task, message }) => <li key={task.id}><strong>{task.targetFileName}</strong><span>{message}</span></li>)}</ul>
        <UiButton variant="secondary" type="button" disabled={selectionBusy} onClick={() => requestDelete(deleteResult.failures.map(({ task }) => task))}>{t("common.actions.retry")}</UiButton>
        <UiButton variant="ghost" type="button" disabled={selectionBusy} onClick={() => setDeleteResult(null)}>{t("common.actions.close")}</UiButton>
      </div> : null}</div>
      <DownloadTaskList key={filter} tasks={data.tasks} gaps={data.gaps} onLoadGap={data.loadGap} locale={locale} pendingAction={data.pendingAction} selectedIds={selectedIds} selectionMode={selectionMode} selectionBusy={selectionBusy} onToggleSelection={(id) => { if (!selectionBusy) setSelectedIds((previous) => toggleDownloadSelection(previous, id)); }} hasMore={data.hasMore} loadingMore={data.loadingMore} loadError={data.loadError} onLoadMore={data.loadMore} onViewport={data.setViewport} onAction={(task, action) => void data.runAction(task, action)} onDelete={(task) => requestDelete([task])} onOpenDirectory={(task) => onOpenDirectory(task.storagePoolId, task.targetDirectory)} />
    </>}
    {createOpen ? <DownloadCreateDialog pools={pools} selectedStoragePoolId={selectedStoragePoolId} locale={locale} onSelectStoragePool={onSelectStoragePool} {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})} onNotifyError={onNotifyError} onNotifySuccess={onNotifySuccess} onCreated={() => data.refresh()} onClose={() => setCreateOpen(false)} /> : null}
    {deleteTargets ? <DownloadDeleteDialog targets={deleteTargets} busy={deleting} progress={data.deletionProgress} onConfirm={() => void confirmDelete()} onClose={() => { if (!deletingRef.current) setDeleteTargets(null); }} /> : null}
  </section>;
}
export function downloadCreateControlState(initialLoading: boolean, storagePoolsLoading: boolean, hasMountedPool: boolean): "loading" | "ready" | "needs-storage" {
  if (initialLoading || storagePoolsLoading) return "loading";
  return hasMountedPool ? "ready" : "needs-storage";
}
