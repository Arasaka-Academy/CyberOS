/**
 * [INPUT]: 依赖 Agent 权限设置与能力标识。
 * [OUTPUT]: 提供能力别名映射和有效权限决策。
 * [POS]: MCP、worker 与执行器共用的权限规则。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { AgentCapabilityId, AgentCapabilityPolicyMode, AgentCapabilityPolicySettingsRecord } from "./types.js";

export function agentPolicyCapabilityId(id: string): AgentCapabilityId | null {
  switch (id) {
    case "cyberos.files.list": case "cyberos.files.search": case "cyberos.files.grep":
    case "cyberos.files.find": case "cyberos.files.edit": case "cyberos.files.write":
    case "cyberos.shell.run": return id;
    case "cyberos.files.stat": case "cyberos.files.read": case "cyberos.files.resource-link":
      return "cyberos.files.read";
    case "cyberos.files.mutate": case "cyberos.files.rollback-propose": case "cyberos.files.restore-propose":
    case "cyberos.files.extract-propose": case "cyberos.files.batch-propose": case "cyberos.files.batch-cancel-propose":
      return "cyberos.files.mutate";
    default: return null;
  }
}

export function effectiveAgentCapabilityPolicy(
  settings: Pick<AgentCapabilityPolicySettingsRecord, "policies" | "fullAccess">,
  id: string,
  fallback: AgentCapabilityPolicyMode = "auto"
): AgentCapabilityPolicyMode {
  if (settings.fullAccess === true) return "auto";
  const policyId = agentPolicyCapabilityId(id);
  return policyId ? settings.policies[policyId] : fallback;
}
