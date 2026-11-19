/**
 * [INPUT]: 依赖下载任务、受控选择状态、共享 CyberUI 控件与本地化。
 * [OUTPUT]: 提供可多选任务行、无障碍状态图标与任务操作。
 * [POS]: 下载列表的展示边界；选择和任务控制由面板数据层执行。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton, Checkbox } from "@cyberos/ui";
import type { MouseEvent, ReactNode } from "react";
import { ArrowDownToLine, CheckCircle2, CircleAlert, CirclePause, CircleX, Clock3, Download, FileArchive, FolderOpen, Magnet, Pause, Play, RotateCw, Square, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { DownloadTask } from "../../api.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";

const statusIcons = {
  queued: Clock3,
  running: ArrowDownToLine,
  paused: CirclePause,
  seeding: Upload,
  completed: CheckCircle2,
  failed: CircleAlert,
  cancelled: CircleX
};

export function DownloadTaskRow({
  task,
  locale,
  pendingAction,
  selected,
  selectionMode,
  selectionBusy,
  onToggleSelection,
  onAction,
  onDelete,
  onOpenDirectory
}: {
  task: DownloadTask;
  locale: SupportedLocale;
  pendingAction: string | null;
  selected: boolean;
  selectionMode: boolean;
  selectionBusy: boolean;
  onToggleSelection: () => void;
  onAction: (action: "pause" | "resume" | "cancel" | "retry" | "stop-seeding") => void;
  onDelete: () => void;
  onOpenDirectory: () => void;
}) {
  const { t } = useTranslation();
  const progress = task.totalBytes && task.totalBytes > 0
    ? Math.max(0, Math.min(100, Math.round(task.receivedBytes / task.totalBytes * 1_000) / 10))
    : null;
  const verifying = task.phase === "verifying";
  const transferring = task.status === "running" && !verifying;
  const torrentLive = (transferring || task.status === "seeding") && !verifying;
  const isIndeterminate = progress === null && transferring;
  const progressValue = task.status === "completed" || task.status === "seeding" ? 100 : progress;
  const progressWidth = progressValue ?? (isIndeterminate ? 36 : 0);
  const canPause = task.status === "queued" || task.status === "running" || task.status === "seeding";
  const canResume = task.status === "paused";
  const canCancel = task.status === "queued" || task.status === "running" || task.status === "paused";
  const canStopSeeding = task.status === "seeding";
  const canRetry = task.status === "failed" || task.status === "cancelled";
  const canOpenDirectory = task.status === "completed" || task.status === "seeding" || Boolean(task.contentCompletedAt);
  const actionBusy = pendingAction?.endsWith(`:${task.id}`) === true;
  const controlsDisabled = selectionBusy || pendingAction !== null;
  const retryLabel = formatRetry(task, locale, t);
  const checksumLabel = formatChecksum(task, t);
  const StatusIcon = statusIcons[task.status];
  const statusLabel = t(`workspace.downloads.status.${task.status}`);

  function selectFromRow(event: MouseEvent<HTMLElement>) {
    if (selectionBusy || event.defaultPrevented || !(event.target instanceof Element)) return;
    if (event.target.closest("button, input, label, a, [data-download-selection-ignore]")) return;
    if (!selectionMode && window.matchMedia("(max-width: 560px)").matches) return;
    onToggleSelection();
  }

  return (
    <article className="download-task-row" data-status={task.status} data-task-id={task.id} data-selected={selected || undefined} data-selection-mode={selectionMode || undefined} onClick={selectFromRow}>
      <label className="download-task-select" data-tooltip={t("workspace.downloads.selectTask", { name: task.targetFileName })}>
        <Checkbox checked={selected} disabled={selectionBusy} aria-label={t("workspace.downloads.selectTask", { name: task.targetFileName })} onChange={onToggleSelection} />
      </label>
      <div className="download-task-main">
        <div className="download-task-heading">
          <span className="download-task-icon" aria-hidden="true">
            {task.sourceKind === "magnet" ? <Magnet size={17} /> : task.sourceKind === "torrent" ? <FileArchive size={17} /> : <Download size={17} />}
          </span>
          <div>
            <strong data-tooltip={task.targetFileName}>{task.targetFileName}</strong>
          </div>
          <span className="download-task-status is-icon" role="img" tabIndex={0} aria-label={statusLabel} data-tooltip={statusLabel} data-download-selection-ignore>
            <StatusIcon aria-hidden="true" size={17} />
          </span>
        </div>
        <div className="download-task-path" data-tooltip={task.targetPath}>{task.targetPath}</div>
        <div
          className={`download-progress-track${isIndeterminate ? " is-indeterminate" : ""}`}
          data-indeterminate={isIndeterminate ? "true" : undefined}
          role="progressbar"
          aria-label={t("workspace.downloads.progress", { name: task.targetFileName })}
          aria-valuemin={progressValue === null ? undefined : 0}
          aria-valuemax={progressValue === null ? undefined : 100}
          aria-valuenow={progressValue ?? undefined}
        >
          <span style={{ width: `${progressWidth}%` }} />
        </div>
        <div className="download-task-meta">
          <span>{formatProgress(task, locale, t)}</span>
          {progressValue !== null ? <span className="download-task-percentage">{formatLocaleNumber(progressValue, locale)}%</span> : null}
          {transferring ? <span>{formatSpeed(task.speedBytesPerSecond, locale, t)}</span> : null}
          {transferring ? <span>{formatEta(task, locale, t)}</span> : null}
          {task.downloadMode === "segmented" ? <span>{t(`workspace.downloads.mode.${task.downloadMode}`)}</span> : null}
          {task.phase && task.phase !== "downloading" && task.phase !== "seeding" ? <span>{t(`workspace.downloads.phase.${task.phase}`)}</span> : null}
          {task.downloadMode === "segmented" && task.segmentCount > 0
            ? <span>{t("workspace.downloads.segments", { count: task.segmentCount })}</span>
            : null}
          {task.sourceKind !== "http" && torrentLive ? (
            <>
              <span>{t("workspace.downloads.uploaded", { value: formatBytes(task.uploadedBytes, locale) })}</span>
              <span>{t("workspace.downloads.uploadSpeed", { value: `${formatBytes(task.uploadSpeedBytesPerSecond, locale)}/s` })}</span>
              <span>{t("workspace.downloads.peers", { count: task.peerCount })}</span>
              <span>{t("workspace.downloads.ratio", { value: torrentRatio(task) })}</span>
            </>
          ) : null}
          {task.controlRequested
            ? <span>{t(`workspace.downloads.control.${task.controlRequested}`)}</span>
            : null}
          {retryLabel ? <span>{retryLabel}</span> : null}
          {checksumLabel ? <span data-tooltip={task.actualSha256 ?? task.expectedSha256 ?? undefined}>{checksumLabel}</span> : null}
          {task.errorCode
            ? <span className="download-task-error" data-tooltip={task.error ?? undefined}>{t(`workspace.downloads.errorCode.${task.errorCode}`)}</span>
            : task.error
              ? <span className="download-task-error" data-tooltip={task.error}>{task.error}</span>
              : null}
        </div>
      </div>
      <div className="download-task-actions" aria-label={t("workspace.downloads.actions")}>
        {canPause ? (
          <IconAction icon={<Pause aria-hidden="true" size={14} />} label={t(task.status === "seeding" ? "workspace.downloads.pauseSeeding" : "workspace.downloads.pause")} disabled={controlsDisabled} busy={actionBusy} onClick={() => onAction("pause")} />
        ) : null}
        {canResume ? (
          <IconAction icon={<Play aria-hidden="true" size={14} />} label={t("workspace.downloads.resume")} disabled={controlsDisabled} busy={actionBusy} onClick={() => onAction("resume")} />
        ) : null}
        {canRetry ? (
          <IconAction icon={<RotateCw aria-hidden="true" size={14} />} label={t("workspace.downloads.retry")} disabled={controlsDisabled} busy={actionBusy} onClick={() => onAction("retry")} />
        ) : null}
        {canCancel ? (
          <IconAction icon={<X aria-hidden="true" size={14} />} label={t("workspace.downloads.cancel")} disabled={controlsDisabled} busy={actionBusy} onClick={() => onAction("cancel")} />
        ) : null}
        {canStopSeeding ? (
          <IconAction icon={<Square aria-hidden="true" size={13} />} label={t("workspace.downloads.stopSeeding")} disabled={controlsDisabled} busy={actionBusy} onClick={() => onAction("stop-seeding")} />
        ) : null}
        {canOpenDirectory ? (
          <IconAction icon={<FolderOpen aria-hidden="true" size={14} />} label={t("workspace.downloads.openDirectory")} onClick={onOpenDirectory} />
        ) : null}
        <IconAction icon={<Trash2 aria-hidden="true" size={14} />} label={t("workspace.downloads.remove")} disabled={controlsDisabled} busy={actionBusy} onClick={onDelete} />
      </div>
    </article>
  );
}

function IconAction({ icon, label, disabled, busy, onClick }: { icon: ReactNode; label: string; disabled?: boolean; busy?: boolean; onClick: () => void }) {
  return (
    <UiButton variant="ghost" type="button" className="download-task-action" data-tooltip={label} aria-label={label} aria-busy={busy || undefined} disabled={disabled} onClick={onClick}>
      {icon}
    </UiButton>
  );
}

function torrentRatio(task: DownloadTask): string {
  if (!task.totalBytes || task.totalBytes <= 0) return "0.00";
  return (task.uploadedBytes / task.totalBytes).toFixed(2);
}

function formatProgress(task: DownloadTask, locale: SupportedLocale, t: (key: string, options?: Record<string, unknown>) => string): string {
  const received = formatBytes(task.receivedBytes, locale);
  return task.totalBytes === null ? `${received} · ${t("workspace.downloads.unknownTotal")}` : `${received} / ${formatBytes(task.totalBytes, locale)}`;
}

function formatSpeed(speed: number, locale: SupportedLocale, t: (key: string) => string): string {
  return speed > 0 ? `${formatBytes(speed, locale)}/s` : t("workspace.downloads.noSpeed");
}

function formatEta(task: DownloadTask, _locale: SupportedLocale, t: (key: string) => string): string {
  if (!task.totalBytes || task.speedBytesPerSecond <= 0 || task.totalBytes <= task.receivedBytes) {
    return task.status === "completed" ? t("workspace.downloads.done") : t("workspace.downloads.unknownEta");
  }
  const seconds = Math.ceil((task.totalBytes - task.receivedBytes) / task.speedBytesPerSecond);
  if (seconds >= 86_400) return `${Math.floor(seconds / 86_400)}d`;
  if (seconds >= 3_600) return `${Math.floor(seconds / 3_600)}h ${Math.floor(seconds / 60) % 60}m`;
  if (seconds >= 60) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  return `${seconds}s`;
}

function formatRetry(
  task: DownloadTask,
  locale: SupportedLocale,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (!task.nextRetryAt) return null;
  const remainingSeconds = Math.max(0, Math.ceil((Date.parse(task.nextRetryAt) - Date.now()) / 1000));
  return t("workspace.downloads.retryCountdown", {
    count: formatLocaleNumber(remainingSeconds, locale),
    retry: task.retryCount
  });
}

function formatChecksum(
  task: DownloadTask,
  t: (key: string, options?: Record<string, unknown>) => string
): string | null {
  if (!task.expectedSha256) return null;
  if (task.phase === "verifying") return t("workspace.downloads.checksumVerifying");
  if (task.actualSha256 === task.expectedSha256) return t("workspace.downloads.checksumVerified");
  if (task.actualSha256) return t("workspace.downloads.checksumMismatch");
  return t("workspace.downloads.checksumPending");
}
