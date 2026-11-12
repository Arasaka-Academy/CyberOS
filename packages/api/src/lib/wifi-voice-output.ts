import { randomInt } from "node:crypto";
import { normalizeVoiceAudio } from "./voice-media.js";
import { VoiceAdpcm, voiceCrc32 } from "./wifi-voice-codec.js";
export interface WifiVoiceSocket {
  readonly readyState: number;
  readonly bufferedAmount: number;
  send(data: Buffer): void;
}
export interface WifiVoiceOutput {
  play(wav: Buffer, volume: number): Promise<void>;
  stop(): void;
}
export const WIFI_SEGMENT_SAMPLES = 131072;
export class WifiSpeaker implements WifiVoiceOutput {
  private queue: Buffer[] = [];
  private wake: (() => void) | null = null;
  private operation: AbortController | null = null;
  private id = 0;
  constructor(private readonly socket: WifiVoiceSocket, private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < WIFI_SEGMENT_SAMPLES || limit > 2080000) throw new Error("Unsupported voice capacity");
  }
  acceptStatus(value: Buffer): void {
    if (value.length !== 20 || value[0] !== 1 || value.readUInt16LE(18) !== 0) throw new Error("Invalid speaker status");
    if (!this.operation || value.readUInt32LE(2) !== this.id) return;
    if (this.queue.length >= 16) throw new Error("Speaker status queue overflow");
    this.queue.push(Buffer.from(value)); this.wake?.();
  }
  private send(type: number, value: Buffer): void {
    if (this.socket.readyState !== 1 || this.socket.bufferedAmount > 8192) throw new Error("Wi-Fi speaker disconnected or stalled");
    this.socket.send(Buffer.concat([Buffer.from([type]), value]));
  }
  stop(): void {
    this.operation?.abort(); this.wake?.();
    if (this.id && this.socket.readyState === 1) {
      const cancel = Buffer.alloc(6); cancel[0] = 1; cancel[1] = 3; cancel.writeUInt32LE(this.id, 2);
      try { this.send(4, cancel); } catch { /* Disconnected: no fallback or replay. */ }
    }
  }
  private async status(signal: AbortSignal, timeout: number): Promise<Buffer> {
    if (signal.aborted) throw new Error("Wi-Fi speech interrupted");
    if (!this.queue.length) await new Promise<void>((resolve, reject) => {
      const done = () => { clearTimeout(timer); signal.removeEventListener("abort", abort); this.wake = null; resolve(); };
      const abort = () => { clearTimeout(timer); this.wake = null; reject(new Error("Wi-Fi speech interrupted")); };
      const timer = setTimeout(() => { signal.removeEventListener("abort", abort); this.wake = null; reject(new Error("Wi-Fi speaker timed out")); }, Math.max(1, timeout));
      this.wake = done; signal.addEventListener("abort", abort, { once: true });
    });
    if (signal.aborted) throw new Error("Wi-Fi speech interrupted");
    const value = this.queue.shift();
    if (!value || value.readUInt16LE(16) !== 0 || value[1] === 4 || value[1] === 5) throw new Error("Device rejected Wi-Fi speech");
    return value;
  }
  async play(wav: Buffer, volume: number): Promise<void> {
    if (this.operation) throw new Error("Wi-Fi speaker busy");
    const operation = new AbortController(); this.operation = operation;
    const first = randomInt(1, 0x100000000);
    const started = Date.now();
    try {
      const normalized = await normalizeVoiceAudio(wav, 130);
      const pcm = normalized.subarray(44);
      const segments = Math.ceil(pcm.length / 2 / this.limit);
      const deadline = started + 265000 + (segments - 1) * 5000;
      for (let offset = 0, segment = 0; offset < pcm.length; offset += this.limit * 2, segment++) {
        if (operation.signal.aborted || Date.now() >= deadline) throw new Error("Wi-Fi speech interrupted or expired");
        const part = pcm.subarray(offset, offset + this.limit * 2);
        const encoded = new VoiceAdpcm().encode(part);
        this.id = (first - 1 + segment) % 0xffffffff + 1; this.queue = [];
        const start = Buffer.alloc(20); start[0] = start[1] = 1; start.writeUInt32LE(this.id, 2);
        start.writeUInt32LE(part.length / 2, 6); start.writeUInt32LE(encoded.length, 10); start.writeUInt32LE(voiceCrc32(encoded), 14);
        start[18] = Math.max(0, Math.min(100, volume)); start[19] = 1;
        this.send(4, start);
        let sequence = 0, sent = 0;
        const transferDeadline = Math.min(deadline, Date.now() + 120000);
        while (true) {
          const status = await this.status(operation.signal, Math.min(10000, transferDeadline - Date.now()));
          if (Date.now() > transferDeadline || status[1] !== 1 || status.readUInt32LE(6) !== sequence || status.readUInt32LE(10) !== sent || status.readUInt16LE(14) > 8) throw new Error("Invalid Wi-Fi speaker acknowledgement");
          if (sent === encoded.length) break;
          if (!status.readUInt16LE(14)) continue;
          const end = Math.min(encoded.length, sent + 480);
          const packet = Buffer.alloc(8 + end - sent); packet.writeUInt32LE(this.id); packet.writeUInt32LE(sequence++, 4); encoded.copy(packet, 8, sent, end);
          sent = end; this.send(5, packet);
        }
        const end = Buffer.alloc(6); end[0] = 1; end[1] = 2; end.writeUInt32LE(this.id, 2); this.send(4, end);
        const playbackDeadline = Math.min(deadline, Date.now() + Math.ceil(part.length / 32) + 5000);
        while (true) {
          const status = await this.status(operation.signal, playbackDeadline - Date.now());
          if (Date.now() > playbackDeadline) throw new Error("Wi-Fi playback expired");
          if (status[1] === 3) {
            if (status.readUInt32LE(6) !== sequence || status.readUInt32LE(10) !== encoded.length) throw new Error("Invalid speaker completion");
            break;
          }
          if (status[1] !== 2) throw new Error("Invalid speaker playback state");
        }
      }
      if (operation.signal.aborted) throw new Error("Wi-Fi speech interrupted");
    } catch (error) { this.stop(); throw error; }
    finally { this.operation = null; this.id = 0; this.queue = []; }
  }
}
