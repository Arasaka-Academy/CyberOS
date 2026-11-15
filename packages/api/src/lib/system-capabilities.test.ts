import Fastify, { type FastifyInstance } from "fastify";
import { mkdtemp, mkdir, readFile, rm, writeFile, symlink } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createMcpClient, createSession, createUserMessageAndJob, decideCapabilityApproval, enqueueIndexTask, getCapabilityApprovalByRun, getFileBatch, getSystemProxySettings, linkAgentJobToCapabilityRun, openCyberOsDb, saveSystemProxySettings, claimNextTorrentPreview, completeTorrentPreview, createDownloadTask, createBluetoothSendTransfers, transitionCapabilityRun, createCapabilityRun, type CyberOsDatabase } from "@cyberos/db";
import { createCatalogDescriptors, type JsonValue } from "@cyberos/capabilities";
import { executeApprovedCapabilityRun, type CapabilityAdapterContext } from "@cyberos/capability-runtime";
import { createClientRuntime, invokeCapability, ownedDomainTask, type McpRuntimeDependencies } from "@cyberos/mcp";
import { loadCyberOsRuntime, unavailableTailscaleStatus, type IscsiSummary } from "@cyberos/shared";
import { createSystemReadAdapters } from "./system-read-capabilities.js";
import { createCapabilityAdapters } from "./capability-adapters.js";
import { createSystemMutationAdapters, systemDomainLink } from "./system-mutation-capabilities.js";
import { capabilityHttp, collectionPage, object, redactCapability, safeCapabilityResult, validateCapability } from "./capability-io.js";
import { buildServer } from "../server.js";
import { registerIscsiRoutes } from "../routes/iscsi.js";
import { registerTailscaleRoutes } from "../routes/tailscale.js";
import type { ApiRouteContext } from "../context.js";

