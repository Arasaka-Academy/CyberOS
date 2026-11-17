/**
 * [INPUT]: 依赖真实 SQLite、提案编排和第一方输入路由。
 * [OUTPUT]: 验证完全权限下的凭据输入与会话隔离。
 * [POS]: API 的免审批秘密输入回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createMcpClient, createSession, createUserMessageAndJob, defaultAgentCapabilityPolicySettings,
  getCapabilityApprovalByRun, getCapabilityRun, linkAgentJobToCapabilityRun, listCapabilityRunEvents,
  openCyberOsDb, saveAgentCapabilityPolicySettings, type CyberOsDatabase
} from "@cyberos/db";
import { proposeDomainCapability, type CapabilityDomainAdapter } from "@cyberos/capability-runtime";
import { loadCyberOsRuntime } from "@cyberos/shared";
import { MonitoringReader } from "@cyberos/monitoring";
import type { ApiRouteContext } from "../context.js";
import { registerApprovalRoutes } from "./approvals.js";
import { registerSessionRoutes } from "./sessions.js";

let db: CyberOsDatabase;
beforeEach(() => { db = openCyberOsDb(":memory:"); });
afterEach(() => { db.close(); });

async function setup() {
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: "/tmp/cyberos-approval-test" }, "/tmp/cyberos-approval-test");
  saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
  const adapter: CapabilityDomainAdapter = {
    availability: () => ({ available: true }),
    prepare: () => ({ summary: "Update credential", privatePayload: {}, requiredSecrets: [{ name: "apiKey", label: "API key" }] }),
    revalidate: () => undefined,
    execute: (_prepared, _context, secrets) => ({ data: { configured: Boolean(secrets.apiKey) } })
  };
  const capabilityRuntime = { db, config, adapters: { "cyberos.settings.update-propose": adapter } };
  const server = Fastify();
  const monitoring = new MonitoringReader(config.paths.metricsDatabasePath, config.monitoring);
  server.addHook("onClose", () => { monitoring.close(); });
  registerApprovalRoutes(server, { db, config, capabilityRuntime, monitoring } satisfies ApiRouteContext);
  registerSessionRoutes(server, { db, config, capabilityRuntime, monitoring } satisfies ApiRouteContext);
  const session = createSession(db, {});
  const { job } = createUserMessageAndJob(db, { sessionId: session.id, content: "Update credential", status: "waiting_approval" });
  const client = createMcpClient(db, { name: "Pi", kind: "pi", scopes: ["cyberos:settings:propose"] });
  const proposed = await proposeDomainCapability({ dependencies: capabilityRuntime, subject: { id: client.id, clientId: client.id, kind: "pi", scopes: new Set(client.scopes) }, capabilityId: "cyberos.settings.update-propose", request: { operation: "model_provider" } });
  linkAgentJobToCapabilityRun(db, { jobId: job.id, runId: proposed.runId! });
  const approval = getCapabilityApprovalByRun(db, proposed.runId!)!;
  return { server, session, approval, runId: proposed.runId! };
}

describe("full-access credential input", () => {
  it("executes after input without requiring an approval decision or confirmation", async () => {
    const { server, session, approval, runId } = await setup();
    try {
      const pending = await server.inject({ method: "GET", url: `/api/approvals?sessionId=${session.id}` });
      expect(pending.json().capabilityApprovals[0]).toMatchObject({ interaction: "input_required", requiresConfirmation: false });
      const sessions = (await server.inject({ method: "GET", url: "/api/sessions" })).json().sessions;
      expect(sessions[0]).toMatchObject({ pendingApprovalCount: 0, activeJob: { status: "waiting_approval", capabilityInteraction: "input_required" } });
      const transcript = (await server.inject({ method: "GET", url: `/api/sessions/${session.id}/transcript` })).json();
      expect(transcript.activeJob.capabilityInteraction).toBe("input_required");
      const response = await server.inject({ method: "POST", url: `/api/capability-approvals/${approval.id}/input`, payload: { sessionId: session.id, expectedRevision: approval.revision, secretInput: { apiKey: "ephemeral-secret" } } });
      expect(response.statusCode).toBe(200);
      expect(getCapabilityRun(db, runId)).toMatchObject({ state: "succeeded", result: { configured: true } });
      expect(getCapabilityApprovalByRun(db, runId)).toMatchObject({ status: "approved", decidedBy: "system:full-access" });
      expect(JSON.stringify(listCapabilityRunEvents(db, runId))).not.toContain("ephemeral-secret");
      expect(response.body).not.toContain("ephemeral-secret");
    } finally { await server.close(); }
  });

  it("rejects missing input, wrong sessions, stale revisions and revoked full access", async () => {
    const { server, session, approval, runId } = await setup();
    const url = `/api/capability-approvals/${approval.id}/input`;
    const payload = { sessionId: session.id, expectedRevision: approval.revision, secretInput: { apiKey: "ephemeral-secret" } };
    try {
      expect((await server.inject({ method: "POST", url, payload: { ...payload, sessionId: "another-session" } })).statusCode).toBe(404);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, secretInput: {} } })).statusCode).toBe(400);
      expect((await server.inject({ method: "POST", url, payload: { ...payload, expectedRevision: 999 } })).statusCode).toBe(409);
      saveAgentCapabilityPolicySettings(db, defaultAgentCapabilityPolicySettings());
      expect((await server.inject({ method: "POST", url, payload })).statusCode).toBe(409);
      expect(getCapabilityRun(db, runId)?.state).toBe("waiting_approval");
    } finally { await server.close(); }
  });
});
