import { describe, expect, it } from "vitest";
import { VoiceAdpcm, pcmWave, voiceCrc32 } from "./wifi-voice-codec.js";
import { WifiSpeaker, WIFI_SEGMENT_SAMPLES } from "./wifi-voice-output.js";
function receiver(options: { cancelAtCompletion?: boolean; failSegment?: number; invalidAck?: boolean; disconnectAtCompletion?: boolean } = {}) {
  let id = 0, sequence = 0, bytes = 0, segment = 0;
  const starts: Buffer[] = [], data: Buffer[][] = [];
  const socket = { readyState: 1, bufferedAmount: 0, send(packet: Buffer) {
    const payload = packet.subarray(1);
    if (packet[0] === 4 && payload[1] === 1) {
      starts.push(Buffer.from(payload)); data.push([]); id = payload.readUInt32LE(2); sequence = bytes = 0; segment++;
      queueMicrotask(() => status(options.failSegment === segment ? 5 : 1));
    } else if (packet[0] === 5) {
      expect(payload.readUInt32LE(0)).toBe(id); expect(payload.readUInt32LE(4)).toBe(sequence++);
      data.at(-1)!.push(Buffer.from(payload.subarray(8))); bytes += payload.length - 8;
      queueMicrotask(() => status(1));
    } else if (packet[0] === 4 && payload[1] === 2) {
      queueMicrotask(() => { status(2); status(3); if (options.cancelAtCompletion) output.stop(); if (options.disconnectAtCompletion) { socket.readyState = 3; output.stop(); } });
    }
  }};
  const output = new WifiSpeaker(socket, WIFI_SEGMENT_SAMPLES);
  function status(state: number) {
    const value = Buffer.alloc(20); value[0] = 1; value[1] = state; value.writeUInt32LE(id, 2);
    value.writeUInt32LE(sequence + (options.invalidAck ? 1 : 0), 6); value.writeUInt32LE(bytes, 10); value.writeUInt16LE(8, 14);
    output.acceptStatus(value);
  }
  return { output, starts, data, socket };
}
describe("Wi-Fi voice codec and sequential speaker", () => {
  it("matches the wire golden vector and preserves decoder state across chunks", () => {
    const decoded = new VoiceAdpcm().decode(Buffer.from([0x12, 0x70, 0xff]));
    expect(Array.from({ length: 5 }, (_, i) => decoded.readInt16LE(i * 2))).toEqual([1, 4, 15, 17, -8]);
    const decoder = new VoiceAdpcm();
    expect(Buffer.concat([decoder.decode(Buffer.from([0x12])), decoder.decode(Buffer.from([0x70, 0xff]))])).toEqual(decoded);
    expect(voiceCrc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });
  it("splits PCM before independent encoding, including an odd final sample", async () => {
    const pcm = Buffer.alloc((WIFI_SEGMENT_SAMPLES * 2 + 17) * 2);
    for (let i = 0; i < pcm.length / 2; i++) pcm.writeInt16LE(Math.round(Math.sin(i / 20) * 6000), i * 2);
    const { output, starts, data } = receiver();
    await output.play(pcmWave(pcm), 10);
    expect(starts).toHaveLength(3);
    let offset = 0;
    for (const [i, start] of starts.entries()) {
      const samples = start.readUInt32LE(6); const encoded = Buffer.concat(data[i]!);
      expect(samples).toBe(i < 2 ? WIFI_SEGMENT_SAMPLES : 17);
      expect(encoded).toEqual(new VoiceAdpcm().encode(pcm.subarray(offset, offset + samples * 2)));
      expect(start.readUInt32LE(14)).toBe(voiceCrc32(encoded));
      expect(start.readUInt32LE(2)).not.toBe(starts[(i + 1) % 3]!.readUInt32LE(2));
      offset += samples * 2;
    }
    expect(offset).toBe(pcm.length);
  });
  it.each([{ cancelAtCompletion: true }, { disconnectAtCompletion: true }, { failSegment: 1 }, { invalidAck: true }])("stops all later segments on cancellation, disconnect, failure or invalid acknowledgement (%j)", async (options) => {
    const { output, starts } = receiver(options);
    await expect(output.play(pcmWave(Buffer.alloc((WIFI_SEGMENT_SAMPLES + 100) * 2)), 10)).rejects.toThrow();
    expect(starts).toHaveLength(1);
  });
  it("bounds capabilities, outgoing backpressure, status queues and total audio", async () => {
    expect(() => new WifiSpeaker({ readyState: 1, bufferedAmount: 0, send() {} }, 1)).toThrow();
    const { output, socket, starts } = receiver(); socket.bufferedAmount = 9000;
    await expect(output.play(pcmWave(Buffer.alloc(320)), 10)).rejects.toThrow(/stalled/);
    expect(starts).toHaveLength(0);
    await expect(output.play(pcmWave(Buffer.alloc((130 * 16000 + 1) * 2)), 10)).rejects.toThrow(/130/);
    expect(() => output.acceptStatus(Buffer.alloc(2))).toThrow();
  });
});