let root: string;
let db: CyberOsDatabase;
let server: FastifyInstance;
let context: CapabilityAdapterContext;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "system-mcp-"));
  db = openCyberOsDb(path.join(root, "state.sqlite"));
  context = { db, config: loadCyberOsRuntime({ CYBEROS_ROOT: root, CYBEROS_ENVIRONMENT: "development" }, root), capabilityId: "cyberos.settings.proxy-propose",
    subject: { id: "pi", clientId: "pi", kind: "pi", scopes: new Set() } };
  server = Fastify();
});
afterEach(async () => { await server.close(); db.close(); await rm(root, { recursive: true, force: true }); });
const subjectContext = () => ({ subject: context.subject, traceId: "test", services: {} });
const deps = (): McpRuntimeDependencies => ({ db, config: context.config, readAdapters: createSystemReadAdapters(server), adapters: createCapabilityAdapters(server, { resourceBaseUrl: "http://127.0.0.1" }) });
const storageSystem = () => ({ commandRunner: { async run(command: string) {
  if (command === "findmnt") return JSON.stringify({ filesystems: [{ source: "/dev/md/pool-1", target: path.join(context.config.paths.dataRoot, "pool-1"), fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
  if (command === "mdadm") return "ARRAY /dev/md/pool-1 name=pool-1 UUID=test";
  if (command === "smartctl") return JSON.stringify({ devices: [] });
  return JSON.stringify({ blockdevices: [] });
} } });

describe("system capability boundaries", () => {
  it("bounds and redacts nested configuration, logs and large output", () => {
    const result = safeCapabilityResult({ password: "hidden", nested: { environment: ["KEY=hidden"], url: "http://user:hidden@host/path", apiKey: "hidden" }, logs: "Authorization: Bearer hidden", values: Array.from({ length: 200 }, () => "字".repeat(10000)) });
    expect(JSON.stringify(result).includes("hidden")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(256 * 1024);
    expect(result).toMatchObject({ truncated: true });
    expect(redactCapability({ passwordConfigured: true })).toEqual({ passwordConfigured: true });
  });
  it("fingerprints pagination and rejects reused cursors from another query", () => {
    const first = object(collectionPage([{ id: "a" }, { id: "b" }], { limit: 1 }, { taskId: "one" }));
    expect(collectionPage([{ id: "a" }, { id: "b" }], { limit: 1, cursor: first.nextCursor! }, { taskId: "one" })).toMatchObject({ items: [{ id: "b" }], nextCursor: null });
    expect(() => collectionPage([], { cursor: first.nextCursor! }, { taskId: "other" })).toThrow();
  });
  it("paginates by actual returned rows when byte limits reduce the page", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ id: index, text: "x".repeat(9000) }));
    const first = object(collectionPage(items, { limit: 20 }, "large-page"));
    expect((first.items as JsonValue[]).length).toBeLessThan(20);
    const second = object(collectionPage(items, { limit: 20, cursor: first.nextCursor! }, "large-page"));
    expect([...(first.items as JsonValue[]), ...(second.items as JsonValue[])]).toEqual(items);
  });
  it("reads daemon JSON as redacted structured configuration", async () => {
    server.get("/api/docker/daemon/config", async () => ({ config: { revision: "revision", content: JSON.stringify({ dns: ["1.1.1.1"], auths: { registry: { auth: "hidden" } } }) } }));
    const result = await createSystemReadAdapters(server)["cyberos.docker.get"]!({ entity: "daemon" }, subjectContext(), deps());
    expect(result).toMatchObject({ config: { revision: "revision", configuration: { dns: ["1.1.1.1"], auths: "[redacted]" } } });
    expect(JSON.stringify(result)).not.toContain("hidden");
    expect(JSON.stringify(redactCapability({ rtspUri: "rtsp://user:hidden@camera/path" }))).not.toContain("hidden");
  });
  it("uses bounded NVR keyset pages and rejects cursor reuse across cameras", async () => {
    const requests: Array<Record<string, unknown>> = [];
    server.get("/api/nvr/events", async (request) => {
      const q = request.query as Record<string, string>;
      requests.push(q);
      return q.cursorId ? [{ id: "a", occurredAt: "2026-11-15T00:00:00Z" }] : [{ id: "c", occurredAt: "2026-11-15T00:00:00Z" }, { id: "b", occurredAt: "2026-11-15T00:00:00Z" }];
    });
    const read = createSystemReadAdapters(server)["cyberos.nvr.query"]!;
    const input = { entity: "events", deviceId: "camera", from: "2026-11-15T00:00:00Z", to: "2026-11-16T00:00:00Z", limit: 1 };
    const first = object(await read(input, subjectContext(), deps()));
    const second = object(await read({ ...input, cursor: first.nextCursor! }, subjectContext(), deps()));
    expect(first).toMatchObject({ items: [{ id: "c" }] });
    expect(second).toMatchObject({ items: [{ id: "a" }] });
    expect(requests[0]).toMatchObject({ limit: "2" });
    expect(requests[1]).toMatchObject({ cursorId: "c" });
    await expect(read({ ...input, deviceId: "other", cursor: first.nextCursor! }, subjectContext(), deps())).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("forwards advanced photo queries and always omits sensitive metadata", async () => {
    let posted: unknown;
    server.post("/api/photos/query", async (request) => { posted = request.body; return { photos: [], nextCursor: null }; });
    server.get("/api/photos/:id/metadata", async (request) => ({ query: request.query, metadata: [] }));
    const reads = createSystemReadAdapters(server);
    const input = { filters: { cameraModels: ["Alpha"], advanced: { mode: "all", conditions: [{ key: "EXIF:ISO", operator: "between", value: 100, valueTo: 800 }] } }, limit: 2, sort: { field: "captured_at", direction: "desc" } };
    await reads["cyberos.photos.query"]!(input, subjectContext(), deps());
    expect(posted).toEqual(input);
    expect(await reads["cyberos.photos.metadata"]!({ assetId: "photo" }, subjectContext(), deps())).toMatchObject({ query: {} });
    await expect(reads["cyberos.photos.metadata"]!({ assetId: "photo", includeSensitive: true }, subjectContext(), deps())).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
  it("keeps native photo cursors aligned with the rows that fit the output budget", async () => {
    const photos = Array.from({ length: 45 }, (_, index) => ({ id: String(index), path: "x".repeat(6000), name: "y".repeat(2000) }));
    server.post("/api/photos/query", async (request) => {
      const input = request.body as { limit?: number; cursor?: string };
      const offset = Number(input.cursor ?? 0);
      const end = Math.min(photos.length, offset + (input.limit ?? 40));
      return { photos: photos.slice(offset, end), nextCursor: end < photos.length ? String(end) : null };
    });
    const read = createSystemReadAdapters(server)["cyberos.photos.query"]!;
    const seen: string[] = [];
    let cursor: JsonValue = null;
    do {
      const page = object(await read({ limit: 40, ...(cursor ? { cursor } : {}) }, subjectContext(), deps()));
      seen.push(...(page.photos as Array<{ id: string }>).map((photo) => photo.id));
      cursor = page.nextCursor ?? null;
    } while (cursor);
    expect(seen).toEqual(photos.map((photo) => photo.id));
  });
  it.each([
    ["cyberos.docker.get", { entity: "logs", id: "container", tail: 2 }, "/api/docker/containers/container/logs?tail=2"],
    ["cyberos.alerts.get", { entity: "delivery", id: "delivery" }, "/api/monitoring/alerts/deliveries/delivery"],
    ["cyberos.audio.status", { view: "settings" }, "/api/settings/audio"],
    ["cyberos.tailscale.status", {}, "/api/system/tailscale?"],
    ["cyberos.iscsi.status", {}, "/api/storage/iscsi?"]
  ] as const)("calls the advertised domain branch %s", async (id, input, expectedUrl) => {
    let called = "";
    server.get("*", async (request) => { called = request.raw.url!; return { ok: true }; });
    await createSystemReadAdapters(server)[id]!(input as JsonValue, subjectContext(), deps());
    expect(called.replace(/\?$/u, "")).toBe(expectedUrl.replace(/\?$/u, ""));
  });
  it("never echoes upstream credentials through errors", async () => {
    server.post("/fail", async (_request, reply) => reply.code(400).send({ error: "password=hidden" }));
    await expect(capabilityHttp(server, { method: "POST", url: "/fail", payload: { password: "hidden" } })).rejects.toMatchObject({ message: "Domain operation failed (HTTP 400)" });
  });
  it("does not mutate before approval and rejects configuration drift", async () => {
    let value = { proxy: { protocol: "http", host: null, port: null } };
    let writes = 0;
    server.get("/api/settings/proxy", async () => value);
    server.patch("/api/settings/proxy", async () => { writes++; return { saved: true }; });
    const adapter = createSystemMutationAdapters(server)[context.capabilityId]!;
    const prepared = await adapter.prepare({ operation: "configure", protocol: "http", host: "127.0.0.1", port: 8080 }, context);
    expect(writes).toBe(0);
    value = { proxy: { protocol: "https", host: null, port: null } };
    await expect(adapter.execute(prepared, context, {})).rejects.toMatchObject({ code: "CONFLICT" });
    expect(writes).toBe(0);
    await expect(adapter.prepare({ operation: "configure", protocol: "http", host: null, port: null }, { ...context, subject: { ...context.subject, kind: "local" } })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("keeps secrets in the first-party input channel and rejects stale revisions", async () => {
    const revision = "a".repeat(64);
    server.get("/api/system/tailscale", async () => ({ tailscale: { revision, transaction: null } }));
    const adapter = createSystemMutationAdapters(server)["cyberos.tailscale.manage-propose"]!;
    const input = { operation: "login", controlUrl: "https://control.example", method: "auth_key", expectedRevision: revision };
    const prepared = await adapter.prepare(input, context);
    expect(prepared.requiredSecrets).toMatchObject([{ name: "tailscaleAuthKey" }]);
    await expect(adapter.prepare({ ...input, authKey: "hidden" }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
    await expect(adapter.prepare({ ...input, expectedRevision: "b".repeat(64) }, context)).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("exposes every new domain as an implemented adapter and hides proposals from external callers", async () => {
    const dependencies = deps();
    const client = createMcpClient(db, { name: "external", kind: "local", scopes: createCatalogDescriptors().flatMap((item) => [...item.requiredScopes]) });
    const runtime = createClientRuntime(dependencies, client);
    expect(runtime.registry.get("cyberos.nvr.query")).toBeDefined();
    expect(runtime.registry.get("cyberos.nvr.manage-propose")).toBeNull();
    expect(runtime.registry.get("cyberos.settings.proxy-propose")).toBeNull();
  });
  it("tracks owned background tasks after submission and cancels only supported tasks", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:tasks:read", "cyberos:tasks:propose"] });
    const download = createDownloadTask(db, { url: "https://example.test/file", storagePoolId: "pool-1", targetDirectory: ".", targetFileName: "file", targetPath: "file" });
    const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.downloads.manage-propose", risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", domainOperationType: "download_task", domainOperationId: download.id });
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ submissionCompleted: true, task: { state: "queued", terminal: false, cancellable: true } });
    expect(() => ownedDomainTask(db, "another-client", run.id)).toThrow();
    const adapter = deps().adapters!["cyberos.tasks.cancel-propose"]!;
    const ownedContext = { ...context, subject: { ...context.subject, id: client.id, clientId: client.id } };
    const prepared = await adapter.prepare({ operation: "cancel", runId: run.id }, ownedContext);
    server.post(`/api/downloads/${download.id}/cancel`, async () => {
      db.prepare("UPDATE download_tasks SET status='cancelled' WHERE id=?").run(download.id); return { task: { id: download.id } };
    });
    await adapter.execute(prepared, ownedContext, {});
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "cancelled", terminal: true, cancellable: false } });
    await expect(adapter.execute(prepared, ownedContext, {})).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("waits for domain completion after the capability submission has succeeded", async () => {
    const client = createMcpClient(db, { name: "tasks", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const download = createDownloadTask(db, { url: "https://example.test/file", storagePoolId: "pool-1", targetDirectory: ".", targetFileName: "file", targetPath: "file" });
    const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.downloads.manage-propose", risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", domainOperationType: "download_task", domainOperationId: download.id });
    const snapshot = ownedDomainTask(db, client.id, run.id);
    const timer = setTimeout(() => db.prepare("UPDATE download_tasks SET status='completed' WHERE id=?").run(download.id), 20);
    try {
      const result = await invokeCapability(createClientRuntime(deps(), client), "cyberos.tasks.wait", { runId: run.id, timeoutMs: 1000, afterRevision: snapshot.revision });
      expect(result).toMatchObject({ data: { submissionCompleted: true, task: { state: "completed", terminal: true } } });
    } finally { clearTimeout(timer); }
    db.prepare("DELETE FROM download_tasks WHERE id=?").run(download.id);
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "unavailable", cancellable: false } });
  });
  it("tracks every Bluetooth transfer and cancels the remaining members of a group", async () => {
    const client = createMcpClient(db, { name: "group", kind: "pi", scopes: ["cyberos:tasks:read", "cyberos:tasks:propose"] });
    const transfers = createBluetoothSendTransfers(db, { adapterId: "adapter-test", deviceAddress: "AA:BB:CC:DD:EE:FF", storagePoolId: "pool-1", files: ["one", "two"].map((name) => ({ relativePath: name, displayName: name, totalBytes: 10 })) });
    const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.bluetooth.manage-propose", risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", progress: { ...systemDomainLink("cyberos.bluetooth.manage-propose", { transfers: transfers.map((transfer) => ({ id: transfer.id })) }) } });
    expect(ownedDomainTask(db, client.id, run.id).task?.children).toHaveLength(2);
    db.prepare("UPDATE bluetooth_transfers SET status='completed' WHERE id=?").run(transfers[0]!.id);
    server.post("/api/system/bluetooth/transfers/:id/cancel", async (request) => {
      const id = (request.params as { id: string }).id;
      db.prepare("UPDATE bluetooth_transfers SET status='cancelled' WHERE id=?").run(id);
      return { saved: true };
    });
    const adapter = deps().adapters!["cyberos.tasks.cancel-propose"]!;
    const ownedContext = { ...context, subject: { ...context.subject, id: client.id, clientId: client.id } };
    const prepared = await adapter.prepare({ operation: "cancel", runId: run.id }, ownedContext);
    await adapter.execute(prepared, ownedContext, {});
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "cancelled", terminal: true, children: [{ state: "completed" }, { state: "cancelled" }] } });
  });
  it("tracks index generations through queue removal, archival and supersession", () => {
    const client = createMcpClient(db, { name: "index", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const queued = enqueueIndexTask(db, { storagePoolId: "pool-1", path: ".", recursive: true, kind: "manual" });
    const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.index.reindex-propose", risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", progress: { ...systemDomainLink(run.capabilityId, { task: { ...queued } }) } });
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { kind: "index_task", state: "queued", terminal: false, cancellable: false } });
    const indexId = `queue:${queued.id}:${queued.generation}:0000000000:attempt`;
    db.prepare("INSERT INTO index_runs (id,storage_pool_id,status,started_at,scanned,indexed) VALUES (?,?,'running',?,4,3)").run(indexId, "pool-1", new Date().toISOString());
    db.prepare("UPDATE index_queue SET status='running' WHERE id=?").run(queued.id);
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "running", progress: { scanned: 4, indexed: 3 } } });
    db.prepare("UPDATE index_runs SET status='completed' WHERE id=?").run(indexId);
    db.prepare("DELETE FROM index_queue WHERE id=?").run(queued.id);
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "completed", terminal: true } });
    db.prepare("INSERT INTO index_run_history (id,storage_pool_id,status,started_at,scanned,indexed) SELECT id,storage_pool_id,status,started_at,scanned,indexed FROM index_runs WHERE id=?").run(indexId);
    db.prepare("DELETE FROM index_runs WHERE id=?").run(indexId);
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "completed", progress: { scanned: 4 } } });
    const next = enqueueIndexTask(db, { storagePoolId: "pool-1" });
    const nextRun = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: run.capabilityId, risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: nextRun.id, expectedRevision: nextRun.revision, from: ["queued"], to: "succeeded", progress: { ...systemDomainLink(run.capabilityId, { task: { ...next } }) } });
    enqueueIndexTask(db, { storagePoolId: "pool-1" });
    expect(ownedDomainTask(db, client.id, nextRun.id)).toMatchObject({ task: { state: "superseded", terminal: true } });
  });
  it("paginates task runs without exposing another client's tasks", async () => {
    const own = createMcpClient(db, { name: "own", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const other = createMcpClient(db, { name: "other", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const ownIds: string[] = [];
    for (const client of [own, other, own, other, own]) {
      const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.downloads.manage-propose", risk: "high", redactedInput: {} });
      transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", progress: { domainTask: { kind: "download_task", id: "shared" } } });
      if (client.id === own.id) ownIds.push(run.id);
    }
    const runtime = createClientRuntime(deps(), own);
    const result: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await invokeCapability(runtime, "cyberos.tasks.list", { limit: 1, ...(cursor ? { cursor } : {}) });
      result.push(...(object(page.data!).tasks as Array<{ runId: string }>).map((task) => task.runId));
      cursor = page.page!.nextCursor;
    } while (cursor);
    expect(result.sort()).toEqual(ownIds.sort());
  });
  it("keeps large task groups within page budgets and omits synchronous file operations", async () => {
    const client = createMcpClient(db, { name: "large-groups", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const transfers = createBluetoothSendTransfers(db, { adapterId: "adapter-test", deviceAddress: "AA:BB:CC:DD:EE:FF", storagePoolId: "pool-1", files: Array.from({ length: 100 }, (_, index) => ({ relativePath: `file-${index}`, displayName: `file-${index}`, totalBytes: 10 })) });
    const ids: string[] = [];
    for (let index = 0; index < 12; index++) {
      const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.bluetooth.manage-propose", risk: "high", redactedInput: {} });
      transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", progress: { ...systemDomainLink(run.capabilityId, { transfers: transfers.map((transfer) => ({ id: transfer.id })) }) } });
      ids.push(run.id);
    }
    const sync = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.files.mutate-propose", risk: "high", redactedInput: {} });
    transitionCapabilityRun(db, { runId: sync.id, expectedRevision: sync.revision, from: ["queued"], to: "succeeded", domainOperationType: "file_operation", domainOperationId: "sync" });
    expect(ownedDomainTask(db, client.id, sync.id).task).toBeNull();
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const page = await invokeCapability(createClientRuntime(deps(), client), "cyberos.tasks.list", { limit: 12, ...(cursor ? { cursor } : {}) });
      expect(Buffer.byteLength(JSON.stringify(page.data))).toBeLessThan(132 * 1024);
      const tasks = object(page.data!).tasks as Array<{ runId: string }>;
      expect(tasks.length).toBeLessThan(12);
      seen.push(...tasks.map((task) => task.runId));
      cursor = page.page!.nextCursor;
    } while (cursor);
    expect(seen.sort()).toEqual(ids.sort());
  });
  it.each(["download_task", "file_batch", "photos_job", "docker_operation", "vm_operation", "backup_run", "music_scan", "media_scan", "bluetooth_transfer", "torrent_preview", "alert_delivery", "job"])("reads the persisted schema of %s without exposing arbitrary columns", (kind) => {
    const client = createMcpClient(db, { name: "schema", kind: "pi", scopes: ["cyberos:tasks:read"] });
    const run = createCapabilityRun(db, { clientId: client.id, subjectId: client.id, subjectKind: "pi", capabilityId: "cyberos.tasks.get", risk: "read", redactedInput: {} });
    transitionCapabilityRun(db, { runId: run.id, expectedRevision: run.revision, from: ["queued"], to: "succeeded", domainOperationType: kind, domainOperationId: "missing" });
    expect(ownedDomainTask(db, client.id, run.id)).toMatchObject({ task: { state: "unavailable" } });
  });
  it("guards storage file identities across approval and rejects symlink sources", async () => {
    const pool = path.join(context.config.paths.dataRoot, "pool-1");
    await mkdir(pool, { recursive: true });
    await writeFile(path.join(pool, "archive.zip"), "original");
    await symlink("archive.zip", path.join(pool, "link.zip"));
    const system = { commandRunner: { async run(command: string) {
      if (command === "findmnt") return JSON.stringify({ filesystems: [{ source: "/dev/md/pool-1", target: pool, fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
      if (command === "mdadm") return "ARRAY /dev/md/pool-1 name=pool-1 UUID=test";
      if (command === "smartctl") return JSON.stringify({ devices: [] });
      return JSON.stringify({ blockdevices: [] });
    } } };
    const adapter = createSystemMutationAdapters(server, system)["cyberos.files.extract-propose"]!;
    const prepared = await adapter.prepare({ operation: "extract", storagePoolId: "pool-1", path: "archive.zip" }, context);
    await writeFile(path.join(pool, "archive.zip"), "replaced source");
    await expect(adapter.revalidate(prepared, context)).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(adapter.prepare({ operation: "extract", storagePoolId: "pool-1", path: "link.zip" }, context)).rejects.toThrow();
    await expect(adapter.prepare({ operation: "extract", storagePoolId: "pool-1", path: "../outside.zip" }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});

describe("system capabilities through real API and approval persistence", () => {
  it("restores trash, extracts archives and completes a tracked file batch through real routes", async () => {
    const pool = path.join(context.config.paths.dataRoot, "pool-1");
    await mkdir(path.join(pool, "dest"), { recursive: true });
    await writeFile(path.join(pool, "hello.txt"), "original");
    await writeFile(path.join(pool, "payload.txt.gz"), gzipSync("extracted"));
    await server.close();
    server = await buildServer({ config: context.config, db, system: storageSystem() });
    const adapters = createSystemMutationAdapters(server, storageSystem());
    const trashed = await server.inject({ method: "POST", url: "/api/files/mutations", payload: { operation: "trash", storagePoolId: "pool-1", sourcePath: "hello.txt" } });
    expect(trashed.statusCode).toBe(201);
    const trashEntryId = (trashed.json() as { operation: { metadata: { trashEntryId: string } } }).operation.metadata.trashEntryId;
    const restore = adapters["cyberos.files.restore-propose"]!;
    const prepared = await restore.prepare({ operation: "restore", trashEntryId }, context);
    await expect(readFile(path.join(pool, "hello.txt"))).rejects.toMatchObject({ code: "ENOENT" });
    await restore.execute(prepared, context, {});
    expect(await readFile(path.join(pool, "hello.txt"), "utf8")).toBe("original");
    await expect(restore.execute(prepared, context, {})).rejects.toMatchObject({ code: "CONFLICT" });
    const extract = adapters["cyberos.files.extract-propose"]!;
    await extract.execute(await extract.prepare({ operation: "extract", storagePoolId: "pool-1", path: "payload.txt.gz" }, context), context, {});
    expect(await readFile(path.join(pool, "payload.txt"), "utf8")).toBe("extracted");
    const batch = adapters["cyberos.files.batch-propose"]!;
    const result = await batch.execute(await batch.prepare({ operation: "move", storagePoolId: "pool-1", sourcePaths: ["hello.txt", "payload.txt"], targetDirectory: "dest" }, context), context, {});
    expect(result.domainTask?.kind).toBe("file_batch");
    await expect.poll(() => getFileBatch(db, result.domainTask!.id)?.status).toBe("completed");
    expect(await readFile(path.join(pool, "dest/hello.txt"), "utf8")).toBe("original");
    const history = object(await createSystemReadAdapters(server)["cyberos.files.history"]!({ storagePoolId: "pool-1", limit: 1 }, subjectContext(), deps()));
    expect(history.operations).toHaveLength(1);
    expect(history.nextCursor).toEqual(expect.any(String));
  });
  it("imports a confined torrent, pages selected files, creates a task and stops seeding", async () => {
    const pool = path.join(context.config.paths.dataRoot, "pool-1");
    await mkdir(pool, { recursive: true });
    await writeFile(path.join(pool, "source.torrent"), "d4:infod4:name7:releaseee");
    await server.close();
    server = await buildServer({ config: context.config, db, system: storageSystem() });
    const adapter = createSystemMutationAdapters(server, storageSystem())["cyberos.downloads.preview-propose"]!;
    const result = await adapter.execute(await adapter.prepare({ operation: "file", storagePoolId: "pool-1", path: "source.torrent" }, context), context, {});
    expect(result.domainTask?.kind).toBe("torrent_preview");
    const preview = claimNextTorrentPreview(db, { workerId: "fixture", leaseMs: 30_000 })!;
    expect(preview.id).toBe(result.domainTask!.id);
    completeTorrentPreview(db, { id: preview.id, workerId: "fixture", infoHash: "0123456789012345678901234567890123456789", name: "release", metainfo: Buffer.from("fixture"), totalBytes: 42, isPrivate: false, files: [{ fileIndex: 0, path: "release/one.txt", sizeBytes: 21 }, { fileIndex: 1, path: "release/two.txt", sizeBytes: 21 }] });
    const reads = createSystemReadAdapters(server);
    const page = object(await reads["cyberos.downloads.preview"]!({ previewId: preview.id, limit: 1 }, subjectContext(), deps()));
    expect(page.files).toMatchObject({ total: 2, nextCursor: expect.any(String) });
    const manage = createCapabilityAdapters(server, { resourceBaseUrl: "http://127.0.0.1", system: storageSystem() })["cyberos.downloads.manage-propose"]!;
    const request = { operation: "create_torrent", torrentPreviewId: preview.id, selectedFileIndices: [1], storagePoolId: "pool-1", targetDirectory: ".", fileName: "release" };
    expect(() => validateCapability("cyberos.downloads.manage-propose", { request: { ...request, seedRatioLimit: 2 } })).toThrow();
    const task = await manage.execute(await manage.prepare(request, context), context, {});
    expect(task).toMatchObject({ data: { task: { selectedFileCount: 1, totalBytes: 21, seedRatioLimit: 1, seedTimeLimitSeconds: 7200 } }, domainTask: { kind: "download_task" } });
    expect(await reads["cyberos.downloads.files"]!({ taskId: task.domainTask!.id }, subjectContext(), deps())).toMatchObject({ total: 2, items: [{ selected: false }, { selected: true }] });
    db.prepare("UPDATE download_tasks SET status='seeding' WHERE id=?").run(task.domainTask!.id);
    const stop = await manage.prepare({ operation: "stop_seeding", taskId: task.domainTask!.id }, context);
    expect(await manage.execute(stop, context, {})).toMatchObject({ data: { task: { status: "seeding", controlRequested: "stop_seeding" } } });
  });
  it("passes Tailscale secrets and revision guards through the real REST validators", async () => {
    const state = { ...unavailableTailscaleStatus("fixture"), available: true, revision: "a".repeat(64) };
    const commands: unknown[] = [];
    registerTailscaleRoutes(server, { config: context.config, system: { tailscaleManager: { request: async (input) => { if (input.action !== "status") commands.push(input); return state; } } } });
    const adapter = createSystemMutationAdapters(server)["cyberos.tailscale.manage-propose"]!;
    const prepared = await adapter.prepare({ operation: "login", controlUrl: "https://control.example", method: "auth_key", expectedRevision: state.revision }, context);
    const result = await adapter.execute(prepared, context, { tailscaleAuthKey: "private-auth-key" });
    expect(commands).toMatchObject([{ action: "login", input: { authKey: "private-auth-key", confirmed: true, expectedRevision: state.revision } }]);
    expect(JSON.stringify(result)).not.toContain("private-auth-key");
    state.revision = "b".repeat(64);
    await expect(adapter.execute(prepared, context, {})).rejects.toMatchObject({ code: "CONFLICT" });
    expect(commands).toHaveLength(1);
  });
  it("requests CHAP through secret input and accepts the real iSCSI summary envelope", async () => {
    const state: IscsiSummary = { collectedAt: "2026-11-15T00:00:00Z", revision: "a".repeat(64), available: true, error: null, listenAddresses: ["192.168.1.5"], pools: [], targets: [], images: [] };
    const commands: unknown[] = [];
    registerIscsiRoutes(server, { config: context.config, db } as ApiRouteContext, { read: async () => state, mutate: async (input) => { commands.push(input); return state; } });
    const adapter = createSystemMutationAdapters(server)["cyberos.iscsi.manage-propose"]!;
    const prepared = await adapter.prepare({ operation: "create_target", expectedRevision: state.revision, name: "Disk", address: "192.168.1.5", port: 3260, enabled: true,
      initiators: ["iqn.1991-05.com.microsoft:desktop"], chap: { enabled: true, username: "storage" } }, context);
    expect(prepared.requiredSecrets).toMatchObject([{ name: "chapPassword" }]);
    expect(commands).toHaveLength(0);
    const result = await adapter.execute(prepared, context, { chapPassword: "123456789012" });
    expect(commands).toMatchObject([{ action: "create_target", chap: { password: "123456789012" }, confirmed: true }]);
    expect(JSON.stringify(result)).not.toContain("123456789012");
    const targetId = "11111111-1111-4111-8111-111111111111";
    state.targets = [{ id: targetId, name: "Disk", iqn: "iqn.2026-11.test:disk", address: "192.168.1.5", port: 3260, enabled: false, chapEnabled: false, chapUsername: null, credentialConfigured: false, initiators: [], status: "disabled", error: null, luns: [], sessions: [] }];
    const updated = await adapter.prepare({ operation: "update_target", targetId, expectedRevision: state.revision, name: "Disk", address: "192.168.1.5", port: 3260,
      initiators: ["iqn.1991-05.com.microsoft:desktop"], chap: { enabled: true, username: "storage" } }, context);
    expect(updated.requiredSecrets).toMatchObject([{ name: "chapPassword" }]);
    await adapter.execute(updated, context, { chapPassword: "abcdefghijkl" });
    expect(commands[1]).toMatchObject({ action: "update_target", targetId, chap: { password: "abcdefghijkl" } });
  });
  it("does not invalidate semantic configuration approval on natural indexing progress", async () => {
    let progress = 0;
    let saved: unknown;
    server.get("/api/settings/photos/semantic-search", async () => ({ settings: { generation: 1 }, status: { indexed: progress++ } }));
    server.patch("/api/settings/photos/semantic-search", async (request) => { saved = request.body; return { settings: { apiKeyConfigured: true } }; });
    const adapter = createSystemMutationAdapters(server)["cyberos.photos.semantic-propose"]!;
    const prepared = await adapter.prepare({ operation: "configure", enabled: true, replaceToken: true }, context);
    await adapter.execute(prepared, context, { semanticApiKey: "private-semantic-key" });
    expect(saved).toEqual({ enabled: true, apiKey: "private-semantic-key" });
  });
  it("reads backup readiness and coverage and executes a proxy proposal exactly once", async () => {
    await server.close();
    server = await buildServer({ config: context.config, db });
    const dependencies = deps();
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:settings:read", "cyberos:settings:propose", "cyberos:backup:read"] });
    const runtime = createClientRuntime(dependencies, client);
    expect(await invokeCapability(runtime, "cyberos.backup.status", {})).toMatchObject({ data: { passwordConfigured: false, repositoryAvailable: false } });
    expect(await invokeCapability(runtime, "cyberos.backup.coverage", {})).toMatchObject({ data: { excluded: [{ data: "docker_named_volumes" }, { data: "iscsi_images_and_target_secrets" }] } });
    const input = { request: { operation: "configure", protocol: "http", host: "127.0.0.1", port: 8080 }, idempotencyKey: "proxy-once" };
    const proposed = await invokeCapability(runtime, "cyberos.settings.proxy-propose", input);
    expect(getSystemProxySettings(db)?.host ?? null).toBeNull();
    const session = createSession(db, {});
    const { job } = createUserMessageAndJob(db, { sessionId: session.id, content: "Set proxy", status: "waiting_approval" });
    linkAgentJobToCapabilityRun(db, { jobId: job.id, runId: proposed.runId! });
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, { approvalId: approval.id, expectedRevision: approval.revision, decision: "approved", decidedBy: "local-admin" })).not.toBeNull();
    expect(await executeApprovedCapabilityRun(dependencies, proposed.runId!)).toMatchObject({ state: "succeeded" });
    expect(getSystemProxySettings(db)).toMatchObject({ host: "127.0.0.1", port: 8080 });
    saveSystemProxySettings(db, { protocol: "http", host: "changed.example", port: 3128 });
    await executeApprovedCapabilityRun(dependencies, proposed.runId!);
    expect(getSystemProxySettings(db)?.host).toBe("changed.example");
  });
});
