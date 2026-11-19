/**
 * [INPUT]: 依赖临时 SQLite、Fastify 和真实下载命令路由。
 * [OUTPUT]: 验证停止确认、删除保留与每任务命令互斥。
 * [POS]: 下载删除的 HTTP 生命周期与观察版本回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import os from "node:os";
import path from "node:path";
import Fastify, { type FastifyInstance } from "fastify";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDownloadTask, getDownloadTask, openCyberOsDb, transitionDownloadTask, type CyberOsDatabase } from "@cyberos/db";
import { MonitoringReader } from "@cyberos/monitoring";
import { loadCyberOsRuntime, type DownloadTaskRecord } from "@cyberos/shared";
import { registerDownloadRoutes } from "./downloads.js";
import { DOWNLOAD_OBSERVATION_HEADER } from "./downloads-list.js";

let directory: string;
let root: string;
let db: CyberOsDatabase;
let app: FastifyInstance;

beforeEach(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-download-delete-"));
  root = path.join(directory, "data", "pool-1");
  await mkdir(root, { recursive: true });
  db = openCyberOsDb(path.join(directory, "test.sqlite"));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: directory }, directory);
  app = Fastify();
  registerDownloadRoutes(app, {
    config, db, monitoring: new MonitoringReader(config.paths.metricsDatabasePath, config.monitoring),
    system: { commandRunner: { async run(command: string) {
      if (command === "findmnt") return JSON.stringify({ filesystems: [{ source: "/dev/md/pool-1", target: root, fstype: "ext4", size: 1000, used: 100, avail: 900, "use%": "10%" }] });
      if (command === "mdadm") return "ARRAY /dev/md/pool-1 name=pool-1 UUID=test";
      if (command === "smartctl") return JSON.stringify({ devices: [] });
      return JSON.stringify({ blockdevices: [] });
    } } }
  });
  await app.ready();
  vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] });
});

afterEach(async () => {
  vi.useRealTimers();
  await app.close();
  db.close();
  await rm(directory, { recursive: true, force: true });
});

function task(status: DownloadTaskRecord["status"] = "running", leaseMs = 30_000): DownloadTaskRecord {
  const fileName = `${randomUUID()}.bin`;
  const created = createDownloadTask(db, {
    url: "https://example.com/file.bin", storagePoolId: "pool-1", targetDirectory: ".",
    targetFileName: fileName, targetPath: fileName
  });
  db.prepare("UPDATE download_tasks SET status = ?, worker_id = ?, lease_expires_at = ? WHERE id = ?")
    .run(status, status === "running" || status === "seeding" ? "worker-1" : null,
      status === "running" || status === "seeding" ? new Date(Date.now() + leaseMs).toISOString() : null, created.id);
  return getDownloadTask(db, created.id)!;
}

function remove(id: string) {
  return app.inject({ method: "DELETE", url: `/api/downloads/${id}` });
}

async function requested(id: string, control: string) {
  await vi.waitFor(() => expect(getDownloadTask(db, id)?.controlRequested).toBe(control));
}

function acknowledge(id: string, to: "cancelled" | "completed") {
  return transitionDownloadTask(db, { id, from: ["running", "seeding"], to });
}

describe("download removal", () => {
  it("keeps the row and partial until a running worker acknowledges cancel", async () => {
    const running = task();
    const partial = path.join(root, running.partialPath);
    await writeFile(partial, "partial");
    const response = remove(running.id).then((value) => value);
    await requested(running.id, "cancel");
    expect(getDownloadTask(db, running.id)?.status).toBe("running");
    await expect(access(partial)).resolves.toBeUndefined();
    acknowledge(running.id, "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    const result = await response;
    expect(result.statusCode).toBe(204);
    expect(JSON.parse(String(result.headers[DOWNLOAD_OBSERVATION_HEADER.toLowerCase()]))).toMatchObject({ serverId: expect.any(String), sequence: expect.any(Number) });
    expect(getDownloadTask(db, running.id)).toBeNull();
    await expect(access(partial)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it.each(["running", "seeding"] as const)("retains published files when %s completes while stopping", async (status) => {
    const active = task(status);
    const finalPath = path.join(root, active.targetPath);
    await writeFile(finalPath, "published");
    const response = remove(active.id).then((value) => value);
    await requested(active.id, status === "running" ? "cancel" : "stop_seeding");
    acknowledge(active.id, "completed");
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).statusCode).toBe(204);
    await expect(access(finalPath)).resolves.toBeUndefined();
  });

  it.each(["worker", "lease", "expired"])("rejects active tasks with invalid %s before sending control", async (invalid) => {
    const active = task();
    if (invalid === "worker") db.prepare("UPDATE download_tasks SET worker_id = NULL WHERE id = ?").run(active.id);
    if (invalid === "lease") db.prepare("UPDATE download_tasks SET lease_expires_at = NULL WHERE id = ?").run(active.id);
    if (invalid === "expired") db.prepare("UPDATE download_tasks SET lease_expires_at = ? WHERE id = ?").run(new Date(Date.now() - 1).toISOString(), active.id);
    expect((await remove(active.id)).statusCode).toBe(409);
    expect(getDownloadTask(db, active.id)).toMatchObject({ status: "running", controlRequested: null });
  });

  it("does not treat expiry recovery as a worker acknowledgement", async () => {
    const active = task("running", 150);
    const response = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    await vi.advanceTimersByTimeAsync(150);
    acknowledge(active.id, "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).statusCode).toBe(409);
    expect(getDownloadTask(db, active.id)?.status).toBe("cancelled");
  });

  it.each(["failed", "queued", "ownership", "lost_lease", "incomplete_ack"] as const)("preserves the record after unexpected %s", async (change) => {
    const active = task();
    const response = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    if (change === "ownership") db.prepare("UPDATE download_tasks SET worker_id = 'worker-2' WHERE id = ?").run(active.id);
    else if (change === "lost_lease") db.prepare("UPDATE download_tasks SET lease_expires_at = NULL WHERE id = ?").run(active.id);
    else if (change === "incomplete_ack") db.prepare("UPDATE download_tasks SET status = 'cancelled' WHERE id = ?").run(active.id);
    else transitionDownloadTask(db, { id: active.id, from: ["running"], to: change });
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).statusCode).toBe(409);
    expect(getDownloadTask(db, active.id)).not.toBeNull();
  });

  it("requires completed acknowledgement from seeding tasks", async () => {
    const seeding = task("seeding");
    const response = remove(seeding.id).then((value) => value);
    await requested(seeding.id, "stop_seeding");
    acknowledge(seeding.id, "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).statusCode).toBe(409);
    expect(getDownloadTask(db, seeding.id)).not.toBeNull();
  });

  it.each(["worker_id", "lease_expires_at", "control_requested"])("rejects acknowledgements with uncleared %s", async (field) => {
    const active = task();
    const response = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    acknowledge(active.id, "cancelled");
    const value = field === "worker_id" ? "worker-1" : field === "control_requested" ? "cancel" : active.leaseExpiresAt;
    db.prepare(`UPDATE download_tasks SET ${field} = ? WHERE id = ?`).run(value, active.id);
    await vi.advanceTimersByTimeAsync(100);
    expect((await response).statusCode).toBe(409);
    expect(getDownloadTask(db, active.id)).not.toBeNull();
  });

  it("times out after ten seconds and retains cancel for the worker", async () => {
    const active = task();
    const response = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    await vi.advanceTimersByTimeAsync(10_000);
    expect((await response).statusCode).toBe(409);
    expect(getDownloadTask(db, active.id)).toMatchObject({ status: "running", controlRequested: "cancel" });
  });

  it.each(["pause", "resume", "cancel", "retry", "stop-seeding"])("serializes %s with removal but permits commands on other tasks", async (command) => {
    const active = task();
    const other = task("paused");
    const deleting = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    let commandFinished = false;
    const competing = app.inject({ method: "POST", url: `/api/downloads/${active.id}/${command}` }).then((value) => { commandFinished = true; return value; });
    expect((await app.inject({ method: "POST", url: `/api/downloads/${other.id}/resume` })).statusCode).toBe(200);
    expect(commandFinished).toBe(false);
    acknowledge(active.id, "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    expect((await deleting).statusCode).toBe(204);
    expect((await competing).statusCode).toBe(404);
  });

  it("retains the record when partial cleanup fails", async () => {
    const queued = task("queued");
    await mkdir(path.join(root, queued.partialPath));
    expect((await remove(queued.id)).statusCode).toBe(409);
    expect(getDownloadTask(db, queued.id)?.status).toBe("cancelled");
  });

  it.each(["queued", "paused", "failed", "cancelled", "completed"] as const)("keeps inactive %s removal semantics and preserves final content", async (status) => {
    const inactive = task(status);
    const partial = path.join(root, inactive.partialPath);
    const finalPath = path.join(root, inactive.targetPath);
    await writeFile(partial, "partial");
    await writeFile(finalPath, "published");
    expect((await remove(inactive.id)).statusCode).toBe(204);
    expect(getDownloadTask(db, inactive.id)).toBeNull();
    await expect(access(finalPath)).resolves.toBeUndefined();
    if (status !== "completed") await expect(access(partial)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("serializes duplicate removals and reports the missing second task", async () => {
    const active = task();
    const first = remove(active.id).then((value) => value);
    await requested(active.id, "cancel");
    const second = remove(active.id).then((value) => value);
    acknowledge(active.id, "cancelled");
    await vi.advanceTimersByTimeAsync(100);
    expect((await first).statusCode).toBe(204);
    expect((await second).statusCode).toBe(404);
  });
});
