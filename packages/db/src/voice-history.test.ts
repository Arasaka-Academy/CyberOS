import { afterEach, describe, expect, it } from "vitest";
import { openCyberOsDb } from "./connection.js";
import { appendEvent, updateJobStatus } from "./repositories.js";
import { deliverVoiceTurn, reserveVoiceTurn, updateVoiceTurn } from "./repositories/audio.js";
import { listVoiceHistory, reserveBrowserVoiceTurn, addVoiceMedia } from "./repositories/voice-history.js";
import Database from "better-sqlite3";
import { migrations, runMigrations } from "./schema.js";

const databases: ReturnType<typeof openCyberOsDb>[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() { const db = openCyberOsDb(":memory:"); databases.push(db); return db; }

describe("durable voice history", () => {
  it("upgrades existing turns without inventing missing recordings", () => {
    const db = new Database(":memory:"); databases.push(db);
    db.exec("CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const migration of migrations.filter((entry) => entry.id !== "010_audio_history")) {
      migration.prepare?.(db); db.exec(migration.sql);
      db.prepare("INSERT INTO schema_migrations VALUES (?, ?)").run(migration.id, new Date().toISOString());
    }
    db.prepare("INSERT INTO audio_voice_turns(recording_id, device_id, status, created_at, updated_at) VALUES ('legacy', 'remote', 'completed', ?, ?)").run(new Date().toISOString(), new Date().toISOString());
    runMigrations(db); runMigrations(db);
    expect(listVoiceHistory(db, {}).items[0]).toMatchObject({ recordingId: "legacy", source: "device", clientId: null, userAudio: [], assistantAudio: [] });
  });
  it("pages stable turns with tied timestamps without dropping or duplicating entries", () => {
    const db = fixture();
    for (const id of ["one", "two", "three"]) {
      reserveVoiceTurn(db, { recordingId: id, deviceId: "remote" });
      updateVoiceTurn(db, id, { status: "completed" });
    }
    db.prepare("UPDATE audio_voice_turns SET created_at = '2026-11-05T00:00:00Z'").run();
    const recent = listVoiceHistory(db, { limit: 2 });
    expect(recent.items.map((x) => x.recordingId)).toEqual(["two", "three"]);
    expect(listVoiceHistory(db, { before: recent.nextCursor!, limit: 2 }).items.map((x) => x.recordingId)).toEqual(["one"]);
  });
  it("binds audio and final replies to the exact recording job and keeps browser delivery idempotent", () => {
    const db = fixture();
    const first = reserveBrowserVoiceTurn(db, { recordingId: "browser-one", clientId: "tab-one", idempotencyKey: "send-one" });
    expect(reserveBrowserVoiceTurn(db, { recordingId: "duplicate", clientId: "tab-one", idempotencyKey: "send-one" }).recordingId).toBe(first.recordingId);
    const turn = deliverVoiceTurn(db, first.recordingId, "用户原文");
    appendEvent(db, { sessionId: turn.sessionId!, jobId: turn.jobId!, type: "agent.completed", payload: { summary: "对应的最终回复" } });
    appendEvent(db, { sessionId: turn.sessionId!, type: "agent.completed", payload: { summary: "不相关的回复" } });
    addVoiceMedia(db, { id: "clip-2", recordingId: first.recordingId, role: "assistant", segment: 1, durationMs: 1000, sizeBytes: 32044 });
    addVoiceMedia(db, { id: "clip-1", recordingId: first.recordingId, role: "assistant", segment: 0, durationMs: 2000, sizeBytes: 64044 });
    updateJobStatus(db, turn.jobId!, "completed");
    const history = listVoiceHistory(db, {});
    expect(history.items).toHaveLength(1);
    expect(history.items[0]).toMatchObject({ source: "browser", clientId: "tab-one", userText: "用户原文", assistantText: "对应的最终回复" });
    expect(history.items[0]!.assistantAudio.map((x) => x.id)).toEqual(["clip-1", "clip-2"]);
    expect(history.items[0]!.userAudio).toEqual([]);
    expect(db.prepare("SELECT count(*) FROM jobs").pluck().get()).toBe(1);
  });
  it("checks duplicate requests before enforcing the two active turn limit", () => {
    const db = fixture();
    reserveBrowserVoiceTurn(db, { recordingId: "first", clientId: "tab-one", idempotencyKey: "send-one" });
    reserveVoiceTurn(db, { recordingId: "second", deviceId: "remote" });
    expect(reserveBrowserVoiceTurn(db, { recordingId: "retry", clientId: "tab-one", idempotencyKey: "send-one" }).recordingId).toBe("first");
    expect(() => reserveBrowserVoiceTurn(db, { recordingId: "third", clientId: "tab-two", idempotencyKey: "send-one" })).toThrow(/busy/i);
  });
  it("advances the history revision for turn, exact-job reply, job status and audio changes", () => {
    const db = fixture();
    reserveVoiceTurn(db, { recordingId: "revision", deviceId: "remote" });
    const revision = () => listVoiceHistory(db, {}).items[0]!.revision;
    const values = [revision()];
    const turn = deliverVoiceTurn(db, "revision", "original"); values.push(revision());
    appendEvent(db, { sessionId: turn.sessionId!, type: "agent.completed", payload: { summary: "unrelated" } });
    expect(revision()).toBe(values.at(-1));
    appendEvent(db, { sessionId: turn.sessionId!, jobId: turn.jobId!, type: "agent.completed", payload: { summary: "reply" } }); values.push(revision());
    updateJobStatus(db, turn.jobId!, "completed"); values.push(revision());
    addVoiceMedia(db, { id: "revision-clip", recordingId: "revision", role: "assistant", segment: 0, durationMs: 1000, sizeBytes: 32044 }); values.push(revision());
    updateVoiceTurn(db, "revision", { status: "completed" }); values.push(revision());
    for (let index = 1; index < values.length; index++) expect(values[index]).toBeGreaterThan(values[index - 1]!);
  });
});
