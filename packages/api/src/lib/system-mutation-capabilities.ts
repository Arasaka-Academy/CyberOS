import { constants } from "node:fs";
import { open, lstat } from "node:fs/promises";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { CapabilityError, type JsonValue } from "@cyberos/capabilities";
import type { CapabilityAdapterContext, CapabilityDomainAdapter, CapabilitySecretRequirement, PreparedCapabilityAction } from "@cyberos/capability-runtime";
import { getTrashEntry, getFileBatch, getBluetoothTransfer, getBackupSettings } from "@cyberos/db";
import { assertNoSymlinkPathSegments } from "@cyberos/storage-tools";
import { SYSTEM_CAPABILITY_ENTRIES } from "@cyberos/capabilities";
import { capabilityHttp, digest, identifier, json, object, omit, safeCapabilityResult, validateCapability, type CapabilityInput, type CapabilityHttpRequest } from "./capability-io.js";
import { resolveScopedExistingPath, resolveScopedTargetPath, resolveStoragePoolScope } from "./storage-scope.js";
import type { SystemManagementDependencies } from "./system-management.js";

type Secrets = Readonly<Record<string, string>>;
const secret = (name: string, label: string, maxLength = 4096, minLength = 1): CapabilitySecretRequirement => ({ name, label, maxLength, minLength });
const cameraConfiguration = (device: CapabilityInput) => ({ id: device.id!, name: device.name!, onvifUrl: device.onvifUrl!, recordingEnabled: device.recordingEnabled!, recordingProfile: device.recordingProfile!, removedAt: device.removedAt ?? null });
function requirements(id: string, input: CapabilityInput): CapabilitySecretRequirement[] {
  if (id === "cyberos.nvr.manage-propose" && input.operation === "add") return [secret("cameraUsername", "Camera username", 256), secret("cameraPassword", "Camera password")];
  if (id === "cyberos.tailscale.manage-propose" && input.method === "auth_key") return [secret("tailscaleAuthKey", "Tailscale / Headscale auth key")];
  if (id === "cyberos.iscsi.manage-propose" && input.chap && (object(input.chap).replacePassword === true || input.operation === "create_target" && object(input.chap).enabled === true)) return [secret("chapPassword", "iSCSI CHAP password", 16, 12)];
  if (id === "cyberos.audio.control-propose" && input.replaceToken === true) return [secret("audioToken", "CyberAudio token")];
  if (id === "cyberos.photos.semantic-propose" && input.replaceToken === true) return [secret("semanticApiKey", "Semantic search API key")];
  return [];
}

