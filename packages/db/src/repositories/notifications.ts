/**
 * [INPUT]: 依赖 SQLite、随机身份令牌和共享通知协议。
 * [OUTPUT]: 提供订阅身份、原子事件分发、独立已见和租约投递。
 * [POS]: 通知持久边界；公开记录隔离端点、密钥与令牌摘要。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { DEFAULT_NOTIFICATION_PREFERENCES, NOTIFICATION_OBSERVE_MS, NOTIFICATION_TTL_MS, notificationEnabled,
  type BrowserPushIdentity, type BrowserPushRegistration, type BrowserPushSubscriptionInput,
  type BrowserPushSubscriptionRecord, type NotificationEventRecord, type NotificationLocale,
  type NotificationPreferences, type NotificationTarget, type NotificationType } from "@cyberos/shared";
import type { CyberOsDatabase } from "../connection.js";

interface SubscriptionRow {
  id: string; endpoint: string; expiration_time: number | null; p256dh: string; auth: string; token_hash: string;
  enabled: number; preferences_json: string; locale: NotificationLocale; origin: string; created_at: string;
  updated_at: string; last_success_at: string | null; last_error: string | null;
}
interface EventRow { id: number; event_key: string; type: NotificationType; target_json: string; created_at: string; expires_at: string }
export class BrowserPushSubscriptionConflictError extends Error {
  constructor() { super("Browser push subscription registration conflict"); this.name = "BrowserPushSubscriptionConflictError"; }
}
const hashToken = (token: string) => createHash("sha256").update(token).digest();
function authorized(row: SubscriptionRow | undefined, token: string): row is SubscriptionRow {
  if (!row || typeof token !== "string" || token.length < 1 || token.length > 512) return false;
  const stored = Buffer.from(row.token_hash, "hex");
  const supplied = hashToken(token);
  return stored.length === supplied.length && timingSafeEqual(stored, supplied);
}
function subscriptionRecord(row: SubscriptionRow): BrowserPushSubscriptionRecord {
  return { id: row.id, enabled: row.enabled === 1, preferences: JSON.parse(row.preferences_json) as NotificationPreferences,
    locale: row.locale, origin: row.origin, createdAt: row.created_at, updatedAt: row.updated_at,
    lastSuccessAt: row.last_success_at, lastError: row.last_error };
}
function eventRecord(row: EventRow): NotificationEventRecord {
  return { id: row.id, eventKey: row.event_key, type: row.type, target: JSON.parse(row.target_json) as NotificationTarget,
    createdAt: row.created_at, expiresAt: row.expires_at };
}
function preferences(input?: NotificationPreferences): NotificationPreferences {
  const result = input ?? DEFAULT_NOTIFICATION_PREFERENCES;
  if (typeof result.replies !== "boolean" || typeof result.actionRequired !== "boolean" || typeof result.failures !== "boolean") {
    throw new Error("Invalid notification preferences");
  }
  return { replies: result.replies, actionRequired: result.actionRequired, failures: result.failures };
}
function subscriptionRow(db: CyberOsDatabase, id: string) {
  return db.prepare("SELECT * FROM browser_push_subscriptions WHERE id = ?").get(id) as SubscriptionRow | undefined;
}

export function createBrowserPushSubscription(db: CyberOsDatabase, input: {
  subscription: BrowserPushSubscriptionInput; origin: string; locale: NotificationLocale;
  preferences?: NotificationPreferences; identity?: BrowserPushIdentity; now?: Date;
}): BrowserPushRegistration {
  return db.transaction(() => {
    const existing = db.prepare("SELECT * FROM browser_push_subscriptions WHERE endpoint = ?")
      .get(input.subscription.endpoint) as SubscriptionRow | undefined;
    const identityRow = input.identity ? subscriptionRow(db, input.identity.id) : undefined;
    if ((existing && (!input.identity || existing.id !== input.identity.id || !authorized(existing, input.identity.token)))
      || (input.identity && (!authorized(identityRow, input.identity.token) || identityRow.origin !== input.origin))
      || (existing && existing.origin !== input.origin)) throw new BrowserPushSubscriptionConflictError();
    const previous = identityRow ?? existing;
    const id = previous?.id ?? randomUUID();
    const token = input.identity?.token ?? randomBytes(32).toString("base64url");
    const now = (input.now ?? new Date()).toISOString();
    const pref = preferences(input.preferences ?? (previous ? JSON.parse(previous.preferences_json) as NotificationPreferences : undefined));
    db.prepare(`INSERT INTO browser_push_subscriptions(id,endpoint,expiration_time,p256dh,auth,token_hash,enabled,
      preferences_json,locale,origin,created_at,updated_at)
      VALUES(?,?,?,?,?,?,1,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET endpoint=excluded.endpoint,
      expiration_time=excluded.expiration_time,p256dh=excluded.p256dh,auth=excluded.auth,enabled=1,
      preferences_json=excluded.preferences_json,locale=excluded.locale,updated_at=excluded.updated_at,last_error=NULL`)
      .run(id, input.subscription.endpoint, input.subscription.expirationTime, input.subscription.keys.p256dh,
        input.subscription.keys.auth, hashToken(token).toString("hex"), JSON.stringify(pref), input.locale, input.origin,
        previous?.created_at ?? now, now);
    return { id, token, subscription: subscriptionRecord(subscriptionRow(db, id)!) };
  }).immediate();
}

export function getBrowserPushSubscription(db: CyberOsDatabase, id: string, token: string): BrowserPushSubscriptionRecord | null {
  const row = subscriptionRow(db, id);
  return authorized(row, token) ? subscriptionRecord(row) : null;
}
export function updateBrowserPushSubscription(db: CyberOsDatabase, id: string, token: string, input: {
  enabled?: boolean; preferences?: NotificationPreferences; locale?: NotificationLocale; now?: Date;
}): BrowserPushSubscriptionRecord | null {
  return db.transaction(() => {
    const row = subscriptionRow(db, id);
    if (!authorized(row, token)) return null;
    const pref = input.preferences ? preferences(input.preferences) : JSON.parse(row.preferences_json) as NotificationPreferences;
    db.prepare(`UPDATE browser_push_subscriptions SET enabled=?,preferences_json=?,locale=?,updated_at=? WHERE id=?`)
      .run(input.enabled === undefined ? row.enabled : Number(input.enabled), JSON.stringify(pref), input.locale ?? row.locale,
        (input.now ?? new Date()).toISOString(), id);
    return subscriptionRecord(subscriptionRow(db, id)!);
  }).immediate();
}
export function deleteBrowserPushSubscription(db: CyberOsDatabase, id: string, token: string): boolean {
  return db.transaction(() => {
    if (!authorized(subscriptionRow(db, id), token)) return false;
    return db.prepare("DELETE FROM browser_push_subscriptions WHERE id=?").run(id).changes === 1;
  }).immediate();
}

export function publishNotification(db: CyberOsDatabase, input: {
  eventKey: string; type: NotificationType; target: NotificationTarget; now?: Date; subscriptionId?: string;
}): NotificationEventRecord {
  return db.transaction(() => {
    const previous = db.prepare("SELECT * FROM notification_events WHERE event_key=?").get(input.eventKey) as EventRow | undefined;
    if (previous) return eventRecord(previous);
    const now = input.now ?? new Date();
    const createdAt = now.toISOString();
    const result = db.prepare("INSERT INTO notification_events(event_key,type,target_json,created_at,expires_at) VALUES(?,?,?,?,?)")
      .run(input.eventKey, input.type, JSON.stringify(input.target), createdAt, new Date(now.getTime() + NOTIFICATION_TTL_MS).toISOString());
    const id = Number(result.lastInsertRowid);
    const rows = db.prepare(`SELECT * FROM browser_push_subscriptions WHERE enabled=1
      AND (expiration_time IS NULL OR expiration_time>?)${input.subscriptionId ? " AND id=?" : ""}`)
      .all(now.getTime(), ...(input.subscriptionId ? [input.subscriptionId] : [])) as SubscriptionRow[];
    const insert = db.prepare("INSERT INTO notification_deliveries(event_id,subscription_id,due_at,updated_at) VALUES(?,?,?,?)");
    for (const row of rows) {
      if (notificationEnabled(input.type, JSON.parse(row.preferences_json) as NotificationPreferences)) {
        insert.run(id, row.id, new Date(now.getTime() + NOTIFICATION_OBSERVE_MS).toISOString(), createdAt);
      }
    }
    return eventRecord(db.prepare("SELECT * FROM notification_events WHERE id=?").get(id) as EventRow);
  }).immediate();
}
export function listNotificationEvents(db: CyberOsDatabase, input: {
  afterId?: number; limit?: number; subscriptionId?: string; now?: Date;
} = {}): NotificationEventRecord[] {
  const rows = db.prepare(`SELECT e.* FROM notification_events e WHERE e.id>?
    ${input.now ? "AND e.expires_at>?" : ""}
    ${input.subscriptionId ? "AND EXISTS(SELECT 1 FROM notification_deliveries d WHERE d.event_id=e.id AND d.subscription_id=?)" : ""}
    ORDER BY e.id LIMIT ?`).all(input.afterId ?? 0, ...(input.now ? [input.now.toISOString()] : []),
      ...(input.subscriptionId ? [input.subscriptionId] : []), Math.max(1, Math.min(input.limit ?? 100, 500))) as EventRow[];
  return rows.map(eventRecord);
}
export function latestNotificationEventId(db: CyberOsDatabase): number {
  return Number(db.prepare("SELECT COALESCE(MAX(id),0) FROM notification_events").pluck().get());
}

export function publishAgentJobNotification(db: CyberOsDatabase, input: {
  jobId: string; type: Extract<NotificationType, `agent.${string}`>; runId?: string;
  requestId?: string; transcriptEventId?: number; now?: Date;
}): NotificationEventRecord | null {
  const eligible = db.prepare(`SELECT j.session_id FROM jobs j JOIN agent_messages m ON m.id=j.message_id
    JOIN agent_sessions s ON s.id=j.session_id WHERE j.id=? AND j.kind='agent' AND m.role='user' AND s.kind='chat'
    AND j.status!='cancelled'`).get(input.jobId) as { session_id: string } | undefined;
  if (!eligible) return null;
  return publishNotification(db, { eventKey: `${input.type}:${input.jobId}${input.type === "agent.action_required" ? `:${input.runId ?? input.requestId ?? "approval"}` : ""}`,
    type: input.type, target: { kind: "agent_session", sessionId: eligible.session_id, jobId: input.jobId,
      ...(input.runId ? { runId: input.runId } : {}), ...(input.transcriptEventId ? { transcriptEventId: input.transcriptEventId } : {}) },
    ...(input.now ? { now: input.now } : {}) });
}
export function observeNotification(db: CyberOsDatabase, input: {
  eventId: number; subscriptionId: string; token: string; now?: Date;
}): boolean {
  return db.transaction(() => {
    if (!authorized(subscriptionRow(db, input.subscriptionId), input.token)) return false;
    return db.prepare(`UPDATE notification_deliveries SET observed_at=COALESCE(observed_at,?),
      state=CASE WHEN state IN ('pending','sending') THEN 'observed' ELSE state END,lease_owner=NULL,lease_until=NULL,updated_at=?
      WHERE event_id=? AND subscription_id=?`).run((input.now ?? new Date()).toISOString(),
      (input.now ?? new Date()).toISOString(), input.eventId, input.subscriptionId).changes === 1;
  }).immediate();
}

export interface ClaimedNotificationDelivery {
  id: number; event: NotificationEventRecord;
  subscription: { id: string; endpoint: string; keys: { p256dh: string; auth: string }; locale: NotificationLocale; origin: string };
  attempt: number; leaseOwner: string; leaseUntil: string;
}
interface DeliveryRow { id: number; event_id: number; subscription_id: string; attempt: number; lease_owner: string; lease_until: string }
const eligibleSql = `d.observed_at IS NULL AND s.enabled=1 AND e.expires_at>@now
  AND (s.expiration_time IS NULL OR s.expiration_time>@nowMs)
  AND (e.type='system.test' OR json_extract(s.preferences_json,CASE e.type
    WHEN 'agent.reply' THEN '$.replies' WHEN 'agent.action_required' THEN '$.actionRequired' ELSE '$.failures' END)=1)
  AND (e.type!='agent.action_required' OR EXISTS(SELECT 1 FROM jobs j
    WHERE j.id=json_extract(e.target_json,'$.jobId') AND j.status IN ('running','waiting_approval')
    AND ((json_extract(e.target_json,'$.runId') IS NULL AND j.status='waiting_approval')
      OR EXISTS(SELECT 1 FROM capability_runs r JOIN capability_approvals a ON a.run_id=r.id
        JOIN agent_capability_runs link ON link.run_id=r.id AND link.job_id=j.id
        WHERE r.id=json_extract(e.target_json,'$.runId') AND r.state='waiting_approval'
          AND a.status='pending' AND a.expires_at>@now))))`;
function settleObsoleteDeliveries(db: CyberOsDatabase, now: Date): void {
  db.prepare(`UPDATE notification_deliveries SET state='failed',last_error='notification_obsolete',
    lease_owner=NULL,lease_until=NULL,updated_at=@now WHERE state IN ('pending','sending')
    AND id IN(SELECT d.id FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
      JOIN browser_push_subscriptions s ON s.id=d.subscription_id WHERE NOT (${eligibleSql}))`)
    .run({ now: now.toISOString(), nowMs: now.getTime() });
}
function claimedRecord(db: CyberOsDatabase, row: DeliveryRow): ClaimedNotificationDelivery {
  const subscription = subscriptionRow(db, row.subscription_id)!;
  return { id: row.id, event: eventRecord(db.prepare("SELECT * FROM notification_events WHERE id=?").get(row.event_id) as EventRow),
    subscription: { id: subscription.id, endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth },
      locale: subscription.locale, origin: subscription.origin }, attempt: row.attempt, leaseOwner: row.lease_owner, leaseUntil: row.lease_until };
}
export function claimNotificationDelivery(db: CyberOsDatabase, input: { workerId: string; now?: Date; leaseMs?: number }): ClaimedNotificationDelivery | null {
  return db.transaction(() => {
    const now = input.now ?? new Date();
    settleObsoleteDeliveries(db, now);
    const row = db.prepare(`UPDATE notification_deliveries SET state='sending',lease_owner=@workerId,lease_until=@leaseUntil,attempt=attempt+1,updated_at=@now
      WHERE id=(SELECT d.id FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
      JOIN browser_push_subscriptions s ON s.id=d.subscription_id WHERE ${eligibleSql}
      AND d.due_at<=@now AND (d.state='pending' OR (d.state='sending' AND d.lease_until<=@now)) ORDER BY d.due_at,d.id LIMIT 1)
      RETURNING *`).get({ workerId: input.workerId, leaseUntil: new Date(now.getTime() + (input.leaseMs ?? 30_000)).toISOString(),
        now: now.toISOString(), nowMs: now.getTime() }) as DeliveryRow | undefined;
    return row ? claimedRecord(db, row) : null;
  }).immediate();
}
export function getClaimedNotificationDelivery(db: CyberOsDatabase, input: {
  deliveryId: number; workerId: string; now?: Date;
}): ClaimedNotificationDelivery | null {
  return db.transaction(() => {
    const now = input.now ?? new Date();
    settleObsoleteDeliveries(db, now);
    const row = db.prepare(`SELECT d.* FROM notification_deliveries d JOIN notification_events e ON e.id=d.event_id
      JOIN browser_push_subscriptions s ON s.id=d.subscription_id WHERE d.id=@deliveryId AND d.lease_owner=@workerId AND d.state='sending'
      AND d.lease_until>@now AND ${eligibleSql}`).get({ deliveryId: input.deliveryId, workerId: input.workerId,
        now: now.toISOString(), nowMs: now.getTime() }) as DeliveryRow | undefined;
    return row ? claimedRecord(db, row) : null;
  }).immediate();
}
interface SettleDeliveryInput { deliveryId: number; workerId: string; now?: Date }
function deliveryErrorCode(error: string): string {
  return /^push_(?:http_[0-9]{3}|[a-z_]{1,64})$/u.test(error) ? error : "push_delivery_failed";
}
function settle(db: CyberOsDatabase, input: SettleDeliveryInput, state: "sent" | "pending" | "failed", error: string | null, retryAt?: Date): boolean {
  const now = (input.now ?? new Date()).toISOString();
  return db.prepare(`UPDATE notification_deliveries SET state=?,last_error=?,due_at=COALESCE(?,due_at),lease_owner=NULL,
    lease_until=NULL,updated_at=? WHERE id=? AND state='sending' AND lease_owner=? AND lease_until>?`)
    .run(state, error, retryAt?.toISOString() ?? null, now, input.deliveryId, input.workerId, now).changes === 1;
}
export function finishNotificationDelivery(db: CyberOsDatabase, input: SettleDeliveryInput): boolean {
  return db.transaction(() => {
    if (!settle(db, input, "sent", null)) return false;
    db.prepare(`UPDATE browser_push_subscriptions SET last_success_at=?,last_error=NULL
      WHERE id=(SELECT subscription_id FROM notification_deliveries WHERE id=?)`)
      .run((input.now ?? new Date()).toISOString(), input.deliveryId);
    return true;
  }).immediate();
}
export function retryNotificationDelivery(db: CyberOsDatabase, input: SettleDeliveryInput & { error: string; retryAt: Date }): boolean {
  return settle(db, input, "pending", deliveryErrorCode(input.error), input.retryAt);
}
export function failNotificationDelivery(db: CyberOsDatabase, input: SettleDeliveryInput & { error: string; disableSubscription?: boolean }): boolean {
  return db.transaction(() => {
    const error = deliveryErrorCode(input.error);
    if (!settle(db, input, "failed", error)) return false;
    db.prepare(`UPDATE browser_push_subscriptions SET enabled=CASE WHEN ? THEN 0 ELSE enabled END,last_error=?,updated_at=?
      WHERE id=(SELECT subscription_id FROM notification_deliveries WHERE id=?)`).run(Number(input.disableSubscription ?? false),
        error, (input.now ?? new Date()).toISOString(), input.deliveryId);
    return true;
  }).immediate();
}
export function cleanupNotifications(db: CyberOsDatabase, input: { now?: Date } = {}): { events: number; subscriptions: number } {
  return db.transaction(() => {
    const now = input.now ?? new Date();
    settleObsoleteDeliveries(db, now);
    const cutoff = new Date(now.getTime() - 30 * 86_400_000);
    const events = db.prepare("DELETE FROM notification_events WHERE created_at<?").run(cutoff.toISOString()).changes;
    const subscriptions = db.prepare(`DELETE FROM browser_push_subscriptions WHERE (enabled=0 AND updated_at<?)
      OR expiration_time<?`).run(cutoff.toISOString(), cutoff.getTime()).changes;
    return { events, subscriptions };
  }).immediate();
}
