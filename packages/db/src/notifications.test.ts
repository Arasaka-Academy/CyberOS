/**
 * [INPUT]: 依赖隔离 SQLite 与通知仓库。
 * [OUTPUT]: 验证订阅身份、原子事件、独立已见和租约投递。
 * [POS]: db 通知持久化的行为回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBrowserPushSubscription, getBrowserPushSubscription, updateBrowserPushSubscription,
  deleteBrowserPushSubscription, publishNotification, listNotificationEvents, observeNotification,
  claimNotificationDelivery, getClaimedNotificationDelivery, finishNotificationDelivery,
  retryNotificationDelivery, failNotificationDelivery, cleanupNotifications, openCyberOsDb,
  type CyberOsDatabase } from "./index.js";

let db: CyberOsDatabase;
const now = new Date("2026-11-19T00:00:00.000Z");
const at = (milliseconds: number) => new Date(now.getTime() + milliseconds);
function register(endpoint = "https://push.example/one") {
  return createBrowserPushSubscription(db, { subscription: { endpoint, expirationTime: null,
    keys: { p256dh: "public-key", auth: "auth-secret" } }, origin: "https://cyberos.example", locale: "zh-CN", now });
}
function publish(eventKey = "reply-1", subscriptionId?: string) {
  return publishNotification(db, { eventKey, type: "agent.reply", target: { kind: "home" }, now,
    ...(subscriptionId ? { subscriptionId } : {}) });
}
beforeEach(() => { db = openCyberOsDb(":memory:"); });
afterEach(() => { db.close(); });

describe("browser notification persistence", () => {
  it("keeps subscription secrets internal and refuses endpoint takeover", () => {
    const registration = register();
    expect(registration.token.length).toBeGreaterThanOrEqual(32);
    expect(JSON.stringify(registration.subscription)).not.toMatch(/push\.example|public-key|auth-secret|token/);
    expect(db.prepare("SELECT token_hash FROM browser_push_subscriptions").pluck().get()).not.toBe(registration.token);
    expect(getBrowserPushSubscription(db, registration.id, "wrong")).toBeNull();
    expect(() => register()).toThrow(/conflict|registered/i);
    const input = { subscription: { endpoint: "https://push.example/one", expirationTime: null,
      keys: { p256dh: "replacement", auth: "replacement" } }, locale: "en" as const,
      origin: "https://cyberos.example", identity: { id: registration.id, token: registration.token } };
    expect(createBrowserPushSubscription(db, input).id).toBe(registration.id);
    expect(() => createBrowserPushSubscription(db, { ...input, origin: "https://other.example" })).toThrow(/conflict|origin/i);
    expect(deleteBrowserPushSubscription(db, registration.id, "wrong")).toBe(false);
    expect(deleteBrowserPushSubscription(db, registration.id, registration.token)).toBe(true);
  });

  it("creates one event and only currently eligible deliveries atomically", () => {
    const first = register();
    const second = register("https://push.example/two");
    updateBrowserPushSubscription(db, second.id, second.token, { preferences: { replies: false, failures: true, actionRequired: true } });
    const event = publish();
    expect(publish().id).toBe(event.id);
    expect(db.prepare("SELECT event_id,subscription_id FROM notification_deliveries").all()).toEqual([{ event_id: event.id, subscription_id: first.id }]);
    db.exec("CREATE TRIGGER reject_delivery BEFORE INSERT ON notification_deliveries BEGIN SELECT RAISE(ABORT, 'reject delivery'); END");
    expect(() => publish("rolled-back")).toThrow("reject delivery");
    expect(listNotificationEvents(db).map(value => value.eventKey)).toEqual(["reply-1"]);
  });

  it("waits two seconds, acknowledges each browser separately, and checks TTL", () => {
    const first = register();
    const second = register("https://push.example/two");
    const event = publish();
    expect(claimNotificationDelivery(db, { workerId: "one", now: at(1_999) })).toBeNull();
    expect(observeNotification(db, { eventId: event.id, subscriptionId: first.id, token: "wrong", now: at(1_000) })).toBe(false);
    expect(observeNotification(db, { eventId: event.id, subscriptionId: first.id, token: first.token, now: at(1_000) })).toBe(true);
    const delivery = claimNotificationDelivery(db, { workerId: "one", now: at(2_000) });
    expect(delivery?.subscription.id).toBe(second.id);
    expect(finishNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "other", now: at(2_001) })).toBe(false);
    expect(finishNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "one", now: at(2_001) })).toBe(true);
    publish("expired");
    expect(claimNotificationDelivery(db, { workerId: "one", now: at(86_400_000) })).toBeNull();
  });

  it("requires delivery membership for an observation and a directed test", () => {
    const first = register();
    const second = register("https://push.example/two");
    const event = publish("directed", first.id);
    expect(listNotificationEvents(db, { subscriptionId: second.id })).toEqual([]);
    expect(observeNotification(db, { eventId: event.id, subscriptionId: second.id, token: second.token })).toBe(false);
    expect(listNotificationEvents(db, { subscriptionId: first.id })[0]?.id).toBe(event.id);
  });

  it("rechecks ACK, preferences, disabled subscriptions, and delivery leases", () => {
    const registration = register();
    const event = publish();
    const delivery = claimNotificationDelivery(db, { workerId: "one", now: at(2_000), leaseMs: 100 });
    expect(claimNotificationDelivery(db, { workerId: "two", now: at(2_050) })).toBeNull();
    expect(getClaimedNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "one", now: at(2_101) })).toBeNull();
    const reclaimed = claimNotificationDelivery(db, { workerId: "two", now: at(2_101) });
    expect(reclaimed?.attempt).toBe(2);
    updateBrowserPushSubscription(db, registration.id, registration.token, { preferences: { replies: false, failures: true, actionRequired: true } });
    expect(getClaimedNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "two", now: at(2_102) })).toBeNull();
    updateBrowserPushSubscription(db, registration.id, registration.token, { preferences: { replies: true, failures: true, actionRequired: true } });
    expect(observeNotification(db, { eventId: event.id, subscriptionId: registration.id, token: registration.token })).toBe(true);
    expect(getClaimedNotificationDelivery(db, { deliveryId: delivery!.id, workerId: "two", now: at(2_103) })).toBeNull();
  });

  it("retries transient failures, disables expired endpoints, and cleans old history", () => {
    const registration = register();
    publish();
    const delivery = claimNotificationDelivery(db, { workerId: "one", now: at(2_000) })!;
    expect(retryNotificationDelivery(db, { deliveryId: delivery.id, workerId: "one", error: "rate_limited", retryAt: at(4_000), now: at(2_001) })).toBe(true);
    expect(claimNotificationDelivery(db, { workerId: "two", now: at(3_999) })).toBeNull();
    expect(claimNotificationDelivery(db, { workerId: "two", now: at(4_000) })?.id).toBe(delivery.id);
    expect(failNotificationDelivery(db, { deliveryId: delivery.id, workerId: "two", error: "gone", disableSubscription: true, now: at(4_001) })).toBe(true);
    expect(getBrowserPushSubscription(db, registration.id, registration.token)?.enabled).toBe(false);
    expect(cleanupNotifications(db, { now: at(31 * 86_400_000) })).toEqual({ events: 1, subscriptions: 1 });
    expect(db.prepare("SELECT COUNT(*) FROM notification_deliveries").pluck().get()).toBe(0);
  });

  it("settles expired queued deliveries instead of leaving them pending", () => {
    register();
    publish();
    expect(claimNotificationDelivery(db, { workerId: "one", now: at(86_400_000) })).toBeNull();
    expect(db.prepare("SELECT state,last_error FROM notification_deliveries").get()).toEqual({ state: "failed", last_error: "notification_obsolete" });
  });

  it("stores only stable error codes in subscription records", () => {
    const identity = register();
    publish();
    const delivery = claimNotificationDelivery(db, { workerId: "one", now: at(2_000) })!;
    failNotificationDelivery(db, { deliveryId: delivery.id, workerId: "one", error: "https://push.example/one auth-secret", now: at(2_001) });
    expect(getBrowserPushSubscription(db, identity.id, identity.token)?.lastError).toBe("push_delivery_failed");
    expect(db.prepare("SELECT last_error FROM notification_deliveries").pluck().get()).toBe("push_delivery_failed");
  });
});
