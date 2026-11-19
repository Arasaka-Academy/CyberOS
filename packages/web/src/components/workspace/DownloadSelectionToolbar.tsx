/**
 * [INPUT]: 依赖已加载任务选择状态与共享复选框。
 * [OUTPUT]: 提供全选半选、选择数量、批删与清除入口。
 * [POS]: 下载工具条的选择边界；移动选择模式由面板控制。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton, Checkbox } from "@cyberos/ui";
import { Trash2, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";

export function DownloadSelectionToolbar({ count, total, checked, indeterminate, selectionMode, busy, onSelectAll, onClear, onDelete }: {
  count: number; total: number; checked: boolean; indeterminate: boolean; selectionMode: boolean; busy: boolean;
  onSelectAll: (checked: boolean) => void; onClear: () => void; onDelete: () => void;
}) {
  const { t } = useTranslation();
  const checkbox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (checkbox.current) checkbox.current.indeterminate = indeterminate; }, [indeterminate]);
  return <div className="downloads-selection-tools" data-selecting={selectionMode || undefined} role="group" aria-label={t("workspace.downloads.selectTasks")}>
    <label className="downloads-select-all" data-tooltip={t("workspace.downloads.selectLoaded")}>
      <Checkbox ref={checkbox} checked={checked} aria-checked={indeterminate ? "mixed" : checked} disabled={busy || total === 0} aria-label={t("workspace.downloads.selectLoaded")} onChange={(event) => onSelectAll(event.target.checked)} />
    </label>
    {count > 0 || selectionMode ? <>
      <span className="downloads-selection-count" role="status">{t("workspace.downloads.selectedCount", { count })}</span>
      <UiButton variant="ghost" iconOnly type="button" className="download-task-action" data-tooltip={t("workspace.downloads.deleteSelected")} aria-label={t("workspace.downloads.deleteSelected")} disabled={busy || count === 0} onClick={onDelete}><Trash2 size={16} aria-hidden="true" /></UiButton>
      <UiButton variant="ghost" iconOnly type="button" className="download-task-action" data-tooltip={t("workspace.downloads.clearSelection")} aria-label={t("workspace.downloads.clearSelection")} disabled={busy} onClick={onClear}><X size={16} aria-hidden="true" /></UiButton>
    </> : null}
  </div>;
}
