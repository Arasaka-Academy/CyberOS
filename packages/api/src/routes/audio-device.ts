import { randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { EventEmitter } from "node:events";
import type { AudioCoordinator } from "../lib/audio-coordinator.js";
import { VoiceAdpcm, pcmWave } from "../lib/wifi-voice-codec.js";
import { WifiSpeaker, type WifiVoiceSocket } from "../lib/wifi-voice-output.js";
interface DeviceSocket extends WifiVoiceSocket, EventEmitter { close(code?: number, reason?: string): void }
export function registerAudioDevice(server: FastifyInstance, audio: AudioCoordinator | undefined): void {
  const sockets = new Set<DeviceSocket>();
  server.addHook("onClose", async () => { for (const socket of sockets) socket.close(1001, "Server stopping"); });
  server.get("/api/audio/device", { websocket: true }, (socket: DeviceSocket, request) => {
    const token = process.env.CYBEROS_WIFI_VOICE_TOKEN ?? "";
    const supplied = request.headers.authorization;
    const id = request.headers["x-cyber-device"];
    const capacity = request.headers["x-cyber-max-samples"];
    const expected = Buffer.from(`Bearer ${token}`), received = Buffer.from(typeof supplied === "string" ? supplied : "");
    if (!audio || !/^[a-zA-Z0-9_-]{32,128}$/u.test(token) || expected.length !== received.length || !timingSafeEqual(expected, received)) { socket.close(1008, "Device authorization required"); return; }
    if (typeof id !== "string" || !/^(?:[0-9a-f]{2}:){5}[0-9a-f]{2}$/iu.test(id) || typeof capacity !== "string" || !/^\d{6,7}$/u.test(capacity) || sockets.size >= 4) { socket.close(1008, "Invalid device or capacity"); return; }
    let speaker: WifiSpeaker;
    let detach: () => void;
    try { speaker = new WifiSpeaker(socket, Number(capacity)); detach = audio.connectWifiDevice(id.toUpperCase(), speaker); }
    catch { socket.close(1008, "Device unavailable or already connected"); return; }
    sockets.add(socket);
    let recording: { decoder: VoiceAdpcm; chunks: Buffer[]; samples: number; maxSamples: number; started: number; key: string } | null = null;
    let accepting = false;
    let alive = Date.now();
    const timer = setInterval(() => {
      if (recording && Date.now() - recording.started > 35000) { recording = null; socket.close(1008, "Recording expired"); }
      if (Date.now() - alive > 45000) socket.close(1001, "Device heartbeat expired");
    }, 1000); timer.unref();
    const close = () => { clearInterval(timer); recording = null; sockets.delete(socket); detach(); };
    socket.once("close", close); socket.on("error", () => socket.close(1011, "Device transport failed"));
    socket.on("ping", () => { alive = Date.now(); }); socket.on("pong", () => { alive = Date.now(); });
    socket.on("message", (raw: unknown, binary: boolean) => {
      try {
        alive = Date.now();
        if (!binary || !Buffer.isBuffer(raw) || raw.length < 1 || raw.length > 513) throw new Error("Invalid voice frame");
        const type = raw[0];
        if (type === 6) { speaker.acceptStatus(raw.subarray(1)); return; }
        if (type === 1 && raw.length === 1 && !recording && !accepting) {
          audio.checkBrowserInput();
          // PTT suppresses old speech immediately, without cancelling Agent work.
          void audio.stopSpeech().catch(() => socket.close(1011, "Could not interrupt speech"));
          recording = { decoder: new VoiceAdpcm(), chunks: [], samples: 0, maxSamples: Math.min(30, audio.history().maxRecordingSeconds) * 16000, started: Date.now(), key: randomUUID() };
        } else if (type === 2 && raw.length === 121 && recording) {
          // Clamp the final frame to the configured limit; DMA may yield a partial tail at release.
          const remaining = recording.maxSamples - recording.samples;
          if (remaining > 0) {
            const pcm = recording.decoder.decode(raw.subarray(1)).subarray(0, Math.min(240, remaining) * 2);
            recording.samples += pcm.length / 2; recording.chunks.push(pcm);
          }
        } else if (type === 3 && raw.length === 1 && recording && recording.samples >= 160) {
          const finished = recording; recording = null; accepting = true;
          void audio.submitWifi(pcmWave(Buffer.concat(finished.chunks)), id.toUpperCase(), finished.key)
            .catch(() => socket.close(1011, "Voice input unavailable"))
            .finally(() => { accepting = false; });
        } else throw new Error("Unexpected voice frame");
      } catch { recording = null; socket.close(1008, "Invalid voice operation"); }
    });
    socket.send(Buffer.from([0, 1]));
  });
}
