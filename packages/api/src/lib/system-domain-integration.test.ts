import Fastify, { type FastifyInstance } from "fastify";
import { createServer, type Server } from "node:net";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getAudioSettings, openCyberOsDb, saveAudioSettings, type CyberOsDatabase } from "@cyberos/db";
import { loadCyberOsRuntime, type BluetoothStatus } from "@cyberos/shared";
import type { JsonValue } from "@cyberos/capabilities";
import type { CapabilityAdapterContext } from "@cyberos/capability-runtime";
import { buildServer } from "../server.js";
import { registerServiceDiagnosticsRoutes } from "../routes/service-diagnostics.js";
import { AudioCoordinator } from "./audio-coordinator.js";
import { unavailableAudioStatus, type AudioRuntime } from "./audio-runtime.js";
import { unavailableBluetoothStatus } from "./bluetooth-manager.js";
import { createSystemReadAdapters } from "./system-read-capabilities.js";
import { createSystemMutationAdapters } from "./system-mutation-capabilities.js";

let root: string;
let db: CyberOsDatabase;
let server: FastifyInstance;
let daemon: Server | undefined;
let context: CapabilityAdapterContext;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "mcp-domain-"));
  db = openCyberOsDb(path.join(root, "state.sqlite"));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: root, CYBEROS_ENVIRONMENT: "development" }, root);
  context = { db, config: { ...config, hostd: { ...config.hostd, socketPath: path.join(root, "hostd.sock") } },
    capabilityId: "cyberos.audio.control-propose", subject: { id: "pi", clientId: "pi", kind: "pi", scopes: new Set() } };
  server = Fastify();
});
afterEach(async () => {
  await server.close();
  if (daemon) await new Promise<void>((resolve, reject) => daemon!.close((error) => error ? reject(error) : resolve()));
  daemon = undefined;
  db.close();
  await rm(root, { recursive: true, force: true });
});
const readContext = () => ({ subject: context.subject, traceId: "integration", services: {} });
const dependencies = () => ({ db, config: context.config });
async function hostd(respond: (request: Record<string, unknown>) => unknown) {
  await mkdir(path.dirname(context.config.hostd.socketPath), { recursive: true });
  daemon = createServer((socket) => {
    const chunks: Buffer[] = [];
    socket.on("data", (chunk: Buffer) => chunks.push(chunk));
    socket.on("end", () => {
      const request = JSON.parse(Buffer.concat(chunks).toString()) as Record<string, unknown>;
      socket.end(`${JSON.stringify({ version: 1, id: request.id, ok: true, result: respond(request) })}\n`);
    });
  });
  await new Promise<void>((resolve, reject) => { daemon!.once("error", reject); daemon!.listen(context.config.hostd.socketPath, resolve); });
}