export function systemMutationRequest(id: string, input: CapabilityInput, secrets: Secrets): CapabilityHttpRequest {
  const op = String(input.operation);
  const body = omit(input, "operation");
  switch (id) {
    case "cyberos.files.restore-propose": return { method: "POST", url: `/api/trash/${identifier(input.trashEntryId)}/restore` };
    case "cyberos.files.extract-propose": return { method: "POST", url: "/api/files/extract", payload: body };
    case "cyberos.files.batch-propose": return { method: "POST", url: "/api/files/batches", payload: input };
    case "cyberos.files.batch-cancel-propose": return { method: "POST", url: `/api/files/batches/${identifier(input.batchId)}/cancel` };
    case "cyberos.downloads.preview-propose":
      return op === "delete" ? { method: "DELETE", url: `/api/downloads/torrent-previews/${identifier(input.previewId)}` }
        : { method: "POST", url: "/api/downloads/torrent-previews", payload: { magnet: input.magnet } };
    case "cyberos.photos.semantic-propose":
      return ["rebuild", "retry"].includes(op) ? { method: "POST", url: `/api/photos/semantic-index/${op}` }
        : { method: op === "configure" ? "PATCH" : "POST", url: `/api/settings/photos/semantic-search${op === "test" ? "/test" : ""}`,
          payload: { ...omit(body, "replaceToken", "clearToken"), ...(input.clearToken === true ? { clearApiKey: true } : {}), ...(secrets.semanticApiKey ? { apiKey: secrets.semanticApiKey } : {}) } };
    case "cyberos.nvr.manage-propose": {
      if (op === "discover") return { method: "POST", url: "/api/nvr/discover" };
      if (op === "add") return { method: "POST", url: "/api/nvr/devices", payload: { ...body, username: secrets.cameraUsername, password: secrets.cameraPassword } };
      if (op === "policy") return { method: "PUT", url: "/api/nvr/policy", payload: body };
      const base = `/api/nvr/devices/${identifier(input.deviceId)}`;
      return op === "ptz" ? { method: "POST", url: `${base}/ptz`, payload: input.command }
        : op === "delete" ? { method: "DELETE", url: base }
        : { method: "PATCH", url: base, payload: omit(body, "deviceId", "expectedUpdatedAt") };
    }
    case "cyberos.tailscale.manage-propose": {
      const base = "/api/system/tailscale";
      if (op === "confirm" || op === "rollback") return { method: "POST", url: `${base}/apply/${identifier(input.transactionId)}/${op}` };
      return { method: op === "settings" || op === "service" ? "PUT" : "POST", url: `${base}/${op === "action" ? "actions" : op}`,
        payload: { ...body, confirmed: true, ...(op === "login" ? { authKey: secrets.tailscaleAuthKey ?? null } : {}) } };
    }
    case "cyberos.bluetooth.manage-propose": {
      const base = "/api/system/bluetooth";
      if (op === "settings") return { method: "PATCH", url: `${base}/settings`, payload: body };
      if (op === "send") return { method: "POST", url: `${base}/transfers`, payload: body };
      if (op === "cancel_transfer") return { method: "POST", url: `${base}/transfers/${identifier(input.transferId)}/cancel` };
      if (op === "power") return { method: "PUT", url: `${base}/adapter/power`, payload: body };
      if (op === "default_adapter") return { method: "PUT", url: `${base}/default-adapter`, payload: body };
      if (op === "scan_start" || op === "scan_stop") return { method: "POST", url: `${base}/scan/${op === "scan_start" ? "start" : "stop"}`, payload: body };
      return { method: op === "trust" ? "PUT" : "POST", url: `${base}/devices/${op.replaceAll("_", "-")}`, payload: body };
    }
    case "cyberos.iscsi.manage-propose": {
      const chap = input.chap ? object(input.chap) : null;
      return { method: "POST", url: "/api/storage/iscsi/actions", payload: { ...body, action: op, confirmed: true,
        ...(chap ? { chap: { ...omit(chap, "replacePassword"), ...(secrets.chapPassword ? { password: secrets.chapPassword } : {}) } } : {}) } };
    }
    case "cyberos.audio.control-propose":
      return op === "settings" ? { method: "PATCH", url: "/api/settings/audio", payload: { ...omit(body, "replaceToken", "clearToken"), ...(input.clearToken === true ? { cyberAudioToken: null } : {}), ...(secrets.audioToken ? { cyberAudioToken: secrets.audioToken } : {}) } }
        : { method: "POST", url: op === "reset" ? "/api/audio/session/reset" : op === "stop" ? "/api/audio/stop" : `/api/audio/test/${op.replace("_test", "")}`, ...(op === "speech_test" ? { payload: { text: input.text } } : {}) };
    case "cyberos.settings.proxy-propose": return { method: "PATCH", url: "/api/settings/proxy", payload: body };
    case "cyberos.backup.restore-propose": return { method: "POST", url: "/api/backup/restore", payload: { snapshotId: input.snapshotId, confirmed: true } };
    default: throw new CapabilityError("INVALID_ARGUMENT", "Unsupported system operation");
  }
}

async function pathSnapshot(context: CapabilityAdapterContext, input: CapabilityInput, system?: SystemManagementDependencies): Promise<JsonValue> {
  const pool = typeof input.storagePoolId === "string" ? input.storagePoolId : typeof input.inboxStoragePoolId === "string" ? input.inboxStoragePoolId : null;
  if (!pool) return null;
  const scope = await resolveStoragePoolScope(context.config.paths.dataRoot, system, pool);
  const paths = [input.path, input.targetDirectory, input.inboxPath, ...(Array.isArray(input.sourcePaths) ? input.sourcePaths : []), ...(Array.isArray(input.paths) ? input.paths : [])].filter((value): value is string => typeof value === "string");
  return json(await Promise.all(paths.map(async (name) => {
    const safe = await resolveScopedExistingPath(scope, name);
    await assertNoSymlinkPathSegments(safe.rootRealPath, safe.absolutePath);
    const stat = await lstat(safe.absolutePath);
    if (stat.isSymbolicLink() || (!stat.isDirectory() && !stat.isFile())) throw new CapabilityError("INVALID_ARGUMENT", "Only regular files or directories are supported");
    // A directory's mtime changes when unrelated siblings change; bind its identity.
    return { pool, path: safe.relativePath, dev: stat.dev, ino: stat.ino, ...(stat.isFile() ? { size: stat.size, mtime: stat.mtimeMs } : {}) };
  })));
}

