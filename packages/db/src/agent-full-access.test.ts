/**
 * [INPUT]: 依赖临时 SQLite 与 Agent 权限仓库。
 * [OUTPUT]: 验证完全权限的兼容读取、持久化和工具策略。
 * [POS]: db 的 Agent 权限行为回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  agentCapabilityPolicyToPiToolPolicy,
  agentCapabilityJobInteraction,
  authorizeAgentCapabilityRun,
  createCapabilityProposal,
  createSession,
  createUserMessageAndJob,
  linkAgentJobToCapabilityRun,
  defaultAgentCapabilityPolicySettings,
  getAgentCapabilityPolicySettings,
  openCyberOsDb,
  saveAgentCapabilityPolicySettings,
  type CyberOsDatabase
} from "./index.js";

let db: CyberOsDatabase;
beforeEach(() => { db = openCyberOsDb(":memory:"); });
afterEach(() => { db.close(); });

describe("Agent full access settings", () => {
  it("defaults legacy settings to standard permissions", () => {
    const settings = defaultAgentCapabilityPolicySettings();
    expect(settings.fullAccess).toBe(false);
    const { fullAccess: _fullAccess, ...legacy } = settings;
    db.prepare("INSERT INTO system_settings(key, value_json, updated_at) VALUES (?, ?, ?)")
      .run("agent_capability_policy", JSON.stringify(legacy), settings.updatedAt);
    expect(getAgentCapabilityPolicySettings(db)?.fullAccess).toBe(false);
  });

  it("overrides tool permissions without overwriting the saved policies", () => {
    const defaults = defaultAgentCapabilityPolicySettings();
    const policies = { ...defaults.policies, "cyberos.files.read": "disabled" as const };
    const saved = saveAgentCapabilityPolicySettings(db, { fullAccess: true, policies });
    expect(getAgentCapabilityPolicySettings(db)?.fullAccess).toBe(true);
    expect(agentCapabilityPolicyToPiToolPolicy(saved)).toMatchObject({ read: "auto", bash: "auto", edit: "auto", write: "auto" });
    const restored = saveAgentCapabilityPolicySettings(db, { fullAccess: false, policies: saved.policies });
    expect(agentCapabilityPolicyToPiToolPolicy(restored)).toMatchObject({ read: "disabled", bash: "confirm", edit: "approve", write: "approve" });
  });

  it("rejects invalid full access values", () => {
    expect(() => saveAgentCapabilityPolicySettings(db, {
      ...defaultAgentCapabilityPolicySettings(), fullAccess: "true" as unknown as boolean
    })).toThrow(/full access/i);
  });

  it("distinguishes automatic job waits from manual approval and credential input", () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const session = createSession(db, {});
    const { job } = createUserMessageAndJob(db, { sessionId: session.id, content: "Execute", status: "running" });
    const proposal = (requiredSecrets: Array<Record<string, string>>) => createCapabilityProposal(db, {
      subjectId: session.id, subjectKind: "pi", capabilityId: "cyberos.settings.update-propose",
      risk: "high", redactedInput: {}, proposal: { requiredSecrets },
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    });
    expect(agentCapabilityJobInteraction(db, job.id)).toBe("approval");
    const automatic = proposal([]);
    linkAgentJobToCapabilityRun(db, { jobId: job.id, runId: automatic.run.id });
    authorizeAgentCapabilityRun(db, { jobId: job.id, runId: automatic.run.id });
    expect(agentCapabilityJobInteraction(db, job.id)).toBe("automatic");
    const input = proposal([{ name: "token", label: "Token" }]);
    linkAgentJobToCapabilityRun(db, { jobId: job.id, runId: input.run.id });
    expect(agentCapabilityJobInteraction(db, job.id)).toBe("input_required");
    saveAgentCapabilityPolicySettings(db, defaultAgentCapabilityPolicySettings());
    expect(agentCapabilityJobInteraction(db, job.id)).toBe("approval");
  });
});
