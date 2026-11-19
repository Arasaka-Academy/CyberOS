/**
 * [INPUT]: 依赖通知公共契约、浏览器权限、Push API 与同源通知 API。
 * [OUTPUT]: 提供显式订阅、状态恢复、偏好更新、观察确认和受控跳转。
 * [POS]: 设置页与应用外壳共用的浏览器通知边界；身份只保存在当前浏览器。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  type BrowserPushConfig, type BrowserPushIdentity, type BrowserPushRegistration,
  type BrowserPushSubscriptionInput, type BrowserPushSubscriptionRecord,
  type NotificationLocale, type NotificationPreferences, type NotificationTarget
} from "@cyberos/shared";

export const BROWSER_PUSH_STORAGE_KEY = "cyberos.browser-push.v1";
export type BrowserNotificationSupport = "supported" | "insecure" | "unsupported";
export interface BrowserNotificationState {
  support: BrowserNotificationSupport;
  permission: NotificationPermission | "unavailable";
  available: boolean;
  subscription: BrowserPushSubscriptionRecord | null;
}
type StoredPush = { identity: BrowserPushIdentity; endpoint: string };
type SubscriptionPatch = { enabled?: boolean; locale?: NotificationLocale; preferences?: NotificationPreferences };
type ErrorCode = "storage" | "denied" | "dismissed" | "insecure" | "unsupported" | "unavailable" | "subscription" | "request";

export class BrowserNotificationError extends Error {
  constructor(readonly code: ErrorCode, readonly status = 0) { super(`Browser notification ${code}`); }
}

const identityListeners = new Set<() => void>();
let enablePending: Promise<BrowserNotificationState> | null = null;

function support(): BrowserNotificationSupport {
  if (typeof window === "undefined" || !window.isSecureContext) return "insecure";
  return typeof navigator !== "undefined" && "serviceWorker" in navigator && typeof Notification !== "undefined" && typeof PushManager !== "undefined" ? "supported" : "unsupported";
}

function readStoredPush(): StoredPush | null {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(BROWSER_PUSH_STORAGE_KEY) ?? "null");
    if (!value || typeof value !== "object" || !("identity" in value) || !("endpoint" in value) || typeof value.endpoint !== "string") return null;
    const identity = value.identity;
    if (!identity || typeof identity !== "object" || !("id" in identity) || !("token" in identity) || typeof identity.id !== "string" || !identity.id || typeof identity.token !== "string" || !identity.token) return null;
    return { identity: { id: identity.id, token: identity.token }, endpoint: value.endpoint };
  } catch { return null; }
}

export function readBrowserPushIdentity(): BrowserPushIdentity | null { return readStoredPush()?.identity ?? null; }

export function subscribeBrowserPushIdentity(listener: () => void): () => void {
  identityListeners.add(listener);
  const onStorage = (event: StorageEvent) => { if (event.key === BROWSER_PUSH_STORAGE_KEY || event.key === null) listener(); };
  window.addEventListener("storage", onStorage);
  return () => { identityListeners.delete(listener); window.removeEventListener("storage", onStorage); };
}

function writeStoredPush(value: StoredPush | null): void {
  try {
    if (value) localStorage.setItem(BROWSER_PUSH_STORAGE_KEY, JSON.stringify(value));
    else localStorage.removeItem(BROWSER_PUSH_STORAGE_KEY);
  } catch { throw new BrowserNotificationError("storage"); }
  for (const listener of identityListeners) listener();
}

function checkStorage(): void {
  const probe = `${BROWSER_PUSH_STORAGE_KEY}.probe`;
  try { localStorage.setItem(probe, "1"); localStorage.removeItem(probe); }
  catch { throw new BrowserNotificationError("storage"); }
}

async function request<T>(path: string, method = "GET", body?: unknown, identity?: BrowserPushIdentity): Promise<T> {
  const response = await fetch(`/api/notifications${path}`, {
    method, cache: "no-store",
    headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(identity ? { authorization: `Bearer ${identity.token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) })
  });
  if (!response.ok) throw new BrowserNotificationError("request", response.status);
  return await response.json() as T;
}

function emptyState(): BrowserNotificationState {
  const supported = support();
  return { support: supported, permission: supported === "supported" ? Notification.permission : "unavailable", available: false, subscription: null };
}

export async function getBrowserNotificationState(): Promise<BrowserNotificationState> {
  const state = emptyState();
  if (state.support !== "supported") return state;
  const config = await request<BrowserPushConfig>("/push/config");
  state.available = config.available && Boolean(config.publicKey);
  const stored = readStoredPush();
  if (!stored) return state;
  const registration = await navigator.serviceWorker.getRegistration("/");
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription || stored.endpoint !== subscription.endpoint || state.permission !== "granted") {
    writeStoredPush(null);
    return state;
  }
  try {
    const result = await request<{ subscription: BrowserPushSubscriptionRecord }>(`/push/subscriptions/${encodeURIComponent(stored.identity.id)}`, "GET", undefined, stored.identity);
    if (result.subscription.id !== stored.identity.id) throw new BrowserNotificationError("subscription");
    return { ...state, subscription: result.subscription };
  } catch (error) {
    if (error instanceof BrowserNotificationError && [401, 403, 404, 410].includes(error.status)) { writeStoredPush(null); return state; }
    throw error;
  }
}

function applicationServerKey(key: string): Uint8Array<ArrayBuffer> {
  const binary = atob(key.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

/** 权限请求必须保留在点击调用栈内。并发点击共用一轮注册。 */
export function enableBrowserNotifications(locale: NotificationLocale, preferences = DEFAULT_NOTIFICATION_PREFERENCES): Promise<BrowserNotificationState> {
  if (enablePending) return enablePending;
  try {
    const supported = support();
    if (supported !== "supported") throw new BrowserNotificationError(supported);
    checkStorage();
    if (Notification.permission === "denied") throw new BrowserNotificationError("denied");
    const permission = Notification.permission === "granted" ? Promise.resolve("granted" as const) : Notification.requestPermission();
    enablePending = enable(locale, preferences, permission).finally(() => { enablePending = null; });
    return enablePending;
  } catch (error) { return Promise.reject(error); }
}

