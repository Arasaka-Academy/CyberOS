import type { JsonValue } from "./contracts.js";

type Page = { cursor?: string | null; limit?: number };
type Operation<N extends string, T = Record<never, never>> = { operation: N } & T;
type Proposal<T> = { request: T; idempotencyKey?: string };
type Fields<K extends string> = Partial<Record<K, JsonValue>>;
type PoolPath = { storagePoolId: string; path: string };
type Device = { adapterId: string; address: string };
type Revision = { expectedRevision: string };
type Camera = { deviceId: string; expectedUpdatedAt: string };

export type PhotoQueryRequest = Page & {
  assetId?: string;
  filters?: {
    text?: string;
    capturedAt?: { from?: string; to?: string };
    mediaKinds?: Array<"image" | "video" | "raw">;
    cameraModels?: string[];
    lensModels?: string[];
    iso?: { min?: number; max?: number };
    aperture?: { min?: number; max?: number };
    exposureTimeSeconds?: { min?: number; max?: number };
    focalLengthMm?: { min?: number; max?: number };
    rating?: { min?: number; max?: number };
    keywords?: string[];
    hasLocation?: boolean;
    location?: { kind: "near"; latitude: number; longitude: number; radiusMeters: number }
      | { kind: "bounds"; west: number; east: number; south: number; north: number };
    advanced?: { mode: "all" | "any"; conditions: Array<{
      key: string;
      operator: "eq" | "prefix" | "contains" | "exists" | "not_exists" | "gt" | "gte" | "lt" | "lte" | "between" | "in";
      value?: string | number | boolean | null | Array<string | number>;
      valueTo?: string | number;
    }> };
  };
  sort?: { field: "captured_at" | "indexed_at" | "name" | "size_bytes" | "rating" | "distance" | "relevance"; direction: "asc" | "desc" };
  includeFacets?: boolean;
};

export type TorrentCreateRequest = Operation<"create_torrent", {
  torrentPreviewId: string; selectedFileIndices: number[]; storagePoolId: string; targetDirectory: string; fileName: string;
  seedRatioLimit?: 1; seedTimeLimitSeconds?: 7200;
}> | Operation<"stop_seeding", { taskId: string }>;
type SemanticRequest = Operation<"rebuild" | "retry"> | (Operation<"configure" | "test"> & Fields<"enabled" | "baseUrl" | "model" | "minSimilarity" | "replaceToken" | "clearToken">);
type PreviewRequest = Operation<"magnet", { magnet: string }> | Operation<"file", PoolPath> | Operation<"delete", { previewId: string }>;
type PtzCommand = { action: "absolute_move" | "relative_move" | "continuous_move"; pan: number; tilt: number }
  | { action: "stop" | "home" } | { action: "set_preset"; name: string; token: string | null }
  | { action: "goto_preset" | "remove_preset"; token: string };
type NvrRequest = Operation<"discover"> | Operation<"add", { name: string; onvifUrl: string }>
  | Operation<"update", Camera & { name?: string; recordingEnabled?: boolean; recordingProfile?: "raw" | "annotated" }>
  | Operation<"delete", Camera> | Operation<"ptz", Camera & { command: PtzCommand }>
  | Operation<"policy", { storagePoolId: string | null; directory: string; retentionDays: number; quotaBytes: number }>;
type TailscaleRequest = Operation<"login", Revision & { controlUrl: string; method: "browser" | "auth_key" }>
  | Operation<"service", Revision & { autoStart: boolean }>
  | Operation<"action", Revision & { action: "connect" | "disconnect" | "logout" | "start" | "restart" }>
  | Operation<"settings", Revision & { settings: Fields<"acceptDns" | "acceptRoutes" | "exitNodeAllowLanAccess" | "advertiseExitNode" | "hostname" | "exitNodeId" | "advertisedRoutes"> }>
  | Operation<"confirm" | "rollback", { transactionId: string }>;
type BluetoothRequest = Operation<"power", { adapterId: string; powered: boolean }>
  | Operation<"default_adapter" | "scan_start" | "scan_stop", { adapterId: string }>
  | Operation<"pair" | "cancel_pairing" | "connect" | "disconnect" | "unpair", Device>
  | Operation<"trust", Device & { trusted: boolean }>
  | Operation<"send", Device & { storagePoolId: string; paths: string[] }>
  | Operation<"cancel_transfer", { transferId: string }>
  | (Operation<"settings"> & Fields<"defaultAudioDeviceId" | "receiveEnabled" | "inboxStoragePoolId" | "inboxPath">);
