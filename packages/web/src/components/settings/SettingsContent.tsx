import { Button as UiButton, DescriptionList, DialogActions, Field, Input, Notice, Section } from "@cyberos/ui";
import { useMobileNavigation } from "../../mobile/MobileNavigation.js";
import { PowerControl } from "../power/PowerControl.js";
import { FormEvent, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { PhotosSemanticSettingsCard } from "./PhotosSemanticSettingsCard.js";
import { SettingsSecretField } from "./SettingsSecretField.js";
import { systemProxyUrl, type SystemProxySettingsRecord } from "@cyberos/shared";
import { getSystemProxySettings } from "../../api.js";
import { AlertTriangle, Check, Cpu, Download, Folder, HardDrive, LoaderCircle, MemoryStick, MonitorCog, Server } from "lucide-react";
import type { AgentCapabilityId, DownloadSettings, PhotoLibrarySettings, PhotoLibraryStatus, PhotoProcessingSettings, SystemInfo } from "../../api.js";
import { AGENT_CAPABILITY_POLICY_OPTIONS, providerLabel, type VmSettingsFormState, type ToolPolicyFormState } from "../../config/settings.js";
import { formatBytes, formatLocaleNumber } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { Switch } from "../common/Switch.js";
import { HelpLabel, HelpTip } from "../common/HelpTip.js";
import { VersionSettingsPage } from "./VersionSettingsPage.js";
import { SettingsIndexerPage } from "./SettingsIndexerPage.js";
import { SettingsOperationsPage } from "./SettingsOperationsPage.js";
import { SettingsAlertsPage } from "./SettingsAlertsPage.js";
import { SettingsWirelessPage } from "./SettingsWirelessPage.js";
import { SettingsProxyPage } from "./SettingsProxyPage.js";
import { SettingsTailscalePage } from "./SettingsTailscalePage.js";
import { SettingsAudioPage } from "./SettingsAudioPage.js";
import { SettingsDockerPage } from "./SettingsDockerPage.js";
import { SettingsBluetoothPage } from "./SettingsBluetoothPage.js";
import { SettingsMediaPage } from "./SettingsMediaPage.js";
import { SettingsSystemProfilePage } from "./SettingsSystemProfilePage.js";
import { SettingsMonitoringPage } from "./SettingsMonitoringPage.js";
import { SettingsBackupPage } from "./SettingsBackupPage.js";
import { SettingsSharesPage } from "./SettingsSharesPage.js";
import { SettingsMcpPage } from "./SettingsMcpPage.js";
import { SettingsSkillsPage } from "./SettingsSkillsPage.js";
import { StorageFilePickerDialog, type StorageFilePickerPool, type StorageFileSelection } from "../workspace/StorageFilePickerDialog.js";

import type { SettingsModalProps } from "./SettingsTypes.js";
import { settingsSectionResources } from "./settings-resources.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";

const PROVIDER_OPTIONS = ["openai", "anthropic"] as const;
const READ_ONLY_CAPABILITIES: AgentCapabilityId[] = [
  "cyberos.files.list", "cyberos.files.read", "cyberos.files.search", "cyberos.files.grep", "cyberos.files.find"
];
const MUTATING_CAPABILITIES: AgentCapabilityId[] = [
  "cyberos.files.mutate", "cyberos.files.edit", "cyberos.files.write", "cyberos.shell.run"
];
const CAPABILITY_DESCRIPTION_KEY = {
  "cyberos.files.list": "list",
  "cyberos.files.read": "read",
  "cyberos.files.search": "search",
  "cyberos.files.grep": "grep",
  "cyberos.files.find": "find",
  "cyberos.files.mutate": "mutate",
  "cyberos.files.edit": "edit",
  "cyberos.files.write": "write",
  "cyberos.shell.run": "shell"
} as const satisfies Record<AgentCapabilityId, string>;
type Translate = (key: string, options?: Record<string, unknown>) => unknown;

export function SettingsContent({
  activeSection,
  resourceStates,
  onResourceRetry,
  activeSessionId,
  form,
  dockerForm,
  loading,
  saving,
  downloadSettings,
  indexerSettings,
  indexerStatus,
  storagePools,
  photoSettings,
  photoStatus,
  photoProcessingSettings,
  settings,
  systemInfo,
  buildInfo,
  buildInfoError,
  toolPolicyForm,
  networkSummary,
  bluetoothStatus,
  resolvedLocale,
  onClose,
  onRequestSystemPower,
  onFormChange,
  onDockerFormChange,
  vmForm,
  onVmFormChange,
  onDownloadSettingsChange,
  onIndexerSettingsChange,
  onIndexerReindex,
  onPhotoLibrarySettingsChange,
  onPhotoProcessingSettingsChange,
  onRequestCreateFolder,
  onToolPolicyFormChange,
  onWifiStatus,
  onBluetoothStatus,
  onNetworkRefresh,
  onNotifySuccess,
  onOpenVoiceSession,
  onNotifyError,
  onSectionChange,
  onSubmit
}: SettingsModalProps) {
  const { t } = useTranslation();
  const compact = useMobileNavigation()?.compact ?? false;
  const required = activeSection === "photos" ? [] : activeSection === "indexer" ? ["indexerSettings" as const] : settingsSectionResources(activeSection);
  if (resourceStates && required.some(key => ["idle", "loading"].includes(resourceStates[key].status))) return <div className="settings-content-body" aria-busy="true"><PanelContentSkeleton /></div>;
  if (resourceStates && required.some(key => resourceStates[key].status === "error")) return null;
  const providerOptions = PROVIDER_OPTIONS.map(provider => ({ value: provider, label: providerLabel(provider, t) }));
  return <>
          {activeSection === "overview" ? (
            <SettingsOverview
              systemInfo={systemInfo}
              loading={loading}
              locale={resolvedLocale}
              onRetry={() => onResourceRetry?.("systemInfo")}
            />
          ) : null}

          {activeSection === "model-providers" ? (
            <form className="settings-form" onSubmit={onSubmit}>
              <div className="settings-content-body">
                <div className="settings-page-grid settings-provider-grid">
                  <Section className="settings-section-card" title={t("settings.modelProvider.profileTitle")} description={t("settings.modelProvider.profileDescription")}>


                    <fieldset className="settings-field-grid" disabled={loading || saving}>
                      <Field className="settings-preference-field" htmlFor="model-provider" label={t("settings.modelProvider.provider")}>
                        <CustomSelect
                          id="model-provider"
                          value={form.providerName}
                          options={providerOptions}
                          onChange={(providerName) =>
                            onFormChange({
                              ...form,
                              providerName
                            })
                          }
                          ariaLabel={t("settings.modelProvider.provider")}
                        />
                      </Field>

                      <Field className="settings-field-wide" label={t("settings.modelProvider.baseUrl")}>

                        <Input
                          value={form.baseUrl}
                          onChange={(event) =>
                            onFormChange({
                              ...form,
                              baseUrl: event.target.value
                            })
                          }
                          placeholder="https://api.example.com/v1"
                        />
                      </Field>

                      <Field className="settings-field-wide" label={t("settings.modelProvider.model")}>

                        <Input
                          value={form.model}
                          onChange={(event) =>
                            onFormChange({
                              ...form,
                              model: event.target.value
                            })
                          }
                          placeholder="provider/model-name"
                        />
                      </Field>
                    </fieldset>
                  </Section>

                  <Section className="settings-section-card" title={t("settings.modelProvider.credentialsTitle")} description={t("settings.modelProvider.credentialsDescription")}>


                    <fieldset className="settings-field-grid settings-field-grid-single" disabled={loading || saving}>
                      <SettingsSecretField
                        id="model-provider-api-key"
                        label={t("settings.modelProvider.apiKey")}
                        help={t("settings.modelProvider.apiKeyNote")}
                        value={form.apiKey}
                        configured={settings?.apiKeyConfigured ?? false}
                        clearSaved={form.clearApiKey}
                        placeholder={settings?.apiKeyConfigured
                          ? t("settings.modelProvider.configuredPlaceholder")
                          : t("settings.modelProvider.notConfiguredPlaceholder")}
                        clearLabel={t("settings.modelProvider.clearApiKey")}
                        onChange={(apiKey, clearApiKey) => onFormChange({ ...form, apiKey, clearApiKey })}
                      />
                    </fieldset>

                  </Section>
                </div>
              </div>

              <DialogActions className="settings-actions">
                <span role="status">{saving ? t("common.actions.saving") : null}</span>
                <div>
                  <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose}>
                    {t("common.actions.cancel")}
                  </UiButton>
                  <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving} aria-busy={loading || saving || undefined}>
                    {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
                    {t("common.actions.saveChanges")}
                  </UiButton>
                </div>
              </DialogActions>
            </form>
          ) : null}

          {activeSection === "version" ? (
            <VersionSettingsPage
              buildInfo={buildInfo}
              error={buildInfoError}
              loading={loading}
              locale={resolvedLocale}
            />
          ) : null}

          {activeSection === "system-profile" ? <><SettingsSystemProfilePage />{compact && onRequestSystemPower ? <section className="settings-power-section"><PowerControl labelled onRequest={onRequestSystemPower} /></section> : null}</> : null}

          {activeSection === "pi-agent" ? (
            <SettingsToolPolicyPage
              form={toolPolicyForm}
              loading={loading}
              saving={saving}
              onChange={onToolPolicyFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "mcp" ? <SettingsMcpPage /> : null}

          {activeSection === "audio" ? <SettingsAudioPage onNotifySuccess={onNotifySuccess} {...(onOpenVoiceSession ? { onOpenVoiceSession } : {})} /> : null}

          {activeSection === "skills" ? (
            <SettingsSkillsPage activeSessionId={activeSessionId} storagePools={storagePools} locale={resolvedLocale} />
          ) : null}

          {activeSection === "wireless" ? (
            <SettingsWirelessPage
              network={networkSummary}
              onStatus={onWifiStatus}
              onRefresh={onNetworkRefresh}
              onNotifySuccess={onNotifySuccess}
              onNotifyError={onNotifyError}
            />
          ) : null}

          {activeSection === "bluetooth" ? (
            <SettingsBluetoothPage
              status={bluetoothStatus}
              pools={storagePools}
              locale={resolvedLocale}
              onStatus={onBluetoothStatus}
              onNotifySuccess={onNotifySuccess}
              onNotifyError={onNotifyError}
            />
          ) : null}

          {activeSection === "proxy" ? <SettingsProxyPage onNotifySuccess={onNotifySuccess} /> : null}
          {activeSection === "tailscale" ? <SettingsTailscalePage onNotifySuccess={onNotifySuccess} /> : null}

          {activeSection === "docker" ? (
            <SettingsDockerPage
              form={dockerForm}
              loading={loading}
              saving={saving}
              onChange={onDockerFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
              onNotifySuccess={onNotifySuccess}
            />
          ) : null}

          {activeSection === "virtual-machines" ? (
            <SettingsVmPage
              form={vmForm}
              loading={loading}
              saving={saving}
              onChange={onVmFormChange}
              onSubmit={onSubmit}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "shares" ? (
            <SettingsSharesPage
              onNotifySuccess={onNotifySuccess}
              onNotifyError={onNotifyError}
            />
          ) : null}

          {activeSection === "downloads" ? (
            <SettingsDownloadsPage
              settings={downloadSettings}
              loading={loading}
              storagePools={storagePools}
              locale={resolvedLocale}
              onRequestCreateFolder={onRequestCreateFolder}
              onSettingsChange={onDownloadSettingsChange}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "indexer" ? (
            <SettingsIndexerPage
              settings={indexerSettings}
              status={resourceStates && resourceStates.indexerStatus.status !== "ready" ? null : indexerStatus}
              statusLoading={resourceStates ? ["idle", "loading"].includes(resourceStates.indexerStatus.status) : false}
              storagePools={storagePools}
              loading={loading}
              onSettingsChange={onIndexerSettingsChange}
              onReindex={onIndexerReindex}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "operations" ? (
            <SettingsOperationsPage locale={resolvedLocale} onClose={onClose} />
          ) : null}

          {activeSection === "monitoring" ? <SettingsMonitoringPage /> : null}

          {activeSection === "backup" ? <SettingsBackupPage locale={resolvedLocale} /> : null}

          {activeSection === "alerts" ? (
            <SettingsAlertsPage locale={resolvedLocale} />
          ) : null}

          {activeSection === "photos" ? (
            <SettingsPhotosPage
              settings={resourceStates && resourceStates.photoLibrary.status !== "ready" ? null : photoSettings}
              status={resourceStates && resourceStates.photoStatus.status !== "ready" ? null : photoStatus}
              processingSettings={resourceStates && resourceStates.photoProcessing.status !== "ready" ? null : photoProcessingSettings}
              libraryReady={!resourceStates || resourceStates.photoLibrary.status === "ready"}
              processingReady={!resourceStates || resourceStates.photoProcessing.status === "ready"}
              libraryLoading={resourceStates ? ["idle", "loading"].includes(resourceStates.photoLibrary.status) : false}
              processingLoading={resourceStates ? ["idle", "loading"].includes(resourceStates.photoProcessing.status) : false}
              statusLoading={resourceStates ? ["idle", "loading"].includes(resourceStates.photoStatus.status) : false}
              storagePools={storagePools}
              locale={resolvedLocale}
              loading={loading}
              onLibrarySettingsChange={onPhotoLibrarySettingsChange}
              onSettingsChange={onPhotoProcessingSettingsChange}
              onOpenProxy={() => onSectionChange("proxy")}
              onRequestCreateFolder={onRequestCreateFolder}
              onClose={onClose}
            />
          ) : null}

          {activeSection === "media" ? (
            <SettingsMediaPage
              pools={storagePools}
              locale={resolvedLocale}
              onNotifySuccess={onNotifySuccess}
              onNotifyError={onNotifyError}
              onOpenProxy={() => onSectionChange("proxy")}
            />
          ) : null}

  </>;
}

function SettingsOverview({
  systemInfo,
  loading,
  locale,
  onRetry,
}: {
  systemInfo: SystemInfo | null;
  loading: boolean;
  locale: SupportedLocale;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  const unavailable = String(t("common.dash"));
  const volumeErrors = systemInfo?.storage.volumes.filter(volume => volume.status === "error" && volume.error) ?? [];
  const metricItems = [
    {
      value: systemInfo?.identity.hostname ?? String(t("common.dash")),
      label: t("settings.system.labels.hostname")
    },
    {
      value: systemInfo
        ? `${systemInfo.operatingSystem.type} ${systemInfo.operatingSystem.release}`
        : String(t("common.dash")),
      label: t("settings.system.labels.os")
    },
    {
      value: systemInfo
        ? formatDuration(systemInfo.operatingSystem.uptimeSeconds, locale, t)
        : String(t("common.dash")),
      label: t("settings.system.metrics.uptime")
    }
  ];
  const hardwareRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.cpuModel"),
      value: systemInfo?.hardware.cpuModel ?? unavailable
    },
    {
      label: t("settings.system.labels.architecture"),
      value: systemInfo
        ? `${systemInfo.operatingSystem.arch} / ${systemInfo.operatingSystem.machine}`
        : unavailable
    },
    {
      label: t("settings.system.labels.cpuThreads"),
      value: systemInfo ? formatLocaleNumber(systemInfo.hardware.cpuThreads, locale) : unavailable
    },
    {
      label: t("settings.system.labels.cpuSpeed"),
      value: systemInfo?.hardware.cpuSpeedMHz === null || systemInfo?.hardware.cpuSpeedMHz === undefined
        ? unavailable
        : t("settings.system.values.megahertz", {
            value: formatLocaleNumber(systemInfo.hardware.cpuSpeedMHz, locale)
          })
    },
    {
      label: t("settings.system.labels.physicalMemory"),
      value: systemInfo ? formatBytes(systemInfo.hardware.memory.totalBytes, locale) : unavailable
    }
  ];
  const runtimeMemory = systemInfo?.runtime.memory;
  const serviceRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.apiBind"),
      value: systemInfo ? `${systemInfo.cyberos.apiHost}:${systemInfo.cyberos.apiPort}` : unavailable
    },
    {
      label: t("settings.system.labels.allowedOrigins"),
      value: systemInfo ? formatLocaleNumber(systemInfo.cyberos.allowedOriginCount, locale) : unavailable
    },
    {
      label: t("settings.system.labels.workerPoll"),
      value: systemInfo
        ? t("settings.system.values.milliseconds", {
            value: formatLocaleNumber(systemInfo.cyberos.workerPollMs, locale)
          })
        : unavailable
    },
    {
      label: t("settings.system.labels.authMode"),
      value: systemInfo?.identity.authMode ?? unavailable
    }
  ];
  const processRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.nodeVersion"),
      value: systemInfo?.runtime.nodeVersion ?? unavailable
    },
    {
      label: t("settings.system.labels.pid"),
      value: systemInfo ? formatLocaleNumber(systemInfo.runtime.pid, locale) : unavailable
    },
    {
      label: t("settings.system.labels.processUptime"),
      value: systemInfo ? formatDuration(systemInfo.runtime.uptimeSeconds, locale, t) : unavailable
    },
    {
      label: t("settings.system.labels.rss"),
      value: runtimeMemory ? formatBytes(runtimeMemory.rssBytes, locale) : unavailable
    },
    {
      label: t("settings.system.labels.heapUsed"),
      value: runtimeMemory
        ? `${formatBytes(runtimeMemory.heapUsedBytes, locale)} / ${formatBytes(runtimeMemory.heapTotalBytes, locale)}`
        : unavailable
    },
    {
      label: t("settings.system.labels.cwd"),
      value: systemInfo?.runtime.cwd ?? unavailable,
      mono: true
    },
    {
      label: t("settings.system.labels.execPath"),
      value: systemInfo?.runtime.execPath ?? unavailable,
      mono: true
    }
  ];
  const pathRows: SettingsInfoRow[] = [
    {
      label: t("settings.system.labels.stateDir"),
      value: systemInfo?.cyberos.stateDir ?? unavailable,
      mono: true
    },
    {
      label: t("settings.system.labels.databasePath"),
      value: systemInfo?.cyberos.databasePath ?? unavailable,
      mono: true
    }
  ];

  return (
    <div className="settings-content-body settings-overview">
      <Section className="settings-section-card settings-identity-card" icon={<MonitorCog aria-hidden="true" size={18} />} title={t("settings.overview.systemProfile")} description={t("settings.overview.systemProfileDescription")}>

        <div className="settings-metric-grid settings-system-metric-grid">
          {metricItems.map((item) => (
            <article key={String(item.label)}>
              <strong>{item.value}</strong>
              <span>{item.label}</span>
            </article>
          ))}
        </div>
      </Section>

      <div className="settings-page-grid settings-overview-details">
        {volumeErrors.length ? <Notice className="settings-inline-alert" role="alert" tone="warning" actions={<UiButton variant="secondary" type="button" onClick={onRetry}>{t("common.actions.refresh")}</UiButton>}>
          {volumeErrors.map(volume => <p key={volume.id}>{`${volume.label}: ${volume.error}`}</p>)}
        </Notice> : null}
        <SettingsInfoCard
          icon={<Cpu aria-hidden="true" size={18} />}
          title={t("settings.overview.hardwareTitle")}
          description={t("settings.overview.hardwareDescription")}
          rows={hardwareRows}
        >
          {!systemInfo ? (
            <Notice className="settings-inline-alert" role="status" tone="warning">
              {loading ? t("common.states.loading") : t("settings.overview.runtimeUnavailable")}
            </Notice>
          ) : null}
        </SettingsInfoCard>

        <SettingsInfoCard
          icon={<Server aria-hidden="true" size={18} />}
          title={t("settings.overview.serviceTitle")}
          description={t("settings.overview.serviceDescription")}
          rows={serviceRows}
        />

        <SettingsInfoCard
          icon={<MemoryStick aria-hidden="true" size={18} />}
          title={t("settings.overview.processTitle")}
          description={t("settings.overview.processDescription")}
          rows={processRows}
        />

        <SettingsInfoCard
          icon={<HardDrive aria-hidden="true" size={18} />}
          title={t("settings.overview.pathsTitle")}
          description={t("settings.overview.pathsDescription")}
          rows={pathRows}
        />
      </div>
    </div>
  );
}



interface SettingsInfoRow {
  label: string;
  value: string;
  detail?: string;
  mono?: boolean;
}

function SettingsInfoCard({
  icon,
  title,
  description,
  rows,
  children
}: {
  icon: ReactNode;
  title: string;
  description: string;
  rows: SettingsInfoRow[];
  children?: ReactNode;
}) {
  return (
    <Section className="settings-section-card settings-system-card" icon={icon} title={title} description={description}>

      <DescriptionList className="settings-summary-list settings-system-list" items={rows} />
      {children}
    </Section>
  );
}



export function SettingsPhotosPage({
  settings,
  status,
  processingSettings,
  storagePools,
  locale,
  loading,
  libraryReady = true,
  processingReady = true,
  libraryLoading = false,
  processingLoading = false,
  statusLoading = false,
  onLibrarySettingsChange,
  onSettingsChange,
  onOpenProxy,
  onRequestCreateFolder,
  onClose
}: {
  settings: PhotoLibrarySettings | null;
  status: PhotoLibraryStatus | null;
  processingSettings: PhotoProcessingSettings | null;
  storagePools: StorageFilePickerPool[];
  locale: SupportedLocale;
  loading: boolean;
  libraryReady?: boolean;
  processingReady?: boolean;
  libraryLoading?: boolean;
  processingLoading?: boolean;
  statusLoading?: boolean;
  onLibrarySettingsChange: (input: PhotoLibraryDraft) => Promise<PhotoLibrarySettings>;
  onSettingsChange: (patch: Partial<PhotoSettingsDraft>) => Promise<void>;
  onOpenProxy: () => void;
  onRequestCreateFolder?: (input: {
    storagePoolId: string;
    parentPath: string;
    name: string;
  }) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<PhotoSettingsDraft>(() => photoSettingsDraft(processingSettings));
  const [libraryDraft, setLibraryDraft] = useState<PhotoLibraryDraft | null>(() => photoLibraryDraft(settings));
  const [pickerOpen, setPickerOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [proxy, setProxy] = useState<SystemProxySettingsRecord | null>(null);
  const [proxyLoading, setProxyLoading] = useState(true);
  const [proxyUnavailable, setProxyUnavailable] = useState(false);

  useEffect(() => {
    let disposed = false;
    void getSystemProxySettings().then((settings) => {
      if (!disposed) setProxy(settings);
    }).catch(() => {
      if (!disposed) setProxyUnavailable(true);
    }).finally(() => {
      if (!disposed) setProxyLoading(false);
    });
    return () => { disposed = true; };
  }, []);

  useEffect(() => {
    setDraft(photoSettingsDraft(processingSettings));
  }, [processingSettings]);

  useEffect(() => {
    setLibraryDraft(photoLibraryDraft(settings));
    setSaved(false);
  }, [settings]);

  const stateLabel = String(loading && !status
    ? t("common.states.loading")
    : status
      ? t(`settings.photos.states.${status.state}`)
      : t("common.states.unavailable"));
  const hasStatusProblem = !settings || Boolean(status?.error) ||
    status?.state === "degraded" || status?.state === "offline" || status?.state === "unconfigured";
  const selectedPool = storagePools.find((pool) => pool.id === libraryDraft?.storagePoolId) ?? null;
  const proxyConfigured = Boolean(proxy?.host && proxy.port !== null);
  const libraryChanged = Boolean(libraryDraft && (
    libraryDraft.storagePoolId !== settings?.storagePoolId || libraryDraft.path !== settings?.path
  ));

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading || (!processingSettings && !libraryChanged) || (libraryChanged && !libraryReady)) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      if (libraryDraft && libraryChanged) {
        const nextSettings = await onLibrarySettingsChange(libraryDraft);
        setLibraryDraft(photoLibraryDraft(nextSettings));
      }
      if (processingSettings) await onSettingsChange(draft);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  function chooseLibrary(selection: StorageFileSelection) {
    setLibraryDraft({ storagePoolId: selection.storagePoolId, path: selection.path });
    setPickerOpen(false);
    setSaved(false);
    setSaveError(null);
  }

  return (
    <>
      <form className="settings-form" onSubmit={(event) => void submit(event)} onChange={() => setSaved(false)}>
        <div className="settings-content-body">
          <div className="settings-page-grid">
          <PhotosSemanticSettingsCard />
          <Section className="settings-section-card" title={t("settings.photos.libraryTitle")} description={t("settings.photos.libraryDescription")}>
            {!libraryReady ? libraryLoading ? <PanelContentSkeleton /> : null : <>
            <dl className="settings-summary-list settings-photo-context">
              <div>
                <dt>{t("settings.photos.storagePool")}</dt>
                <dd>{selectedPool?.name ?? libraryDraft?.storagePoolId ?? t("settings.photos.notConfigured")}</dd>
              </div>
              <div>
                <dt>{t("settings.photos.libraryPath")}</dt>
                <dd className={libraryDraft ? "is-mono" : undefined}>
                  {libraryDraft?.path ?? t("settings.photos.notConfigured")}
                </dd>
              </div>
            </dl>
            <div className="settings-photo-library-actions">
              <UiButton variant="secondary"
                className="secondary-button"
                type="button"
                onClick={() => setPickerOpen(true)}
                disabled={loading || saving || storagePools.length === 0}
              >
                <Folder aria-hidden="true" size={15} />
                <span>{settings ? t("settings.photos.changeDirectory") : t("settings.photos.chooseDirectory")}</span>
              </UiButton>
            </div>
            {storagePools.length === 0 && !loading ? (
              <Notice className="settings-inline-alert" role="alert" tone="warning" icon={<AlertTriangle aria-hidden="true" size={15} />}>

                <span>{t("settings.photos.noStoragePools")}</span>
              </Notice>
            ) : null}
            {libraryChanged ? (
              <p className="settings-photo-pending" role="status">
                <Check aria-hidden="true" size={15} />
                <span>{t("settings.photos.pendingSave")}</span>
              </p>
            ) : statusLoading ? <span role="status">{t("common.states.loading")}</span> : hasStatusProblem ? (
              <Notice className="settings-inline-alert" role="alert" tone={status?.error ? "danger" : "warning"} icon={<AlertTriangle aria-hidden="true" size={15} />}>

                <span>{status?.error ?? stateLabel}</span>
              </Notice>
            ) : null}
            </>}
          </Section>

          {!processingReady ? processingLoading ? <PanelContentSkeleton /> : null : <><Section className="settings-section-card" title={t("settings.photos.mapTitle")}>

            <div className="settings-switch-row">
              <div className="settings-proxy-summary">
                <strong className="help-label">
                  {t("settings.photos.mapDownloadUseProxy")}
                  <HelpTip label={t("settings.photos.mapDownloadUseProxy")} content={t("settings.photos.mapDownloadProxyHelp")} />
                </strong>
                <span role={proxyUnavailable ? "alert" : undefined}>
                  {proxyLoading ? t("common.states.loading") : proxyUnavailable ? t("settings.photos.proxyUnavailable")
                    : proxyConfigured && proxy ? systemProxyUrl(proxy) : t("settings.photos.proxyMissing")}
                </span>
              </div>
              <Switch
                checked={draft.mapDownloadUseProxy}
                ariaLabel={t("settings.photos.mapDownloadUseProxy")}
                disabled={loading || saving || !processingSettings || (!draft.mapDownloadUseProxy && (proxyLoading || !proxyConfigured))}
                onCheckedChange={(checked) => {
                  setDraft((current) => ({ ...current, mapDownloadUseProxy: checked }));
                  setSaved(false);
                  setSaveError(null);
                }}
              />
            </div>
            <div className="settings-card-actions">
              <UiButton variant="secondary" className="secondary-button" type="button" onClick={onOpenProxy} disabled={saving}>
                {t("settings.photos.configureProxy")}
              </UiButton>
            </div>
          </Section>

          <Section className="settings-section-card" title={t("settings.photos.processingTitle")} description={t("settings.photos.processingDescription")}>

            <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving || !processingSettings}>
              <DownloadNumberField label={t("settings.photos.processingConcurrency")} value={draft.processingConcurrency} min={1} max={4} onChange={(value) => setDraft((current) => ({ ...current, processingConcurrency: value ?? 1 }))} />
              <DownloadNumberField label={t("settings.photos.scanIntervalMs")} value={draft.scanIntervalMs} min={60_000} max={86_400_000} step={60_000} onChange={(value) => setDraft((current) => ({ ...current, scanIntervalMs: value ?? 60_000 }))} />
              <DownloadNumberField label={t("settings.photos.commandTimeoutMs")} value={draft.commandTimeoutMs} min={5_000} max={900_000} step={1_000} onChange={(value) => setDraft((current) => ({ ...current, commandTimeoutMs: value ?? 5_000 }))} />
            </fieldset>
          </Section>

          <Section className="settings-section-card" title={t("settings.photos.retryPolicyTitle")} description={t("settings.photos.retryPolicyDescription")}>

            <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving || !processingSettings}>
              <DownloadNumberField label={t("settings.photos.maxAutoRetries")} value={draft.maxAutoRetries} min={0} max={20} onChange={(value) => setDraft((current) => ({ ...current, maxAutoRetries: value ?? 0 }))} />
              <DownloadNumberField label={t("settings.photos.retryBaseDelayMs")} value={draft.retryBaseDelayMs} min={500} max={1_800_000} step={500} onChange={(value) => setDraft((current) => ({ ...current, retryBaseDelayMs: value ?? 500 }))} />
              <DownloadNumberField label={t("settings.photos.retryMaxDelayMs")} value={draft.retryMaxDelayMs} min={draft.retryBaseDelayMs} max={1_800_000} step={1_000} onChange={(value) => setDraft((current) => ({ ...current, retryMaxDelayMs: value ?? current.retryBaseDelayMs }))} />
            </fieldset>
          </Section>

          <Section className="settings-section-card" title={t("settings.photos.resourceLimitsTitle")} description={t("settings.photos.resourceLimitsDescription")}>

            <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving || !processingSettings}>
              <DownloadNumberField label={t("settings.photos.maxFileSizeBytes")} value={draft.maxFileSizeBytes} min={1024 ** 2} max={1024 ** 4} step={1024 ** 2} onChange={(value) => setDraft((current) => ({ ...current, maxFileSizeBytes: value ?? 1024 ** 2 }))} />
              <DownloadNumberField label={t("settings.photos.maxXmpSizeBytes")} value={draft.maxXmpSizeBytes} min={1024} max={64 * 1024 ** 2} step={1024} onChange={(value) => setDraft((current) => ({ ...current, maxXmpSizeBytes: value ?? 1024 }))} />
              <DownloadNumberField label={t("settings.photos.maxIntermediateBytes")} value={draft.maxIntermediateBytes} min={64 * 1024 ** 2} max={8 * 1024 ** 3} step={1024 ** 2} onChange={(value) => setDraft((current) => ({ ...current, maxIntermediateBytes: value ?? 64 * 1024 ** 2 }))} />
              <DownloadNumberField label={t("settings.photos.minFreeSpaceBytes")} value={draft.minFreeSpaceBytes} min={0} max={1024 ** 4} step={1024 ** 2} onChange={(value) => setDraft((current) => ({ ...current, minFreeSpaceBytes: value ?? 0 }))} />
              <DownloadNumberField label={t("settings.photos.maxDecodedPixels")} value={draft.maxDecodedPixels} min={1_000_000} max={268_402_689} onChange={(value) => setDraft((current) => ({ ...current, maxDecodedPixels: value ?? 1_000_000 }))} />
            </fieldset>
          </Section>
          </>}
          </div>
        </div>

        <footer className="settings-actions">
          <span role={saveError ? "alert" : "status"}>
            {saving
              ? t("common.actions.saving")
              : saveError
                ? saveError
                : saved
                  ? t("settings.photos.saved")
                  : !loading && !processingSettings && !libraryChanged
                    ? t("common.states.unavailable")
                    : null}
          </span>
          <div>
            <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose} disabled={saving}>{t("common.actions.cancel")}</UiButton>
            <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving || (!processingSettings && !libraryChanged)} aria-busy={saving || undefined}>
              {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
              {t("common.actions.saveChanges")}
            </UiButton>
          </div>
        </footer>
      </form>
      {pickerOpen ? (
        <StorageFilePickerDialog
          pools={storagePools}
          initialPoolId={selectedPool?.id ?? storagePools[0]?.id ?? ""}
          locale={locale}
          mode="directory"
          directoryPurpose="photoLibrary"
          {...(selectedPool && libraryDraft?.path ? { initialPath: libraryDraft.path } : {})}
          onCancel={() => setPickerOpen(false)}
          onSelect={chooseLibrary}
          {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
        />
      ) : null}
    </>
  );
}