async function enable(locale: NotificationLocale, preferences: NotificationPreferences, permission: Promise<NotificationPermission>): Promise<BrowserNotificationState> {
  const granted = await permission;
  if (granted !== "granted") throw new BrowserNotificationError(granted === "denied" ? "denied" : "dismissed");
  const config = await request<BrowserPushConfig>("/push/config");
  if (!config.available || !config.publicKey) throw new BrowserNotificationError("unavailable");
  const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  // 首次安装时等待 active，避免在 worker 激活前调用 subscribe。
  const activeRegistration = registration.active ? registration : await navigator.serviceWorker.ready;
  const manager = activeRegistration.pushManager;
  const subscribe = () => manager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationServerKey(config.publicKey!) });
  let currentSubscription = await manager.getSubscription();
  const stored = readStoredPush();
  let identity = currentSubscription && stored?.endpoint === currentSubscription.endpoint ? stored.identity : undefined;
  // 丢失身份后必须轮换 endpoint。旧 endpoint 不能证明令牌所有权。
  if (currentSubscription && !identity) {
    if (stored) writeStoredPush(null);
    await currentSubscription.unsubscribe();
    currentSubscription = null;
  }
  let subscription = currentSubscription ?? await subscribe();
  const register = async (): Promise<BrowserPushRegistration> => {
    const input = subscription.toJSON();
    if (!input.endpoint || !input.keys?.p256dh || !input.keys.auth) throw new BrowserNotificationError("subscription");
    return request<BrowserPushRegistration>("/push/subscriptions", "POST", {
      subscription: { endpoint: input.endpoint, expirationTime: input.expirationTime ?? null, keys: { p256dh: input.keys.p256dh, auth: input.keys.auth } } satisfies BrowserPushSubscriptionInput,
      locale, preferences, ...(identity ? { identity } : {})
    });
  };
  let result: BrowserPushRegistration;
  try { result = await register(); }
  catch (error) {
    if (!identity || !(error instanceof BrowserNotificationError) || ![401, 404, 409, 410].includes(error.status)) throw error;
    writeStoredPush(null);
    identity = undefined;
    await subscription.unsubscribe();
    subscription = await subscribe();
    result = await register();
  }
  if (!result.id || !result.token || result.subscription.id !== result.id) throw new BrowserNotificationError("subscription");
  const nextIdentity = { id: result.id, token: result.token };
  try { writeStoredPush({ identity: nextIdentity, endpoint: subscription.endpoint }); }
  catch (error) {
    await request(`/push/subscriptions/${encodeURIComponent(result.id)}`, "DELETE", undefined, nextIdentity).catch(() => {});
    throw error;
  }
  const current = result.subscription.enabled ? result.subscription : await patchSubscription({ enabled: true }, nextIdentity);
  return { support: "supported", permission: "granted", available: true, subscription: current };
}

