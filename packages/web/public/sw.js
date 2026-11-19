/**
 * [INPUT]: 依赖 Web Push 通用通知载荷和同源窗口客户端。
 * [OUTPUT]: 提供关闭页面后的系统通知和受控会话跳转。
 * [POS]: 根作用域通知 Service Worker；不拦截请求或建立离线缓存。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
/* global self, URL */
"use strict";

function notificationTarget(value) {
  if (!value || typeof value !== "object") return { kind: "home" };
  if (value.kind !== "agent_session" || typeof value.sessionId !== "string" || !value.sessionId || value.sessionId.length > 256 || typeof value.jobId !== "string" || !value.jobId || value.jobId.length > 256) return { kind: "home" };
  return {
    kind: "agent_session", sessionId: value.sessionId, jobId: value.jobId,
    ...(typeof value.runId === "string" && value.runId.length <= 256 ? { runId: value.runId } : {}),
    ...(Number.isSafeInteger(value.transcriptEventId) && value.transcriptEventId >= 0 ? { transcriptEventId: value.transcriptEventId } : {})
  };
}

self.addEventListener("install", event => { event.waitUntil(self.skipWaiting()); });
self.addEventListener("activate", event => { event.waitUntil(self.clients.claim()); });

self.addEventListener("push", event => {
  event.waitUntil((async () => {
    let payload = null;
    try { payload = event.data?.json(); } catch { /* 无效载荷仍展示通用通知。 */ }
    const valid = payload && payload.version === 1 && Number.isSafeInteger(payload.eventId) && payload.eventId > 0;
    const title = valid && typeof payload.title === "string" ? payload.title : "CyberOS";
    const body = valid && typeof payload.body === "string" ? payload.body : "Open CyberOS to view the update";
    await self.registration.showNotification(title, {
      body, icon: "/cyberos-icon.svg", badge: "/cyberos-icon-small.svg",
      ...(valid ? { tag: `cyberos-event-${payload.eventId}` } : {}),
      renotify: false,
      data: { target: notificationTarget(valid ? payload.target : null) }
    });
  })());
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const target = notificationTarget(event.notification.data?.target);
    const path = target.kind === "agent_session" ? `/?session=${encodeURIComponent(target.sessionId)}` : "/";
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const appWindow = windows.find(client => {
      try {
        const url = new URL(client.url);
        return url.origin === self.location.origin && (url.pathname === "/" || url.pathname === "/index.html");
      } catch { return false; }
    });
    if (appWindow) {
      await appWindow.focus();
      appWindow.postMessage({ type: "cyberos.notification.open", target });
    } else { await self.clients.openWindow(new URL(path, self.location.origin).href); }
  })());
});
