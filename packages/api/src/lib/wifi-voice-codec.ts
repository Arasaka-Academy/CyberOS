// IMA ADPCM: high nibble first, initial predictor/index zero per recording or segment.
const steps = [
7, 8, 9, 10, 11, 12, 13, 14, 16, 17, 19, 21, 23, 25, 28, 31, 34, 37, 41, 45, 50, 55, 60, 66,
    73, 80, 88, 97, 107, 118, 130, 143, 157, 173, 190, 209, 230, 253, 279, 307, 337, 371, 408, 449,
    494, 544, 598, 658, 724, 796, 876, 963, 1060, 1166, 1282, 1411, 1552, 1707, 1878, 2066, 2272,
    2499, 2749, 3024, 3327, 3660, 4026, 4428, 4871, 5358, 5894, 6484, 7132, 7845, 8630, 9493,
    10442, 11487, 12635, 13899, 15289, 16818, 18500, 20350, 22385, 24623, 27086, 29794, 32767];
const indexes = [-1, -1, -1, -1, 2, 4, 6, 8];
export class VoiceAdpcm {
  private predictor = 0;
  private index = 0;
  nibble(value: number): number {
    const step = steps[this.index]!;
    let delta = step >> 3;
    if (value & 1) delta += step >> 2;
    if (value & 2) delta += step >> 1;
    if (value & 4) delta += step;
    this.predictor = Math.max(-32768, Math.min(32767, this.predictor + (value & 8 ? -delta : delta)));
    this.index = Math.max(0, Math.min(88, this.index + indexes[value & 7]!));
    return this.predictor;
  }
  decode(bytes: Buffer): Buffer {
    const pcm = Buffer.alloc(bytes.length * 4);
    for (let i = 0; i < bytes.length * 2; i++) pcm.writeInt16LE(this.nibble(i % 2 ? bytes[i >> 1]! & 15 : bytes[i >> 1]! >> 4), i * 2);
    return pcm;
  }
  encode(pcm: Buffer): Buffer {
    if (pcm.length % 2) throw new Error("Invalid PCM length");
    const encoded = Buffer.alloc(Math.ceil(pcm.length / 4));
    for (let i = 0; i < pcm.length / 2; i++) {
      let difference = pcm.readInt16LE(i * 2) - this.predictor;
      let value = difference < 0 ? 8 : 0;
      difference = Math.abs(difference);
      let step = steps[this.index]!;
      for (const bit of [4, 2, 1]) { if (difference >= step) { value |= bit; difference -= step; } step >>= 1; }
      this.nibble(value);
      if (i % 2) encoded[i >> 1]! |= value; else encoded[i >> 1] = value << 4;
    }
    return encoded;
  }
}
export function voiceCrc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of bytes) { crc ^= byte; for (let i = 0; i < 8; i++) crc = crc >>> 1 ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}
export function pcmWave(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
