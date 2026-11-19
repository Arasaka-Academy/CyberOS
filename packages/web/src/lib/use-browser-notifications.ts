/**
 * [INPUT]: 依赖通用事件 SSE、浏览器订阅身份与聊天 DOM 的展示标记。
 * [OUTPUT]: 提供有界重试的前台展示确认与系统通知会话跳转。
 * [POS]: 应用层通知桥；后台投递由服务器与 Service Worker 独立完成。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { useEffect, useRef, type RefObject } from "react";
import { NOTIFICATION_TYPES, type NotificationEventRecord } from "@cyberos/shared";
import { observeBrowserNotification, parseBrowserNotificationMessage, parseBrowserNotificationTarget, readBrowserPushIdentity, subscribeBrowserPushIdentity } from "./browser-notifications.js";
import { canObserveBrowserNotification } from "./notification-observation.js";

interface BrowserNotificationView {
  sessionId: string | null;
  chatVisible: boolean;
  transcriptRef: RefObject<HTMLDivElement | null>;
  onOpenSession: (sessionId: string) => void;
}

export function useBrowserNotifications(view: BrowserNotificationView): void {
  const current = useRef(view);
  current.current = view;
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const open = (message: MessageEvent<unknown>) => {
      const target = parseBrowserNotificationMessage(message.data);
      if (target?.kind === "agent_session") current.current.onOpenSession(target.sessionId);
    };
    navigator.serviceWorker.addEventListener("message", open);
    return () => navigator.serviceWorker.removeEventListener("message", open);
  }, []);

  useEffect(() => {
    let source: EventSource | null = null;
    let identity = readBrowserPushIdentity();
    const pending = new Map<number, { event: NotificationEventRecord; attempts: number; retryAt: number }>();
    const inFlight = new Set<number>();
    let disposed = false;
    let lastEventId: number | null = null;
    const connect = () => {
      source?.close();
      source = null;
      identity = readBrowserPushIdentity();
      pending.clear();
      if (!identity) return;
      source = new EventSource(`/api/notifications/events${lastEventId === null ? "" : `?after=${lastEventId}`}`);
      source.addEventListener("notification", (raw: MessageEvent<string>) => {
        try {
          const value = JSON.parse(raw.data) as Partial<NotificationEventRecord>;
          const target = parseBrowserNotificationTarget(value.target);
          if (!Number.isSafeInteger(value.id) || !target || !NOTIFICATION_TYPES.includes(value.type as NotificationEventRecord["type"])) return;
          const event = { ...value, target } as NotificationEventRecord;
          lastEventId = event.id;
          if (event.type !== "system.test" && !pending.has(event.id)) pending.set(event.id, { event, attempts: 0, retryAt: 0 });
          if (pending.size > 100) pending.delete(pending.keys().next().value!);
        } catch { /* 无效事件保留服务端投递。 */ }
      });
      source.addEventListener("ready", (raw: MessageEvent<string>) => {
        try {
          const value = JSON.parse(raw.data) as { lastEventId?: unknown };
          if (typeof value.lastEventId === "number" && Number.isSafeInteger(value.lastEventId)) lastEventId = value.lastEventId;
        } catch { /* 重连继续沿用最后确认的游标。 */ }
      });
    };
    const check = () => {
      if (!identity || disposed) return;
      const { sessionId, chatVisible, transcriptRef } = current.current;
      const container = transcriptRef.current;
      for (const [id, entry] of pending) {
        const { event } = entry;
        if (Date.parse(event.expiresAt) < Date.now()) { pending.delete(id); continue; }
        if (inFlight.has(id) || entry.retryAt > Date.now() || event.target.kind !== "agent_session" || !container) continue;
        const target = event.target;
        const attribute = event.type === "agent.action_required" ? "data-capability-run" : "data-transcript-id";
        const key = event.type === "agent.action_required" ? target.runId : `event:${target.transcriptEventId}`;
        const element = [...container.querySelectorAll<HTMLElement>(`[${attribute}]`)].find(item => item.getAttribute(attribute) === key);
        const bounds = element?.getBoundingClientRect();
        const area = container.getBoundingClientRect();
        const typing = element?.querySelector(".text-type");
        const complete = Boolean(element && !element.classList.contains("is-streaming")
          && (!typing || typing.querySelector('[role="status"]')?.textContent?.trim()));
        if (!canObserveBrowserNotification(event, {
          sessionId, chatVisible: chatVisible && !document.querySelector('[aria-modal="true"]'),
          focused: document.hasFocus(), visible: document.visibilityState === "visible",
          rendered: Boolean(element?.isConnected), complete,
          inViewport: Boolean(bounds && bounds.width > 0 && bounds.height > 0 && bounds.bottom > Math.max(0, area.top)
            && bounds.top < Math.min(window.innerHeight, area.bottom) && bounds.right > Math.max(0, area.left)
            && bounds.left < Math.min(window.innerWidth, area.right))
        })) continue;
        inFlight.add(id);
        entry.attempts += 1;
        void observeBrowserNotification(id, identity).then(() => { pending.delete(id); })
          .catch(() => {
            if (entry.attempts >= 3) pending.delete(id);
            else entry.retryAt = Date.now() + 500;
          }).finally(() => { inFlight.delete(id); });
      }
    };
    connect();
    const unsubscribe = subscribeBrowserPushIdentity(connect);
    const timer = window.setInterval(check, 150);
    return () => { disposed = true; source?.close(); unsubscribe(); window.clearInterval(timer); };
  }, []);
}
