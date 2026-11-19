/**
 * [INPUT]: 依赖通知目标、窗口焦点与已呈现内容的可见状态。
 * [OUTPUT]: 提供订阅范围的前台免打扰判定。
 * [POS]: 展示确认的纯规则；收到事件不等于看到内容。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { NotificationEventRecord } from "@cyberos/shared";

export interface NotificationDisplayState {
  sessionId: string | null;
  focused: boolean;
  visible: boolean;
  chatVisible: boolean;
  rendered: boolean;
  inViewport: boolean;
  complete: boolean;
}

export function canObserveBrowserNotification(event: NotificationEventRecord, display: NotificationDisplayState): boolean {
  if (event.target.kind !== "agent_session" || event.type === "system.test") return false;
  const referenced = event.type === "agent.action_required" ? Boolean(event.target.runId) : Boolean(event.target.transcriptEventId);
  return referenced && event.target.sessionId === display.sessionId && display.focused && display.visible
    && display.chatVisible && display.rendered && display.inViewport && display.complete;
}
