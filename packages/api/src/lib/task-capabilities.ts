import type { FastifyInstance } from "fastify";
import { CapabilityError } from "@cyberos/capabilities";
import type { CapabilityAdapterContext, CapabilityDomainAdapter, PreparedCapabilityAction } from "@cyberos/capability-runtime";
import { ownedDomainTask } from "@cyberos/mcp";
import { capabilityHttp, digest, identifier, json, object, validateCapability } from "./capability-io.js";

export function createTaskCancelAdapter(server: FastifyInstance): CapabilityDomainAdapter {
  const task = (runId: string, context: CapabilityAdapterContext) => {
    const result = ownedDomainTask(context.db, context.subject.clientId, runId);
    if (!result.task?.cancellable) throw new CapabilityError("CONFLICT", "Domain task is no longer cancellable or does not support cancellation");
    return result.task;
  };
  const parse = (prepared: PreparedCapabilityAction) => String(object(prepared.privatePayload).runId);
  const revalidate = (prepared: PreparedCapabilityAction, context: CapabilityAdapterContext) => {
    const current = task(parse(prepared), context);
    if (digest({ kind: current.kind, id: current.id }) !== prepared.revision) throw new CapabilityError("CONFLICT", "Task reference changed");
  };
  return {
    availability: () => ({ available: true }),
    prepare: (value, context) => {
      if (context.subject.kind !== "pi") throw new CapabilityError("FORBIDDEN", "Only the built-in Pi agent may propose task cancellation");
      const input = object(validateCapability("cyberos.tasks.cancel-propose", { request: value }).request);
      const current = task(String(input.runId), context);
      return { summary: `Cancel ${current.kind}: ${current.id}`, changes: json({ runId: input.runId, kind: current.kind, id: current.id }),
        revision: digest({ kind: current.kind, id: current.id }), privatePayload: { runId: input.runId! } };
    },
    revalidate,
    execute: async (prepared, context) => {
      revalidate(prepared, context);
      const current = task(parse(prepared), context);
      const targets = current.kind === "bluetooth_batch" ? current.children?.filter((child) => child.cancellable) ?? [] : [current];
      for (const target of targets) {
        const id = identifier(target.id);
        const url = target.kind === "download_task" ? `/api/downloads/${id}/${target.state === "seeding" ? "stop-seeding" : "cancel"}`
          : target.kind === "file_batch" ? `/api/files/batches/${id}/cancel` : target.kind === "bluetooth_transfer" ? `/api/system/bluetooth/transfers/${id}/cancel` : null;
        if (!url) throw new CapabilityError("CONFLICT", "Task does not support cancellation");
        await capabilityHttp(server, { method: "POST", url });
      }
      return { data: json(ownedDomainTask(context.db, context.subject.clientId, parse(prepared))) };
    }
  };
}
