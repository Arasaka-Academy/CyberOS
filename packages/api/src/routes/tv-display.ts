/**
 * [INPUT]: 依赖显示运行时与整机 TV 设置。
 * [OUTPUT]: 提供显示事件流与本机 Chromium 渲染握手。
 * [POS]: TV shell 的状态订阅边界；不接受电源控制命令。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { FastifyInstance } from "fastify";
import { defaultTvSettings, getTvSettings } from "@cyberos/db";
import type { ApiRouteContext } from "../context.js";
import { unavailableTvDisplay } from "../lib/tv-display.js";

export function registerTvDisplayRoutes(server: FastifyInstance, context: ApiRouteContext): void {
  const clients = new Set<() => void>();
  server.addHook("preClose", async () => { for (const close of clients) close(); });
  server.post<{ Body: unknown }>("/api/tv/renderer", async (request, reply) => {
    const forwarded = request.headers["x-forwarded-for"];
    const addresses = [request.ip, ...[forwarded].flat().flatMap(value => typeof value === "string" ? value.split(",").map(address => address.trim()) : [])];
    if (!addresses.every(address => address === "::1" || address === "::ffff:127.0.0.1" || address === "127.0.0.1")) {
      return reply.status(403).send({ error: "Renderer readiness is restricted to the local TV display" });
    }
    const body = request.body;
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => key !== "ready") || !("ready" in body) || typeof body.ready !== "boolean") {
      return reply.status(400).send({ error: "Renderer readiness must be a boolean" });
    }
    context.tvDisplay?.rendererReady(body.ready);
    return { display: context.tvDisplay?.status() ?? unavailableTvDisplay() };
  });
  server.get("/api/tv/events", async (_request, reply) => {
    reply.hijack();
    const raw = reply.raw;
    raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" });
    raw.write(": connected\n\n");
    let previous = "";
    let closed = false;
    const flush = () => {
      if (closed) return;
      try {
        const next = JSON.stringify({ display: context.tvDisplay?.status() ?? unavailableTvDisplay(), settings: getTvSettings(context.db) ?? defaultTvSettings() });
        if (next !== previous) { previous = next; raw.write(`event: snapshot\ndata: ${next}\n\n`); }
      } catch { raw.write("event: unavailable\ndata: {}\n\n"); }
    };
    const unsubscribe = context.tvDisplay?.subscribe(flush);
    const timer = setInterval(flush, 1_000);
    timer.unref();
    const close = () => { if (closed) return; closed = true; clearInterval(timer); unsubscribe?.(); clients.delete(close); raw.end(); };
    clients.add(close);
    raw.once("close", close);
    flush();
  });
}