describe("system capability domain integration", () => {
  it("reads service diagnostics through the versioned hostd transport and rejects malformed replies", async () => {
    const requests: Record<string, unknown>[] = [];
    let malformed = false;
    await hostd((request) => {
      requests.push(request);
      if (malformed) return { services: "invalid", logs: [], truncated: false };
      const payload = request.payload as { action: string };
      return payload.action === "status"
        ? { services: [{ unit: "cyberos-api.service", loadState: "loaded", activeState: "failed", subState: "failed", result: "exit-code", exitStatus: "1" }], logs: [], truncated: false }
        : { services: [], logs: [{ timestampMicros: "1", message: "Authorization: Bearer private-token" }], truncated: false };
    });
    registerServiceDiagnosticsRoutes(server, { config: context.config });
    const reads = createSystemReadAdapters(server);
    expect(await reads["cyberos.system.services"]!({ unit: "cyberos-api.service" }, readContext(), dependencies())).toMatchObject({ services: [{ result: "exit-code", exitStatus: "1" }] });
    const logs = await reads["cyberos.system.logs"]!({ unit: "cyberos-api.service", limit: 2, since: "2026-11-15T00:00:00Z" }, readContext(), dependencies());
    expect(JSON.stringify(logs)).not.toContain("private-token");
    expect(requests.at(-1)).toMatchObject({ operation: "system.diagnostics", payload: { action: "logs", unit: "cyberos-api.service", limit: 2, since: "2026-11-15T00:00:00Z" } });
    const count = requests.length;
    expect((await server.inject({ method: "GET", url: "/api/system/services/cyberos-api.service/logs?limit=201" })).statusCode).toBe(400);
    expect(requests).toHaveLength(count);
    malformed = true;
    await expect(reads["cyberos.system.services"]!({}, readContext(), dependencies())).rejects.toMatchObject({ code: "NOT_READY" });
  });

  it("uses the actual Bluetooth controllers for adapter actions and confined, tracked transfers", async () => {
    const bluetooth: BluetoothStatus = { ...unavailableBluetoothStatus(), backend: "BlueZ", available: true, error: null,
      adapters: [{ id: "adapter-hci0", address: "00:11:22:33:44:55", name: "hci0", alias: "Host", state: "powered", powered: true, discovering: false, defaultAdapter: true }],
      devices: [{ adapterId: "adapter-hci0", address: "AA:BB:CC:DD:EE:FF", name: "Speaker", alias: "Speaker", type: "speaker", rssi: -42, paired: true, trusted: true, connected: true, servicesResolved: true, lastSeenAt: null }] };
    const actions: string[] = [];
    await hostd((request) => {
      const payload = request.payload as { action: string };
      if (request.operation === "bluetooth.manager" && payload.action !== "status") actions.push(payload.action);
      return bluetooth;
    });
    const pool = path.join(context.config.paths.dataRoot, "pool-1");
    await mkdir(pool, { recursive: true });
    await writeFile(path.join(pool, "one.txt"), "file");
    const system = { commandRunner: { async run(command: string) {
      if (command === "findmnt") return JSON.stringify({ filesystems: [{ source: "/dev/md/pool-1", target: pool, fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
      if (command === "mdadm") return "ARRAY /dev/md/pool-1 name=pool-1 UUID=test";
      if (command === "smartctl") return JSON.stringify({ devices: [] });
      return JSON.stringify({ blockdevices: [] });
    } } };
    await server.close();
    server = await buildServer({ config: context.config, db, system });
    const reads = createSystemReadAdapters(server);
    expect(await reads["cyberos.bluetooth.status"]!({}, readContext(), dependencies())).toMatchObject({ bluetooth: { available: true }, settings: { receiveEnabled: false } });
    const adapter = createSystemMutationAdapters(server, system)["cyberos.bluetooth.manage-propose"]!;
    const inputs: JsonValue[] = [
      { operation: "power", adapterId: "adapter-hci0", powered: true },
      { operation: "default_adapter", adapterId: "adapter-hci0" },
      ...["scan_start", "scan_stop"].map((operation) => ({ operation, adapterId: "adapter-hci0" })),
      ...["pair", "cancel_pairing", "connect", "disconnect", "unpair"].map((operation) => ({ operation, adapterId: "adapter-hci0", address: "AA:BB:CC:DD:EE:FF" })),
      { operation: "trust", adapterId: "adapter-hci0", address: "AA:BB:CC:DD:EE:FF", trusted: true },
      { operation: "settings", receiveEnabled: false }
    ];
    for (const input of inputs) {
      const prepared = await adapter.prepare(input, context);
      await adapter.execute(prepared, context, {});
    }
    expect(actions).toEqual(["adapter_power", "set_default_adapter", "scan_start", "scan_stop", "pair", "cancel_pairing", "connect", "disconnect", "unpair", "trust"]);
    const prepared = await adapter.prepare({ operation: "send", adapterId: "adapter-hci0", address: "AA:BB:CC:DD:EE:FF", storagePoolId: "pool-1", paths: ["one.txt"] }, context);
    const sent = await adapter.execute(prepared, context, {});
    expect(sent.domainTask).toMatchObject({ kind: "bluetooth_transfer" });
    expect(await reads["cyberos.bluetooth.transfers"]!({}, readContext(), dependencies())).toMatchObject({ items: [{ id: sent.domainTask!.id, status: "queued" }] });
    const cancellation = await adapter.prepare({ operation: "cancel_transfer", transferId: sent.domainTask!.id }, context);
    expect(await adapter.execute(cancellation, context, {})).toMatchObject({ data: { transfer: { status: "cancelled" } } });
    await expect(adapter.prepare({ operation: "pairing_respond", accept: true }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });

  it("configures audio with independent secret input and runs diagnostics through the real coordinator", async () => {
    let generation = 1;
    const played: string[] = [];
    const runtime: AudioRuntime = {
      status: async () => ({ ...unavailableAudioStatus(), available: true, connected: true, protocol: "ATVV", error: null, generation }),
      devices: async () => ({ inputs: [{ id: "remote", name: "Remote", connected: true }], outputs: [{ id: "speaker", name: "Speaker", connected: true }] }),
      configure: async () => {}, recording: async (id) => ({ id, deviceId: "remote", wav: "" }), ack: async () => {},
      play: async (wav) => { played.push(wav.toString()); }, stop: async () => ++generation
    };
    const audio = new AudioCoordinator(db, runtime, {
      test: async () => ({ reachable: true, authenticated: true, sttReady: true, ttsReady: true, voices: ["serena"], error: null }),
      transcribe: async () => "", synthesize: async (_settings, text) => Buffer.from(text)
    }, { acquire: async () => "lease", renew: async () => {}, release: async () => {} });
    await server.close();
    server = await buildServer({ config: context.config, db, audio });
    const adapter = createSystemMutationAdapters(server)["cyberos.audio.control-propose"]!;
    const input = { operation: "settings", cyberAudioBaseUrl: "https://audio.example", replaceToken: true, inputDeviceId: "remote", outputDeviceId: "speaker" };
    const prepared = await adapter.prepare(input, context);
    expect(prepared.requiredSecrets).toMatchObject([{ name: "audioToken" }]);
    expect(getAudioSettings(db)).toBeNull();
    expect(JSON.stringify(await adapter.execute(prepared, context, { audioToken: "private-audio-token" }))).not.toContain("private-audio-token");
    expect(getAudioSettings(db)?.cyberAudioToken).toBe("private-audio-token");
    const reads = createSystemReadAdapters(server);
    for (const view of ["status", "devices", "history", "settings"]) {
      const result = await reads["cyberos.audio.status"]!({ view }, readContext(), dependencies());
      expect(JSON.stringify(result)).not.toContain("private-audio-token");
    }
    const requests: JsonValue[] = [{ operation: "service_test" }, { operation: "speech_test", text: "test speech" }, { operation: "stop" }, { operation: "reset" }, { operation: "recording_test" }];
    for (const request of requests) {
      await adapter.execute(await adapter.prepare(request, context), context, {});
    }
    expect(played).toEqual(["test speech"]);
    const stale = await adapter.prepare({ operation: "stop" }, context);
    saveAudioSettings(db, { volume: 20 });
    await expect(adapter.execute(stale, context, {})).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(adapter.prepare({ ...input, cyberAudioToken: "private-audio-token" }, context)).rejects.toMatchObject({ code: "INVALID_ARGUMENT" });
  });
});
