/**
 * [INPUT]: 依赖冻结的删除目标、批次进度和共享模态控件。
 * [OUTPUT]: 提供单删与批删共用的确认弹窗。
 * [POS]: 下载删除的确认边界；执行与结果由面板持有。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton, DialogActions, DialogHeader } from "@cyberos/ui";
import { LoaderCircle, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal.js";
import type { DownloadDeleteProgress, DownloadDeleteTarget } from "./download-task-deletion.js";
import { useModalDialog } from "./useModalDialog.js";

export function DownloadDeleteDialog({ targets, busy, progress, onClose, onConfirm }: {
  targets: readonly DownloadDeleteTarget[]; busy: boolean; progress: DownloadDeleteProgress | null;
  onClose: () => void; onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog(onClose, busy);
  return <ModalPortal className="management-modal-backdrop" onRequestClose={onClose} closeDisabled={busy} onMouseDown={(event) => {
    if (event.currentTarget === event.target && !busy) onClose();
  }}>
    <section ref={dialogRef} tabIndex={-1} className="management-modal download-delete-dialog" role="dialog" aria-modal="true" aria-labelledby="download-delete-title" aria-describedby="download-delete-description" aria-busy={busy || undefined}>
      <DialogHeader icon={<Trash2 aria-hidden="true" size={20} />} title={t("workspace.downloads.deleteTitle", { count: targets.length })} description={t("workspace.downloads.deleteDescription")} headingId="download-delete-title" descriptionId="download-delete-description" />
      <ul className="download-delete-targets">{targets.map((task) => <li key={task.id} data-tooltip={task.targetFileName}>{task.targetFileName}</li>)}</ul>
      {busy ? <p className="download-delete-progress" role="status">{t("workspace.downloads.deleteProgress", { completed: progress?.completed ?? 0, total: targets.length })}</p> : null}
      <DialogActions>
        <UiButton variant="secondary" type="button" onClick={onClose} disabled={busy}>{t("common.actions.cancel")}</UiButton>
        <UiButton variant="danger" className="danger-button" type="button" onClick={onConfirm} disabled={busy} aria-busy={busy || undefined}>
          {busy ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <Trash2 aria-hidden="true" size={16} />}{t("workspace.downloads.deleteTasks")}
        </UiButton>
      </DialogActions>
    </section>
  </ModalPortal>;
}
