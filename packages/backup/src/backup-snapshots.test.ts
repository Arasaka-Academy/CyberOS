import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { acquireExecutionLock, defaultBackupSettings, finishBackupRun, openCyberOsDb, saveBackupSettings, startBackupRun, type CyberOsDatabase } from "@cyberos/db";
import { loadCyberOsRuntime, type CyberOsRuntime } from "@cyberos/shared";
import { listBackupSnapshots, restoreConfiguredBackup } from "./backup.js";
import type { ResticCommandRunner } from "./restic.js";

let root: string;
let db: CyberOsDatabase;
let config: CyberOsRuntime;
const dataId = "a".repeat(64);
const stateId = "b".repeat(64);
let calls: string[][];
let failData: boolean;
let corruptState: boolean;
let snapshots: Array<Record<string, unknown>>;
let restic: ResticCommandRunner;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "backup-snapshots-"));
  config = loadCyberOsRuntime({ CYBEROS_ROOT: root, CYBEROS_ENVIRONMENT: "development" }, root);
  config = { ...config, backup: { ...config.backup, stagingPath: path.join(root, "staging"), retryCount: 1 } };
  db = openCyberOsDb(path.join(root, "test.sqlite"));
  const repositoryPath = path.join(root, "repository");
  await mkdir(path.dirname(config.paths.backupPasswordPath), { recursive: true });
  await writeFile(config.paths.backupPasswordPath, "fixture-password");
  await mkdir(repositoryPath);
  await mkdir(config.paths.dataRoot, { recursive: true });
  await writeFile(path.join(config.paths.dataRoot, "live.txt"), "live-data");
  saveBackupSettings(db, { ...defaultBackupSettings(repositoryPath, false), enabled: false });
  const run = startBackupRun(db, { kind: "daily" });
  finishBackupRun(db, { runId: run.id, status: "completed", snapshotIds: [dataId.slice(0, 8), stateId.slice(0, 8)], verified: true });
  calls = [];
  failData = false;
  corruptState = false;
  snapshots = [dataId, stateId].map((id) => ({ id, time: "2026-11-15T00:00:00Z", tags: ["daily"], hostname: "private-host", paths: ["/secret/path"] }));
  restic = { run: vi.fn(async (args) => {
    calls.push(args);
    if (args[0] === "snapshots") return { code: 0, stdout: JSON.stringify(snapshots), stderr: "" };
    if (args[0] === "restore" && !args.includes("--dry-run")) {
      const target = args[args.indexOf("--target") + 1]!;
      await mkdir(target, { recursive: true });
      if (args[1] === dataId) {
        await writeFile(path.join(target, "restored.txt"), "snapshot-data");
        if (failData) return { code: 1, stdout: "", stderr: "unavailable" };
      } else {
        await writeFile(path.join(target, "cyberos.sqlite"), "state-copy");
        await writeFile(path.join(target, "manifest.json"), JSON.stringify({ version: 2, runId: "fixture", database: "cyberos.sqlite", dataRoot: config.paths.dataRoot,
          checksums: { "cyberos.sqlite": createHash("sha256").update(corruptState ? "different" : "state-copy").digest("hex") } }));
      }
    }
    return { code: 0, stdout: "", stderr: "" };
  }) };
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });

describe("configured backup snapshot recovery", () => {
  it("lists sanitized paired snapshots even with scheduled backups disabled", async () => {
    const result = await listBackupSnapshots({ db, config, restic });
    expect(result).toHaveLength(2);
    expect(result.find((snapshot) => snapshot.id === stateId)).toMatchObject({ kind: "state", restoreSnapshotIds: [dataId, stateId] });
    expect(JSON.stringify(result)).not.toMatch(/private-host|secret\/path/);
  });

  it("restores both snapshots to fresh staging and leaves live data unchanged", async () => {
    const result = await restoreConfiguredBackup({ db, config, restic, snapshotId: dataId.slice(0, 8) });
    expect(result).toMatchObject({ verified: true, liveDataChanged: false, snapshotIds: [dataId, stateId] });
    expect(await readFile(path.join(result.stagingPath, "cyberos.sqlite"), "utf8")).toBe("state-copy");
    expect(await readFile(path.join(result.stagingPath, "data-snapshot", "restored.txt"), "utf8")).toBe("snapshot-data");
    expect(await readFile(path.join(config.paths.dataRoot, "live.txt"), "utf8")).toBe("live-data");
    expect(calls.filter((args) => args[0] === "restore" && !args.includes("--dry-run")).map((args) => args[1])).toEqual([stateId, dataId]);
  });

  it("rejects concurrent backup execution before invoking restic", async () => {
    acquireExecutionLock(db, { name: "backup", owner: "other" });
    await expect(restoreConfiguredBackup({ db, config, restic, snapshotId: stateId })).rejects.toThrow("backup already running");
    expect(restic.run).not.toHaveBeenCalled();
  });

  it.each(["data failure", "checksum failure"])("removes staging and releases its lease after %s", async (failure) => {
    failData = failure === "data failure";
    corruptState = failure === "checksum failure";
    await expect(restoreConfiguredBackup({ db, config, restic, snapshotId: stateId })).rejects.toThrow();
    expect(await readdir(config.backup.stagingPath)).toEqual([]);
    expect(acquireExecutionLock(db, { name: "backup", owner: "next" })).toBe(true);
    expect(await readFile(path.join(config.paths.dataRoot, "live.txt"), "utf8")).toBe("live-data");
  });

  it("rejects ambiguous selection and never associates an ambiguous stored prefix", async () => {
    snapshots.push({ id: `${"a".repeat(8)}${"c".repeat(56)}`, time: "2026-11-15T00:00:00Z" });
    expect((await listBackupSnapshots({ db, config, restic })).every((snapshot) => snapshot.kind === "unknown")).toBe(true);
    await expect(restoreConfiguredBackup({ db, config, restic, snapshotId: "a".repeat(8) })).rejects.toThrow("ambiguous");
    expect(calls.some((args) => args[0] === "restore")).toBe(false);
  });

  it("needs only the repository mount when the original pools are unavailable", async () => {
    const repositoryPath = path.join(root, "repository");
    saveBackupSettings(db, { ...defaultBackupSettings(repositoryPath, true), enabled: false });
    await mkdir(path.join(config.paths.dataRoot, "unmounted-pool"));
    expect(await listBackupSnapshots({ db, config, restic, mountInfo: `23 22 8:2 / ${repositoryPath} rw - ext4 /dev/sdb1 rw` })).toHaveLength(2);
  });
});
