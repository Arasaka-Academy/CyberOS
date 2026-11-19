/**
 * [INPUT]: 依赖 Agent 作业归属、提案快照、权限设置和通知仓库。
 * [OUTPUT]: 提供交互判断、系统自动授权和人工处理通知。
 * [POS]: worker 与第一方输入路由共用的授权边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { CyberOsDatabase } from "../connection.js";
import { getAgentCapabilityPolicySettings } from "./settings.js";
import { decideCapabilityApproval, getAgentCapabilityApproval, getCapabilityApprovalByRun, getCapabilityRunForAgentJob } from "./capability-runs.js";
import { publishAgentJobNotification } from "./notifications.js";

export type AgentCapabilityInteraction = "approval" | "input_required" | "automatic";
export const FULL_ACCESS_DECISION_SOURCE = "system:full-access";

export function agentCapabilityRunInteraction(db: CyberOsDatabase, runId: string): AgentCapabilityInteraction {
  const approval = getCapabilityApprovalByRun(db, runId);
  if (approval?.status === "approved" && approval.decidedBy === FULL_ACCESS_DECISION_SOURCE) return "automatic";
  if (!approval || approval.status !== "pending" || !getAgentCapabilityPolicySettings(db)?.fullAccess) return "approval";
  const proposal = approval.proposal;
  if (!proposal || typeof proposal !== "object" || Array.isArray(proposal) || proposal.authorizationMode !== "full_access") return "approval";
  return Array.isArray(proposal.requiredSecrets) && proposal.requiredSecrets.length > 0 ? "input_required" : "automatic";
}

export function agentCapabilityJobInteraction(db: CyberOsDatabase, jobId: string): AgentCapabilityInteraction {
  const runs = db.prepare(`
    SELECT r.id FROM capability_runs r
    JOIN agent_capability_runs a ON a.run_id = r.id
    WHERE a.job_id = ? AND r.state NOT IN ('succeeded', 'failed', 'cancelled', 'expired')
  `).all(jobId) as Array<{ id: string }>;
  if (!runs.length) {
    const latest = getCapabilityRunForAgentJob(db, jobId);
    return latest ? agentCapabilityRunInteraction(db, latest.id) : "approval";
  }
  const interactions = runs.map(run => agentCapabilityRunInteraction(db, run.id));
  if (interactions.includes("approval")) return "approval";
  return interactions.includes("input_required") ? "input_required" : "automatic";
}

export function authorizeAgentCapabilityRun(
  db: CyberOsDatabase,
  input: { runId: string; jobId: string }
): AgentCapabilityInteraction {
  return db.transaction(() => {
    const approval = getCapabilityApprovalByRun(db, input.runId);
    const linked = approval && getAgentCapabilityApproval(db, approval.id);
    if (!linked || linked.jobId !== input.jobId) throw new Error("Capability run is not owned by this Agent job");
    const activeJob = db.prepare("SELECT 1 FROM jobs WHERE id = ? AND status IN ('running', 'waiting_approval')").pluck().get(input.jobId);
    if (!activeJob) throw new Error("Agent job no longer accepts capability work");
    const interaction = agentCapabilityRunInteraction(db, input.runId);
    if (interaction === "automatic" && approval.status === "pending") {
      if (!decideCapabilityApproval(db, {
        approvalId: approval.id, expectedRevision: approval.revision,
        decision: "approved", decidedBy: FULL_ACCESS_DECISION_SOURCE, confirmed: true
      })) throw new Error("Capability run changed before automatic authorization");
    }
    if (interaction !== "automatic" && approval.status === "pending") {
      publishAgentJobNotification(db, { jobId: input.jobId, type: "agent.action_required", runId: input.runId });
    }
    return interaction;
  }).immediate();
}