type PhotoLibraryDraft = Pick<PhotoLibrarySettings, "storagePoolId" | "path">;
type PhotoSettingsDraft = Omit<PhotoProcessingSettings, "updatedAt">;

function photoLibraryDraft(settings: PhotoLibrarySettings | null): PhotoLibraryDraft | null {
  return settings ? { storagePoolId: settings.storagePoolId, path: settings.path } : null;
}

function photoSettingsDraft(settings: PhotoProcessingSettings | null): PhotoSettingsDraft {
  if (settings) {
    const { updatedAt: _updatedAt, ...draft } = settings;
    return draft;
  }
  return {
    mapDownloadUseProxy: false,
    processingConcurrency: 1,
    scanIntervalMs: 1_800_000,
    maxAutoRetries: 5,
    retryBaseDelayMs: 2_000,
    retryMaxDelayMs: 300_000,
    commandTimeoutMs: 120_000,
    maxFileSizeBytes: 512 * 1024 ** 2,
    maxXmpSizeBytes: 16 * 1024 ** 2,
    maxIntermediateBytes: 2 * 1024 ** 3,
    minFreeSpaceBytes: 0,
    maxDecodedPixels: 268_402_689
  };
}

type DownloadSettingsDraft = Omit<DownloadSettings, "updatedAt">;

