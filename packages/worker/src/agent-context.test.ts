import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCapabilityProposal, createSession, createUserMessageAndJob, linkAgentJobToCapabilityRun, openCyberOsDb, type CyberOsDatabase } from "@cyberos/db";
import { loadCyberOsRuntime, type CyberOsRuntime } from "@cyberos/shared";
import { agentSystemContext } from "./agent-context.js";

let root: string;
let db: CyberOsDatabase;
let config: CyberOsRuntime;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), "agent-context-"));
  config = loadCyberOsRuntime({ CYBEROS_ROOT: root, CYBEROS_ENVIRONMENT: "development" }, root);
  db = openCyberOsDb(path.join(root, "test.sqlite"));
  await mkdir(config.paths.dataRoot, { recursive: true });
});
afterEach(async () => { db.close(); await rm(root, { recursive: true, force: true }); });
function proposal(sessionId: string, expiresAt = new Date(Date.now() + 60_000).toISOString()) {
  const { job } = createUserMessageAndJob(db, { sessionId, content: "private conversation", status: "waiting_approval" });
  const result = createCapabilityProposal(db, { subjectId: "pi", subjectKind: "pi", capabilityId: "cyberos.settings.proxy-propose", risk: "high", redactedInput: {}, proposal: { sensitive: "private-config" }, privatePayload: { password: "private-secret" }, expiresAt });
  linkAgentJobToCapabilityRun(db, { jobId: job.id, runId: result.run.id });
  return result;
}
describe("Agent per-turn system context", () => {
  it("isolates sessions, omits secret payloads and excludes expired approvals", async () => {
    const a = createSession(db, {});
    const b = createSession(db, {});
    const own = proposal(a.id);
    const other = proposal(b.id);
    const expired = proposal(a.id, "2000-01-01T00:00:00Z");
    const text = await agentSystemContext(db, config, a.id, ".");
    const context = JSON.parse(text) as { pendingApprovals: Array<{ id: string }> };
    expect(context.pendingApprovals.map((approval) => approval.id)).toEqual([own.approval.id]);
    expect(text).not.toContain(other.run.id);
    expect(text).not.toContain(expired.approval.id);
    expect(text).not.toContain("private-");
  });
  it("refreshes pools and jobs and bounds the context without claiming mount readiness", async () => {
    const session = createSession(db, {});
    expect(JSON.parse(await agentSystemContext(db, config, session.id, ".")).storagePools).toEqual([]);
    for (let index = 0; index < 24; index++) await mkdir(path.join(config.paths.dataRoot, `pool-${index}`));
    await mkdir(path.join(config.paths.dataRoot, ".hidden"));
    await symlink(root, path.join(config.paths.dataRoot, "symlink"));
    for (let index = 0; index < 10; index++) proposal(session.id);
    const text = await agentSystemContext(db, config, session.id, "x".repeat(5000));
    const context = JSON.parse(text) as { storagePools: Array<{ id: string }>; relatedRuns: unknown[]; pendingApprovals: unknown[]; storageReadiness: string };
    expect(context.storagePools).toHaveLength(20);
    expect(context.storagePools.every((pool) => ![".hidden", "symlink"].includes(pool.id))).toBe(true);
    expect(context.relatedRuns).toHaveLength(8);
    expect(context.pendingApprovals).toHaveLength(8);
    expect(context.storageReadiness).toContain("cyberos.system.health");
    expect(text.length).toBeLessThanOrEqual(7500);
  });
});