type IscsiTarget = { name: string; address: string; port: number; initiators: string[]; chap: { enabled: boolean; username: string; replacePassword?: boolean } };
type IscsiRequest = Operation<"create_target", Revision & IscsiTarget & { enabled: boolean }>
  | Operation<"update_target", Revision & IscsiTarget & { targetId: string }>
  | Operation<"set_target_enabled", Revision & { targetId: string; enabled: boolean }>
  | Operation<"delete_target", Revision & { targetId: string; destroyImages: boolean; confirmation?: string }>
  | Operation<"create_lun", Revision & { targetId: string; name: string; storagePoolId: string; sizeBytes: number }>
  | Operation<"attach_lun", Revision & { targetId: string; imageId: string }>
  | Operation<"detach_lun", Revision & { targetId: string; imageId: string; destroyImage: boolean; confirmation?: string }>
  | Operation<"destroy_image", Revision & { imageId: string; confirmation: string }>;
type AudioRequest = Operation<"service_test" | "recording_test" | "stop" | "reset">
  | Operation<"speech_test", { text: string }>
  | (Operation<"settings"> & Fields<"cyberAudioBaseUrl" | "replaceToken" | "clearToken" | "enabled" | "inputDeviceId" | "maxRecordingSeconds" | "sttLanguage" | "ttsLanguage" | "ttsVoice" | "ttsInstructions" | "speechEnabled" | "outputDeviceId" | "volume">);

export interface SystemCapabilityRequestMap {
  "cyberos.system.health": Record<never, never>;
  "cyberos.system.info": Record<never, never>;
  "cyberos.system.services": { unit?: string };
  "cyberos.system.logs": { unit: string; limit?: number; since?: string };
  "cyberos.files.history": Page & { storagePoolId?: string };
  "cyberos.files.batches": { storagePoolId?: string; limit?: number };
  "cyberos.files.restore-propose": Proposal<Operation<"restore", { trashEntryId: string }>>;
  "cyberos.files.extract-propose": Proposal<Operation<"extract", PoolPath>>;
  "cyberos.files.batch-propose": Proposal<Operation<"move", { storagePoolId: string; sourcePaths: string[]; targetDirectory: string }> | Operation<"trash", { storagePoolId: string; sourcePaths: string[] }>>;
  "cyberos.files.batch-cancel-propose": Proposal<Operation<"cancel", { batchId: string }>>;
  "cyberos.photos.query": PhotoQueryRequest;
  "cyberos.photos.metadata": { assetId?: string; query?: string; limit?: number };
  "cyberos.photos.semantic-status": Record<never, never>;
  "cyberos.photos.semantic-propose": Proposal<SemanticRequest>;
  "cyberos.downloads.preview": Page & { previewId: string };
  "cyberos.downloads.preview-propose": Proposal<PreviewRequest>;
  "cyberos.downloads.files": Page & { taskId: string };
  "cyberos.docker.get": { entity: "container" | "app" | "network" | "volume" | "daemon" | "logs"; id?: string; tail?: number; limit?: number };
  "cyberos.alerts.get": { entity: "incident" | "delivery" | "smtp"; id?: string };
  "cyberos.nvr.status": { limit?: number };
  "cyberos.nvr.query": Page & { entity: "device" | "segments" | "events" | "ptz"; deviceId?: string; from?: string; to?: string };
  "cyberos.nvr.resource-link": { variant: "snapshot" | "segment"; id: string };
  "cyberos.nvr.manage-propose": Proposal<NvrRequest>;
  "cyberos.tailscale.status": Record<never, never>;
  "cyberos.tailscale.manage-propose": Proposal<TailscaleRequest>;
  "cyberos.bluetooth.status": Record<never, never>;
  "cyberos.bluetooth.transfers": Page;
  "cyberos.bluetooth.manage-propose": Proposal<BluetoothRequest>;
  "cyberos.iscsi.status": Record<never, never>;
  "cyberos.iscsi.manage-propose": Proposal<IscsiRequest>;
  "cyberos.audio.status": { view?: "status" | "devices" | "settings" | "history"; before?: string; limit?: number };
  "cyberos.audio.control-propose": Proposal<AudioRequest>;
  "cyberos.settings.proxy": Record<never, never>;
  "cyberos.settings.proxy-propose": Proposal<Operation<"configure", { protocol: "http" | "https" | "socks5"; host: string | null; port: number | null }>>;
  "cyberos.backup.snapshots": Page;
  "cyberos.backup.coverage": Record<never, never>;
  "cyberos.backup.restore-propose": Proposal<Operation<"restore", { snapshotId: string }>>;
  "cyberos.tasks.get": { runId: string };
  "cyberos.tasks.list": Page;
  "cyberos.tasks.wait": { runId: string; timeoutMs?: number; afterRevision?: string };
  "cyberos.tasks.cancel-propose": Proposal<Operation<"cancel", { runId: string }>>;
}

export type SystemCapabilityMutationRequest = {
  [K in keyof SystemCapabilityRequestMap]: SystemCapabilityRequestMap[K] extends Proposal<infer T> ? T : never
}[keyof SystemCapabilityRequestMap];
