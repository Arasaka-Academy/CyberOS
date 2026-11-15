import { access, constants as fsConstants } from "node:fs/promises";
import type { FastifyInstance } from "fastify";
import { defaultBackupSettings, getBackupSettings, listBackupRuns, listHealthAlerts } from "@cyberos/db";
import type { ApiRouteContext } from "../context.js";
import { listBackupSnapshots, restoreConfiguredBackup } from "@cyberos/backup";

export function registerBackupRoutes(server: FastifyInstance, { db, config }: ApiRouteContext): void {
  server.get("/api/backup/coverage", async () => ({
    protected: ["storage_pool_files_except_iscsi", "sqlite_consistent_copy", "cyberos_configuration", "trash"],
    excluded: [
      { data: "docker_named_volumes", reason: "Outside storage pools; application consistency requires a dedicated backup" },
      { data: "iscsi_images_and_target_secrets", reason: "Live block devices require a consistent storage snapshot" }
    ],
    consistency: { sqlite: "online_backup", ordinaryFiles: "live_file_copy", dockerApplications: false, iscsi: false },
    restore: { destination: "fresh_staging", liveReplacement: false, manifest: "v2_sha256", dataAndStateSnapshots: "paired_by_backup_run" }
  }));
  server.get("/api/backup/snapshots", async (_request, reply) => {
    try { return { snapshots: await listBackupSnapshots({ db, config }) }; }
    catch { return reply.code(503).send({ error: "Backup repository snapshots are unavailable" }); }
  });
  server.post<{ Body: { snapshotId?: string; confirmed?: boolean } }>("/api/backup/restore", async (request, reply) => {
    const body = request.body;
    if (!body || body.confirmed !== true || typeof body.snapshotId !== "string" || !/^[a-f0-9]{8,64}$/u.test(body.snapshotId)
      || Object.keys(body).some((key) => !["snapshotId", "confirmed"].includes(key))) return reply.code(400).send({ error: "A confirmed snapshot ID is required" });
    try { return await restoreConfiguredBackup({ db, config, snapshotId: body.snapshotId }); }
    catch { return reply.code(409).send({ error: "Backup restore did not complete; verify repository availability and active backup tasks" }); }
  });
  server.get("/api/backup/status", async () => {
    const settings = getBackupSettings(db) ?? defaultBackupSettings(
      config.paths.backupRoot,
      config.environment === "production"
    );
    const repositoryAvailable = await access(
      settings.repositoryPath,
      fsConstants.R_OK | fsConstants.W_OK
    ).then(() => true).catch(() => false);
    const passwordConfigured = await access(
      config.paths.backupPasswordPath,
      fsConstants.R_OK
    ).then(() => true).catch(() => false);
    return {
      enabled: settings.enabled,
      repositoryConfigured: Boolean(settings.repositoryPath),
      repositoryAvailable,
      passwordConfigured,
      repositoryPath: settings.repositoryPath,
      stagingPath: config.backup.stagingPath,
      runs: listBackupRuns(db, 30),
      alerts: listHealthAlerts(db, { limit: 100 }).filter((alert) => alert.code.startsWith("backup_") || alert.code === "repo_check_failed")
    };
  });
}
