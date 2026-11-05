import type { FastifyInstance } from "fastify";
import type { ApiRouteContext } from "../context.js";
import { sendFileStream } from "../lib/files.js";
import { MAX_VOICE_UPLOAD, VoiceInputError } from "../lib/voice-media.js";

export function registerAudioRoutes(server: FastifyInstance, { audio }: Pick<ApiRouteContext, "audio">): void {
  const streams = new Set<() => void>();
  server.addHook("onClose", async () => { for (const close of streams) close(); });
  server.get<{ Querystring: { before?: string; limit?: string } }>("/api/audio/history", async (request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    const { before, limit } = request.query;
    if ((before !== undefined && !/^[1-9]\d{0,15}$/u.test(before))
      || (limit !== undefined && (!/^\d{1,2}$/u.test(limit) || Number(limit) < 1 || Number(limit) > 50))) {
      return reply.status(400).send({ error: "Invalid voice history cursor or limit" });
    }
    try { return audio.history(before, limit ? Number(limit) : undefined); }
    catch { return reply.status(400).send({ error: "Invalid voice history cursor" }); }
  });
  server.get("/api/audio/history/events", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    reply.hijack();
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store, no-transform",
      connection: "keep-alive", "x-accel-buffering": "no" });
    let last = "";
    let heartbeat = 0;
    const send = () => {
      if (reply.raw.writableLength > 1024 * 1024) { close(); return; }
      const snapshot = JSON.stringify(audio.history());
      if (snapshot !== last) { reply.raw.write(`event: history\ndata: ${snapshot}\n\n`); last = snapshot; }
      else if (++heartbeat % 15 === 0) reply.raw.write(": keepalive\n\n");
    };
    const timer = setInterval(send, 1000);
    timer.unref();
    const close = () => { clearInterval(timer); streams.delete(close); reply.raw.end(); };
    streams.add(close);
    reply.raw.on("close", close);
    send();
  });
  server.post("/api/audio/recordings", { bodyLimit: MAX_VOICE_UPLOAD + 64 * 1024 }, async (request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    const clientId = request.headers["x-voice-client"];
    const key = request.headers["idempotency-key"];
    const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{16,80}$/u.test(value);
    if (!validId(clientId) || !validId(key)) return reply.status(400).send({ error: "Supply a voice client ID and idempotency key" });
    try {
      // Retries remain idempotent even if the channel has since been disabled.
      const existing = audio.browserTurn(clientId, key);
      if (existing && (existing.status !== "failed" || existing.jobId)) { request.raw.resume(); return reply.status(202).send({ turn: existing }); }
      audio.checkBrowserInput();
      let input: Buffer | null = null;
      for await (const part of request.parts({ limits: { files: 1, fields: 0, parts: 1, fileSize: MAX_VOICE_UPLOAD } })) {
        if (part.type !== "file" || part.fieldname !== "file") throw new VoiceInputError("Attach one audio file", 400);
        input = await part.toBuffer();
      }
      if (!input) return reply.status(400).send({ error: "Attach one audio recording" });
      const turn = await audio.submitBrowser(input, clientId, key);
      return reply.status(202).send({ turn });
    } catch (error) {
      if (error instanceof VoiceInputError) return reply.status(error.statusCode).send({ error: error.message });
      if (error instanceof Error && "statusCode" in error && error.statusCode === 413) return reply.status(413).send({ error: "Recording exceeds 8 MiB" });
      return reply.status(400).send({ error: "Could not read recording; attach one audio file" });
    }
  });
  server.get<{ Params: { id: string } }>("/api/audio/media/:id", async (request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    const { id } = request.params;
    if (!/^[0-9a-f-]{36}$/u.test(id)) return reply.status(404).send({ error: "Audio unavailable" });
    const filePath = audio.mediaPath(id);
    if (!filePath) return reply.status(404).send({ error: "Audio unavailable" });
    reply.header("Cache-Control", "private, max-age=31536000, immutable");
    try { return await sendFileStream(reply, request.headers.range, filePath, "audio/wav"); }
    catch { return reply.status(404).send({ error: "Audio unavailable" }); }
  });
  server.get("/api/audio/status", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    return audio.refreshStatus();
  });
  server.get("/api/audio/devices", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    try { return await audio.runtime.devices(); }
    catch { return reply.status(503).send({ error: "Audio daemon unavailable" }); }
  });
  server.post("/api/audio/test/service", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    return audio.serviceTest();
  });
  server.post("/api/audio/test/recording", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    try { await audio.armRecordingTest(); return { armed: true }; }
    catch { return reply.status(409).send({ error: "Configure input, service and token; wait for active recording to finish" }); }
  });
  server.post<{ Body?: { text?: string } }>("/api/audio/test/speech", async (request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    const text = request.body?.text ?? "你好，CyberOS 语音输出测试。 Hello from CyberOS.";
    if (typeof text !== "string" || !text.trim() || Array.from(text).length > 500) return reply.status(400).send({ error: "Speech test requires 1–500 characters" });
    try { await audio.testSpeech(text); return { played: true }; }
    catch { return reply.status(409).send({ error: "Speech test failed; check service, selected output and media focus" }); }
  });
  server.post("/api/audio/stop", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    await audio.stopSpeech(); return { stopped: true };
  });
  server.post("/api/audio/session/reset", async (_request, reply) => {
    if (!audio) return reply.status(503).send({ error: "Audio coordinator unavailable" });
    try { return { session: audio.resetContext() }; }
    catch { return reply.status(409).send({ error: "Voice context cannot reset while work is active" }); }
  });
}
