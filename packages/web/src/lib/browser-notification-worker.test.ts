/**
 * [INPUT]: 依赖 Node VM、静态 Service Worker 和通知客户端替身。
 * [OUTPUT]: 验证后台推送必展示、通知去重与同源主窗口跳转。
 * [POS]: 浏览器通知 Service Worker 的隔离行为测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const listeners = new Map<string, (event: unknown) => void>();
  const showNotification = vi.fn(async () => {});
  const matchAll = vi.fn(async (): Promise<unknown[]> => []);
  const openWindow = vi.fn(async () => {});
  runInNewContext(readFileSync(new URL("../../public/sw.js", import.meta.url), "utf8"), {
    URL, self: {
      addEventListener: (name: string, listener: (event: unknown) => void) => listeners.set(name, listener),
      registration: { showNotification }, location: { origin: "https://cyberos.test" },
      clients: { matchAll, openWindow, claim: vi.fn() }, skipWaiting: vi.fn()
    }
  });
  async function dispatch(name: string, value: Record<string, unknown>) {
    const waitUntil = vi.fn();
    listeners.get(name)!({ ...value, waitUntil });
    expect(waitUntil).toHaveBeenCalledTimes(1);
    await waitUntil.mock.calls[0]![0];
  }
  return { dispatch, showNotification, matchAll, openWindow, listeners };
}
const target = { kind: "agent_session", sessionId: "session&1", jobId: "job-1", transcriptEventId: 42 };

describe("notification service worker", () => {
  it("always shows a visible notification and uses event IDs for deduplication", async () => {
    const { dispatch, showNotification, listeners } = worker();
    await dispatch("push", { data: { json: () => ({ version: 1, eventId: 10, title: "Agent replied", body: "Open the conversation", target }) } });
    expect(showNotification).toHaveBeenCalledWith("Agent replied", expect.objectContaining({ tag: "cyberos-event-10", renotify: false, data: { target } }));
    await dispatch("push", { data: { json: () => { throw new Error("invalid"); } } });
    expect(showNotification).toHaveBeenLastCalledWith("CyberOS", expect.objectContaining({ data: { target: { kind: "home" } } }));
    expect(listeners.has("fetch")).toBe(false);
  });
  it("focuses the main app and sends a controlled target without selecting TV or docs", async () => {
    const { dispatch, matchAll, openWindow } = worker();
    const app = { url: "https://cyberos.test/?session=old", focus: vi.fn(async () => {}), postMessage: vi.fn() };
    matchAll.mockResolvedValue([{ url: "https://cyberos.test/tv/" }, { url: "https://cyberos.test/docs/" }, { url: "https://evil.test/" }, app]);
    const close = vi.fn();
    await dispatch("notificationclick", { notification: { close, data: { target } } });
    expect(close).toHaveBeenCalled();
    expect(app.focus).toHaveBeenCalled();
    expect(app.postMessage).toHaveBeenCalledWith({ type: "cyberos.notification.open", target });
    expect(openWindow).not.toHaveBeenCalled();
  });
  it("opens only a same-origin encoded app route when no main window exists", async () => {
    const { dispatch, openWindow } = worker();
    await dispatch("notificationclick", { notification: { close: vi.fn(), data: { target } } });
    expect(openWindow).toHaveBeenCalledWith("https://cyberos.test/?session=session%261");
    await dispatch("notificationclick", { notification: { close: vi.fn(), data: { target: { kind: "url", url: "https://evil.test" } } } });
    expect(openWindow).toHaveBeenLastCalledWith("https://cyberos.test/");
  });
});
