/**
 * [INPUT]: 依赖隔离 SQLite、作业状态与能力审批。
 * [OUTPUT]: 验证 Agent 通知范围、幂等和状态事务。
 * [POS]: db 的 Agent 事件到通用通知边界测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendEvent, authorizeAgentCapabilityRun, claimNextJob, claimNotificationDelivery, createBrowserPushSubscription,
  createActionMessageAndJob, createCapabilityProposal, decideCapabilityApproval, getCapabilityApprovalByRun, getClaimedNotificationDelivery,
  createSession, createUserMessageAndJob, defaultAgentCapabilityPolicySettings, finishAgentJobWithNotification,
  getJob, linkAgentJobToCapabilityRun, listEvents, listNotificationEvents, openCyberOsDb, recoverExpiredAgentJobs,
  saveAgentCapabilityPolicySettings, updateJobStatus, type CyberOsDatabase } from "./index.js";

let db: CyberOsDatabase;
beforeEach(() => { db = openCyberOsDb(":memory:"); });
afterEach(() => { db.close(); });
function claimed() {
  const session = createSession(db, {});
  const { job } = createUserMessageAndJob(db, { sessionId: session.id, content: "hello" });
  claimNextJob(db, { workerId: "worker", leaseMs: 30_000 });
  return { session, job };
}
function proposal(jobId: string, sessionId: string, requiredSecrets: Array<{ name: string }> = []) {
  const { run } = createCapabilityProposal(db, { subjectId: sessionId, subjectKind: "pi", capabilityId: "cyberos.settings.update-propose",
    risk: "high", redactedInput: {}, proposal: { requiredSecrets }, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  linkAgentJobToCapabilityRun(db, { jobId, runId: run.id });
  return run;
}

describe("Agent notification production", () => {
  it("atomically completes with one reply and the exact stored transcript reference", () => {
    const { session, job } = claimed();
    const event = appendEvent(db, { sessionId: session.id, jobId: job.id, type: "agent.message", payload: { role: "assistant", content: "Reply" } });
    expect(finishAgentJobWithNotification(db, { jobId: job.id, workerId: "worker", status: "completed", reply: "Reply" })).toBe(true);
    expect(finishAgentJobWithNotification(db, { jobId: job.id, workerId: "worker", status: "completed", reply: "Reply" })).toBe(false);
    expect(listNotificationEvents(db)).toEqual([expect.objectContaining({ type: "agent.reply", target: {
      kind: "agent_session", sessionId: session.id, jobId: job.id, transcriptEventId: event.id } })]);
  });

  it("does not notify empty replies, cancelled jobs, voice sessions or system jobs", () => {
    const first = claimed();
    finishAgentJobWithNotification(db, { jobId: first.job.id, workerId: "worker", status: "completed", reply: "  " });
    const cancelled = claimed();
    updateJobStatus(db, cancelled.job.id, "cancelled");
    expect(finishAgentJobWithNotification(db, { jobId: cancelled.job.id, workerId: "worker", status: "completed", reply: "late" })).toBe(false);
    const voice = claimed();
    db.prepare("UPDATE agent_sessions SET kind='voice' WHERE id=?").run(voice.session.id);
    finishAgentJobWithNotification(db, { jobId: voice.job.id, workerId: "worker", status: "failed", error: "failed" });
    const session = createSession(db, {});
    const { job } = createActionMessageAndJob(db, { sessionId: session.id, content: "operation", kind: "storage", status: "running" });
    appendEvent(db, { sessionId: session.id, jobId: job.id, type: "approval.pending", payload: {} });
    expect(listNotificationEvents(db)).toEqual([]);
  });

  it("rolls state and job event back when notification creation fails", () => {
    const { session, job } = claimed();
    db.exec("CREATE TRIGGER reject_notification BEFORE INSERT ON notification_events BEGIN SELECT RAISE(ABORT,'notification failed'); END");
    expect(() => finishAgentJobWithNotification(db, { jobId: job.id, workerId: "worker", status: "failed", error: "error" })).toThrow("notification failed");
    expect(getJob(db, job.id)?.status).toBe("running");
    expect(listEvents(db, { sessionId: session.id })).toEqual([]);
  });

  it("publishes one failure on lease recovery and refuses a stale worker", () => {
    const { session, job } = claimed();
    db.prepare("UPDATE jobs SET lease_until=? WHERE id=?").run("2000-01-01T00:00:00.000Z", job.id);
    expect(recoverExpiredAgentJobs(db)).toBe(1);
    expect(recoverExpiredAgentJobs(db)).toBe(0);
    expect(finishAgentJobWithNotification(db, { jobId: job.id, workerId: "worker", status: "completed", reply: "late" })).toBe(false);
    const failedEvent = listEvents(db, { sessionId: session.id }).find(event => event.type === "job.failed");
    expect(listNotificationEvents(db)).toEqual([expect.objectContaining({ type: "agent.failed", target: {
      kind: "agent_session", sessionId: session.id, jobId: job.id, transcriptEventId: failedEvent?.id } })]);
  });

  it("publishes manual approval once per capability run, including later runs of the same job", () => {
    const { session, job } = claimed();
    const first = proposal(job.id, session.id);
    authorizeAgentCapabilityRun(db, { jobId: job.id, runId: first.id });
    authorizeAgentCapabilityRun(db, { jobId: job.id, runId: first.id });
    appendEvent(db, { sessionId: session.id, jobId: job.id, type: "approval.pending", payload: { runId: first.id } });
    const second = proposal(job.id, session.id);
    authorizeAgentCapabilityRun(db, { jobId: job.id, runId: second.id });
    expect(listNotificationEvents(db).map(event => event.target)).toEqual([first, second].map(run => ({
      kind: "agent_session", sessionId: session.id, jobId: job.id, runId: run.id })));
  });

  it("notifies credential input but suppresses full-access automatic waits", () => {
    saveAgentCapabilityPolicySettings(db, { ...defaultAgentCapabilityPolicySettings(), fullAccess: true });
    const { session, job } = claimed();
    const automatic = proposal(job.id, session.id);
    expect(authorizeAgentCapabilityRun(db, { jobId: job.id, runId: automatic.id })).toBe("automatic");
    appendEvent(db, { sessionId: session.id, jobId: job.id, type: "approval.pending", payload: { runId: automatic.id } });
    const input = proposal(job.id, session.id, [{ name: "token" }]);
    expect(authorizeAgentCapabilityRun(db, { jobId: job.id, runId: input.id })).toBe("input_required");
    expect(listNotificationEvents(db)).toEqual([expect.objectContaining({ type: "agent.action_required", target: {
      kind: "agent_session", sessionId: session.id, jobId: job.id, runId: input.id } })]);
  });

  it.each(["approved", "rejected", "cancelled", "expired"] as const)("settles obsolete %s approval deliveries before sending", (state) => {
    createBrowserPushSubscription(db, { subscription: { endpoint: "https://push.example/one", expirationTime: null,
      keys: { p256dh: "public", auth: "secret" } }, origin: "https://cyberos.example", locale: "en" });
    const { session, job } = claimed();
    const run = proposal(job.id, session.id);
    authorizeAgentCapabilityRun(db, { jobId: job.id, runId: run.id });
    const sentAt = new Date(Date.now() + 2_100);
    const delivery = claimNotificationDelivery(db, { workerId: "sender", now: sentAt });
    expect(delivery).not.toBeNull();
    if (state === "approved" || state === "rejected") {
      const approval = getCapabilityApprovalByRun(db, run.id)!;
      decideCapabilityApproval(db, { approvalId: approval.id, expectedRevision: approval.revision, decision: state, decidedBy: "user" });
    } else if (state === "cancelled") updateJobStatus(db, job.id, "cancelled");
    else db.prepare("UPDATE capability_approvals SET expires_at=? WHERE run_id=?").run("2000-01-01T00:00:00.000Z", run.id);
    expect(getClaimedNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "sender", now: sentAt })).toBeNull();
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "failed", last_error: "notification_obsolete" });
  });
});
