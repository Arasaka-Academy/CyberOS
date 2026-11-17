/**
 * [INPUT]: 依赖临时存储、SQLite 与领域适配器。
 * [OUTPUT]: 验证授权、撤权、执行和队列幂等性。
 * [POS]: 能力运行状态和文件副作用的回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { access, mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CapabilityError } from "@cyberos/capabilities";
import {
  authorizeAgentCapabilityRun,
  agentCapabilityRunInteraction,
  createCapabilityRun,
  cancelOwnedCapabilityRun,
  createMcpClient,
  createSession,
  createUserMessageAndJob,
  defaultAgentCapabilityPolicySettings,
  decideCapabilityApproval,
  getCapabilityApprovalByRun,
  getAgentCapabilityApproval,
  getCapabilityRun,
  getCapabilityRunPayload,
  listCapabilityRunEvents,
  linkAgentJobToCapabilityRun,
  openCyberOsDb,
  saveAgentCapabilityPolicySettings,
  updateJobStatus,
  type CyberOsDatabase
} from "@cyberos/db";
import { loadCyberOsRuntime, type CyberOsRuntime } from "@cyberos/shared";
import {
  capabilityRunSecretRequirements,
  executeApprovedCapabilityRun,
  executeStartedSecretCapabilityRun,
  proposeFileMutation,
  proposeDomainCapability,
  proposePiMcpFileCapability,
  recoverCapabilityRuns
} from "./orchestrator.js";
import { startCapabilityRunQueue } from "./run-queue.js";
import type { CapabilityDomainAdapter } from "./adapters.js";

let tempDir: string;
let rootDir: string;
let db: CyberOsDatabase;

beforeEach(async () => {
  tempDir = await mkdtemp(path.join(os.tmpdir(), "cyberos-capability-runtime-"));
  rootDir = path.join(tempDir, "data", "local");
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, "source.txt"), "version one", "utf8");
  db = openCyberOsDb(path.join(tempDir, "cyberos.sqlite"));
});

afterEach(async () => {
  db.close();
  await rm(tempDir, { recursive: true, force: true });
});

describe("capability mutation runtime", () => {
  it("automatically executes a linked full-access file mutation without human confirmation", async () => {
    const defaults = defaultAgentCapabilityPolicySettings();
    saveAgentCapabilityPolicySettings(db, { fullAccess: true, policies: { ...defaults.policies, "cyberos.files.mutate": "disabled" } });
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });
    const proposed = await proposeFileMutation({ dependencies: dependencies(), subject: subject(client.id),
      request: { operation: "mkdir", storagePoolId: "local", targetPath: "automatic" }, requiresConfirmation: true });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getAgentApproval(proposed.runId!);
    expect(authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: approval.jobId })).toBe("automatic");
    expect(getCapabilityApprovalByRun(db, proposed.runId!)?.decidedBy).toBe("system:full-access");
    const run = await executeApprovedCapabilityRun(dependencies(), proposed.runId!);
    expect(run.state).toBe("succeeded");
    await expect(access(path.join(rootDir, "automatic"))).resolves.toBeUndefined();
    await executeApprovedCapabilityRun(dependencies(), proposed.runId!);
    expect(getCapabilityRun(db, proposed.runId!)?.revision).toBe(run.revision);
  });

  it("authorizes explicit-confirmation domains but blocks queued work after full access is disabled", async () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const id = "cyberos.system.power-propose";
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:admin:power"] });
    const adapter = recordingAdapter();
    const runtime = domainDependencies(id, adapter);
    const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:admin:power"), capabilityId: id, request: { operation: "reboot" } });
    linkProposalToAgentJob(proposed.runId!);
    authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: getAgentApproval(proposed.runId!).jobId });
    saveAgentCapabilityPolicySettings(db, defaultAgentCapabilityPolicySettings());
    expect(await executeApprovedCapabilityRun(runtime, proposed.runId!)).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    expect(adapter.executions).toEqual([]);
  });

  it("consumes automatically authorized work from the API queue exactly once", async () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:admin:power"] });
    const id = "cyberos.system.power-propose";
    const adapter = recordingAdapter();
    const runtime = domainDependencies(id, adapter);
    const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:admin:power"), capabilityId: id, request: { operation: "reboot" } });
    expect(() => authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: "unowned" })).toThrow(/owned/);
    linkProposalToAgentJob(proposed.runId!);
    expect(() => authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: "another-job" })).toThrow(/owned/);
    const jobId = getAgentApproval(proposed.runId!).jobId;
    authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId });
    authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId });
    const errors: unknown[] = [];
    const stop = startCapabilityRunQueue(runtime, (error) => { errors.push(error); });
    try {
      await expect.poll(() => {
        const run = getCapabilityRun(db, proposed.runId!);
        return { state: run?.state, error: run?.errorMessage };
      }).toEqual({ state: "succeeded", error: null });
      expect(adapter.executions).toEqual([{}]);
      expect(errors).toEqual([]);
    } finally { await stop(); }
  });

  it("checks revocation again after asynchronous validation and before starting execution", async () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:admin:power"] });
    const id = "cyberos.system.power-propose";
    const adapter = recordingAdapter();
    adapter.revalidate = async () => { saveAgentCapabilityPolicySettings(db, defaultAgentCapabilityPolicySettings()); };
    const runtime = domainDependencies(id, adapter);
    const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:admin:power"), capabilityId: id, request: { operation: "reboot" } });
    linkProposalToAgentJob(proposed.runId!);
    authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: getAgentApproval(proposed.runId!).jobId });
    expect(await executeApprovedCapabilityRun(runtime, proposed.runId!)).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    expect(adapter.executions).toEqual([]);
  });

  it("leaves remaining runs queued when the API stops during execution", async () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:admin:power"] });
    const id = "cyberos.system.power-propose";
    const adapter = recordingAdapter();
    let release!: () => void;
    let started!: () => void;
    const executing = new Promise<void>((resolve) => { started = resolve; });
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    let executions = 0;
    adapter.execute = async () => {
      executions += 1;
      started();
      await blocked;
      return { data: {} };
    };
    const runtime = domainDependencies(id, adapter);
    const runIds: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:admin:power"), capabilityId: id, request: { operation: "reboot" } });
      linkProposalToAgentJob(proposed.runId!);
      authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: getAgentApproval(proposed.runId!).jobId });
      runIds.push(proposed.runId!);
    }
    const errors: unknown[] = [];
    const stop = startCapabilityRunQueue(runtime, (error) => { errors.push(error); });
    try {
      await executing;
      const stopped = stop();
      release();
      await stopped;
      expect(executions).toBe(1);
      expect(runIds.map((runId) => getCapabilityRun(db, runId)?.state).sort()).toEqual(["queued", "succeeded"]);
      expect(errors).toEqual([]);
    } finally {
      release();
      await stop();
    }
  });

  it("does not execute automatically authorized work after its Agent job was cancelled", async () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:admin:power"] });
    const id = "cyberos.system.power-propose";
    const adapter = recordingAdapter();
    const runtime = domainDependencies(id, adapter);
    const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:admin:power"), capabilityId: id, request: { operation: "reboot" } });
    linkProposalToAgentJob(proposed.runId!);
    const jobId = getAgentApproval(proposed.runId!).jobId;
    authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId });
    updateJobStatus(db, jobId, "cancelled");
    expect(await executeApprovedCapabilityRun(runtime, proposed.runId!)).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    expect(adapter.executions).toEqual([]);
  });

  it("keeps historical proposals manual and requires secrets without requesting approval", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:settings:propose"] });
    const id = "cyberos.settings.update-propose";
    const runtime = domainDependencies(id, recordingAdapter(true));
    const legacy = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:settings:propose"), capabilityId: id, request: { operation: "model_provider" } });
    linkProposalToAgentJob(legacy.runId!);
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    expect(authorizeAgentCapabilityRun(db, { runId: legacy.runId!, jobId: getAgentApproval(legacy.runId!).jobId })).toBe("approval");
    const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:settings:propose"), capabilityId: id, request: { operation: "model_provider" } });
    linkProposalToAgentJob(proposed.runId!);
    expect(authorizeAgentCapabilityRun(db, { runId: proposed.runId!, jobId: getAgentApproval(proposed.runId!).jobId })).toBe("input_required");
    expect(agentCapabilityRunInteraction(db, proposed.runId!)).toBe("input_required");
    expect(getCapabilityRun(db, proposed.runId!)?.state).toBe("waiting_approval");
  });

  it("executes an approved Pi MCP read and stores its result for continuation", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:read"] });
    const proposed = await proposePiMcpFileCapability({
      dependencies: dependencies(),
      subject: { id: client.id, clientId: client.id, kind: "pi", scopes: new Set(client.scopes) },
      capabilityId: "cyberos.files.read",
      request: { storagePoolId: "local", path: "source.txt" },
      requiresConfirmation: false
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })).not.toBeNull();

    const run = await executeApprovedCapabilityRun(dependencies(), proposed.runId!);

    expect(run).toMatchObject({
      state: "succeeded",
      result: { data: { storagePoolId: "local", preview: { content: "version one", truncated: false } } }
    });
  });

  it("rechecks Agent policy immediately before an approved capability executes", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:read"] });
    const proposed = await proposePiMcpFileCapability({
      dependencies: dependencies(),
      subject: { id: client.id, clientId: client.id, kind: "pi", scopes: new Set(client.scopes) },
      capabilityId: "cyberos.files.read",
      request: { storagePoolId: "local", path: "source.txt" },
      requiresConfirmation: false
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })).not.toBeNull();
    const defaults = defaultAgentCapabilityPolicySettings();
    saveAgentCapabilityPolicySettings(db, {
      policies: { ...defaults.policies, "cyberos.files.read": "disabled" }
    });

    const run = await executeApprovedCapabilityRun(dependencies(), proposed.runId!);

    expect(run).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    expect(getCapabilityRunPayload(db, proposed.runId!)).toBeNull();
  });

  it.each(["cyberos.files.restore-propose", "cyberos.files.extract-propose", "cyberos.files.batch-propose", "cyberos.files.batch-cancel-propose", "cyberos.files.rollback-propose"])("rechecks the file mutation policy before executing %s", async (capabilityId) => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });
    const adapter = recordingAdapter();
    const runtime = domainDependencies(capabilityId, adapter);
    const proposed = await proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:files:propose"),
      capabilityId,
      request: { operation: "test" }
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })).not.toBeNull();
    saveAgentCapabilityPolicySettings(db, {
      policies: { ...defaultAgentCapabilityPolicySettings().policies, "cyberos.files.mutate": "disabled" }
    });

    expect(await executeApprovedCapabilityRun(runtime, proposed.runId!)).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    expect(adapter.executions).toEqual([]);
    expect(getCapabilityRunPayload(db, proposed.runId!)).toBeNull();
  });

  it("rejects an approved proposal when the source revision changed", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });
    const proposed = await proposeFileMutation({
      dependencies: dependencies(),
      subject: subject(client.id),
      request: { operation: "move", storagePoolId: "local", sourcePath: "source.txt", targetPath: "target.txt" }
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })).not.toBeNull();
    await writeFile(path.join(rootDir, "source.txt"), "version two is different", "utf8");

    const run = await executeApprovedCapabilityRun(dependencies(), proposed.runId!);

    expect(run).toMatchObject({ state: "failed", errorCode: "CONFLICT", cancellable: false });
    await expect(access(path.join(rootDir, "source.txt"))).resolves.toBeUndefined();
    await expect(access(path.join(rootDir, "target.txt"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rechecks client scopes immediately before execution", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });
    const proposed = await proposeFileMutation({
      dependencies: dependencies(),
      subject: subject(client.id),
      request: { operation: "mkdir", storagePoolId: "local", targetPath: "Archive" }
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })).not.toBeNull();
    db.prepare("UPDATE mcp_clients SET scopes_json = '[]' WHERE id = ?").run(client.id);

    const run = await executeApprovedCapabilityRun(dependencies(), proposed.runId!);

    expect(run).toMatchObject({ state: "failed", errorCode: "FORBIDDEN" });
    await expect(access(path.join(rootDir, "Archive"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects proposals while a required storage pool is unavailable", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });
    await rm(rootDir, { recursive: true, force: true });

    await expect(proposeFileMutation({
      dependencies: dependencies(),
      subject: subject(client.id),
      request: { operation: "mkdir", storagePoolId: "local", targetPath: "Archive" }
    })).rejects.toMatchObject({ code: "NOT_READY", retryable: true } satisfies Partial<CapabilityError>);
  });

  it("rejects mutations through a symlink", async () => {
    const outside = path.join(tempDir, "outside.txt");
    await writeFile(outside, "outside", "utf8");
    await symlink(outside, path.join(rootDir, "linked.txt"));
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:files:propose"] });

    await expect(proposeFileMutation({
      dependencies: dependencies(),
      subject: subject(client.id),
      request: { operation: "trash", storagePoolId: "local", sourcePath: "linked.txt" }
    })).rejects.toMatchObject({ code: "INVALID_ARGUMENT" } satisfies Partial<CapabilityError>);
  });

  it("marks interrupted destructive work failed without replaying it", async () => {
    const client = createMcpClient(db, { name: "Agent", kind: "local", scopes: ["cyberos:files:propose"] });
    const run = createCapabilityRun(db, {
      clientId: client.id,
      subjectId: client.id,
      subjectKind: "local",
      capabilityId: "cyberos.files.mutate",
      risk: "high",
      redactedInput: { operation: "mkdir", storagePoolId: "local", targetPath: "NeverCreate" },
      state: "running",
      cancellable: false
    });

    await expect(recoverCapabilityRuns(dependencies())).resolves.toEqual({ expired: 0, interrupted: 1, resumed: 0 });
    expect(getCapabilityRun(db, run.id)).toMatchObject({ state: "failed", errorCode: "INTERNAL" });
    await expect(access(path.join(rootDir, "NeverCreate"))).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("deduplicates identical domain proposals and rejects conflicting idempotency input", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:settings:propose"] });
    const adapter = recordingAdapter();
    const runtime = domainDependencies("cyberos.settings.update-propose", adapter);
    const first = await proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:settings:propose"),
      capabilityId: "cyberos.settings.update-propose",
      request: { operation: "agent_policy", value: "first" },
      idempotencyKey: "settings-change-0001"
    });
    const repeated = await proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:settings:propose"),
      capabilityId: "cyberos.settings.update-propose",
      request: { value: "first", operation: "agent_policy" },
      idempotencyKey: "settings-change-0001"
    });

    expect(repeated.runId).toBe(first.runId);
    await expect(proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:settings:propose"),
      capabilityId: "cyberos.settings.update-propose",
      request: { operation: "agent_policy", value: "different" },
      idempotencyKey: "settings-change-0001"
    })).rejects.toMatchObject({ code: "CONFLICT" });
  });

  it("allows distinct approved actions to track the same background task", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:downloads:propose"] });
    const adapter: CapabilityDomainAdapter = { ...recordingAdapter(), execute: () => ({ data: { submitted: true }, domainTask: { kind: "download_task", id: "shared-task" } }) };
    const runtime = domainDependencies("cyberos.downloads.manage-propose", adapter);
    for (const operation of ["pause", "resume", "stop_seeding"]) {
      const proposed = await proposeDomainCapability({ dependencies: runtime, subject: domainSubject(client.id, "cyberos:downloads:propose"),
        capabilityId: "cyberos.downloads.manage-propose", request: { operation, taskId: "shared-task" } });
      linkProposalToAgentJob(proposed.runId!);
      const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
      expect(decideCapabilityApproval(db, { approvalId: approval.id, expectedRevision: approval.revision, decision: "approved", decidedBy: "local-admin" })).not.toBeNull();
      expect(await executeApprovedCapabilityRun(runtime, proposed.runId!)).toMatchObject({ state: "succeeded", progress: { domainTask: { kind: "download_task", id: "shared-task" } } });
    }
  });

  it("resumes an approved queued domain run after restart", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:notifications:propose"] });
    const adapter = recordingAdapter();
    const runtime = domainDependencies("cyberos.notifications.read-state-propose", adapter);
    const proposed = await proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:notifications:propose"),
      capabilityId: "cyberos.notifications.read-state-propose",
      request: { operation: "read_all" }
    });
    linkProposalToAgentJob(proposed.runId!);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    expect(decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin"
    })?.run.state).toBe("queued");

    await expect(recoverCapabilityRuns(runtime)).resolves.toEqual({ expired: 0, interrupted: 0, resumed: 1 });
    expect(getCapabilityRun(db, proposed.runId!)).toMatchObject({
      state: "succeeded",
      result: { executed: true },
      domainOperationType: "test_operation",
      domainOperationId: "operation-1"
    });
    expect(adapter.executions).toHaveLength(1);
    expect(getCapabilityRunPayload(db, proposed.runId!)).toBeNull();
  });

  it("executes secret-bearing work from memory without persisting the secret", async () => {
    const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:settings:propose"] });
    const adapter = recordingAdapter(true);
    const runtime = domainDependencies("cyberos.settings.update-propose", adapter);
    const proposed = await proposeDomainCapability({
      dependencies: runtime,
      subject: domainSubject(client.id, "cyberos:settings:propose"),
      capabilityId: "cyberos.settings.update-propose",
      request: { operation: "model_provider", replaceApiKey: true }
    });
    linkProposalToAgentJob(proposed.runId!);
    expect(capabilityRunSecretRequirements(runtime, proposed.runId!)).toEqual([
      { name: "apiKey", label: "API key", minLength: 8, maxLength: 128 }
    ]);
    const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
    const decided = decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: approval.revision,
      decision: "approved",
      decidedBy: "local-admin",
      startRunning: true
    })!;
    expect(decided.run).toMatchObject({ state: "running", cancellable: false });
    expect(cancelOwnedCapabilityRun(db, client.id, proposed.runId!)).toBeNull();

    const secret = "local-secret-value";
    const completed = await executeStartedSecretCapabilityRun(runtime, proposed.runId!, { apiKey: secret });

    expect(completed).toMatchObject({ state: "succeeded", result: { executed: true } });
    expect(adapter.executions).toEqual([{ apiKey: secret }]);
    expect(getCapabilityRunPayload(db, proposed.runId!)).toBeNull();
    expect(JSON.stringify(listCapabilityRunEvents(db, proposed.runId!))).not.toContain(secret);
    const persistedCapabilityState = db.prepare(`
      SELECT group_concat(value, '') FROM (
        SELECT input_json AS value FROM capability_runs WHERE id = ?
        UNION ALL SELECT proposal_json FROM capability_approvals WHERE run_id = ?
        UNION ALL SELECT payload_json FROM capability_run_events WHERE run_id = ?
      )
    `).pluck().get(proposed.runId!, proposed.runId!, proposed.runId!);
    expect(String(persistedCapabilityState)).not.toContain(secret);
  });
});

function subject(clientId: string) {
  return { id: clientId, clientId, kind: "pi" as const, scopes: new Set(["cyberos:files:propose"]) };
}

function getAgentApproval(runId: string) {
  return getAgentCapabilityApproval(db, getCapabilityApprovalByRun(db, runId)!.id)!;
}

function domainSubject(clientId: string, scope: string) {
  return { id: clientId, clientId, kind: "pi" as const, scopes: new Set([scope]) };
}

function domainDependencies(capabilityId: string, adapter: CapabilityDomainAdapter) {
  return { db, config: testConfig(), adapters: { [capabilityId]: adapter } };
}

function recordingAdapter(requiresSecret = false): CapabilityDomainAdapter & { executions: Array<Record<string, string>> } {
  const executions: Array<Record<string, string>> = [];
  return {
    executions,
    availability: () => ({ available: true }),
    prepare: (request) => ({
      summary: "Execute test operation",
      revision: "revision-1",
      privatePayload: { request },
      ...(requiresSecret ? {
        requiredSecrets: [{ name: "apiKey", label: "API key", minLength: 8, maxLength: 128 }]
      } : {})
    }),
    revalidate: () => undefined,
    execute: (_prepared, _context, secrets) => {
      executions.push({ ...secrets });
      return {
        data: { executed: true },
        domainOperationType: "test_operation",
        domainOperationId: "operation-1"
      };
    }
  };
}

function linkProposalToAgentJob(runId: string): void {
  const session = createSession(db, { });
  const { job } = createUserMessageAndJob(db, {
    sessionId: session.id,
    content: "Run a file mutation",
    status: "waiting_approval"
  });
  linkAgentJobToCapabilityRun(db, { jobId: job.id, runId });
}

function dependencies() {
  return { db, config: testConfig() };
}

function testConfig(): CyberOsRuntime {
  const base = loadCyberOsRuntime({ CYBEROS_ROOT: tempDir }, tempDir);
  return {
    ...base,
    paths: { ...base.paths, databasePath: path.join(tempDir, "cyberos.sqlite") },
    api: { host: "127.0.0.1", port: 3010, allowedOrigins: [] },
    worker: { pollMs: 100, concurrency: 1 },
    admin: { displayName: "Admin", authMode: "local-only" },
    docker: { enabled: false, socketPath: "/var/run/docker.sock", composeCommand: "docker", operationTimeoutMs: 1_000, consoleShells: ["/bin/sh"] },
    hostd: { socketPath: path.join(tempDir, "hostd.sock") },
    shares: { enabled: false, account: { username: "cyberos", password: null }, shares: [] },
    terminal: { user: "cyberos", socketPath: path.join(tempDir, "terminald.sock"), sessionIdleTimeoutMs: 60_000, connectTimeoutMs: 1_000, maxSessions: 4 },
    vodPlayer: { enabled: false, socketPath: path.join(tempDir, "vod.sock"), statePath: path.join(tempDir, "vod.json"), commandTimeoutMs: 1_000, startupTimeoutMs: 1_000, checkpointIntervalMs: 1_000, retryBaseDelayMs: 100, retryMaxDelayMs: 1_000, videoOutput: "drm", drmConnector: null, audioOutput: "alsa", audioDevice: "default", hwdec: "auto-safe", user: "cyberos" },
  };
}