export function SettingsDownloadsPage({
  settings,
  loading,
  storagePools,
  locale,
  onRequestCreateFolder,
  onSettingsChange,
  onClose
}: {
  settings: DownloadSettings | null;
  loading: boolean;
  storagePools: StorageFilePickerPool[];
  locale: SupportedLocale;
  onRequestCreateFolder?: (input: { storagePoolId: string; parentPath: string; name: string }) => Promise<void>;
  onSettingsChange: (patch: Partial<DownloadSettingsDraft>) => Promise<void>;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<DownloadSettingsDraft>(() => downloadSettingsDraft(settings));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  const [pickerOpen, setPickerOpen] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const directoryButtonRef = useRef<HTMLButtonElement | null>(null);
  const defaultPool = storagePools.find((pool) => pool.id === draft.defaultStoragePoolId);
  const directoryText = draft.defaultTargetDirectory !== null
    ? `${defaultPool?.name ?? draft.defaultStoragePoolId} / ${draft.defaultTargetDirectory}`
    : t("settings.downloads.directoryNotSet");

  useEffect(() => {
    setDraft(downloadSettingsDraft(settings));
    setSaved(false);
  }, [settings]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loading) return;
    setSaving(true);
    setSaved(false);
    setSaveError(null);
    try {
      await onSettingsChange(draft);
      setSaved(true);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
    <form className="settings-form" onSubmit={(event) => void submit(event)}>
      <div className="settings-content-body">
        <div className="settings-page-grid settings-downloads-grid">
            <Section className="settings-section-card" title={t("settings.downloads.concurrencyTitle")} description={t("settings.downloads.concurrencyDescription")}>


              {([
                { key: "concurrency", id: "download-concurrency", label: "settings.downloads.concurrencyField", help: "settings.downloads.concurrencyHelp" },
                { key: "btConcurrency", id: "download-bt-concurrency", label: "settings.downloads.btConcurrencyField", help: "settings.downloads.btConcurrencyHelp" }
              ] as const).map((control) => (
              <fieldset className="settings-download-control" disabled={loading || saving} key={control.key}>
                <Field className="settings-preference-field" htmlFor={control.id} label={t(control.label)} help={<HelpTip label={t(control.label)} content={t(control.help)} />}>
                  <CustomSelect
                    id={control.id}
                    value={String(draft[control.key])}
                    ariaLabel={t(control.label)}
                    disabled={loading || saving}
                    options={Array.from({ length: 10 }, (_, index) => index + 1).map((value) => ({
                      value: String(value),
                      label: t("settings.downloads.connectionCount", { count: value })
                    }))}
                    onChange={(value) => setDraft((current) => ({
                      ...current,
                      [control.key]: Number(value)
                    }))}
                  />
                </Field>
                <div className="settings-download-visual" aria-hidden="true">
                  <Download size={22} />
                  <strong>{draft[control.key]}</strong>
                  <span>{t("settings.downloads.connectionUnit")}</span>
                </div>
              </fieldset>
              ))}
              <fieldset className="settings-preference-field settings-download-directory" disabled={loading || saving}>
                <HelpLabel label={t("settings.downloads.defaultDirectory")} content={t("settings.downloads.defaultDirectoryHelp")} htmlFor="download-default-directory" />
                <div className="settings-download-directory-value" data-tooltip={directoryText}>
                  <Folder aria-hidden="true" size={15} />
                  <span>{directoryText}</span>
                </div>
                <div className="settings-download-directory-actions">
                  <UiButton variant="secondary" id="download-default-directory" ref={directoryButtonRef} type="button" className="secondary-button" disabled={!storagePools.some((pool) => pool.status !== "offline")} onClick={() => setPickerOpen(true)}>
                    <Folder aria-hidden="true" size={15} />
                    {t("settings.downloads.chooseDirectory")}
                  </UiButton>
                  <UiButton variant="secondary" type="button" className="secondary-button" disabled={draft.defaultStoragePoolId === null} onClick={() => {
                    setDraft((current) => ({ ...current, defaultStoragePoolId: null, defaultTargetDirectory: null }));
                    setSaved(false);
                    setSaveError(null);
                  }}>{t("settings.downloads.clearDirectory")}</UiButton>
                </div>
              </fieldset>
              <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving}>
                <DownloadNumberField
                  label={t("settings.downloads.parallelRequests")}
                  help={t("settings.downloads.parallelRequestsHelp")}
                  value={draft.parallelRequestsPerTask}
                  min={1}
                  max={8}
                  onChange={(value) => setDraft((current) => ({ ...current, parallelRequestsPerTask: value ?? 1 }))}
                />
                <DownloadNumberField
                  label={t("settings.downloads.segmentedMinBytes")}
                  help={t("settings.downloads.segmentedMinBytesHelp")}
                  value={draft.segmentedDownloadMinBytes}
                  min={1024 * 1024}
                  max={1024 ** 4}
                  step={1024 * 1024}
                  onChange={(value) => setDraft((current) => ({ ...current, segmentedDownloadMinBytes: value ?? 1024 * 1024 }))}
                />
              </fieldset>
            </Section>

            <Section className="settings-section-card" title={t("settings.downloads.retryTitle")} description={t("settings.downloads.retryDescription")}>

              <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving}>
                <DownloadNumberField label={t("settings.downloads.maxAutoRetries")} value={draft.maxAutoRetries} min={0} max={20} onChange={(value) => setDraft((current) => ({ ...current, maxAutoRetries: value ?? 0 }))} />
                <DownloadNumberField label={t("settings.downloads.retryBaseDelayMs")} value={draft.retryBaseDelayMs} min={500} max={60_000} step={500} onChange={(value) => setDraft((current) => ({ ...current, retryBaseDelayMs: value ?? 500 }))} />
                <DownloadNumberField label={t("settings.downloads.retryMaxDelayMs")} value={draft.retryMaxDelayMs} min={draft.retryBaseDelayMs} max={1_800_000} step={1000} onChange={(value) => setDraft((current) => ({ ...current, retryMaxDelayMs: value ?? current.retryBaseDelayMs }))} />
                <DownloadNumberField label={t("settings.downloads.retryAfterMaxDelayMs")} value={draft.retryAfterMaxDelayMs} min={1000} max={3_600_000} step={1000} onChange={(value) => setDraft((current) => ({ ...current, retryAfterMaxDelayMs: value ?? 1000 }))} />
              </fieldset>
            </Section>

            <Section className="settings-section-card" title={t("settings.downloads.timeoutsTitle")} description={t("settings.downloads.timeoutsDescription")}>

              <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving}>
                <DownloadNumberField label={t("settings.downloads.connectTimeoutMs")} value={draft.connectTimeoutMs} min={1000} max={120_000} step={1000} onChange={(value) => setDraft((current) => ({ ...current, connectTimeoutMs: value ?? 1000 }))} />
                <DownloadNumberField label={t("settings.downloads.responseHeaderTimeoutMs")} value={draft.responseHeaderTimeoutMs} min={5000} max={300_000} step={1000} onChange={(value) => setDraft((current) => ({ ...current, responseHeaderTimeoutMs: value ?? 5000 }))} />
                <DownloadNumberField label={t("settings.downloads.readIdleTimeoutMs")} value={draft.readIdleTimeoutMs} min={5000} max={900_000} step={1000} onChange={(value) => setDraft((current) => ({ ...current, readIdleTimeoutMs: value ?? 5000 }))} />
              </fieldset>
            </Section>

            <Section className="settings-section-card" title={t("settings.downloads.storageTitle")} description={t("settings.downloads.storageDescription")}>

              <fieldset className="settings-field-grid settings-download-fields" disabled={loading || saving}>
                <DownloadNumberField label={t("settings.downloads.minFreeSpaceBytes")} help={t("settings.downloads.minFreeSpaceHelp")} value={draft.minFreeSpaceBytes} min={0} max={Number.MAX_SAFE_INTEGER} step={1024 * 1024} onChange={(value) => setDraft((current) => ({ ...current, minFreeSpaceBytes: value ?? 0 }))} />
                <DownloadNumberField label={t("settings.downloads.maxFileSizeBytes")} help={t("settings.downloads.maxFileSizeHelp")} value={draft.maxFileSizeBytes} min={1} max={Number.MAX_SAFE_INTEGER} step={1024 * 1024} nullable onChange={(value) => setDraft((current) => ({ ...current, maxFileSizeBytes: value }))} />
              </fieldset>
            </Section>
        </div>
      </div>

      {saveError ? <Notice className="settings-inline-alert" role="alert" tone="danger">{saveError}</Notice> : null}
      <footer className="settings-actions">
        <span role="status">
          {saving
            ? t("settings.downloads.saving")
            : saved
              ? t("settings.downloads.saved")
              : !loading && !settings
                ? t("settings.downloads.notLoaded")
                : null}
        </span>
        <div>
          <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose} disabled={saving}>
            {t("common.actions.cancel")}
          </UiButton>
          <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving || !settings} aria-busy={loading || saving || undefined}>
            {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
            {t("common.actions.saveChanges")}
          </UiButton>
        </div>
      </footer>
    </form>
    {pickerOpen ? (
      <StorageFilePickerDialog
        pools={storagePools}
        initialPoolId={draft.defaultStoragePoolId ?? storagePools[0]?.id ?? ""}
        {...(draft.defaultTargetDirectory !== null ? { initialPath: draft.defaultTargetDirectory } : {})}
        locale={locale}
        mode="directory"
        returnFocusRef={directoryButtonRef}
        onCancel={() => setPickerOpen(false)}
        onSelect={(selection) => {
          setDraft((current) => ({ ...current, defaultStoragePoolId: selection.storagePoolId, defaultTargetDirectory: selection.path }));
          setPickerOpen(false);
          setSaved(false);
          setSaveError(null);
        }}
        {...(onRequestCreateFolder ? { onRequestCreateFolder } : {})}
      />
    ) : null}
    </>
  );
}