async function revision(server: FastifyInstance, id: string, input: CapabilityInput, context: CapabilityAdapterContext, system?: SystemManagementDependencies): Promise<string> {
  const get = async (url: string) => object(await capabilityHttp(server, { method: "GET", url }));
  const states: unknown[] = [await pathSnapshot(context, input, system)];
  if (id === "cyberos.files.restore-propose") {
    const trash = getTrashEntry(context.db, String(input.trashEntryId));
    if (!trash || trash.restoredAt) throw new CapabilityError("CONFLICT", "Trash entry is missing or already restored");
    const scope = await resolveStoragePoolScope(context.config.paths.dataRoot, system, trash.storagePoolId);
    const target = await resolveScopedTargetPath(scope, trash.originalPath);
    const targetExists = await lstat(target.absolutePath).then(() => true).catch((error: NodeJS.ErrnoException) => { if (error.code === "ENOENT") return false; throw error; });
    if (targetExists) throw new CapabilityError("CONFLICT", "Restore destination already exists");
    // Trash is system-owned; only the database record supplies this host path.
    const trashed = await lstat(trash.trashPath);
    const parent = await resolveScopedExistingPath(scope, path.posix.dirname(target.relativePath));
    const parentStat = await lstat(parent.realPath);
    states.push(trash, { dev: trashed.dev, ino: trashed.ino, size: trashed.size, mtime: trashed.mtimeMs, parentDev: parentStat.dev, parentIno: parentStat.ino });
  } else if (id === "cyberos.files.batch-cancel-propose") {
    const batch = getFileBatch(context.db, String(input.batchId));
    if (!batch || !["queued", "running"].includes(batch.status)) throw new CapabilityError("CONFLICT", "Batch is no longer cancellable");
    states.push({ id: batch.id });
  } else if (id.startsWith("cyberos.nvr.")) {
    if (input.deviceId) {
      const device = await get(`/api/nvr/devices/${identifier(input.deviceId)}`);
      states.push(cameraConfiguration(device));
    } else {
      const overview = await get("/api/nvr");
      states.push(overview.policy, (Array.isArray(overview.devices) ? overview.devices : []).map((device) => object(device).id));
    }
  } else if (id.startsWith("cyberos.tailscale.")) {
    const status = object((await get("/api/system/tailscale")).tailscale);
    if (input.expectedRevision !== undefined && input.expectedRevision !== status.revision) throw new CapabilityError("CONFLICT", "Tailscale revision changed");
    states.push(status.revision, status.pendingTransaction ?? status.transaction ?? null);
  } else if (id.startsWith("cyberos.iscsi.")) {
    const result = await get("/api/storage/iscsi");
    const status = object(result.summary ?? result.iscsi ?? result);
    if (input.expectedRevision !== status.revision) throw new CapabilityError("CONFLICT", "iSCSI revision changed");
    states.push(status.revision);
  } else if (id.startsWith("cyberos.bluetooth.")) {
    states.push((await get("/api/system/bluetooth/settings")).settings);
    if (input.transferId) {
      const transfer = getBluetoothTransfer(context.db, String(input.transferId));
      if (!transfer || !["queued", "running", "paused"].includes(transfer.status)) throw new CapabilityError("CONFLICT", "Transfer is no longer cancellable");
      states.push({ id: transfer.id });
    }
    if (input.adapterId) {
      const status = object((await get("/api/system/bluetooth")).bluetooth);
      const adapter = (Array.isArray(status.adapters) ? status.adapters : []).find((item) => object(item).id === input.adapterId);
      if (!adapter) throw new CapabilityError("CONFLICT", "Bluetooth adapter is unavailable");
      const a = object(adapter);
      states.push({ id: a.id, powered: a.powered });
      if (input.address) {
        const device = (Array.isArray(status.devices) ? status.devices : []).find((item) => object(item).adapterId === input.adapterId && object(item).address === input.address);
        if (!device) throw new CapabilityError("CONFLICT", "Bluetooth device is unavailable");
        const d = object(device);
        states.push({ address: d.address, paired: d.paired, trusted: d.trusted, connected: d.connected });
      }
    }
  } else if (id.startsWith("cyberos.audio.")) states.push(await get("/api/settings/audio"));
  else if (id.startsWith("cyberos.photos.")) states.push((await get("/api/settings/photos/semantic-search")).settings);
  else if (id.startsWith("cyberos.settings.proxy")) states.push(await get("/api/settings/proxy"));
  else if (id.startsWith("cyberos.backup.")) {
    states.push(getBackupSettings(context.db));
  } else if (id.startsWith("cyberos.downloads.") && input.previewId) {
    const preview = await get(`/api/downloads/torrent-previews/${identifier(input.previewId)}`);
    states.push(preview);
  }
  return digest(states);
}

