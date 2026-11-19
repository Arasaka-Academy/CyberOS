/**
 * [INPUT]: 依赖通知事件与订阅分类偏好。
 * [OUTPUT]: 验证锁屏文案隔离业务正文与分类开关。
 * [POS]: 浏览器安全通知契约的回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { describe, expect, it } from "vitest";
import { NOTIFICATION_TYPES, notificationEnabled, notificationPayload, type NotificationEventRecord } from "./notifications.js";

describe("notification privacy contract", () => {
  it("emits generic localized prompts without leaking source data", () => {
    for (const type of NOTIFICATION_TYPES) {
      const event: NotificationEventRecord = {
        id: 8, eventKey: "secret-source-key", type, target: { kind: "home" },
        createdAt: "2026-11-19T00:00:00Z", expiresAt: "2026-11-20T00:00:00Z"
      };
      for (const locale of ["en", "zh-CN"] as const) {
        const payload = notificationPayload(event, locale);
        expect(payload.title).toBeTruthy();
        expect(payload.body).toBeTruthy();
        expect(JSON.stringify(payload)).not.toContain("secret-source-key");
        expect(Object.keys(payload).sort()).toEqual(["body", "eventId", "target", "title", "type", "version"]);
      }
    }
  });

  it("selects subscriptions by the matching category while allowing an explicit test", () => {
    const disabled = { replies: false, actionRequired: false, failures: false };
    expect(NOTIFICATION_TYPES.map(type => notificationEnabled(type, disabled))).toEqual([false, false, false, true]);
    expect(notificationEnabled("agent.reply", { ...disabled, replies: true })).toBe(true);
    expect(notificationEnabled("agent.action_required", { ...disabled, actionRequired: true })).toBe(true);
    expect(notificationEnabled("agent.failed", { ...disabled, failures: true })).toBe(true);
  });
});
