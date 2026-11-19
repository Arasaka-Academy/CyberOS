/**
 * [INPUT]: 依赖浏览器安全的基础类型。
 * [OUTPUT]: 提供通用通知事件、推送订阅与隐私文案契约。
 * [POS]: 通知生产者、持久队列、API 与浏览器共用的协议边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export const NOTIFICATION_TYPES = ["agent.reply", "agent.action_required", "agent.failed", "system.test"] as const;
export type NotificationType = typeof NOTIFICATION_TYPES[number];
export type NotificationLocale = "zh-CN" | "en";
export type NotificationTarget = { kind: "agent_session"; sessionId: string; jobId: string; runId?: string; transcriptEventId?: number } | { kind: "home" };

export interface NotificationPreferences { replies: boolean; actionRequired: boolean; failures: boolean }
export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferences = { replies: true, actionRequired: true, failures: true };
export const NOTIFICATION_OBSERVE_MS = 2_000;
export const NOTIFICATION_TTL_MS = 24 * 60 * 60 * 1_000;

export interface NotificationEventRecord {
  id: number;
  eventKey: string;
  type: NotificationType;
  target: NotificationTarget;
  createdAt: string;
  expiresAt: string;
}

export interface BrowserPushSubscriptionInput {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

export interface BrowserPushSubscriptionRecord {
  id: string;
  enabled: boolean;
  preferences: NotificationPreferences;
  locale: NotificationLocale;
  origin: string;
  createdAt: string;
  updatedAt: string;
  lastSuccessAt: string | null;
  lastError: string | null;
}

export interface BrowserPushIdentity { id: string; token: string }
export interface BrowserPushConfig { available: boolean; publicKey: string | null }
export interface BrowserPushRegistration extends BrowserPushIdentity { subscription: BrowserPushSubscriptionRecord }

export interface BrowserPushPayload {
  version: 1;
  eventId: number;
  type: NotificationType;
  title: string;
  body: string;
  target: NotificationTarget;
}

export function notificationEnabled(type: NotificationType, preferences: NotificationPreferences): boolean {
  return type === "system.test" || (type === "agent.reply" ? preferences.replies : type === "agent.action_required" ? preferences.actionRequired : preferences.failures);
}

export function notificationPayload(event: NotificationEventRecord, locale: NotificationLocale): BrowserPushPayload {
  const messages: Record<NotificationType, readonly [string, string]> = locale === "zh-CN" ? {
    "agent.reply": ["Agent 已回复", "点击查看回复"],
    "agent.action_required": ["需要你处理", "Agent 正在等待人工处理"],
    "agent.failed": ["Agent 执行失败", "点击查看执行状态"],
    "system.test": ["CyberOS 通知测试", "浏览器通知已连接"]
  } : {
    "agent.reply": ["Agent replied", "Open the conversation to view the reply"],
    "agent.action_required": ["Action required", "Agent is waiting for your input"],
    "agent.failed": ["Agent run failed", "Open the conversation to view its status"],
    "system.test": ["CyberOS notification test", "Browser notifications are connected"]
  };
  const [title, body] = messages[event.type];
  return { version: 1, eventId: event.id, type: event.type, title, body, target: event.target };
}
