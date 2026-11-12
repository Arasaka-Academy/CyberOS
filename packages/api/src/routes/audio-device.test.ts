import Fastify from "fastify";
import websocket from "@fastify/websocket";
import { once, type EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { afterEach, expect, it, vi } from "vitest";
import type { AudioCoordinator } from "../lib/audio-coordinator.js";
import { registerAudioDevice } from "./audio-device.js";
interface TestSocket extends EventEmitter { send(value: Buffer | string): void; close(): void; terminate(): void }
const { WebSocket } = createRequire(import.meta.url)("ws") as { WebSocket: new(url: string, options: { headers: Record<string, string> }) => TestSocket };
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); vi.unstubAllEnvs(); });
async function fixture(token = "a".repeat(32)) {
  vi.stubEnv("CYBEROS_WIFI_VOICE_TOKEN", token);
  const detach = vi.fn();
  const audio = { connectWifiDevice: vi.fn(() => detach), stopSpeech: vi.fn(async () => {}), checkBrowserInput: vi.fn(),
    history: () => ({ maxRecordingSeconds: 30 }), submitWifi: vi.fn(async () => {}) };
  const server = Fastify(); await server.register(websocket, { options: { maxPayload: 513 } });
  registerAudioDevice(server, audio as unknown as AudioCoordinator);
  const address = await server.listen({ host: "127.0.0.1", port: 0 });
  const clients: TestSocket[] = [];
  cleanup.push(async () => { clients.forEach((c) => c.terminate()); await server.close(); });
  const connect = (authorization = `Bearer ${token}`, capacity = "131072") => {
    const socket = new WebSocket(`${address.replace("http:", "ws:")}/api/audio/device`, { headers: { authorization,
      "x-cyber-device": "dc:54:75:cd:fb:a0", "x-cyber-max-samples": capacity } });
    clients.push(socket); return socket;
  };
  return { audio, connect, detach };
}
it.each(["", "Bearer wrong"])("rejects missing or incorrect device credentials (%s)", async (authorization) => {
  const { audio, connect } = await fixture(); const socket = connect(authorization);
  const [code] = await once(socket, "close"); expect(code).toBe(1008); expect(audio.connectWifiDevice).not.toHaveBeenCalled();
});
it("keeps the device endpoint disabled without a configured token", async () => {
  const { connect } = await fixture(""); expect((await once(connect(), "close"))[0]).toBe(1008);
});
it("accepts authenticated PTT frames, decodes continuous audio and submits only on release", async () => {
  const { audio, connect, detach } = await fixture(); const socket = connect();
  const [ready] = await once(socket, "message"); expect(ready).toEqual(Buffer.from([0, 1]));
  socket.send(Buffer.from([1])); socket.send(Buffer.concat([Buffer.from([2]), Buffer.alloc(120, 0x12)]));
  await vi.waitFor(() => expect(audio.stopSpeech).toHaveBeenCalledOnce());
  expect(audio.submitWifi).not.toHaveBeenCalled();
  socket.send(Buffer.from([3])); await vi.waitFor(() => expect(audio.submitWifi).toHaveBeenCalledOnce());
  const [wav, id] = audio.submitWifi.mock.calls[0] as unknown as [Buffer, string];
  expect(wav.length).toBe(524); expect(wav.readInt16LE(44)).toBe(1); expect(wav.readInt16LE(46)).toBe(4);
  expect(id).toBe("DC:54:75:CD:FB:A0");
  socket.close(); await once(socket, "close"); await vi.waitFor(() => expect(detach).toHaveBeenCalledOnce());
});
it("discards incomplete recordings on disconnect and rejects out-of-order or text frames", async () => {
  const { audio, connect } = await fixture(); const socket = connect(); await once(socket, "message");
  socket.send(Buffer.from([1])); socket.send(Buffer.concat([Buffer.from([2]), Buffer.alloc(120)])); socket.close(); await once(socket, "close");
  expect(audio.submitWifi).not.toHaveBeenCalled();
  const invalid = connect(); await once(invalid, "message"); const closed = once(invalid, "close"); invalid.send("record"); expect((await closed)[0]).toBe(1008);
});
