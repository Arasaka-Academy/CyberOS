import { mkdtemp, readFile, stat, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, expect, it } from "vitest";
import { openCyberOsDb, reserveVoiceTurn, findVoiceMedia } from "@cyberos/db";
import { normalizeVoiceAudio, VoiceMediaStore } from "./voice-media.js";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });
export function sampleWav(seconds = 0.1): Buffer {
  const pcm = Buffer.alloc(Math.round(seconds * 32000));
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(pcm.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
it("decodes actual audio and rejects spoofed, oversized and overlong recordings", async () => {
  const wav = await normalizeVoiceAudio(sampleWav(), 30);
  expect(wav.readUInt32LE(24)).toBe(16000);
  expect(wav.readUInt16LE(22)).toBe(1);
  expect(wav.length).toBe(3244);
  await expect(normalizeVoiceAudio(Buffer.from("not audio"), 30)).rejects.toThrow(/WAV/);
  await expect(normalizeVoiceAudio(Buffer.from("RIFFxxxxWAVEbroken"), 30)).rejects.toThrow(/Invalid/);
  await expect(normalizeVoiceAudio(sampleWav(1.1), 1)).rejects.toThrow(/exceeds/);
  await expect(normalizeVoiceAudio(Buffer.alloc(8 * 1024 * 1024 + 1), 30)).rejects.toThrow(/8 MiB/);
});
it.each(["webm", "mp4"])("decodes browser %s containers into canonical PCM WAV", async (format) => {
  const encoded = spawnSync("ffmpeg", ["-v", "error", "-f", "wav", "-i", "pipe:0", "-c:a", format === "webm" ? "libopus" : "aac",
    ...(format === "mp4" ? ["-movflags", "frag_keyframe+empty_moov"] : []), "-f", format, "pipe:1"], { input: sampleWav(0.5), timeout: 10_000, maxBuffer: 1024 * 1024 });
  expect(encoded.status, encoded.stderr.toString()).toBe(0);
  const decoded = await normalizeVoiceAudio(encoded.stdout, 30);
  expect(decoded.toString("ascii", 8, 12)).toBe("WAVE");
  expect(decoded.readUInt16LE(22)).toBe(1);
  expect(decoded.readUInt32LE(24)).toBe(16000);
  expect(decoded.length).toBeGreaterThan(16000);
});
it("publishes restricted durable files before their database asset and survives reopening", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-voice-")); directories.push(directory);
  const filename = path.join(directory, "state.db");
  const db = openCyberOsDb(filename);
  reserveVoiceTurn(db, { recordingId: "capture", deviceId: "remote" });
  const store = new VoiceMediaStore(directory, db);
  const wav = await normalizeVoiceAudio(sampleWav(), 30);
  const media = await store.archive("capture", "user", 0, wav);
  expect((await stat(store.filePath(media.id))).mode & 0o777).toBe(0o600);
  db.close();
  const reopened = openCyberOsDb(filename);
  try {
    expect(findVoiceMedia(reopened, media.id)).toMatchObject({ durationMs: 100, segment: 0 });
    expect(await readFile(store.filePath(media.id))).toEqual(wav);
    expect(() => store.filePath("../../outside")).toThrow();
  } finally { reopened.close(); }
});
