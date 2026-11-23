/**
 * [INPUT]: 依赖上传队列、CyberUI 标题、状态、分段进度与文案。
 * [OUTPUT]: 提供 PhotoUploadsProvider、usePhotoUploads 与上传进度浮窗。
 * [POS]: 应用级照片上传生命周期；切换工作区仍保留状态与浮窗。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, DialogHeader, Progress, StatusBadge } from "@cyberos/ui";
import { Check, ChevronDown, ChevronUp, CircleAlert, Upload, X } from "lucide-react";
import { createContext, useContext, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { formatBytes } from "../../i18n/format.js";
import { uploadPhotoBatch, type PhotoUploadItem } from "../../lib/photo-uploads.js";

const PhotoUploadsContext = createContext<{
  active: boolean;
  upload: (files: File[], directory: string) => Promise<PhotoUploadItem[]>;
} | null>(null);

export function usePhotoUploads() {
  const context = useContext(PhotoUploadsContext);
  if (!context) throw new Error("PhotoUploadsProvider is required");
  return context;
}

export function PhotoUploadsProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<PhotoUploadItem[]>([]);
  const [active, setActive] = useState(false);
  const [expanded, setExpanded] = useState(true);
  const running = useRef(false);

  async function upload(files: File[], directory: string) {
    if (running.current) throw new Error("A photo upload is already running");
    running.current = true;
    setActive(true);
    setExpanded(true);
    try {
      return await uploadPhotoBatch(files, directory, setItems);
    } finally {
      running.current = false;
      setActive(false);
    }
  }

  return <PhotoUploadsContext.Provider value={{ active, upload }}>
    {children}
    {items.length ? <PhotoUploadProgress items={items} active={active} expanded={expanded}
      onToggle={() => setExpanded((value) => !value)} onDismiss={() => setItems([])} /> : null}
  </PhotoUploadsContext.Provider>;
}

export function PhotoUploadProgress({ items, active, expanded, onToggle, onDismiss }: {
  items: PhotoUploadItem[];
  active: boolean;
  expanded: boolean;
  onToggle: () => void;
  onDismiss: () => void;
}) {
  const { t, i18n } = useTranslation();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const locale = i18n.resolvedLanguage === "en" ? "en" : "zh-CN";
  const completed = items.filter((item) => item.status === "completed").length;
  const failed = items.filter((item) => item.status === "failed").length;
  const totalBytes = items.reduce((sum, item) => sum + item.sizeBytes, 0);
  const uploadedBytes = items.reduce((sum, item) => sum + item.uploadedBytes, 0);
  const percentage = totalBytes ? Math.floor(uploadedBytes / totalBytes * 100) : completed === items.length ? 100 : 0;
  const content = <section className="photo-upload-window" aria-label={t("workspace.photos.uploadProgress")}
    onKeyDown={(event) => {
      if (event.key === "Escape" && expanded) {
        event.stopPropagation(); event.preventDefault(); onToggle(); toggleRef.current?.focus();
      }
    }}>
    <DialogHeader className="photo-upload-header" headingLevel={3} title={t("workspace.photos.uploadProgress")}
      icon={<Upload size={18} aria-hidden="true" />}
      description={<span role="status">{t("workspace.photos.uploadSummary", { completed, total: items.length })}
        {failed ? ` · ${t("workspace.photos.uploadFailures", { count: failed })}` : ""}</span>}
      actions={<>
      <Button ref={toggleRef} iconOnly variant="ghost" type="button" aria-expanded={expanded} aria-controls="photo-upload-files"
        aria-label={t(expanded ? "workspace.photos.collapseUploads" : "workspace.photos.expandUploads")}
        data-tooltip={t(expanded ? "workspace.photos.collapseUploads" : "workspace.photos.expandUploads")} onClick={onToggle}>
        {expanded ? <ChevronDown size={17} aria-hidden="true" /> : <ChevronUp size={17} aria-hidden="true" />}
      </Button>
      {!active ? <Button iconOnly variant="ghost" type="button" aria-label={t("workspace.photos.dismissUploads")}
        data-tooltip={t("workspace.photos.dismissUploads")} onClick={onDismiss}><X size={17} aria-hidden="true" /></Button> : null}
      </>}
    />
    <div className="photo-upload-total">
      <Progress className="photo-upload-meter" value={percentage} label={t("workspace.photos.totalUploadProgress")} />
      <span>{percentage}%</span>
    </div>
    <ol id="photo-upload-files" className="photo-upload-files" hidden={!expanded} tabIndex={0} aria-label={t("workspace.photos.uploadProgress")}>
      {items.map((item) => {
        const percent = item.sizeBytes ? Math.floor(item.uploadedBytes / item.sizeBytes * 100) : item.status === "completed" ? 100 : 0;
        const state = item.status === "processing" ? t("workspace.photos.uploadProcessing")
          : t(({ queued: "workspace.uploadQueued", uploading: "workspace.uploading", completed: "workspace.uploadCompleted", failed: "workspace.uploadFailed" } as const)[item.status]);
        return <li key={item.id} className="photo-upload-file" data-state={item.status}>
          <div className="photo-upload-file-heading">
            {item.status === "completed" ? <Check size={15} aria-hidden="true" /> : item.status === "failed" ? <CircleAlert size={15} aria-hidden="true" /> : <Upload size={15} aria-hidden="true" />}
            <span className="photo-upload-name" data-tooltip={item.name}>{item.name}</span>
            <StatusBadge className="photo-upload-state" state={item.status === "completed" ? "ready" : item.status === "failed" ? "error" : item.status === "queued" ? "neutral" : "warning"}>{state}</StatusBadge>
          </div>
          <Progress className="photo-upload-meter" value={percent} label={item.name} aria-valuetext={`${percent}% · ${state}`} />
          <div className="photo-upload-file-meta"><span>{formatBytes(item.uploadedBytes, locale)} / {formatBytes(item.sizeBytes, locale)}</span><span>{percent}%</span></div>
          {item.error ? <p className="photo-upload-error">{item.error}</p> : null}
        </li>;
      })}
    </ol>
  </section>;
  return typeof document === "undefined" ? content : createPortal(content, document.fullscreenElement ?? document.body);
}
