import { readdir } from "node:fs/promises";
import type { CyberOsDatabase } from "@cyberos/db";
import type { CyberOsRuntime } from "@cyberos/shared";

/** Only this session's linked runs and approval identifiers enter the model context. */
export async function agentSystemContext(db: CyberOsDatabase, config: CyberOsRuntime, sessionId: string, workingPath: string): Promise<string> {
  const pools = await readdir(config.paths.dataRoot, { withFileTypes: true }).then((entries) => entries
    .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && !entry.name.startsWith("."))
    .slice(0, 20).map((entry) => ({ id: entry.name }))).catch(() => []);
  const runs = db.prepare(`SELECT DISTINCT r.id,r.capability_id,r.state,
    COALESCE(json_extract(r.progress_json, '$.domainTask.kind'), r.domain_operation_type) AS domain_operation_type
    FROM capability_runs r JOIN agent_capability_runs a ON a.run_id=r.id JOIN jobs j ON j.id=a.job_id
    WHERE j.session_id=? ORDER BY r.created_at DESC LIMIT 8`).all(sessionId);
  const approvals = db.prepare(`SELECT DISTINCT a.id,a.run_id,a.expires_at
    FROM capability_approvals a JOIN agent_capability_runs l ON l.run_id=a.run_id JOIN jobs j ON j.id=l.job_id
    WHERE j.session_id=? AND a.status='pending' AND a.expires_at>?
    ORDER BY a.created_at DESC LIMIT 8`).all(sessionId, new Date().toISOString());
  const context = { observedAt: new Date().toISOString(), workingPath: workingPath.slice(0, 2048), storagePools: pools,
    storageReadiness: "Query cyberos.system.health before storage operations", relatedRuns: runs, pendingApprovals: approvals };
  while (JSON.stringify(context).length > 7500 && context.storagePools.length) context.storagePools.pop();
  return JSON.stringify(context);
}
