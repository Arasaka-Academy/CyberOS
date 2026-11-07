import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { once, type EventEmitter } from "node:events";
import { createServer, type ServerResponse } from "node:http";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { loadCyberOsRuntime, nvrSocketPath } from "@cyberos/shared";
import { MjpegFrames, registerNvrPreview } from "./nvr-preview.js";

interface TestSocket extends EventEmitter { close(): void; terminate(): void; }
const { WebSocket } = createRequire(import.meta.url)("ws") as {
  WebSocket: new (url: string, options: { origin: string }) => TestSocket;
};

const jpeg = Buffer.from([0xff, 0xd8, 0x12, 0xff, 0xd9]);
const part = (frame = jpeg) => Buffer.concat([Buffer.from(`--frame\r\nContent-Type: image/jpeg\r\nContent-Length: ${frame.length}\r\n\r\n`), frame, Buffer.from("\r\n")]);

describe("NVR preview framing", () => {
  it("reassembles split headers and frames without scanning inside JPEG payloads", () => {
    const decoder = new MjpegFrames('multipart/x-mixed-replace; boundary="frame"');
    const image = Buffer.concat([jpeg.subarray(0, 2), Buffer.from("\r\n--frame\r\nContent-Length: 1\r\n\r\n"), jpeg.subarray(2)]);
    const result = [];
    for (const byte of Buffer.concat([part(image), part()])) result.push(...decoder.push(Buffer.from([byte])));
    expect(result).toEqual([image, jpeg]);
  });
  it.each([
    "--other\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\n\r\n",
    "--frame\r\nContent-Type: image/jpeg\r\n\r\n",
    "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 99999999\r\n\r\n",
    "--frame\r\nContent-Type: image/jpeg\r\nContent-Length: 5\r\nContent-Length: 5\r\n\r\n",
    "--frame\r\nContent-Type: text/html\r\nContent-Length: 5\r\n\r\n",
    "x".repeat(8193),
  ])("rejects invalid or unbounded multipart headers (%#)", (wire) => {
    expect(() => new MjpegFrames("multipart/x-mixed-replace; boundary=frame").push(Buffer.from(wire))).toThrow();
  });
  it("rejects damaged JPEG markers and invalid source content types", () => {
    expect(() => new MjpegFrames("text/html")).toThrow();
    expect(() => new MjpegFrames("multipart/x-mixed-replace; boundary=frame").push(part(Buffer.from("broken")))).toThrow();
  });
});

async function fixture(reply: (response: ServerResponse) => void) {
  const root = await mkdtemp(path.join(tmpdir(), "nvr-ws-"));
  const config = loadCyberOsRuntime({ CYBEROS_ENVIRONMENT: "development", CYBEROS_ROOT: root });
  await mkdir(config.paths.stateDir, { recursive: true });
  const paths: string[] = []; let active = 0;
  const source = createServer((request, response) => {
    paths.push(request.url ?? ""); active += 1;
    response.once("close", () => { active -= 1; });
    reply(response);
  });
  source.listen(nvrSocketPath(config)); await once(source, "listening");
  const server = Fastify(); await server.register(websocket);
  registerNvrPreview(server, config);
  await server.listen({ host: "127.0.0.1", port: 0 });
  const address = server.server.address();
  if (!address || typeof address === "string") throw new Error("No test address");
  const origin = `http://127.0.0.1:${address.port}`;
  const sockets: TestSocket[] = [];
  return { paths, active: () => active, connect(originOverride = origin, id = "camera") {
    const socket = new WebSocket(`${origin.replace("http:", "ws:")}/api/nvr/devices/${id}/preview-socket`, { origin: originOverride });
    sockets.push(socket); return socket;
  }, async close() {
    for (const socket of sockets) socket.terminate();
    await server.close(); source.closeAllConnections();
    await new Promise<void>((resolve, reject) => source.close((error) => error ? reject(error) : resolve()));
    await rm(root, { recursive: true, force: true });
  } };
}

describe("NVR WebSocket preview", () => {
  it("serves four cameras independently and closes source streams on viewer disconnect", async () => {
    const f = await fixture((response) => {
      response.writeHead(200, { "Content-Type": "multipart/x-mixed-replace; boundary=frame" });
      response.write(part());
    });
    try {
      const sockets = Array.from({ length: 4 }, (_, index) => f.connect(undefined, `camera-${index}`));
      const frames = await Promise.all(sockets.map((socket) => once(socket, "message")));
      expect(frames.map(([data]) => data)).toEqual([jpeg, jpeg, jpeg, jpeg]);
      expect(f.paths.sort()).toEqual(Array.from({ length: 4 }, (_, index) => `/nvr/devices/camera-${index}/preview`));
      expect(f.active()).toBe(4);
      for (const socket of sockets) socket.close();
      await expect.poll(f.active).toBe(0);
    } finally { await f.close(); }
  });
  it("rejects cross-origin viewers before opening a source", async () => {
    const f = await fixture((response) => response.end("private-secret"));
    try {
      const socket = f.connect("http://untrusted.invalid");
      const [code] = await once(socket, "close");
      expect(code).toBe(1008); expect(f.paths).toEqual([]);
    } finally { await f.close(); }
  });
  it("closes authentication failures without forwarding source bodies or credentials", async () => {
    const f = await fixture((response) => { response.writeHead(401); response.end("private-secret"); });
    try {
      const socket = f.connect(); const messages: unknown[] = [];
      socket.on("message", (message: Buffer) => messages.push(message));
      const [code, reason] = await once(socket, "close");
      expect(code).toBe(1011); expect(String(reason)).toBe("Preview unavailable"); expect(messages).toEqual([]);
    } finally { await f.close(); }
  });
});
