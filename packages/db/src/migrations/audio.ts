import type { Migration } from "./types.js";

export const audioMigrations: Migration[] = [{
  id: "009_audio_voice_channel",
  sql: `
ALTER TABLE agent_sessions ADD COLUMN kind TEXT NOT NULL DEFAULT 'chat' CHECK(kind IN ('chat', 'voice'));
ALTER TABLE agent_sessions ADD COLUMN system_key TEXT;
ALTER TABLE agent_sessions ADD COLUMN context_generation INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_agent_sessions_system_key ON agent_sessions(system_key) WHERE system_key IS NOT NULL;
CREATE TABLE audio_voice_turns (
  recording_id TEXT PRIMARY KEY,
  device_id TEXT NOT NULL,
  session_id TEXT REFERENCES agent_sessions(id),
  message_id TEXT,
  job_id TEXT UNIQUE,
  status TEXT NOT NULL CHECK(status IN ('transcribing','queued','agent','synthesizing','speaking','completed','interrupted','failed')),
  speech_suppressed INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  timings_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_audio_voice_turns_status ON audio_voice_turns(status, created_at);
`
}, {
  id: "010_audio_history",
  sql: `
ALTER TABLE audio_voice_turns ADD COLUMN source TEXT NOT NULL DEFAULT 'device' CHECK(source IN ('device','browser'));
ALTER TABLE audio_voice_turns ADD COLUMN client_id TEXT;
ALTER TABLE audio_voice_turns ADD COLUMN idempotency_key TEXT;
ALTER TABLE audio_voice_turns ADD COLUMN audio_error TEXT;
ALTER TABLE audio_voice_turns ADD COLUMN user_audio_error TEXT;
ALTER TABLE audio_voice_turns ADD COLUMN assistant_audio_error TEXT;
ALTER TABLE audio_voice_turns ADD COLUMN history_revision INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX idx_audio_browser_idempotency ON audio_voice_turns(client_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE TABLE audio_voice_media (
  id TEXT PRIMARY KEY,
  recording_id TEXT NOT NULL REFERENCES audio_voice_turns(recording_id),
  role TEXT NOT NULL CHECK(role IN ('user','assistant')),
  segment INTEGER NOT NULL CHECK(segment >= 0),
  duration_ms INTEGER NOT NULL CHECK(duration_ms > 0),
  size_bytes INTEGER NOT NULL CHECK(size_bytes > 44),
  UNIQUE(recording_id, role, segment)
);
CREATE TRIGGER audio_history_turn_updated AFTER UPDATE ON audio_voice_turns
WHEN NEW.history_revision = OLD.history_revision BEGIN
  UPDATE audio_voice_turns SET history_revision = history_revision + 1 WHERE recording_id = NEW.recording_id;
END;
CREATE TRIGGER audio_history_media_added AFTER INSERT ON audio_voice_media BEGIN
  UPDATE audio_voice_turns SET history_revision = history_revision + 1 WHERE recording_id = NEW.recording_id;
END;
CREATE TRIGGER audio_history_job_updated AFTER UPDATE OF status ON jobs
WHEN NEW.status != OLD.status BEGIN
  UPDATE audio_voice_turns SET history_revision = history_revision + 1 WHERE job_id = NEW.id;
END;
CREATE TRIGGER audio_history_reply_added AFTER INSERT ON agent_events
WHEN NEW.type = 'agent.completed' AND NEW.job_id IS NOT NULL BEGIN
  UPDATE audio_voice_turns SET history_revision = history_revision + 1 WHERE job_id = NEW.job_id;
END;
`
}];
