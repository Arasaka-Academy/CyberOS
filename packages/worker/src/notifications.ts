/**
 * [INPUT]: 依赖持久通知租约、私有 VAPID 和发送前重查的可取消传输。
 * [OUTPUT]: 提供单次独立通知发送调度。
 * [POS]: worker 通知出口；不消耗 Agent 作业并发槽。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import {
  claimNotificationDelivery, failNotificationDelivery, finishNotificationDelivery,
  getClaimedNotificationDelivery, retryNotificationDelivery, type CyberOsDatabase
} from "@cyberos/db";
import { notificationPayload, type CyberOsRuntime } from "@cyberos/shared";
import { BrowserPushTransportError, createBrowserPushTransport, loadBrowserPushVapidKeys, type BrowserPushTransport } from "@cyberos/shared/browser-push-node";

interface NotificationSenderDependencies {
  db: CyberOsDatabase;
  config: CyberOsRuntime;
  workerId: string;
  transport?: BrowserPushTransport;
  signal?: AbortSignal;
  now?: () => Date;
}
const MAX_ATTEMPTS = 8;
const DEFAULT_RETRY_MS = 30_000;
const MAX_RETRY_MS = 3_600_000;
const defaultTransport = createBrowserPushTransport();

export async function processNextNotification(dependencies: NotificationSenderDependencies): Promise<boolean> {
  const { db, config, workerId, signal, transport = defaultTransport } = dependencies;
  const clock = dependencies.now ?? (() => new Date());
  if (signal?.aborted) return false;
  const claimed = claimNotificationDelivery(db, { workerId, now: clock(), leaseMs: 30_000 });
  if (!claimed) return false;
  const settle = () => ({ deliveryId: claimed.id, workerId, now: clock() });
  try {
    const keys = loadBrowserPushVapidKeys(config.paths.secretsDir);
    const current = getClaimedNotificationDelivery(db, settle());
    if (!current || signal?.aborted) return false;
    const ttlSeconds = Math.max(1, Math.ceil((Date.parse(current.event.expiresAt) - clock().getTime()) / 1_000));
    const subject = current.subscription.origin.startsWith("https://") ? current.subscription.origin : "mailto:notifications@cyberos.local";
    const result = await transport({ ...current.subscription, expirationTime: null }, notificationPayload(current.event, current.subscription.locale), keys, signal, ttlSeconds, subject,
      () => Boolean(getClaimedNotificationDelivery(db, settle())));
    if (result.cancelled) return false;
    if (result.status >= 200 && result.status < 300) finishNotificationDelivery(db, settle());
    else if (result.status === 429 || result.status >= 500) retry(`push_http_${result.status}`, result.retryAfter);
    else failNotificationDelivery(db, { ...settle(), error: `push_http_${result.status}`, disableSubscription: result.status === 404 || result.status === 410 });
  } catch (error) {
    if (error instanceof BrowserPushTransportError && error.kind === "unsafe_endpoint") {
      failNotificationDelivery(db, { ...settle(), error: "push_unsafe_endpoint", disableSubscription: true });
    } else retry(signal?.aborted ? "push_interrupted" : "push_network", null);
  }
  return true;

  function retry(error: string, retryAfter: string | null): void {
    const now = clock();
    const backoff = Math.min(MAX_RETRY_MS, DEFAULT_RETRY_MS * 2 ** Math.max(0, claimed!.attempt - 1));
    const date = retryAfter ? Date.parse(retryAfter) : NaN;
    const seconds = retryAfter && /^\d+$/u.test(retryAfter.trim()) ? Number(retryAfter) * 1_000 : NaN;
    const serviceDelay = Number.isFinite(seconds) ? seconds : Number.isFinite(date) ? date - now.getTime() : 0;
    const retryAt = new Date(now.getTime() + Math.min(MAX_RETRY_MS, Math.max(backoff, serviceDelay)));
    if (claimed!.attempt >= MAX_ATTEMPTS || retryAt.getTime() >= Date.parse(claimed!.event.expiresAt)) {
      failNotificationDelivery(db, { ...settle(), error: "push_retries_exhausted" });
    } else retryNotificationDelivery(db, { ...settle(), error, retryAt });
  }
}
