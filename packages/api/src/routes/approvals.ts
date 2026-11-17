/**
 * [INPUT]: 依赖能力运行、作业归属、当前授权模式与秘密输入验证。
 * [OUTPUT]: 提供人工审批和完全权限下的第一方补充信息接口。
 * [POS]: 第一方交互边界；凭据仅在请求内存中交给执行器。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import {
  capabilityRunSecretRequirements,
  executeApprovedCapabilityRun,
  executeStartedSecretCapabilityRun,
  validateCapabilitySecretInput
} from "@cyberos/capability-runtime";
import {
  appendEvent,
  agentCapabilityRunInteraction,
  FULL_ACCESS_DECISION_SOURCE,
  decideCapabilityApproval,
  deleteCapabilityRunPayload,
  expireCapabilityApprovals,
  getAgentCapabilityApproval,
  listPendingAgentCapabilityApprovals
} from "@cyberos/db";
import type { ApiRouteContext } from "../context.js";

interface ApprovalDecisionRequest {
  Params: { id: string };
  Body: {
    sessionId?: string;
    decision?: "approved" | "rejected";
    expectedRevision?: number;
    confirmed?: boolean;
    secretInput?: Record<string, string>;
  };
}

export function registerApprovalRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const { config, db } = context;
  const capabilityRuntime = context.capabilityRuntime ?? { db, config };

  server.get<{
    Querystring: { sessionId?: string };
  }>("/api/approvals", async (request, reply) => {
    if (!request.query.sessionId) {
      reply.status(400).send({ error: "sessionId is required" });
      return;
    }
    expireCapabilityApprovals(db);
    return {
      capabilityApprovals: listPendingAgentCapabilityApprovals(db, {
        sessionId: request.query.sessionId
      }).map((approval) => {
        const interaction = agentCapabilityRunInteraction(db, approval.run.id);
        return { ...approval, interaction, requiresConfirmation: interaction === "input_required" ? false : approval.requiresConfirmation };
      })
    };
  });

  const decide = async (request: FastifyRequest<ApprovalDecisionRequest>, reply: FastifyReply, inputOnly: boolean) => {
    const sessionId = request.body?.sessionId;
    const decision = inputOnly ? "approved" : request.body?.decision;
    const expectedRevision = request.body?.expectedRevision;
    if (!sessionId || (decision !== "approved" && decision !== "rejected") || !Number.isInteger(expectedRevision)) {
      reply.status(400).send({ error: "sessionId, a valid decision, and expectedRevision are required" });
      return;
    }

    const approval = getAgentCapabilityApproval(db, request.params.id);
    if (!approval || approval.sessionId !== sessionId) {
      reply.status(404).send({ error: "Agent approval not found" });
      return;
    }
    if (inputOnly && agentCapabilityRunInteraction(db, approval.run.id) !== "input_required") {
      reply.status(409).send({ error: "This run requires a new approval or no longer accepts input" });
      return;
    }

    const secretRequirements = capabilityRunSecretRequirements(capabilityRuntime, approval.run.id);
    let secretInput: Readonly<Record<string, string>> = {};
    if (decision === "approved") {
      try {
        secretInput = validateCapabilitySecretInput(
          capabilityRunSecretRequirements(capabilityRuntime, approval.run.id),
          request.body?.secretInput
        );
      } catch (error) {
        reply.status(400).send({
          error: error instanceof Error ? error.message : "Required secret input is invalid",
          code: "SECRET_INPUT_REQUIRED"
        });
        return;
      }
    }

    const decided = decideCapabilityApproval(db, {
      approvalId: approval.id,
      expectedRevision: expectedRevision!,
      decision,
      decidedBy: inputOnly ? FULL_ACCESS_DECISION_SOURCE : "local-admin",
      confirmed: inputOnly || request.body?.confirmed === true,
      startRunning: decision === "approved" && secretRequirements.length > 0
    });
    if (!decided) {
      reply.status(409).send({ error: "Approval changed, expired, or requires explicit confirmation" });
      return;
    }
    appendEvent(db, {
      sessionId,
      jobId: approval.jobId,
      type: "approval.updated",
      sourceId: `approval:${decided.approval.id}:${decided.approval.revision}`,
      runId: `capability:${decided.run.id}`,
      payload: {
        approvalId: decided.approval.id,
        capabilityRunId: decided.run.id,
        status: decided.approval.status,
        runState: decided.run.state
      }
    });

    if (decision === "approved") {
      if (secretRequirements.length === 0) {
        setImmediate(() => {
          void executeApprovedCapabilityRun(capabilityRuntime, decided.run.id).catch((error) => {
            server.log.error({ err: error, runId: decided.run.id }, "Capability run execution failed");
          });
        });
        reply.status(202).send(decided);
        return;
      }
      const run = await executeStartedSecretCapabilityRun(capabilityRuntime, decided.run.id, secretInput);
      if (run.state === "failed" || run.state === "cancelled" || run.state === "expired") {
        reply.status(422).send({
          error: run.errorMessage ?? "Approved Agent capability failed",
          ...(run.errorCode ? { code: run.errorCode } : {}),
          ...decided,
          run
        });
        return;
      }
      reply.status(run.state === "succeeded" ? 200 : 202).send({ ...decided, run });
      return;
    }

    deleteCapabilityRunPayload(db, decided.run.id);
    reply.status(200).send(decided);
  };
  server.post<ApprovalDecisionRequest>("/api/capability-approvals/:id/decision", async (request, reply) => decide(request, reply, false));
  server.post<ApprovalDecisionRequest>("/api/capability-approvals/:id/input", async (request, reply) => decide(request, reply, true));
}
