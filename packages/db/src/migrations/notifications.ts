/**
 * [INPUT]: 依赖 SQLite 迁移协议。
 * [OUTPUT]: 提供通用事件、浏览器订阅和独立投递表。
 * [POS]: 保留旧操作通知表，追加浏览器推送持久队列。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { Migration } from "./types.js";

export const notificationMigrations: Migration[] = [{ id: "016_browser_notifications", sql: `
CREATE TABLE notification_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_key TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL CHECK(type IN ('agent.reply','agent.action_required','agent.failed','system.test')),
  target_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE TABLE browser_push_subscriptions (
  id TEXT PRIMARY KEY,
  endpoint TEXT NOT NULL UNIQUE,
  expiration_time INTEGER,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
  preferences_json TEXT NOT NULL,
  locale TEXT NOT NULL CHECK(locale IN ('zh-CN','en')),
  origin TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_success_at TEXT,
  last_error TEXT
);
CREATE TABLE notification_deliveries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  event_id INTEGER NOT NULL REFERENCES notification_events(id) ON DELETE CASCADE,
  subscription_id TEXT NOT NULL REFERENCES browser_push_subscriptions(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','observed')),
  due_at TEXT NOT NULL,
  attempt INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT,
  lease_owner TEXT,
  lease_until TEXT,
  last_error TEXT,
  updated_at TEXT NOT NULL,
  UNIQUE(event_id,subscription_id)
);
CREATE INDEX idx_notification_delivery_due ON notification_deliveries(state,due_at,lease_until);
CREATE INDEX idx_notification_events_created ON notification_events(created_at);
` }];