function downloadSettingsDraft(settings: DownloadSettings | null): DownloadSettingsDraft {
  if (settings) {
    const { updatedAt: _updatedAt, ...draft } = settings;
    return draft;
  }
  return {
    concurrency: 1,
    btConcurrency: 3,
    defaultStoragePoolId: null,
    defaultTargetDirectory: null,
    parallelRequestsPerTask: 4,
    segmentedDownloadMinBytes: 64 * 1024 * 1024,
    maxAutoRetries: 5,
    retryBaseDelayMs: 2_000,
    retryMaxDelayMs: 300_000,
    retryAfterMaxDelayMs: 900_000,
    connectTimeoutMs: 15_000,
    responseHeaderTimeoutMs: 30_000,
    readIdleTimeoutMs: 60_000,
    minFreeSpaceBytes: 0,
    maxFileSizeBytes: null
  };
}

function DownloadNumberField({
  label,
  help,
  value,
  min,
  max,
  step = 1,
  nullable = false,
  onChange
}: {
  label: string;
  help?: string;
  value: number | null;
  min: number;
  max: number;
  step?: number;
  nullable?: boolean;
  onChange: (value: number | null) => void;
}) {
  const id = useId();
  return (
    <Field className="settings-preference-field" htmlFor={id} label={label} help={help ? <HelpTip label={label} content={help} /> : null}>
      <Input
        id={id}
        type="number"
        value={value ?? ""}
        min={min}
        max={max}
        step={step}
        placeholder={nullable ? "-" : undefined}
        onChange={(event) => {
          const next = event.target.value;
          onChange(next === "" && nullable ? null : Number(next));
        }}
      />
    </Field>
  );
}