async function patchSubscription(patch: SubscriptionPatch, identity: BrowserPushIdentity): Promise<BrowserPushSubscriptionRecord> {
  const result = await request<{ subscription: BrowserPushSubscriptionRecord }>(`/push/subscriptions/${encodeURIComponent(identity.id)}`, "PATCH", patch, identity);
  return result.subscription;
}

export async function updateBrowserNotifications(patch: SubscriptionPatch): Promise<BrowserNotificationState> {
  const identity = readBrowserPushIdentity();
  if (!identity) throw new BrowserNotificationError("subscription");
  const subscription = await patchSubscription(patch, identity);
  return { ...emptyState(), available: true, subscription };
}

export async function testBrowserNotifications(): Promise<void> {
  const identity = readBrowserPushIdentity();
  if (!identity) throw new BrowserNotificationError("subscription");
  await request("/push/test", "POST", { identity });
}

export async function observeBrowserNotification(eventId: number, identity = readBrowserPushIdentity()): Promise<boolean> {
  if (!identity || !Number.isSafeInteger(eventId) || eventId < 1) return false;
  const result = await request<{ observed: boolean }>(`/events/${eventId}/observed`, "POST", { identity });
  return result.observed;
}

export function parseBrowserNotificationTarget(value: unknown): NotificationTarget | null {
  if (!value || typeof value !== "object" || !("kind" in value)) return null;
  if (value.kind === "home") return { kind: "home" };
  if (value.kind !== "agent_session" || !("sessionId" in value) || !("jobId" in value) || typeof value.sessionId !== "string" || !value.sessionId || value.sessionId.length > 256 || typeof value.jobId !== "string" || !value.jobId || value.jobId.length > 256) return null;
  return {
    kind: "agent_session", sessionId: value.sessionId, jobId: value.jobId,
    ...("runId" in value && typeof value.runId === "string" && value.runId.length <= 256 ? { runId: value.runId } : {}),
    ...("transcriptEventId" in value && Number.isSafeInteger(value.transcriptEventId) && typeof value.transcriptEventId === "number" && value.transcriptEventId >= 0 ? { transcriptEventId: value.transcriptEventId } : {})
  };
}

export function notificationTargetUrl(target: NotificationTarget): string { return target.kind === "agent_session" ? `/?session=${encodeURIComponent(target.sessionId)}` : "/"; }

export function parseBrowserNotificationMessage(value: unknown): NotificationTarget | null {
  return value && typeof value === "object" && "type" in value && value.type === "cyberos.notification.open" && "target" in value ? parseBrowserNotificationTarget(value.target) : null;
}
