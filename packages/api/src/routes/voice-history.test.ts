import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { appendEvent, defaultAudioSettings, listVoiceTurns, openCyberOsDb, saveAudioSettings, updateJobStatus } from "@cyberos/db";
import { AudioCoordinator } from "../lib/audio-coordinator.js";
import { VoiceMediaStore } from "../lib/voice-media.js";
import { unavailableAudioStatus, type AudioRuntime } from "../lib/audio-runtime.js";
import { registerAudioRoutes } from "./audio.js";

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
function wav(seconds = 0.1): Buffer {
  const data = Buffer.alloc(Math.round(seconds * 32000));
  const header = Buffer.alloc(44);
  header.write("RIFF"); header.writeUInt32LE(data.length + 36, 4); header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(16000, 24); header.writeUInt32LE(32000, 28); header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}
async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-voice-route-"));
  const db = openCyberOsDb(path.join(directory, "state.db"));
  saveAudioSettings(db, { ...defaultAudioSettings(), enabled: true, cyberAudioBaseUrl: "https://audio.example.com", cyberAudioToken: "test-token" });
  const runtime: AudioRuntime = { status: async () => unavailableAudioStatus(), configure: async () => {}, devices: async () => ({ inputs: [], outputs: [] }),
    recording: async () => { throw new Error("offline"); }, ack: async () => {}, play: vi.fn(async () => {}), stop: async () => 0 };
  const client = { test: vi.fn(), transcribe: vi.fn(async () => "浏览器提问"), synthesize: vi.fn(async () => wav()) };
  const store = new VoiceMediaStore(directory, db);
  const focus = { acquire: vi.fn(async () => "lease"), renew: async () => {}, release: async () => {} };
  const audio = new AudioCoordinator(db, runtime, client, focus, store);
  const server = Fastify(); await server.register(multipart);
  registerAudioRoutes(server, { audio });
  cleanup.push(async () => { await server.close(); await audio.close(); db.close(); await rm(directory, { recursive: true, force: true }); });
  const upload = (key = "recording-key-0001", input = wav(), clientId = "browser-client-0001") => server.inject({
    method: "POST", url: "/api/audio/recordings", headers: { "content-type": "multipart/form-data; boundary=voice-test", "x-voice-client": clientId, "idempotency-key": key },
    payload: Buffer.concat([Buffer.from('--voice-test\r\nContent-Disposition: form-data; name="file"; filename="capture.webm"\r\nContent-Type: audio/webm\r\n\r\n'), input, Buffer.from("\r\n--voice-test--\r\n")])
  });
  return { db, server, audio, upload, client, runtime, store, focus };
}
it("accepts browser audio without a device and archives segmented replies only for its initiating source", async () => {
  const { db, audio, upload, runtime, focus, client } = await fixture();
  const accepted = await upload(); expect(accepted.statusCode).toBe(202);
  await audio.idle();
  const turn = listVoiceTurns(db)[0]!;
  appendEvent(db, { sessionId: turn.sessionId!, jobId: turn.jobId!, type: "agent.completed", payload: { summary: "答".repeat(600) } });
  appendEvent(db, { sessionId: turn.sessionId!, type: "agent.completed", payload: { summary: "unrelated" } });
  updateJobStatus(db, turn.jobId!, "completed");
  await audio.tick(); await audio.idle();
  const history = audio.history();
  expect(history.items[0]).toMatchObject({ source: "browser", clientId: "browser-client-0001", userText: "浏览器提问", assistantText: "答".repeat(600), status: "completed" });
  expect(history.items[0]!.userAudio).toHaveLength(1);
  expect(history.items[0]!.assistantAudio.map((clip) => clip.segment)).toEqual([0, 1]);
  expect(runtime.play).not.toHaveBeenCalled(); expect(focus.acquire).not.toHaveBeenCalled();
  expect(client.synthesize).toHaveBeenCalledTimes(2);
});
it("deduplicates concurrent submissions, keeps the two-turn bound and rejects corrupt audio before reserving work", async () => {
  const { db, audio, upload, client } = await fixture();
  expect((await upload("bad-recording-0001", Buffer.from("not audio"))).statusCode).toBe(422);
  expect((await upload("long-recording-001", wav(30.1))).statusCode).toBe(422);
  expect(listVoiceTurns(db)).toHaveLength(0);
  const results = await Promise.all([upload(), upload()]);
  expect(results.map((result) => result.statusCode)).toEqual([202, 202]);
  expect(results[0]!.json().turn.recordingId).toBe(results[1]!.json().turn.recordingId);
  await audio.idle();
  expect(client.transcribe).toHaveBeenCalledOnce();
  expect((await upload("second-recording-01")).statusCode).toBe(202); await audio.idle();
  expect((await upload("third-recording-001")).statusCode).toBe(409);
  expect((await upload()).statusCode).toBe(202);
  expect(db.prepare("SELECT count(*) FROM jobs").pluck().get()).toBe(2);
});
it("preserves the browser reply after stopping the previous device output", async () => {
  const { db, audio, runtime, upload } = await fixture();
  let generation = 1;
  runtime.status = async () => ({ ...unavailableAudioStatus(), available: true, generation });
  runtime.stop = async () => ++generation;
  await audio.tick();
  expect((await upload()).statusCode).toBe(202);
  await audio.idle();
  await audio.tick();
  const turn = listVoiceTurns(db)[0]!;
  expect(turn.speechSuppressed).toBe(false);
  appendEvent(db, { sessionId: turn.sessionId!, jobId: turn.jobId!, type: "agent.completed", payload: { summary: "新的回复" } });
  updateJobStatus(db, turn.jobId!, "completed");
  await audio.tick(); await audio.idle();
  expect(audio.history().items[0]!.assistantAudio).toHaveLength(1);
});
it("retains Agent text when archiving fails without re-executing work", async () => {
  const { db, audio, upload, store } = await fixture();
  vi.spyOn(store, "archive").mockRejectedValue(new Error("disk full"));
  expect((await upload()).statusCode).toBe(202); await audio.idle();
  expect(audio.history().items[0]).toMatchObject({ userText: "浏览器提问", audioError: expect.any(String), userAudio: [] });
  await upload(); await audio.idle();
  expect(db.prepare("SELECT count(*) FROM jobs").pluck().get()).toBe(1);
});
it("retries failed transcription with the same recording identity without duplicating audio or Agent work", async () => {
  const { db, audio, upload, client } = await fixture();
  client.transcribe.mockRejectedValueOnce(new Error("STT temporarily unavailable"));
  const first = await upload(); await audio.idle();
  const id = first.json().turn.recordingId;
  expect(audio.history().items[0]).toMatchObject({ recordingId: id, status: "failed", jobId: null });
  const retries = await Promise.all([upload(), upload()]); await audio.idle();
  expect(retries.map((response) => response.json().turn.recordingId)).toEqual([id, id]);
  expect(audio.history().items[0]).toMatchObject({ recordingId: id, status: "queued", userText: "浏览器提问" });
  expect(audio.history().items[0]!.userAudio).toHaveLength(1);
  expect(client.transcribe).toHaveBeenCalledTimes(2);
  expect(db.prepare("SELECT count(*) FROM jobs").pluck().get()).toBe(1);
});
it("serves stored bytes with seeking while disabled, and never regenerates historical audio", async () => {
  const { db, audio, upload, server, client } = await fixture();
  await upload(); await audio.idle();
  const id = audio.history().items[0]!.userAudio[0]!.id;
  saveAudioSettings(db, { enabled: false });
  const part = await server.inject({ url: `/api/audio/media/${id}`, headers: { range: "bytes=44-75" } });
  expect(part.statusCode).toBe(206); expect(part.rawPayload.length).toBe(32);
  expect(part.headers["content-range"]).toBe("bytes 44-75/3244");
  expect((await server.inject({ url: `/api/audio/media/${id}`, headers: { range: "bytes=999999-" } })).statusCode).toBe(416);
  expect((await server.inject({ url: "/api/audio/media/../../etc/passwd" })).statusCode).toBe(404);
  expect((await server.inject({ url: "/api/audio/history" })).json().items).toHaveLength(1);
  expect((await server.inject({ url: "/api/audio/history?before=NaN" })).statusCode).toBe(400);
  expect((await upload()).statusCode).toBe(202);
  expect((await upload("new-disabled-0001")).statusCode).toBe(409);
  expect(client.synthesize).not.toHaveBeenCalled();
});
it("starts every SSE connection with a recent history snapshot", async () => {
  const { server } = await fixture();
  const address = await server.listen({ host: "127.0.0.1", port: 0 });
  for (let i = 0; i < 2; i++) {
    const response = await fetch(`${address}/api/audio/history/events`);
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    const reader = response.body!.getReader();
    const first = new TextDecoder().decode((await reader.read()).value);
    expect(first).toContain("event: history"); expect(first).toContain('"items":[]');
    await reader.cancel();
  }
});

