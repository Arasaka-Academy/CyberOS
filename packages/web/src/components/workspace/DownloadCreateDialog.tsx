/**
 * [INPUT]: 依赖下载创建接口、种子预览与存储目录选择器。
 * [OUTPUT]: 提供独立下载创建弹窗和种子文件选择器。
 * [POS]: 下载面板的创建流程边界；关闭时释放预览并恢复焦点。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button as UiButton, Checkbox, DialogActions, DialogHeader, Field, Input } from "@cyberos/ui";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { CheckCircle2, CircleAlert, Download, FileArchive, FileUp, FolderOpen, Link2, LoaderCircle, Magnet, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal.js";
import { createDownload, createMagnetPreview, createTorrentDownload, deleteTorrentPreview, getDownloadSettings, getFileMeta, getTorrentPreview, uploadTorrentPreview, type DownloadTask, type TorrentPreview } from "../../api.js";
import { formatBytes } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { StorageFilePickerDialog, type StorageFilePickerPool, type StorageFileSelection } from "./StorageFilePickerDialog.js";

type DownloadSourceMode = "link" | "torrent-file";
interface DownloadCreateDialogProps {
  pools: StorageFilePickerPool[];
  selectedStoragePoolId: string;
  locale: SupportedLocale;
  onSelectStoragePool: (poolId: string) => void;
  onRequestCreateFolder?: (input: { storagePoolId: string; parentPath: string; name: string }) => Promise<void>;
  onNotifyError: (message: string | null) => void;
  onNotifySuccess: (message: string | null) => void;
  onCreated: (task: DownloadTask) => void;
  onClose: () => void;
}
export function DownloadCreateDialog({ pools, selectedStoragePoolId, locale, onSelectStoragePool, onRequestCreateFolder, onNotifyError, onNotifySuccess, onCreated, onClose }: DownloadCreateDialogProps) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [sourceMode, setSourceMode] = useState<DownloadSourceMode>("link");
  const [url, setUrl] = useState("");
  const [torrentFileName, setTorrentFileName] = useState("");
  const [torrentPreview, setTorrentPreview] = useState<TorrentPreview | null>(null);
  const [selectedFileIndices, setSelectedFileIndices] = useState<number[]>([]);
  const [resolvingTorrent, setResolvingTorrent] = useState(false);
  const [fileName, setFileName] = useState("");
  const [sha256, setSha256] = useState("");
  const [fileNameEdited, setFileNameEdited] = useState(false);
  const [target, setTarget] = useState<StorageFileSelection | null>(null);
  const [targetLoading, setTargetLoading] = useState(false);
  const [targetError, setTargetError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const createDialogRef = useRef<HTMLFormElement | null>(null);
  const createUrlInputRef = useRef<HTMLInputElement | null>(null);
  const torrentFileInputRef = useRef<HTMLInputElement | null>(null);
  const torrentPreviewRequestRef = useRef(0);
  const targetRequestRef = useRef(0);
  const targetButtonRef = useRef<HTMLButtonElement | null>(null);
  const selectedPool = pools.find((pool) => pool.id === (target?.storagePoolId ?? selectedStoragePoolId)) ?? null;
  const mountedPools = useMemo(() => pools.filter((pool) => pool.status !== "offline"), [pools]);
  const torrentSource = sourceMode === "torrent-file" || isMagnetLink(url);
  const torrentReady = torrentPreview?.status === "ready";
  const sourceReady = torrentSource
    ? torrentReady && selectedFileIndices.length > 0
    : sourceMode === "link" && Boolean(url.trim());
  useEffect(() => () => {
    torrentPreviewRequestRef.current += 1;
    targetRequestRef.current += 1;
  }, []);

  useEffect(() => {
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => createUrlInputRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(frame);
      if (previouslyFocused?.isConnected) {
        window.requestAnimationFrame(() => previouslyFocused.focus());
      }
    };
  }, []);

  useEffect(() => { openCreateDialog(); }, []);

  function openCreateDialog() {
    const requestId = ++targetRequestRef.current;
    setTarget(null);
    setTargetLoading(true);
    setTargetError(null);
    void getDownloadSettings().then(async (settings) => {
      if (targetRequestRef.current !== requestId) return;
      if (settings.defaultStoragePoolId !== null && settings.defaultTargetDirectory !== null) {
        const pool = mountedPools.find((candidate) => candidate.id === settings.defaultStoragePoolId);
        if (!pool) {
          setTargetError(t("settings.downloads.defaultDirectoryUnavailable"));
          return;
        }
        try {
          const directory = await getFileMeta(pool.id, settings.defaultTargetDirectory);
          if (targetRequestRef.current !== requestId) return;
          if (directory.kind !== "directory") {
            setTargetError(t("settings.downloads.defaultDirectoryUnavailable"));
            return;
          }
        } catch {
          if (targetRequestRef.current === requestId) setTargetError(t("settings.downloads.defaultDirectoryUnavailable"));
          return;
        }
        setTarget({ storagePoolId: pool.id, path: settings.defaultTargetDirectory, name: pool.name });
      } else {
        const pool = mountedPools.find((candidate) => candidate.id === selectedStoragePoolId) ?? mountedPools[0];
        setTarget(pool ? { storagePoolId: pool.id, path: pool.path, name: pool.name } : null);
      }
    }).catch(() => {
      if (targetRequestRef.current === requestId) setTargetError(t("settings.downloads.defaultDirectoryLoadFailed"));
    }).finally(() => {
      if (targetRequestRef.current === requestId) setTargetLoading(false);
    });
    torrentPreviewRequestRef.current += 1;
    setSourceMode("link");
    setUrl("");
    setTorrentFileName("");
    setTorrentPreview(null);
    setSelectedFileIndices([]);
    setResolvingTorrent(false);
    setFileName("");
    setSha256("");
    setFileNameEdited(false);
  }

  function closeCreateDialog() {
    if (submitting) return;
    targetRequestRef.current += 1;
    setTargetLoading(false);
    torrentPreviewRequestRef.current += 1;
    setResolvingTorrent(false);
    if (torrentPreview) {
      void deleteTorrentPreview(torrentPreview.id).catch(() => undefined);
    }
    setTorrentPreview(null);
    setSelectedFileIndices([]);
    onClose();
  }

  function handleCreateDialogKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === "Escape" && !event.defaultPrevented && !submitting) {
      event.preventDefault();
      closeCreateDialog();
      return;
    }
    if (event.key !== "Tab") return;

    const focusable = [...(createDialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      createDialogRef.current?.focus();
      return;
    }
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function updateUrl(value: string) {
    if (resolvingTorrent || torrentPreview) {
      torrentPreviewRequestRef.current += 1;
      if (torrentPreview) {
        void deleteTorrentPreview(torrentPreview.id).catch(() => undefined);
      }
      setTorrentPreview(null);
      setSelectedFileIndices([]);
      setResolvingTorrent(false);
    }
    setUrl(value);
    if (!fileNameEdited) {
      setFileName(isMagnetLink(value) ? "" : deriveFileName(value));
    }
  }

  function selectSourceMode(mode: DownloadSourceMode) {
    if (sourceMode === mode) return;
    torrentPreviewRequestRef.current += 1;
    if (torrentPreview) {
      void deleteTorrentPreview(torrentPreview.id).catch(() => undefined);
    }
    setSourceMode(mode);
    setUrl("");
    setTorrentFileName("");
    setTorrentPreview(null);
    setSelectedFileIndices([]);
    setResolvingTorrent(false);
    setFileName("");
    setSha256("");
    setFileNameEdited(false);
  }

  async function resolveTorrent(createPreview: () => Promise<TorrentPreview>) {
    if (torrentPreview) {
      void deleteTorrentPreview(torrentPreview.id).catch(() => undefined);
    }
    const requestId = torrentPreviewRequestRef.current + 1;
    torrentPreviewRequestRef.current = requestId;
    setResolvingTorrent(true);
    setTorrentPreview(null);
    setSelectedFileIndices([]);
    onNotifyError(null);
    try {
      let preview = await createPreview();
      if (torrentPreviewRequestRef.current !== requestId) return;
      setTorrentPreview(preview);
      while (preview.status === "queued" || preview.status === "resolving") {
        await delay(750);
        if (torrentPreviewRequestRef.current !== requestId) return;
        preview = await getTorrentPreview(preview.id);
        if (torrentPreviewRequestRef.current !== requestId) return;
        setTorrentPreview(preview);
      }
      if (preview.status !== "ready") {
        throw new Error(preview.error ?? t(`workspace.downloads.previewStatus.${preview.status}`));
      }
      setSelectedFileIndices(preview.files.map((file) => file.fileIndex));
      setFileName(preview.name?.trim() || "torrent");
      setFileNameEdited(false);
    } catch (error) {
      if (torrentPreviewRequestRef.current === requestId) {
        onNotifyError(errorMessage(error));
      }
    } finally {
      if (torrentPreviewRequestRef.current === requestId) {
        setResolvingTorrent(false);
      }
    }
  }

  function resolveMagnet() {
    const magnet = url.trim();
    if (!isMagnetLink(magnet) || resolvingTorrent) return;
    void resolveTorrent(() => createMagnetPreview(magnet));
  }

  function selectTorrentFile(file: File | undefined) {
    if (!file || resolvingTorrent) return;
    setTorrentFileName(file.name);
    void resolveTorrent(() => uploadTorrentPreview(file));
  }

  function handleDirectorySelection(selection: StorageFileSelection) {
    targetRequestRef.current += 1;
    setTargetLoading(false);
    setTargetError(null);
    setTarget(selection);
    onSelectStoragePool(selection.storagePoolId);
    setPickerOpen(false);
  }

  async function submitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!target || targetLoading || !fileName.trim() || !sourceReady || submitting) return;
    setSubmitting(true);
    onNotifyError(null);
    try {
      const task = torrentSource && torrentPreview?.status === "ready"
        ? await createTorrentDownload({
            torrentPreviewId: torrentPreview.id,
            selectedFileIndices,
            storagePoolId: target.storagePoolId,
            targetDirectory: target.path,
            fileName: fileName.trim(),
            seedRatioLimit: 1,
            seedTimeLimitSeconds: 7_200
          })
        : await createDownload({
            url: url.trim(),
            storagePoolId: target.storagePoolId,
            targetDirectory: target.path,
            fileName: fileName.trim(),
            ...(sha256.trim() ? { sha256: sha256.trim() } : {})
          });
      onCreated(task);
      torrentPreviewRequestRef.current += 1;
      setTorrentPreview(null);
      setSelectedFileIndices([]);
      onClose();
      onNotifySuccess(t("workspace.downloads.created"));
    } catch (error) {
      onNotifyError(errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  return (<>
        <ModalPortal className="management-dialog-backdrop" role="presentation" onRequestClose={closeCreateDialog} closeDisabled={submitting} onMouseDown={(event) => event.currentTarget === event.target && closeCreateDialog()}>
          <form
            ref={createDialogRef}
            className="management-dialog download-create-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="download-create-title"
            tabIndex={-1}
            onKeyDown={handleCreateDialogKeyDown}
            onSubmit={(event) => void submitCreate(event)}
          >
            <DialogHeader className="download-create-dialog-header" title={t("workspace.downloads.newDownload")} description={t("workspace.downloads.createDescription")} headingLevel={3} headingId="download-create-title" actions={<><span className="download-create-dialog-icon" aria-hidden="true"><Download size={19} /></span><span className="eyebrow">{t("workspace.downloads.eyebrow")}</span><UiButton variant="ghost" iconOnly type="button" className="management-icon-action" onClick={closeCreateDialog} disabled={submitting} aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")}>
                <X aria-hidden="true" size={16} />
              </UiButton></>} />
            <div className="download-create-form">
              <section className="download-form-section">
                <div className="download-form-section-heading">
                  <span>01</span>
                  <div>
                    <h4>{t("workspace.downloads.sourceTitle")}</h4>
                    <p>{t("workspace.downloads.sourceDescription")}</p>
                  </div>
                </div>
                <div className="download-source-modes" role="tablist" aria-label={t("workspace.downloads.sourceModeLabel")}>
                  <UiButton variant="ghost" type="button" role="tab" aria-selected={sourceMode === "link"} className={sourceMode === "link" ? "is-active" : ""} onClick={() => selectSourceMode("link")}>
                    <Link2 aria-hidden="true" size={14} />
                    <span>{t("workspace.downloads.sourceMode.link")}</span>
                  </UiButton>
                  <UiButton variant="ghost" type="button" role="tab" aria-selected={sourceMode === "torrent-file"} className={sourceMode === "torrent-file" ? "is-active" : ""} onClick={() => selectSourceMode("torrent-file")}>
                    <FileUp aria-hidden="true" size={14} />
                    <span>{t("workspace.downloads.sourceMode.torrentFile")}</span>
                  </UiButton>
                </div>
                {sourceMode === "link" ? (
                  <div className="download-source-input-row">
                    <Field className="download-form-field download-form-field-wide" label={t("workspace.downloads.link")}>

                      <Input
                        ref={createUrlInputRef}
                        type="text"
                        inputMode="url"
                        value={url}
                        onChange={(event) => updateUrl(event.target.value)}
                        placeholder={t("workspace.downloads.linkPlaceholder")}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                      />
                    </Field>
                    {isMagnetLink(url) ? (
                      <UiButton variant="secondary" type="button" className="secondary-button download-resolve-button" disabled={resolvingTorrent || torrentReady} aria-busy={resolvingTorrent || undefined} onClick={resolveMagnet}>
                        {resolvingTorrent ? <LoaderCircle className="is-spinning" aria-hidden="true" size={14} /> : <Magnet aria-hidden="true" size={14} />}
                        <span>{t(torrentReady ? "workspace.downloads.metadataReady" : "workspace.downloads.resolveMetadata")}</span>
                      </UiButton>
                    ) : null}
                  </div>
                ) : (
                  <div className="download-torrent-upload">
                    <input
                      ref={torrentFileInputRef}
                      type="file"
                      accept=".torrent,application/x-bittorrent"
                      hidden
                      onChange={(event) => {
                        selectTorrentFile(event.target.files?.[0]);
                        event.target.value = "";
                      }}
                    />
                    <UiButton variant="ghost" type="button" className="download-torrent-pick" disabled={resolvingTorrent} aria-busy={resolvingTorrent || undefined} onClick={() => torrentFileInputRef.current?.click()}>
                      {resolvingTorrent ? <LoaderCircle className="is-spinning" aria-hidden="true" size={16} /> : <FileArchive aria-hidden="true" size={16} />}
                      <span>{torrentFileName || t("workspace.downloads.chooseTorrentFile")}</span>
                    </UiButton>
                    <small>{t("workspace.downloads.torrentFileHint")}</small>
                  </div>
                )}
                {torrentPreview ? (
                  <div className="download-preview-status" data-status={torrentPreview.status} role="status">
                    {resolvingTorrent ? <LoaderCircle className="is-spinning" aria-hidden="true" size={15} /> : torrentPreview.status === "ready" ? <CheckCircle2 aria-hidden="true" size={15} /> : <CircleAlert aria-hidden="true" size={15} />}
                    <div>
                      <strong>{t(`workspace.downloads.previewStatus.${torrentPreview.status}`)}</strong>
                      <span>{torrentPreview.status === "ready"
                        ? t("workspace.downloads.previewSummary", { name: torrentPreview.name ?? t("workspace.downloads.sourceKind.torrent"), count: torrentPreview.fileCount, size: formatBytes(torrentPreview.totalBytes ?? 0, locale) })
                        : torrentPreview.error ?? t("workspace.downloads.previewWaiting")}</span>
                    </div>
                  </div>
                ) : null}
                {torrentPreview?.status === "ready" ? (
                  <TorrentFileSelector
                    files={torrentPreview.files}
                    selectedFileIndices={selectedFileIndices}
                    locale={locale}
                    disabled={submitting}
                    onChange={setSelectedFileIndices}
                  />
                ) : null}
                <Field className="download-form-field" label={t(torrentSource ? "workspace.downloads.outputFolderName" : "workspace.downloads.fileName")} hint={t(torrentSource ? "workspace.downloads.outputFolderHint" : "workspace.downloads.fileNameHint")}>

                  <Input value={fileName} onChange={(event) => { setFileNameEdited(true); setFileName(event.target.value); }} />

                </Field>
                {!torrentSource ? <Field className="download-form-field download-form-field-wide" label={t("workspace.downloads.sha256")} hint={t("workspace.downloads.sha256Hint")}>

                  <Input
                    value={sha256}
                    onChange={(event) => setSha256(event.target.value)}
                    placeholder={t("workspace.downloads.sha256Placeholder")}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                  />

                </Field> : null}
                {torrentReady ? <p className="download-seeding-policy">{t("workspace.downloads.seedingPolicy")}</p> : null}
              </section>

              <section className="download-form-section">
                <div className="download-form-section-heading">
                  <span>02</span>
                  <div>
                    <h4>{t("workspace.downloads.destinationTitle")}</h4>
                    <p>{t("workspace.downloads.destinationDescription")}</p>
                  </div>
                </div>
                <div className="download-target-field">
                  <span>{t("workspace.downloads.targetDirectory")}</span>
                  <div className="download-target-control" aria-busy={targetLoading || undefined}>
                    <div className="download-target-value" data-tooltip={target?.path ?? undefined}>
                      <FolderOpen aria-hidden="true" size={15} />
                      <span>{targetLoading ? t("common.states.loading") : target?.path ?? t("workspace.downloads.chooseDirectory")}</span>
                    </div>
                    <UiButton variant="ghost" ref={targetButtonRef} type="button" onClick={() => setPickerOpen(true)} disabled={!mountedPools.length}>
                      <FolderOpen aria-hidden="true" size={15} />
                      <span>{t("workspace.downloads.chooseDirectory")}</span>
                    </UiButton>
                  </div>
                  <small>{selectedPool?.name ?? t("workspace.downloads.noStoragePool")}</small>
                  {targetError ? <p role="alert">{targetError}</p> : null}
                </div>
              </section>
            </div>
            <DialogActions className="download-create-dialog-footer">
              <UiButton variant="secondary" type="button" className="secondary-button" onClick={closeCreateDialog} disabled={submitting}>{t("common.actions.cancel")}</UiButton>
              <UiButton variant="primary" type="submit" className="primary-button" disabled={submitting || targetLoading || !target || !sourceReady || !fileName.trim()} aria-busy={submitting || undefined}>
                {submitting ? <LoaderCircle className="is-spinning" aria-hidden="true" size={15} /> : <Download aria-hidden="true" size={15} />}
                <span>{t("workspace.downloads.startDownload")}</span>
              </UiButton>
            </DialogActions>
          </form>
        </ModalPortal>

      {pickerOpen ? (
        <StorageFilePickerDialog
          pools={mountedPools}
          initialPoolId={target?.storagePoolId ?? selectedStoragePoolId}
          {...(target ? { initialPath: target.path } : {})}
          locale={locale}
          mode="directory"
          returnFocusRef={targetButtonRef}
          onCancel={() => setPickerOpen(false)}
          onSelect={handleDirectorySelection}
          {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
        />
      ) : null}
  </>);
}

export function TorrentFileSelector({
  files,
  selectedFileIndices,
  locale,
  disabled,
  onChange
}: {
  files: TorrentPreview["files"];
  selectedFileIndices: number[];
  locale: SupportedLocale;
  disabled: boolean;
  onChange: (fileIndices: number[]) => void;
}) {
  const { t } = useTranslation();
  const selected = new Set(selectedFileIndices);
  const allSelected = files.length > 0 && files.every((file) => selected.has(file.fileIndex));
  const selectedBytes = files.reduce((sum, file) => selected.has(file.fileIndex) ? sum + file.sizeBytes : sum, 0);
  const sortedSelection = (values: number[]) => [...values].sort((left, right) => left - right);

  return (
    <div className="torrent-file-selector" aria-label={t("workspace.downloads.torrentFiles")}>
      <div className="torrent-file-selector-toolbar">
        <label>
          <Checkbox

            checked={allSelected}
            disabled={disabled || files.length === 0}
            onChange={(event) => onChange(event.target.checked ? files.map((file) => file.fileIndex) : [])}
          />
          <span>{t("workspace.downloads.selectAllFiles")}</span>
        </label>
        <span>{t("workspace.downloads.fileSelectionSummary", {
          selected: selected.size,
          total: files.length,
          size: formatBytes(selectedBytes, locale)
        })}</span>
      </div>
      <div className="torrent-file-list">
        {files.map((file) => (
          <label key={file.fileIndex} data-tooltip={file.path}>
            <Checkbox

              checked={selected.has(file.fileIndex)}
              disabled={disabled}
              onChange={(event) => {
                const next = new Set(selected);
                if (event.target.checked) next.add(file.fileIndex);
                else next.delete(file.fileIndex);
                onChange(sortedSelection([...next]));
              }}
            />
            <span>{file.path}</span>
            <small>{formatBytes(file.sizeBytes, locale)}</small>
          </label>
        ))}
      </div>
    </div>
  );
}

function deriveFileName(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    const candidate = decodeURIComponent(url.pathname.split("/").filter(Boolean).at(-1) ?? "").trim();
    if (
      !candidate ||
      candidate === "." ||
      candidate === ".." ||
      candidate.includes("/") ||
      candidate.includes("\\")
    ) {
      return "download";
    }
    return candidate.length <= 255 ? candidate : `${candidate.slice(0, 252)}...`;
  } catch {
    return "download";
  }
}

function isMagnetLink(value: string): boolean {
  return value.trim().toLowerCase().startsWith("magnet:");
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
