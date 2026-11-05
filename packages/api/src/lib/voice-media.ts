import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { addVoiceMedia, type CyberOsDatabase } from "@cyberos/db";
import type { VoiceMedia } from "@cyberos/shared";

export const MAX_VOICE_UPLOAD = 8 * 1024 * 1024;
export class VoiceInputError extends Error {
  constructor(message: string, readonly statusCode = 422) { super(message); }
}

// Decode the actual container, ignoring its claimed MIME type. No network protocols,
// video output, shell expansion or client-supplied paths are permitted.
export async function normalizeVoiceAudio(input: Buffer, maxSeconds: number): Promise<Buffer> {
  if (!input.length || input.length > MAX_VOICE_UPLOAD) throw new VoiceInputError("Recording must be at most 8 MiB", 413);
  const wav = input.toString("ascii", 0, 4) === "RIFF" && input.toString("ascii", 8, 12) === "WAVE";
  const webm = input.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
  const mp4 = input.toString("ascii", 4, 8) === "ftyp";
  if (!wav && !webm && !mp4) throw new VoiceInputError("Use a WAV, WebM or MP4 audio recording");
  const limit = Math.floor(maxSeconds * 16_000) * 2;
  const pcm = await new Promise<Buffer>((resolve, reject) => {
    const child = spawn("ffmpeg", ["-hide_banner", "-loglevel", "error", "-nostdin", "-threads", "1",
      "-protocol_whitelist", "pipe", "-i", "pipe:0", "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000",
      "-filter_threads", "1", "-f", "s16le", "pipe:1"], { stdio: ["pipe", "pipe", "pipe"] });
    const chunks: Buffer[] = [];
    let size = 0;
    let failure: Error | null = null;
    const timer = setTimeout(() => { failure = new VoiceInputError("Audio decoding timed out"); child.kill("SIGKILL"); }, 20_000);
    child.on("error", () => { clearTimeout(timer); reject(new VoiceInputError("Audio decoder unavailable", 503)); });
    child.stdin.on("error", () => {});
    child.stderr.resume();
    child.stdout.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) { failure = new VoiceInputError(`Recording exceeds ${maxSeconds} seconds`); child.kill("SIGKILL"); }
      else chunks.push(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (failure) reject(failure);
      else if (code !== 0 || size < 320 || size % 2) reject(new VoiceInputError("Invalid or empty audio recording"));
      else resolve(Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16_000, 24); header.writeUInt32LE(32_000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

export class VoiceMediaStore {
  private readonly directory: string;
  constructor(stateDir: string, private readonly db: CyberOsDatabase) { this.directory = path.join(stateDir, "audio", "history"); }
  filePath(id: string): string {
    if (!/^[0-9a-f-]{36}$/u.test(id)) throw new Error("Invalid voice asset ID");
    return path.join(this.directory, `${id}.wav`);
  }
  async archive(recordingId: string, role: VoiceMedia["role"], segment: number, wav: Buffer): Promise<VoiceMedia> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await chmod(this.directory, 0o700);
    const id = randomUUID();
    const destination = this.filePath(id);
    const temporary = `${destination}.tmp`;
    try {
      await writeFile(temporary, wav, { flag: "wx", mode: 0o600 });
      await rename(temporary, destination);
      const media: VoiceMedia = { id, role, segment, durationMs: Math.round((wav.length - 44) / 32), sizeBytes: wav.length };
      addVoiceMedia(this.db, { ...media, recordingId });
      return media;
    } catch (error) {
      await unlink(temporary).catch(() => {});
      await unlink(destination).catch(() => {});
      throw error;
    }
  }
}