export function systemDomainLink(id: string, result: JsonValue): { domainTask?: { kind: string; id: string } } {
  if (!result || typeof result !== "object" || Array.isArray(result)) return {};
  const value = object(result);
  if (id === "cyberos.index.reindex-propose" && value.task) {
    const task = object(value.task);
    if (typeof task.id === "string" && typeof task.generation === "number" && Number.isSafeInteger(task.generation) && task.generation > 0) {
      return { domainTask: { kind: "index_task", id: JSON.stringify([task.id, task.generation]) } };
    }
  }
  if (id === "cyberos.downloads.preview-propose" && value.preview && typeof object(value.preview).id === "string") return { domainTask: { kind: "torrent_preview", id: String(object(value.preview).id) } };
  const fields = id.includes("batch") ? [["batch", "file_batch"]] : id.startsWith("cyberos.photos.") ? [["job", "photos_job"]]
    : id.startsWith("cyberos.downloads.") ? [["task", "download_task"]] : id.startsWith("cyberos.docker.") ? [["operation", "docker_operation"]]
    : id.startsWith("cyberos.vm.") ? [["operation", "vm_operation"]] : id.startsWith("cyberos.backup.") ? [["run", "backup_run"]] : [];
  for (const [key, type] of fields) if (value[key!] && typeof object(value[key!]).id === "string") return { domainTask: { kind: type!, id: String(object(value[key!]).id) } };
  if (id.startsWith("cyberos.backup.") && typeof value.id === "string") return { domainTask: { kind: "backup_run", id: value.id } };
  if (id.startsWith("cyberos.bluetooth.") && Array.isArray(value.transfers) && value.transfers.length > 0) {
    const ids = value.transfers.map((transfer) => String(object(transfer).id));
    return { domainTask: { kind: ids.length === 1 ? "bluetooth_transfer" : "bluetooth_batch", id: ids.length === 1 ? ids[0]! : JSON.stringify(ids) } };
  }
  return {};
}