it("routes Wi-Fi turns to their connected speaker and preserves approvals, history and disconnect suppression", async () => {
  const { db, audio, runtime, client } = await fixture();
  const device = { play: vi.fn(async () => {}), stop: vi.fn() };
  const detach = audio.connectWifiDevice("DC:54:75:CD:FB:A0", device);
  expect(() => audio.connectWifiDevice("DC:54:75:CD:FB:A0", device)).toThrow(/already/);
  const turn = await audio.submitWifi(wav(), "DC:54:75:CD:FB:A0", "wifi-recording-0001"); await audio.idle();
  const current = listVoiceTurns(db)[0]!;
  expect(current.source).toBe("device"); expect(current.deviceId).toBe("wifi:DC:54:75:CD:FB:A0");
  expect((await audio.submitWifi(wav(), "DC:54:75:CD:FB:A0", "wifi-recording-0001")).recordingId).toBe(turn.recordingId);
  updateJobStatus(db, current.jobId!, "waiting_approval"); await audio.tick(); await audio.idle();
  expect(device.play).not.toHaveBeenCalled(); expect(audio.status().awaitingApproval).toBe(true);
  appendEvent(db, { sessionId: current.sessionId!, jobId: current.jobId!, type: "agent.completed", payload: { summary: "Wi-Fi 回复" } });
  updateJobStatus(db, current.jobId!, "completed"); await audio.tick(); await audio.idle();
  expect(device.play).toHaveBeenCalledOnce(); expect(runtime.play).not.toHaveBeenCalled();
  expect(audio.history().items[0]!.assistantAudio).toHaveLength(1);
  expect(client.transcribe).toHaveBeenCalledOnce();
  await audio.submitWifi(wav(), "DC:54:75:CD:FB:A0", "wifi-recording-0002"); await audio.idle();
  detach();
  expect(listVoiceTurns(db)[0]!.speechSuppressed).toBe(true);
  await expect(audio.submitWifi(wav(), "DC:54:75:CD:FB:A0", "wifi-recording-0003")).rejects.toThrow(/disconnect/);
});
