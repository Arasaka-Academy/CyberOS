import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  acquireExecutionLock,
  isExecutionLockOwner,
  openCyberOsDb,
  releaseExecutionLock,
  type CyberOsDatabase
} from "@cyberos/db";
import { loadCyberOsRuntime, type CyberOsRuntime } from "@cyberos/shared";
import { initBackup, restoreBackup, runBackup, shouldSkipScheduledBackup, validateBackup } from "./backup.js";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, copyFile: vi.fn(actual.copyFile) };
});

let tempDir: string | undefined;
let db: CyberOsDatabase | undefined;

afterEach(async () => {
  db?.close();
  db = undefined;
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
  tempDir = undefined;
});

function config(root: string, repository: string, passwordFile: string): CyberOsRuntime {
  const rootDir = path.dirname(root);
  const base = loadCyberOsRuntime({ CYBEROS_ROOT: rootDir }, rootDir);
  return {
    ...base,
    paths: { ...base.paths, dataRoot: root, databasePath: path.join(rootDir, "cyberos.sqlite") },
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 50, concurrency: 1 },
    admin: { displayName: "Test", authMode: "local-only" },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 120000, consoleShells: ["/bin/sh"] },
    hostd: { socketPath: "/tmp/hostd.sock" },
    shares: { enabled: false, account: { username: "share", password: null }, shares: [] },
    terminal: { user: "test-user", socketPath: "/tmp/terminald.sock", sessionIdleTimeoutMs: 60_000, connectTimeoutMs: 1_000, maxSessions: 4 },
    vodPlayer: { enabled: false, socketPath: "/tmp/vod-player.sock", statePath: "/tmp/vod-player-session.json", commandTimeoutMs: 5000, startupTimeoutMs: 15000, checkpointIntervalMs: 5000, retryBaseDelayMs: 2000, retryMaxDelayMs: 60000, videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: null, hwdec: "auto-safe", user: "cyberos" },
    backup: { enabled: true, repositoryPath: repository, passwordFile, stagingPath: path.join(path.dirname(root), "staging"), requireMount: false, retryCount: 1, timeoutMs: 1000, keepDaily: 7, keepWeekly: 4 },
    health: { staleIndexWarningMs: 7200000, staleIndexCriticalMs: 21600000, stalledRunMs: 900000, consecutiveFailureThreshold: 2, backupStaleMs: 93600000 }
  };
}

