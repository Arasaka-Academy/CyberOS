/**
 * [INPUT]: 依赖存储池、下载分页数据层与共享面板控件。
 * [OUTPUT]: 提供紧凑下载面板、全局统计和筛选入口。
 * [POS]: 工作区下载入口；创建、任务行和窗口列表分离。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton } from "@cyberos/ui";
import { Download, LoaderCircle, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { DownloadFilter } from "@cyberos/shared";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { DownloadCreateDialog } from "./DownloadCreateDialog.js";
import { DownloadTaskList } from "./DownloadTaskList.js";
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
  const data = useDownloadTasks(filter, onNotifyError);
  const mountedPools = useMemo(() => pools.filter((pool) => pool.status !== "offline"), [pools]);
  const createControlState = downloadCreateControlState(data.loading, storagePoolsLoading, mountedPools.length > 0);
  function openCreateDialog() {
    if (data.loading || storagePoolsLoading) return;
    if (mountedPools.length === 0) { onNotifyWarning(t("workspace.downloads.configureStoragePool")); onOpenStorage(); return; }
    setCreateOpen(true);
  }
  const createLabel = t(data.loading ? "common.states.loading" : storagePoolsLoading ? "workspace.downloads.loadingStoragePools" : "workspace.downloads.newDownload");
  return <section className="workspace-management http-downloader-panel" aria-label={t("workspace.downloads.title")} aria-busy={data.loading || undefined}>
    <PanelHeader className="downloads-header" icon={<Download aria-hidden="true" size={20} />} title={t("workspace.downloads.title")} subtitle={null} actions={<PanelHeaderActions label={t("workspace.management.actions.label")} className="downloads-header-actions">
      <PanelHeaderAction label={createLabel} tooltip={createControlState === "needs-storage" ? t("workspace.downloads.configureStoragePool") : createLabel} type="button" className="download-create-button" onClick={openCreateDialog} disabled={createControlState === "loading"} aria-busy={createControlState === "loading" || undefined} mobilePrimary data-state={createControlState}>
        {createControlState === "loading" ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <Plus aria-hidden="true" size={17} />}
      </PanelHeaderAction>
    </PanelHeaderActions>} />
    {data.loading ? <DownloadsInitialSkeleton /> : <>
      <div className="downloads-toolbar">
        <div className="downloads-filters" role="tablist" aria-label={t("workspace.downloads.filters")}>
          {(["all", "active", "completed", "failed"] as const).map((value) => <UiButton variant="ghost" key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{t(`workspace.downloads.filter.${value}`)}</UiButton>)}
        </div>
        <div className="downloads-toolbar-meta"><div className="downloads-summary" aria-label={t("workspace.downloads.title")}>
          <div className="download-header-stat"><strong>{formatLocaleNumber(data.summary.active, locale)}</strong><span>{t("workspace.downloads.active")}</span></div>
          <div className="download-header-stat"><strong>{formatLocaleNumber(data.summary.queued, locale)}</strong><span>{t("workspace.downloads.queued")}</span></div>
          <div className="download-header-stat"><strong>{formatBytes(data.summary.speedBytesPerSecond, locale)}/s</strong><span>{t("workspace.downloads.speed")}</span></div>
          <div className="download-header-stat" data-state={data.health?.status ?? "unavailable"}><strong>{t(`workspace.downloads.workerStatus.${data.health?.status ?? "unavailable"}`)}</strong><span>{t("workspace.downloads.worker")}</span></div>
        </div></div>
      </div>
      <DownloadTaskList key={filter} tasks={data.tasks} gaps={data.gaps} onLoadGap={data.loadGap} locale={locale} pendingAction={data.pendingAction} hasMore={data.hasMore} loadingMore={data.loadingMore} loadError={data.loadError} onLoadMore={data.loadMore} onViewport={data.setViewport} onAction={(task, action) => void data.runAction(task, action)} onDelete={(task) => void data.removeTask(task)} onOpenDirectory={(task) => onOpenDirectory(task.storagePoolId, task.targetDirectory)} />
    </>}
    {createOpen ? <DownloadCreateDialog pools={pools} selectedStoragePoolId={selectedStoragePoolId} locale={locale} onSelectStoragePool={onSelectStoragePool} {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})} onNotifyError={onNotifyError} onNotifySuccess={onNotifySuccess} onCreated={() => data.refresh()} onClose={() => setCreateOpen(false)} /> : null}
  </section>;
}
export function downloadCreateControlState(initialLoading: boolean, storagePoolsLoading: boolean, hasMountedPool: boolean): "loading" | "ready" | "needs-storage" {
  if (initialLoading || storagePoolsLoading) return "loading";
  return hasMountedPool ? "ready" : "needs-storage";
}