async function torrentFile(server: FastifyInstance, context: CapabilityAdapterContext, input: CapabilityInput, system?: SystemManagementDependencies): Promise<JsonValue> {
  const scope = await resolveStoragePoolScope(context.config.paths.dataRoot, system, String(input.storagePoolId));
  const safe = await resolveScopedExistingPath(scope, String(input.path));
  await assertNoSymlinkPathSegments(safe.rootRealPath, safe.absolutePath);
  const file = await open(safe.absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 16 * 1024 * 1024) throw new CapabilityError("INVALID_ARGUMENT", "Torrent must be a regular file of at most 16 MiB");
    const data = Buffer.alloc(stat.size + 1);
    let offset = 0;
    while (offset < data.length) {
      const read = await file.read(data, offset, data.length - offset, offset);
      if (!read.bytesRead) break;
      offset += read.bytesRead;
    }
    const after = await file.stat();
    if (offset !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new CapabilityError("CONFLICT", "Torrent changed while reading");
    const boundary = "cyberos-mcp-torrent";
    const payload = Buffer.concat([Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="torrent"; filename="source.torrent"\r\nContent-Type: application/x-bittorrent\r\n\r\n`), data.subarray(0, stat.size), Buffer.from(`\r\n--${boundary}--\r\n`)]);
    const response = await server.inject({ method: "POST", url: "/api/downloads/torrent-previews", payload, headers: { "content-type": `multipart/form-data; boundary=${boundary}` } });
    if (response.statusCode >= 400) throw new CapabilityError("INVALID_ARGUMENT", "Torrent preview could not be created");
    return response.json<JsonValue>();
  } finally { await file.close(); }
}

export function createSystemMutationAdapters(server: FastifyInstance, system?: SystemManagementDependencies): Record<string, CapabilityDomainAdapter> {
  return Object.fromEntries(SYSTEM_CAPABILITY_ENTRIES.filter((entry) => entry.approval !== "none" && entry.domain !== "tasks").map(({ capabilityId: id }) => {
    const parse = (value: JsonValue, context: CapabilityAdapterContext) => {
      if (context.subject.kind !== "pi") throw new CapabilityError("FORBIDDEN", "Only the built-in Pi agent may propose changes");
      const input = object(validateCapability(id, { request: value }).request);
      if (input.replaceToken === true && input.clearToken === true) throw new CapabilityError("INVALID_ARGUMENT", "Replace and clear are mutually exclusive");
      for (const key of ["onvifUrl", "baseUrl", "cyberAudioBaseUrl", "controlUrl"]) if (typeof input[key] === "string") {
        let url: URL;
        try { url = new URL(input[key]); } catch { throw new CapabilityError("INVALID_ARGUMENT", "A valid service URL is required"); }
        if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new CapabilityError("INVALID_ARGUMENT", "Service URLs must use HTTP or HTTPS without credentials, query or fragment");
      }
      return input;
    };
    const preparedInput = (prepared: PreparedCapabilityAction, context: CapabilityAdapterContext) => parse(object(prepared.privatePayload).request ?? null, context);
    const revalidate = async (prepared: PreparedCapabilityAction, context: CapabilityAdapterContext) => {
      const input = preparedInput(prepared, context);
      if (await revision(server, id, input, context, system) !== prepared.revision) throw new CapabilityError("CONFLICT", "Target changed after approval was requested");
    };
    const adapter: CapabilityDomainAdapter = {
      availability: () => ({ available: true }),
      prepare: async (value, context) => {
        const input = parse(value, context);
        let expectedConfiguration: JsonValue = null;
        if (id === "cyberos.nvr.manage-propose" && input.deviceId) {
          const device = object(await capabilityHttp(server, { method: "GET", url: `/api/nvr/devices/${identifier(input.deviceId)}` }));
          if (device.updatedAt !== input.expectedUpdatedAt) throw new CapabilityError("CONFLICT", "Camera revision changed");
          expectedConfiguration = cameraConfiguration(device);
        } else if (id === "cyberos.nvr.manage-propose" && input.operation === "policy") {
          expectedConfiguration = object(await capabilityHttp(server, { method: "GET", url: "/api/nvr" })).policy ?? null;
        }
        const requiredSecrets = requirements(id, input);
        if (id === "cyberos.iscsi.manage-propose" && input.operation === "update_target" && object(input.chap).enabled === true && !requiredSecrets.length) {
          const result = object(await capabilityHttp(server, { method: "GET", url: "/api/storage/iscsi" }));
          const summary = object(result.summary ?? result.iscsi ?? result);
          const target = (Array.isArray(summary.targets) ? summary.targets : []).find((item) => object(item).id === input.targetId);
          if (!target) throw new CapabilityError("CONFLICT", "iSCSI target is unavailable");
          if (!object(target).credentialConfigured) requiredSecrets.push(secret("chapPassword", "iSCSI CHAP password", 16, 12));
        }
        return { summary: `${id.replace("cyberos.", "")}: ${String(input.operation)}`, target: omit(input, "command"), changes: input,
          revision: await revision(server, id, input, context, system), privatePayload: { request: input, expectedConfiguration }, requiredSecrets };
      },
      revalidate,
      execute: async (prepared, context, secrets) => {
        await revalidate(prepared, context);
        const input = preparedInput(prepared, context);
        const request = systemMutationRequest(id, input, secrets);
        const expectedConfiguration = object(prepared.privatePayload).expectedConfiguration;
        if (id === "cyberos.nvr.manage-propose" && expectedConfiguration) request.url += `?${new URLSearchParams({ expectedConfiguration: JSON.stringify(expectedConfiguration) })}`;
        const result = id === "cyberos.downloads.preview-propose" && input.operation === "file" ? await torrentFile(server, context, input, system)
          : await capabilityHttp(server, request);
        return { data: safeCapabilityResult(result), ...systemDomainLink(id, result) };
      }
    };
    return [id, adapter];
  }));
}