describe("backup workflow", () => {
  it("skips scheduled runs when backup is disabled", () => {
    const cfg = config("/tmp/root", "/tmp/repo", "/tmp/password");

    expect(shouldSkipScheduledBackup({ ...cfg, backup: { ...cfg.backup!, enabled: false } }, "run")).toBe(true);
    expect(shouldSkipScheduledBackup(cfg, "run")).toBe(false);
    expect(shouldSkipScheduledBackup({ ...cfg, backup: { ...cfg.backup!, enabled: false } }, "validate")).toBe(false);
  });

  it("validates credentials and records a completed restic run", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    await mkdir(root);
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const calls: string[][] = [];
    let manifestVersion: number | undefined;
    const restic = { run: async (args: string[]) => {
      calls.push(args);
      if (args[0] === "backup" && args.at(-1)?.includes(`${path.sep}staging${path.sep}run-`)) {
        const manifest = JSON.parse(await readFile(path.join(args.at(-1)!, "manifest.json"), "utf8")) as { version: number };
        manifestVersion = manifest.version;
      }
      if (args[0] === "snapshots") return { stdout: calls.filter((entry) => entry[0] === "backup").length ? '[{"id":"abc123"}]' : "[]", stderr: "", code: 0 };
      return { stdout: '{"id":"abc123"}\n', stderr: "", code: 0 };
    } };
    const cfg = config(root, repo, password);
    await expect(validateBackup({ db, config: cfg, restic })).resolves.toMatchObject({ ok: true });
    const result = await runBackup({ db, config: cfg, restic });
    expect(result).toMatchObject({ status: "completed", snapshotIds: ["abc123"], verified: true });
    expect(calls.some((args) => args[0] === "backup")).toBe(true);
    const dataBackup = calls.find((args) => args[0] === "backup" && args.at(-1) === root)!;
    expect(dataBackup).toContain("--exclude");
    expect(dataBackup).toContain("*/.cyberos/iscsi");
    expect(dataBackup).not.toContain("*/.cyberos");
    expect(manifestVersion).toBe(2);
  });

  it("fails before creating snapshots when a trash file cannot be staged", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    await mkdir(root);
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const cfg = config(root, path.join(tempDir, "repo"), path.join(tempDir, "password"));
    const trash = path.join(cfg.paths.stateDir, "trash");
    await mkdir(trash, { recursive: true });
    await writeFile(path.join(trash, "deleted.txt"), "recoverable data");
    const restic = { run: vi.fn(async (args: string[]) => ({
      stdout: args[0] === "snapshots" ? '[{"id":"abc123"}]' : '{"id":"abc123"}\n',
      stderr: "",
      code: 0
    })) };
    const copy = vi.mocked(copyFile).mockRejectedValueOnce(new Error("trash copy failed"));
    try {
      const result = await runBackup({ db, config: cfg, restic });

      expect(result).toMatchObject({ status: "failed", verified: false, error: "trash copy failed" });
      expect(restic.run).not.toHaveBeenCalled();
    } finally {
      copy.mockRestore();
    }
  });

  it("requires exact repository and storage-pool mounts when mount enforcement is enabled", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-mounts-"));
    const root = path.join(tempDir, "data");
    const pool = path.join(root, "pool-1");
    const repo = path.join(tempDir, "backup");
    await mkdir(pool, { recursive: true });
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const cfg = config(root, repo, password);
    cfg.backup = { ...cfg.backup!, requireMount: true };
    const restic = { run: vi.fn(async () => ({ stdout: "[]", stderr: "", code: 0 })) };
    const mounted = [
      `23 22 8:2 / ${repo} rw - ext4 /dev/sdb1 rw`,
      `24 22 8:3 / ${pool} rw - ext4 /dev/sdc1 rw`
    ].join("\n");

    await expect(validateBackup({ db, config: cfg, restic, mountInfo: mounted }))
      .resolves.toMatchObject({ ok: true });
    await expect(validateBackup({
      db,
      config: cfg,
      restic,
      mountInfo: `23 22 8:2 / ${repo} rw - ext4 /dev/sdb1 rw`
    })).resolves.toMatchObject({
      ok: false,
      issues: [expect.stringContaining("Storage pool pool-1 is not mounted")]
    });
  });

  it("restores only CyberOS v2 manifests", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    await mkdir(root);
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const cfg = config(root, repo, password);
    const databaseContents = "cyberos-v2-database";
    const checksum = createHash("sha256").update(databaseContents).digest("hex");
    const restic = {
      run: async (args: string[]) => {
        if (args[0] === "restore" && !args.includes("--dry-run")) {
          const target = args[args.indexOf("--target") + 1]!;
          const restored = path.join(target, "state");
          await mkdir(restored, { recursive: true });
          await writeFile(path.join(restored, "cyberos.sqlite"), databaseContents);
          await writeFile(path.join(restored, "manifest.json"), JSON.stringify({
            version: 2,
            runId: "run-v2",
            createdAt: new Date().toISOString(),
            dataRoot: root,
            database: "cyberos.sqlite",
            checksums: { "cyberos.sqlite": checksum }
          }));
        }
        return { stdout: "", stderr: "", code: 0 };
      }
    };

    await expect(restoreBackup({
      config: cfg,
      repositoryPath: repo,
      passwordFile: password,
      restic,
      snapshot: "snapshot-v2"
    }))
      .resolves.toMatchObject({ verified: true });
  });

  it("rejects restored checksum paths that escape staging through a parent symlink", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-restore-symlink-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    const outside = path.join(tempDir, "outside");
    await Promise.all([mkdir(root), mkdir(repo), mkdir(outside)]);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    await writeFile(path.join(outside, "external.txt"), "external contents");
    const restic = { run: async (args: string[]) => {
      if (args[0] === "restore" && !args.includes("--dry-run")) {
        const target = args[args.indexOf("--target") + 1]!;
        await writeFile(path.join(target, "cyberos.sqlite"), "database");
        await symlink(outside, path.join(target, "linked"));
        await writeFile(path.join(target, "manifest.json"), JSON.stringify({
          version: 2, runId: "linked-restore", dataRoot: root, database: "cyberos.sqlite",
          checksums: {
            "cyberos.sqlite": createHash("sha256").update("database").digest("hex"),
            "linked/external.txt": createHash("sha256").update("external contents").digest("hex")
          }
        }));
      }
      return { stdout: "", stderr: "", code: 0 };
    } };

    await expect(restoreBackup({
      config: config(root, repo, password), repositoryPath: repo, passwordFile: password,
      restic, snapshot: "linked-snapshot"
    })).rejects.toThrow("restore manifest path escapes staging");
    expect(await readFile(path.join(outside, "external.txt"), "utf8")).toBe("external contents");
  });

  it("rejects v1 backup manifests", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    await mkdir(root);
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const cfg = config(root, repo, password);
    const restic = {
      run: async (args: string[]) => {
        if (args[0] === "restore" && !args.includes("--dry-run")) {
          const target = args[args.indexOf("--target") + 1]!;
          await writeFile(path.join(target, "manifest.json"), JSON.stringify({
            version: 1,
            runId: "old-run",
            roots: [{ storagePoolId: "local", path: root }],
            database: "cyberos.sqlite",
            checksums: {}
          }));
        }
        return { stdout: "", stderr: "", code: 0 };
      }
    };

    await expect(restoreBackup({
      config: cfg,
      repositoryPath: repo,
      passwordFile: password,
      restic,
      snapshot: "snapshot-v1"
    }))
      .rejects.toThrow("restore manifest validation failed");
  });

  it("allows explicit init to create a repository directory that does not exist yet", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "nested", "repo");
    await mkdir(root);
    await mkdir(path.dirname(repo), { recursive: true });
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const calls: string[][] = [];
    const restic = {
      run: async (args: string[]) => {
        calls.push(args);
        return { stdout: "", stderr: "", code: 0 };
      }
    };

    await expect(initBackup({ db, config: config(root, repo, password), restic })).resolves.toBeUndefined();
    expect(calls).toEqual([["init", "--repo", repo]]);
  });

  it("serializes init with other backup operations", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    await mkdir(root);
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    expect(acquireExecutionLock(db, { name: "backup", owner: "active-backup" })).toBe(true);
    const restic = { run: vi.fn(async () => ({ stdout: "", stderr: "", code: 0 })) };

    await expect(initBackup({ db, config: config(root, repo, password), restic }))
      .rejects.toThrow("backup already running");
    expect(restic.run).not.toHaveBeenCalled();
    expect(releaseExecutionLock(db, { name: "backup", owner: "active-backup" })).toBe(true);
  });

  it("does not release a replacement lease when init loses ownership", async () => {
    tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-backup-"));
    const root = path.join(tempDir, "root");
    const repo = path.join(tempDir, "repo");
    await mkdir(root);
    await mkdir(repo);
    const password = path.join(tempDir, "password");
    await writeFile(password, "secret\n");
    db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
    const restic = {
      run: vi.fn(async () => {
        db!.prepare("UPDATE execution_locks SET owner = ? WHERE name = 'backup'")
          .run("replacement-owner");
        return { stdout: "", stderr: "", code: 0 };
      })
    };

    await expect(initBackup({ db, config: config(root, repo, password), restic }))
      .rejects.toThrow("backup execution lease lost");
    expect(isExecutionLockOwner(db, { name: "backup", owner: "replacement-owner" })).toBe(true);
    expect(releaseExecutionLock(db, { name: "backup", owner: "replacement-owner" })).toBe(true);
  });
});
