import { createHash } from "node:crypto";
import { CapabilityError, type JsonValue } from "@cyberos/capabilities";
import { getOwnedCapabilityRun, type CapabilityRunRecord, type CyberOsDatabase } from "@cyberos/db";

const SOURCES: Readonly<Record<string, { table: string; columns: string; cancellable: string[] }>> = {
  download_task: { table: "download_tasks", columns: "id,status,received_bytes,total_bytes,phase,updated_at", cancellable: ["queued", "running", "paused", "seeding"] },
  file_batch: { table: "file_batches", columns: "id,status,total_count,completed_count,success_count,failed_count,cancelled_count,updated_at", cancellable: ["queued", "running"] },
  photos_job: { table: "photos_jobs", columns: "id,status,scanned,processed,failed,phase,updated_at", cancellable: [] },
  docker_operation: { table: "docker_operations", columns: "id,status,updated_at", cancellable: [] },
  vm_operation: { table: "vm_operations", columns: "id,status,updated_at", cancellable: [] },
  backup_run: { table: "backup_runs", columns: "id,status,files,bytes,finished_at", cancellable: [] },
  music_scan: { table: "music_scan_runs", columns: "id,status,scanned,updated_at", cancellable: [] },
  media_scan: { table: "media_scan_runs", columns: "id,status,scanned,updated_at", cancellable: [] },
  bluetooth_transfer: { table: "bluetooth_transfers", columns: "id,status,transferred_bytes,total_bytes,updated_at", cancellable: ["queued", "running", "paused"] },
  torrent_preview: { table: "torrent_previews", columns: "id,status,updated_at,expires_at", cancellable: [] },
  alert_delivery: { table: "monitoring_alert_deliveries", columns: "id,status,attempt_count,due_at,sent_at,updated_at", cancellable: [] },
  job: { table: "jobs", columns: "id,status,updated_at", cancellable: [] }
};
const TERMINAL = new Set(["succeeded", "completed", "failed", "cancelled", "interrupted", "superseded", "applied", "rejected", "expired", "ready"]);
type TaskState = { kind: string; id: string; state: string; terminal: boolean; cancellable: boolean; progress: Record<string, JsonValue>; children?: TaskState[] };
export interface OwnedDomainTask {
  runId: string;
  capabilityState: string;
  submissionCompleted: boolean;
  revision: string;
  task: TaskState | null;
}

export function domainTaskReference(run: Pick<CapabilityRunRecord, "progress" | "domainOperationType" | "domainOperationId">): { kind: string; id: string } | null {
  const progress = run.progress;
  const task = progress && typeof progress === "object" && !Array.isArray(progress) ? progress.domainTask : null;
  if (task && typeof task === "object" && !Array.isArray(task) && typeof task.kind === "string" && typeof task.id === "string") return { kind: task.kind, id: task.id };
  const kind = run.domainOperationType === "download" ? "download_task" : run.domainOperationType;
  return kind && run.domainOperationId && (SOURCES[kind] || kind === "index_task" || kind === "bluetooth_batch") ? { kind, id: run.domainOperationId } : null;
}
function readTask(db: CyberOsDatabase, kind: string, id: string): TaskState {
  const source = SOURCES[kind];
  const row = source ? db.prepare(`SELECT ${source.columns} FROM ${source.table} WHERE id = ?`).get(id) as Record<string, JsonValue> | undefined : undefined;
  const state = row ? String(row.status) : "unavailable";
  return { kind, id, state, terminal: TERMINAL.has(state), cancellable: source?.cancellable.includes(state) ?? false, progress: row ?? {} };
}

function readIndexTask(db: CyberOsDatabase, id: string): TaskState {
  let reference: unknown;
  try { reference = JSON.parse(id); } catch { reference = null; }
  if (!Array.isArray(reference) || reference.length !== 2 || typeof reference[0] !== "string" || typeof reference[1] !== "number" || !Number.isSafeInteger(reference[1]) || reference[1] < 1) {
    throw new CapabilityError("INTERNAL", "Invalid index task reference");
  }
  const [queueId, generation] = reference as [string, number];
  const queue = db.prepare("SELECT id,generation,status,retry_count,updated_at FROM index_queue WHERE id = ?").get(queueId) as Record<string, JsonValue> | undefined;
  const prefix = `queue:${queueId}:${generation}:`;
  const columns = "id,status,scanned,indexed,unchanged,removed,skipped,failed,bytes,phase,started_at,finished_at,last_progress_at";
  const run = db.prepare(`SELECT ${columns} FROM (
    SELECT ${columns} FROM index_runs WHERE id >= ? AND id < ?
    UNION ALL SELECT ${columns} FROM index_run_history WHERE id >= ? AND id < ?
  ) ORDER BY substr(id, length(?) + 1, 10) DESC, started_at DESC, COALESCE(finished_at, started_at) DESC, id DESC LIMIT 1`)
    .get(prefix, `${prefix}\uffff`, prefix, `${prefix}\uffff`, prefix) as Record<string, JsonValue> | undefined;
  const state = queue && queue.generation !== generation ? "superseded"
    : queue ? String(queue.status) : run ? String(run.status) : "unavailable";
  return { kind: "index_task", id, state, terminal: TERMINAL.has(state), cancellable: false,
    progress: { ...(run ?? {}), ...(queue?.generation === generation ? queue : {}), generation } };
}
export function ownedDomainTask(db: CyberOsDatabase, clientId: string, runId: string): OwnedDomainTask {
  const run = getOwnedCapabilityRun(db, clientId, runId);
  if (!run) throw new CapabilityError("INVALID_ARGUMENT", "Capability run was not found");
  const reference = domainTaskReference(run);
  const kind = reference?.kind;
  const id = reference?.id;
  let task: OwnedDomainTask["task"] = null;
  if (kind === "index_task" && id) task = readIndexTask(db, id);
  else if (kind === "bluetooth_batch" && id) {
    let ids: unknown;
    try { ids = JSON.parse(id); } catch { ids = null; }
    if (!Array.isArray(ids) || ids.length > 100 || ids.some((value) => typeof value !== "string")) throw new CapabilityError("INTERNAL", "Invalid task group reference");
    const children = (ids as string[]).map((id) => readTask(db, "bluetooth_transfer", id));
    const terminal = children.every((task) => task.terminal);
    const state = terminal ? children.some((task) => task.state === "failed") ? "failed" : children.some((task) => task.state === "cancelled") ? "cancelled" : "completed" : "running";
    task = { kind, id, state, terminal, cancellable: children.some((task) => task.cancellable), progress: {}, children };
  } else if (kind && id) task = readTask(db, kind, id);
  const data = { runId, capabilityState: run.state, submissionCompleted: run.state === "succeeded", task };
  return { ...data, revision: createHash("sha256").update(JSON.stringify(data)).digest("hex") };
}
