/**
 * [INPUT]: 依赖会话 transcript 接口和受控 URL 参数。
 * [OUTPUT]: 提供通知会话直读与会话定位参数校验。
 * [POS]: 通知跳转边界；旧会话不依赖最近五十条会话列表。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { getTranscript, type Session, type SessionTranscriptSnapshot } from "../api.js";

export function notificationSessionId(search: string): string | null {
  const id = new URLSearchParams(search).get("session");
  return id && /^[A-Za-z0-9_-]{1,128}$/u.test(id) ? id : null;
}

export async function loadNotificationSession(sessionId: string): Promise<{ session: Session; snapshot: SessionTranscriptSnapshot }> {
  const snapshot = await getTranscript(sessionId);
  if (!snapshot.session || snapshot.session.id !== sessionId || snapshot.session.kind === "voice") {
    throw new Error("Notification conversation is unavailable");
  }
  return { session: snapshot.session, snapshot };
}

export function writeNotificationSessionLocation(sessionId: string): void {
  const url = new URL(window.location.href);
  url.searchParams.set("session", sessionId);
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}
