import type { FormEvent } from "react";
import type { BuildInfo, DockerSettings, VmSettings, DownloadSettings, IndexerOverview, IndexerSettings, NetworkSummary, StoragePool, ModelProviderSettings, PhotoLibrarySettings, PhotoLibraryStatus, PhotoProcessingSettings, SystemInfo, SystemPowerAction, WifiStatus, BluetoothStatus } from "../../api.js";
import type { DockerSettingsFormState, VmSettingsFormState, ModelProviderFormState, SettingsSectionId, ToolPolicyFormState } from "../../config/settings.js";
import type { LanguagePreference, SupportedLocale } from "../../i18n/locale.js";
import type { SettingsResourceKey, SettingsResourceSnapshot } from "./settings-resources.js";

export interface SettingsModalProps {
  activeSection: SettingsSectionId;
  resourceStates?: SettingsResourceSnapshot;
  onResourceRetry?: (resource: SettingsResourceKey) => void;
  onSectionVisible?: (section: SettingsSectionId | null) => void;
  activeSessionId: string;
  form: ModelProviderFormState;
  dockerForm: DockerSettingsFormState;
  loading: boolean;
  saving: boolean;
  saveError?: string | null;
  dockerSettings: DockerSettings | null;
  vmSettings: VmSettings | null;
  downloadSettings: DownloadSettings | null;
  indexerSettings: IndexerSettings | null;
  indexerStatus: IndexerOverview | null;
  storagePools: StoragePool[];
  photoSettings: PhotoLibrarySettings | null;
  photoStatus: PhotoLibraryStatus | null;
  photoProcessingSettings: PhotoProcessingSettings | null;
  settings: ModelProviderSettings | null;
  systemInfo: SystemInfo | null;
  buildInfo: BuildInfo | null;
  buildInfoError: string | null;
  toolPolicyForm: ToolPolicyFormState;
  languagePreference: LanguagePreference;
  previewFileSizeLimitBytes: number;
  networkSummary: NetworkSummary | null;
  bluetoothStatus: BluetoothStatus | null;
  resolvedLocale: SupportedLocale;
  onClose: () => void;
  onOpenVoiceSession?: (sessionId: string) => void;
  onRequestSystemPower?: (action: SystemPowerAction) => Promise<boolean>;
  onFormChange: (form: ModelProviderFormState) => void;
  onDockerFormChange: (form: DockerSettingsFormState) => void;
  vmForm: VmSettingsFormState;
  onVmFormChange: (form: VmSettingsFormState) => void;
  onDownloadSettingsChange: (
    patch: Partial<Omit<DownloadSettings, "updatedAt">>
  ) => Promise<void>;
  onIndexerSettingsChange: (
    patch: Partial<Omit<IndexerSettings, "updatedAt">>
  ) => Promise<void>;
  onIndexerReindex: (storagePoolId: string) => Promise<void>;
  onPhotoLibrarySettingsChange: (input: {
    storagePoolId: string;
    path: string;
  }) => Promise<PhotoLibrarySettings>;
  onPhotoProcessingSettingsChange: (
    patch: Partial<Omit<PhotoProcessingSettings, "updatedAt">>
  ) => Promise<void>;
  onRequestCreateFolder: (input: {
    storagePoolId: string;
    parentPath: string;
    name: string;
  }) => Promise<void>;
  onToolPolicyFormChange: (form: ToolPolicyFormState) => void;
  onLanguagePreferenceChange: (preference: LanguagePreference) => void;
  onPreviewFileSizeLimitChange: (bytes: number) => void;
  onWifiStatus: (status: WifiStatus) => void;
  onBluetoothStatus: (status: BluetoothStatus) => void;
  onNetworkRefresh: () => Promise<void>;
  onNotifySuccess: (message: string) => void;
  onNotifyError: (message: string) => void;
  onSectionChange: (section: SettingsSectionId) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}
