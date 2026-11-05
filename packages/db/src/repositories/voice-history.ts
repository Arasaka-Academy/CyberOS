import type { VoiceHistoryPage, VoiceHistoryTurn, VoiceMedia, VoiceTurnRecord } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";
import { getVoiceTurn, reserveVoiceTurn } from "./audio.js";

export function reserveBrowserVoiceTurn(db: CyberOsDatabase, input: { recordingId: string; clientId: string; idempotencyKey: string }): VoiceTurnRecord {
  return db.transaction(() => {
    const existing = findBrowserVoiceTurn(db, input.clientId, input.idempotencyKey);
    if (existing) return existing;
    reserveVoiceTurn(db, { recordingId: input.recordingId, deviceId: `browser:${input.clientId}` });
    db.prepare("UPDATE audio_voice_turns SET source = 'browser', client_id = ?, idempotency_key = ? WHERE recording_id = ?")
      .run(input.clientId, input.idempotencyKey, input.recordingId);
    return getVoiceTurn(db, input.recordingId)!;
  }).immediate();
}

export function findBrowserVoiceTurn(db: CyberOsDatabase, clientId: string, key: string): VoiceTurnRecord | null {
  const id = db.prepare("SELECT recording_id FROM audio_voice_turns WHERE client_id = ? AND idempotency_key = ?").pluck().get(clientId, key);
  return typeof id === "string" ? getVoiceTurn(db, id) : null;
}

export function addVoiceMedia(db: CyberOsDatabase, media: VoiceMedia & { recordingId: string }): void {
  db.prepare("INSERT INTO audio_voice_media(id, recording_id, role, segment, duration_ms, size_bytes) VALUES (?, ?, ?, ?, ?, ?)")
    .run(media.id, media.recordingId, media.role, media.segment, media.durationMs, media.sizeBytes);
}

export function findVoiceMedia(db: CyberOsDatabase, id: string): VoiceMedia | null {
  const row = db.prepare("SELECT id, role, segment, duration_ms AS durationMs, size_bytes AS sizeBytes FROM audio_voice_media WHERE id = ?").get(id);
  return row as VoiceMedia | undefined ?? null;
}

export function findVoiceInputMedia(db: CyberOsDatabase, recordingId: string): VoiceMedia | null {
  const id = db.prepare("SELECT id FROM audio_voice_media WHERE recording_id = ? AND role = 'user' AND segment = 0").pluck().get(recordingId);
  return typeof id === "string" ? findVoiceMedia(db, id) : null;
}

export function setVoiceAudioError(db: CyberOsDatabase, recordingId: string, error: string, role: "user" | "assistant"): void {
  const column = role === "user" ? "user_audio_error" : "assistant_audio_error";
  db.prepare(`UPDATE audio_voice_turns SET audio_error = ?, ${column} = ?, updated_at = ? WHERE recording_id = ?`).run(error, error, new Date().toISOString(), recordingId);
}

export function listVoiceHistory(db: CyberOsDatabase, input: { before?: string; limit?: number }): VoiceHistoryPage {
  const before = input.before ? Number(input.before) : Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(before) || before <= 0) throw new Error("Invalid voice history cursor");
  const limit = Math.min(50, Math.max(1, input.limit ?? 20));
  const rows = db.prepare(`SELECT turn.rowid AS sequence, turn.history_revision AS revision, turn.recording_id AS recordingId,
    COALESCE(message.content, '') AS userText,
    COALESCE((SELECT json_extract(event.payload_json, '$.summary') FROM agent_events AS event
      WHERE event.job_id = turn.job_id AND event.type = 'agent.completed' ORDER BY event.id DESC LIMIT 1), '') AS assistantText,
    job.status AS jobStatus, turn.user_audio_error AS userAudioError, turn.assistant_audio_error AS assistantAudioError
    FROM audio_voice_turns AS turn
    LEFT JOIN agent_messages AS message ON message.id = turn.message_id
    LEFT JOIN jobs AS job ON job.id = turn.job_id
    WHERE turn.rowid < ? ORDER BY turn.rowid DESC LIMIT ?`).all(before, limit + 1) as {
      sequence: number; revision: number; recordingId: string; userText: string; assistantText: string; jobStatus: string | null;
      userAudioError: string | null; assistantAudioError: string | null
    }[];
  const more = rows.length > limit;
  const selected = rows.slice(0, limit);
  const items = selected.reverse().map((row): VoiceHistoryTurn => {
    const turn = getVoiceTurn(db, row.recordingId)!;
    const media = db.prepare("SELECT id, role, segment, duration_ms AS durationMs, size_bytes AS sizeBytes FROM audio_voice_media WHERE recording_id = ? ORDER BY segment ASC").all(row.recordingId) as VoiceMedia[];
    const userAudio = media.filter((clip) => clip.role === "user");
    const assistantAudio = media.filter((clip) => clip.role === "assistant");
    const finished = ["completed", "interrupted", "failed"].includes(turn.status);
    return { ...turn, sequence: row.sequence, revision: row.revision, source: turn.source ?? "device", clientId: turn.clientId ?? null,
      userText: row.userText, assistantText: row.assistantText, awaitingApproval: row.jobStatus === "waiting_approval",
      userAudio, assistantAudio,
      userAudioState: userAudio.length ? "available" : turn.status === "transcribing" && !row.userAudioError ? "pending" : "unavailable",
      assistantAudioState: assistantAudio.length
        ? row.assistantAudioError || turn.status === "interrupted" || turn.status === "failed" ? "incomplete" : finished ? "available" : "pending"
        : finished || row.assistantAudioError ? "unavailable" : "pending" };
  });
  return { items, nextCursor: more ? String(items[0]!.sequence) : null };
}
