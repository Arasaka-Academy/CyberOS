import { Button as UiButton, Field, Input, Section } from "@cyberos/ui";
import { FormEvent, useEffect, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Check, Database, LoaderCircle, RefreshCw } from "lucide-react";
import type { IndexerOverview, IndexerSettings, StoragePool } from "../../api.js";
import { Switch } from "../common/Switch.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";

type IndexerSettingsDraft = Omit<IndexerSettings, "updatedAt">;

export function SettingsIndexerPage({
  settings,
  status,
  statusLoading = false,
  storagePools,
  loading,
  onSettingsChange,
  onReindex,
  onClose
}: {
  settings: IndexerSettings | null;
  status: IndexerOverview | null;
  statusLoading?: boolean;
  storagePools: StoragePool[];
  loading: boolean;
  onSettingsChange: (patch: Partial<IndexerSettingsDraft>) => Promise<void>;
  onReindex: (storagePoolId: string) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<IndexerSettingsDraft>(() => indexerSettingsDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [reindexingStoragePoolId, setReindexingStoragePoolId] = useState<string | null>(null);

  useEffect(() => {
    setDraft(indexerSettingsDraft(settings));
    setSaved(false);
  }, [settings]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading || saving || !settings) return;
    setSaving(true);
    setSaved(false);
    try {
      await onSettingsChange(draft);
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function reindex(storagePoolId: string) {
    if (reindexingStoragePoolId) return;
    setReindexingStoragePoolId(storagePoolId);
    try {
      await onReindex(storagePoolId);
    } finally {
      setReindexingStoragePoolId(null);
    }
  }

  const disabled = loading || saving || !settings;
  return (
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <div className="settings-content-body">
        <div className="settings-page-grid settings-indexer-grid">
            <Section className="settings-section-card" title={t("settings.indexer.workersTitle")} description={t("settings.indexer.workersDescription")}>

              <fieldset className="settings-field-grid" disabled={disabled}>
                <NumberField label={t("settings.indexer.scanConcurrency")} value={draft.scanConcurrency} min={1} max={16} onChange={(value) => setDraft((current) => ({ ...current, scanConcurrency: value }))} />
                <NumberField label={t("settings.indexer.extractionConcurrency")} value={draft.extractionConcurrency} min={1} max={8} onChange={(value) => setDraft((current) => ({ ...current, extractionConcurrency: value }))} />
                <NumberField label={t("settings.indexer.reconciliationMinutes")} value={draft.reconciliationIntervalMs / 60_000} min={1} max={1440} onChange={(value) => setDraft((current) => ({ ...current, reconciliationIntervalMs: value * 60_000 }))} />
                <NumberField label={t("settings.indexer.commandTimeoutSeconds")} value={draft.commandTimeoutMs / 1000} min={5} max={900} onChange={(value) => setDraft((current) => ({ ...current, commandTimeoutMs: value * 1000 }))} />
              </fieldset>
            </Section>

            <Section className="settings-section-card" title={t("settings.indexer.limitsTitle")} description={t("settings.indexer.limitsDescription")}>

              <fieldset className="settings-field-grid" disabled={disabled}>
                <NumberField label={t("settings.indexer.textLimitMiB")} value={draft.maxExtractedTextBytes / 1024 ** 2} min={0.0625} max={16} step={0.0625} onChange={(value) => setDraft((current) => ({ ...current, maxExtractedTextBytes: Math.round(value * 1024 ** 2) }))} />
                <NumberField label={t("settings.indexer.documentLimitMiB")} value={draft.maxSourceDocumentBytes / 1024 ** 2} min={1} max={2 * 1024 ** 2} onChange={(value) => setDraft((current) => ({ ...current, maxSourceDocumentBytes: Math.round(value * 1024 ** 2) }))} />
                <NumberField label={t("settings.indexer.pdfPages")} value={draft.maxPdfTextPages} min={1} max={5000} onChange={(value) => setDraft((current) => ({ ...current, maxPdfTextPages: value }))} />
                <NumberField label={t("settings.indexer.ocrPages")} value={draft.maxOcrPages} min={1} max={100} onChange={(value) => setDraft((current) => ({ ...current, maxOcrPages: value }))} />
              </fieldset>
            </Section>

            <Section className="settings-section-card" title={t("settings.indexer.storagePoolsTitle")} description={t("settings.indexer.storagePoolsDescription")}>

              <div className="settings-indexer-storage-pools">
                {storagePools.map((storagePool) => {
                  const ocrEnabled = draft.ocrStoragePoolIds.includes(storagePool.id);
                  const rebuilding = reindexingStoragePoolId === storagePool.id;
                  return (
                    <div key={storagePool.id} className="settings-indexer-storage-pool">
                      <span>
                        <strong>{storagePool.name}</strong>
                        <small>{storagePool.mountpoint ?? storagePool.id}</small>
                      </span>
                      <Switch
                        className="settings-indexer-ocr"
                        compact
                        checked={ocrEnabled}
                        disabled={disabled}
                        label={t("settings.indexer.ocr")}
                        onCheckedChange={(checked) => setDraft((current) => ({
                            ...current,
                            ocrStoragePoolIds: checked
                              ? [...new Set([...current.ocrStoragePoolIds, storagePool.id])]
                              : current.ocrStoragePoolIds.filter((storagePoolId) => storagePoolId !== storagePool.id)
                          }))}
                      />
                      <UiButton variant="secondary"
                        type="button"
                        className="secondary-button settings-indexer-rebuild"
                        disabled={loading || Boolean(reindexingStoragePoolId)}
                        aria-busy={rebuilding || undefined}
                        onClick={() => void reindex(storagePool.id)}
                      >
                        <RefreshCw aria-hidden="true" size={14} className={rebuilding ? "is-spinning" : undefined} />
                        {t("settings.indexer.reindex")}
                      </UiButton>
                    </div>
                  );
                })}
              </div>
            </Section>

          <Section className="settings-section-card settings-indexer-status" aria-label={t("settings.indexer.statusTitle")} title={t("settings.indexer.statusTitle")} description={t("settings.indexer.statusDescription")} icon={<Database aria-hidden="true" size={17} />}>

            {statusLoading ? <PanelContentSkeleton /> : <dl className="settings-summary-list settings-indexer-status-list">
              <StatusRow label={t("settings.indexer.service")} value={status ? t(`settings.indexer.states.${status.service.status}`) : t("common.states.unavailable")} />
              <StatusRow label={t("settings.indexer.watcher")} value={status ? t(`settings.indexer.states.${status.watcher.status}`) : t("common.states.unavailable")} />
              <StatusRow label={t("settings.indexer.queue")} value={status ? t("settings.indexer.queueSummary", { queued: status.queue.queued, running: status.queue.running, failed: status.queue.failed }) : t("common.states.unavailable")} />
              <StatusRow label={t("settings.indexer.contentIndex")} value={status ? t("settings.indexer.contentIndexSummary", { ready: status.rebuild.storagePoolsReady, total: status.rebuild.storagePoolsTotal }) : t("common.states.unavailable")} />
            </dl>}
          </Section>
        </div>
      </div>

      <footer className="settings-actions">
        <span role="status">
          {saving
            ? t("common.actions.saving")
            : saved
              ? t("settings.indexer.saved")
              : !loading && !settings
                ? t("settings.indexer.notLoaded")
                : null}
        </span>
        <div>
          <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose} disabled={saving}>{t("common.actions.cancel")}</UiButton>
          <UiButton variant="primary" className="primary-button" type="submit" disabled={disabled} aria-busy={saving || undefined}>
            {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
            {t("common.actions.saveChanges")}
          </UiButton>
        </div>
      </footer>
    </form>
  );
}

function NumberField({ label, value, min, max, step = 1, onChange }: {
  label: ReactNode;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (value: number) => void;
}) {
  return (
    <Field className="settings-preference-field" label={label}>

      <Input type="number" value={value} min={min} max={max} step={step} onChange={(event) => onChange(Number(event.target.value))} />
    </Field>
  );
}

function StatusRow({ label, value }: { label: ReactNode; value: ReactNode }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function indexerSettingsDraft(settings: IndexerSettings | null): IndexerSettingsDraft {
  if (settings) {
    const { updatedAt: _updatedAt, ...draft } = settings;
    return draft;
  }
  return {
    scanConcurrency: 4,
    extractionConcurrency: 2,
    reconciliationIntervalMs: 30 * 60_000,
    maxExtractedTextBytes: 2 * 1024 ** 2,
    maxSourceDocumentBytes: 512 * 1024 ** 2,
    commandTimeoutMs: 120_000,
    maxPdfTextPages: 500,
    maxOcrPages: 20,
    ocrStoragePoolIds: []
  };
}
