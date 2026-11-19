/**
 * [INPUT]: 依赖通知浏览器适配器与浏览器 API 替身。
 * [OUTPUT]: 验证显式权限、订阅恢复、身份持久化与安全跳转。
 * [POS]: 通知前端边界的行为回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BROWSER_PUSH_STORAGE_KEY, enableBrowserNotifications, getBrowserNotificationState,
  notificationTargetUrl, observeBrowserNotification, parseBrowserNotificationMessage,
  readBrowserPushIdentity, updateBrowserNotifications
} from "./browser-notifications.js";

const record = { id: "browser-1", enabled: true, preferences: { replies: true, actionRequired: true, failures: true }, locale: "en", origin: "https://cyberos.test", createdAt: "now", updatedAt: "now", lastSuccessAt: null, lastError: null };
const identity = { id: "browser-1", token: "private-browser-token" };
const endpoint = "https://push.example.test/subscription";
let storage: Map<string, string>;
let fetchMock: ReturnType<typeof vi.fn>;
let requestPermission: ReturnType<typeof vi.fn>;
let register: ReturnType<typeof vi.fn>;
let subscribe: ReturnType<typeof vi.fn>;
let getSubscription: ReturnType<typeof vi.fn>;
let unsubscribe: ReturnType<typeof vi.fn>;

beforeEach(() => {
  storage = new Map();
  vi.stubGlobal("localStorage", { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  vi.stubGlobal("window", { isSecureContext: true, addEventListener: vi.fn(), removeEventListener: vi.fn() });
  requestPermission = vi.fn(async () => "granted");
  vi.stubGlobal("Notification", { permission: "granted", requestPermission });
  vi.stubGlobal("PushManager", class {});
  unsubscribe = vi.fn(async () => true);
  const subscription = { endpoint, unsubscribe, toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "key", auth: "auth" } }) };
  const replacement = { endpoint: `${endpoint}-new`, unsubscribe, toJSON: () => ({ endpoint: `${endpoint}-new`, expirationTime: null, keys: { p256dh: "key", auth: "auth" } }) };
  subscribe = vi.fn(async () => replacement);
  getSubscription = vi.fn(async () => subscription);
  const registration = { active: {}, pushManager: { getSubscription, subscribe } };
  register = vi.fn(async () => registration);
  vi.stubGlobal("navigator", { serviceWorker: { register, getRegistration: vi.fn(async () => registration) } });
  fetchMock = vi.fn(async (url: string, _init: RequestInit) => new Response(JSON.stringify(url.endsWith("/config") ? { available: true, publicKey: "AQID" } : url.endsWith("/observed") ? { observed: true } : url.endsWith("/subscriptions") ? { ...identity, subscription: record } : { subscription: record }), { status: 200 }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("browser push lifecycle", () => {
  it("reads state without registering a worker or requesting permission", async () => {
    await getBrowserNotificationState();
    expect(register).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });
  it("requests permission synchronously on explicit enable and reuses a matching subscription", async () => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint }));
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    const pending = enableBrowserNotifications("en");
    expect(requestPermission).toHaveBeenCalledTimes(1);
    const state = await pending;
    expect(state.subscription?.id).toBe(identity.id);
    expect(register).toHaveBeenCalledWith("/sw.js", { scope: "/", updateViaCache: "none" });
    expect(subscribe).not.toHaveBeenCalled();
    expect(readBrowserPushIdentity()).toEqual(identity);
    await enableBrowserNotifications("en");
    const body = JSON.parse(fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/subscriptions")).at(-1)![1].body);
    expect(body.identity).toEqual(identity);
  });
  it("refuses denied permission and insecure origins without registering", async () => {
    vi.stubGlobal("Notification", { permission: "denied", requestPermission });
    await expect(enableBrowserNotifications("en")).rejects.toMatchObject({ code: "denied" });
    expect(register).not.toHaveBeenCalled();
    vi.stubGlobal("window", { isSecureContext: false });
    expect((await getBrowserNotificationState()).support).toBe("insecure");
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not request permission when persistent identity storage fails", async () => {
    vi.stubGlobal("Notification", { permission: "default", requestPermission });
    vi.stubGlobal("localStorage", { getItem: () => null, setItem: () => { throw new Error("blocked"); }, removeItem: vi.fn() });
    await expect(enableBrowserNotifications("en")).rejects.toMatchObject({ code: "storage" });
    expect(requestPermission).not.toHaveBeenCalled();
  });
  it("does not use a stored identity for a different push endpoint", async () => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint: "https://push.example.test/old" }));
    await enableBrowserNotifications("en");
    const call = fetchMock.mock.calls.find(([url]) => String(url).endsWith("/subscriptions"))!;
    expect(JSON.parse(call[1].body)).not.toHaveProperty("identity");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(JSON.parse(call[1].body).subscription.endpoint).toBe(`${endpoint}-new`);
  });
  it("replaces a subscription with lost local identity before registering, avoiding endpoint conflicts", async () => {
    fetchMock.mockImplementation(async (url: string, init: RequestInit) => {
      if (url.endsWith("/config")) return new Response(JSON.stringify({ available: true, publicKey: "AQID" }));
      const body = JSON.parse(String(init.body));
      return body.subscription.endpoint === endpoint ? new Response("{}", { status: 409 }) : new Response(JSON.stringify({ ...identity, subscription: record }));
    });
    await enableBrowserNotifications("en");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(readBrowserPushIdentity()).toEqual(identity);
  });
  it.each([401, 404, 409])("rotates an invalid saved identity once after registration returns %s", async status => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint }));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ available: true, publicKey: "AQID" })))
      .mockImplementationOnce(async () => new Response("{}", { status }));
    await enableBrowserNotifications("en");
    expect(unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscribe).toHaveBeenCalledTimes(1);
    const registrations = fetchMock.mock.calls.filter(([url]) => String(url).endsWith("/subscriptions"));
    expect(JSON.parse(registrations[0]![1].body).identity).toEqual(identity);
    expect(JSON.parse(registrations[1]![1].body)).not.toHaveProperty("identity");
    expect(JSON.parse(registrations[1]![1].body).subscription.endpoint).toBe(`${endpoint}-new`);
  });
  it("keeps the existing identity and endpoint on ordinary network failures", async () => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint }));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ available: true, publicKey: "AQID" })))
      .mockImplementationOnce(async () => { throw new Error("offline"); });
    await expect(enableBrowserNotifications("en")).rejects.toThrow("offline");
    expect(unsubscribe).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
    expect(readBrowserPushIdentity()).toEqual(identity);
  });
  it("subscribes only once for concurrent enable actions", async () => {
    getSubscription.mockResolvedValue(null);
    const first = enableBrowserNotifications("en");
    const second = enableBrowserNotifications("en");
    expect(first).toBe(second);
    await Promise.all([first, second]);
    expect(subscribe).toHaveBeenCalledExactlyOnceWith({ userVisibleOnly: true, applicationServerKey: new Uint8Array([1, 2, 3]) });
    expect(register).toHaveBeenCalledTimes(1);
  });
  it("rejects server identity mismatch without persisting credentials", async () => {
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ available: true, publicKey: "AQID" })))
      .mockImplementationOnce(async () => new Response(JSON.stringify({ ...identity, subscription: { ...record, id: "different-browser" } })));
    await expect(enableBrowserNotifications("en")).rejects.toMatchObject({ code: "subscription" });
    expect(readBrowserPushIdentity()).toBeNull();
  });
  it("clears expired server identities and lets explicit enable recover", async () => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint }));
    fetchMock.mockImplementationOnce(async () => new Response(JSON.stringify({ available: true, publicKey: "AQID" })))
      .mockImplementationOnce(async () => new Response("{}", { status: 401 }));
    expect((await getBrowserNotificationState()).subscription).toBeNull();
    expect(readBrowserPushIdentity()).toBeNull();
    expect((await enableBrowserNotifications("en")).subscription?.enabled).toBe(true);
  });
  it("keeps tokens in authorization headers and POST bodies", async () => {
    storage.set(BROWSER_PUSH_STORAGE_KEY, JSON.stringify({ identity, endpoint }));
    await updateBrowserNotifications({ enabled: false });
    await observeBrowserNotification(12);
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("authorization")).toBe(`Bearer ${identity.token}`);
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes(identity.token))).toBe(false);
    expect(JSON.parse(fetchMock.mock.calls[1]![1].body)).toEqual({ identity });
  });
});

describe("notification navigation", () => {
  it("accepts only controlled message targets and encodes session identifiers", () => {
    expect(parseBrowserNotificationMessage({ type: "cyberos.notification.open", target: { kind: "agent_session", sessionId: "abc&evil=1", jobId: "job" } })).toEqual({ kind: "agent_session", sessionId: "abc&evil=1", jobId: "job" });
    expect(notificationTargetUrl({ kind: "agent_session", sessionId: "abc&evil=1", jobId: "job" })).toBe("/?session=abc%26evil%3D1");
    expect(parseBrowserNotificationMessage({ type: "cyberos.notification.open", target: { kind: "url", url: "https://evil.test" } })).toBeNull();
    expect(parseBrowserNotificationMessage({ type: "other", target: { kind: "home" } })).toBeNull();
    expect(parseBrowserNotificationMessage({ type: "cyberos.notification.open", target: { kind: "agent_session", sessionId: "session", jobId: "job", transcriptEventId: 24 } })).toMatchObject({ transcriptEventId: 24 });
    expect(parseBrowserNotificationMessage({ type: "cyberos.notification.open", target: { kind: "agent_session", sessionId: "session", jobId: "job", transcriptEventId: -1 } })).not.toHaveProperty("transcriptEventId");
  });
});