function SettingsToolPolicyPage({
  form,
  loading,
  saving,
  onChange,
  onSubmit,
  onClose
}: {
  form: ToolPolicyFormState;
  loading: boolean;
  saving: boolean;
  onChange: (form: ToolPolicyFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const policyOptions = AGENT_CAPABILITY_POLICY_OPTIONS.map((mode) => ({
    value: mode,
    label: toolPolicyModeLabel(mode, t)
  }));
  const approvalRequiredPolicyOptions = policyOptions.filter((option) => option.value !== "auto");

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        <div className="settings-page-grid">
          <Section className="settings-section-card" title={t("settings.toolPolicy.readOnlyTitle")} description={t("settings.toolPolicy.readOnlyDescription")}>

            <div className="settings-tool-policy-list">
              {READ_ONLY_CAPABILITIES.map((capabilityId) => (
                <Field key={capabilityId} className="settings-policy-row" label={<>
                    <strong>{capabilityId}</strong>
                    <small>{t(`settings.toolPolicy.capabilities.${CAPABILITY_DESCRIPTION_KEY[capabilityId]}`)}</small>
                  </>}>

                  <CustomSelect
                    id={`capability-policy-${capabilityId}`}
                    value={form.policies[capabilityId]}
                    options={capabilityId === "cyberos.files.mutate" ? approvalRequiredPolicyOptions : policyOptions}
                    ariaLabel={`${capabilityId}: ${toolPolicyModeLabel(form.policies[capabilityId], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        policies: { ...form.policies, [capabilityId]: mode }
                      })
                    }
                    disabled={loading || saving}
                  />
                </Field>
              ))}
            </div>
          </Section>

          <Section className="settings-section-card" title={t("settings.toolPolicy.dangerousTitle")} description={t("settings.toolPolicy.dangerousDescription")}>

            <div className="settings-tool-policy-list">
              {MUTATING_CAPABILITIES.map((capabilityId) => (
                <Field key={capabilityId} className="settings-policy-row" label={<>
                    <strong>{capabilityId}</strong>
                    <small>{t(`settings.toolPolicy.capabilities.${CAPABILITY_DESCRIPTION_KEY[capabilityId]}`)}</small>
                  </>}>

                  <CustomSelect
                    id={`capability-policy-${capabilityId}`}
                    value={form.policies[capabilityId]}
                    options={policyOptions}
                    ariaLabel={`${capabilityId}: ${toolPolicyModeLabel(form.policies[capabilityId], t)}`}
                    onChange={(mode) =>
                      onChange({
                        ...form,
                        policies: { ...form.policies, [capabilityId]: mode }
                      })
                    }
                    disabled={loading || saving}
                  />
                </Field>
              ))}
            </div>
          </Section>

        </div>
      </div>

      <footer className="settings-actions">
        <span role="status">{saving ? t("common.actions.saving") : null}</span>
        <div>
          <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </UiButton>
          <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving} aria-busy={loading || saving || undefined}>
            {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
            {t("common.actions.saveChanges")}
          </UiButton>
        </div>
      </footer>
    </form>
  );
}

function SettingsVmPage({
  form,
  loading,
  saving,
  onChange,
  onSubmit,
  onClose
}: {
  form: VmSettingsFormState;
  loading: boolean;
  saving: boolean;
  onChange: (form: VmSettingsFormState) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <form className="settings-form" onSubmit={onSubmit}>
      <div className="settings-content-body">
        <div className="settings-page-grid settings-docker-grid">
          <Section className="settings-section-card" title={t("settings.virtualMachines.runtimeTitle")} description={t("settings.virtualMachines.runtimeDescription")}>


            <fieldset className="settings-field-grid" disabled={loading || saving}>
              <span className="help-label settings-field-wide">
                <Switch
                  checked={form.enabled}
                  label={t("settings.virtualMachines.enabledField")}
                  onCheckedChange={(enabled) => onChange({ ...form, enabled })}
                />
                <HelpTip label={t("settings.virtualMachines.enabledField")} content={`${t("settings.virtualMachines.enabledDescription")} ${t("settings.virtualMachines.runtimeNote")}`} />
              </span>
            </fieldset>
          </Section>
        </div>
      </div>

      <footer className="settings-actions">
        <span role="status">{saving ? t("common.actions.saving") : null}</span>
        <div>
          <UiButton variant="secondary" className="secondary-button" type="button" onClick={onClose}>
            {t("common.actions.cancel")}
          </UiButton>
          <UiButton variant="primary" className="primary-button" type="submit" disabled={loading || saving} aria-busy={loading || saving || undefined}>
            {saving ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}
            {t("common.actions.saveChanges")}
          </UiButton>
        </div>
      </footer>
    </form>
  );
}

function formatDuration(
  seconds: number,
  locale: SupportedLocale,
  t: Translate
): string {
  const totalSeconds = Math.max(Math.round(seconds), 0);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const remainingSeconds = totalSeconds % 60;

  if (days > 0) {
    return String(t("settings.system.duration.daysHours", {
      days: formatLocaleNumber(days, locale),
      hours: formatLocaleNumber(hours, locale)
    }));
  }
  if (hours > 0) {
    return String(t("settings.system.duration.hoursMinutes", {
      hours: formatLocaleNumber(hours, locale),
      minutes: formatLocaleNumber(minutes, locale)
    }));
  }
  if (minutes > 0) {
    return String(t("settings.system.duration.minutesSeconds", {
      minutes: formatLocaleNumber(minutes, locale),
      seconds: formatLocaleNumber(remainingSeconds, locale)
    }));
  }
  return String(t("settings.system.duration.seconds", {
    seconds: formatLocaleNumber(remainingSeconds, locale)
  }));
}

function toolPolicyModeLabel(mode: string, t: Translate): string {
  if (mode === "auto") {
    return String(t("settings.toolPolicy.modes.auto"));
  }
  if (mode === "approve") return String(t("settings.toolPolicy.modes.approve"));
  if (mode === "confirm") return String(t("settings.toolPolicy.modes.confirm"));
  return String(t("settings.toolPolicy.modes.disabled"));
}
