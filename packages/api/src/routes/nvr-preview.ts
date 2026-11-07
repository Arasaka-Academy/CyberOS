import { request as httpRequest } from "node:http";
import type { EventEmitter } from "node:events";
import type { FastifyInstance } from "fastify";
import { nvrSocketPath, type CyberOsRuntime } from "@cyberos/shared";

const MAX_FRAME = 8 * 1024 * 1024;
const MAX_HEADER = 8192;
interface PreviewSocket extends EventEmitter {
  readonly OPEN: number;
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Buffer): void;
  close(code?: number, reason?: string): void;
}

/** CyberVisual sends length-delimited JPEG parts. Never scan inside JPEG data. */
export class MjpegFrames {
  private buffer: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  private length: number | null = null;
  private readonly boundary: string;
  constructor(contentType: string) {
    const match = /^multipart\/x-mixed-replace\s*;\s*boundary=(?:"([^"\r\n]+)"|([^;\s]+))\s*$/iu.exec(contentType);
    const boundary = match?.[1] ?? match?.[2];
    if (!boundary || boundary.length > 70 || /[^\x21-\x7e]/u.test(boundary)) throw new Error("Invalid preview boundary");
    this.boundary = `--${boundary}`;
  }
  push(chunk: Buffer): Buffer[] {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    const frames: Buffer[] = [];
    while (this.buffer.length) {
      if (this.length === null) {
        const end = this.buffer.indexOf("\r\n\r\n");
        if (end < 0) {
          if (this.buffer.length > MAX_HEADER) throw new Error("Preview header too large");
          break;
        }
        if (end > MAX_HEADER) throw new Error("Preview header too large");
        const lines = this.buffer.subarray(0, end).toString("ascii").split("\r\n");
        if (lines.shift() !== this.boundary) throw new Error("Invalid preview part");
        const lengths = lines.filter((line) => /^content-length:/iu.test(line));
        const value = lengths[0]?.slice(lengths[0].indexOf(":") + 1).trim() ?? "";
        if (lengths.length !== 1 || !/^\d+$/u.test(value)) throw new Error("Invalid preview length");
        this.length = Number(value);
        if (this.length < 4 || this.length > MAX_FRAME || !lines.some((line) => /^content-type:\s*image\/jpeg\s*$/iu.test(line))) throw new Error("Invalid preview image");
        this.buffer = this.buffer.subarray(end + 4);
      }
      if (this.buffer.length < this.length + 2) break;
      const frame = this.buffer.subarray(0, this.length);
      if (frame.readUInt16BE(0) !== 0xffd8 || frame.readUInt16BE(frame.length - 2) !== 0xffd9 || this.buffer.toString("ascii", this.length, this.length + 2) !== "\r\n") throw new Error("Invalid preview JPEG");
      frames.push(frame);
      this.buffer = this.buffer.subarray(this.length + 2);
      this.length = null;
    }
    return frames;
  }
}

export function registerNvrPreview(server: FastifyInstance, config: CyberOsRuntime): void {
  const clients = new Set<PreviewSocket>();
  server.get<{ Params: { id: string } }>("/api/nvr/devices/:id/preview-socket", { websocket: true }, (socket: PreviewSocket, request) => {
    const origin = request.headers.origin;
    let allowed = Boolean(origin && config.api.allowedOrigins.includes(origin));
    try { allowed ||= Boolean(origin && new URL(origin).host === request.headers.host && ["http:", "https:"].includes(new URL(origin).protocol)); } catch { /* Reject malformed origins. */ }
    if (!allowed) { socket.close(1008, "Preview origin is not allowed"); return; }
    if (clients.size >= 16) { socket.close(1013, "Too many preview clients"); return; }
    clients.add(socket);
    const upstream = httpRequest({ socketPath: nvrSocketPath(config), path: `/nvr/devices/${encodeURIComponent(request.params.id)}/preview` }, (response) => {
      if (socket.readyState !== socket.OPEN) { response.destroy(); return; }
      let frames: MjpegFrames;
      try {
        if (response.statusCode !== 200) throw new Error("Preview unavailable");
        frames = new MjpegFrames(response.headers["content-type"] ?? "");
      } catch { response.destroy(); socket.close(1011, "Preview unavailable"); return; }
      response.on("data", (chunk: Buffer) => {
        try {
          for (const frame of frames.push(chunk)) {
            // Drop whole frames for a slow viewer; recording never waits for it.
            if (socket.readyState === socket.OPEN && socket.bufferedAmount < 2 * 1024 * 1024) socket.send(frame);
          }
        } catch { response.destroy(); socket.close(1011, "Invalid preview stream"); }
      });
      response.once("end", () => socket.close(1001, "Preview ended"));
      response.once("error", () => socket.close(1011, "Preview unavailable"));
      socket.once("close", () => response.destroy());
    });
    socket.once("close", () => { clients.delete(socket); upstream.destroy(); });
    socket.on("error", () => upstream.destroy());
    socket.on("message", () => socket.close(1008, "Preview is read only"));
    upstream.setTimeout(15000, () => upstream.destroy());
    upstream.once("error", () => socket.close(1011, "Preview unavailable"));
    upstream.end();
  });
}
