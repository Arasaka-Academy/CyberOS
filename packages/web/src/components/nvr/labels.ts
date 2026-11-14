import type { TFunction } from "i18next";
import { nvrEn } from "../../i18n/nvr.js";
export function statusState(value: string): "ready" | "warning" | "offline" | "error" | "neutral" {
  if (["connected", "available", "recording", "ready", "recovered", "running"].includes(value)) return "ready";
  if (value === "disconnected") return "offline";
  if (["unavailable", "paused", "uncalibrated", "calibration_required", "missing"].includes(value)) return "warning";
  if (["invalid", "error", "fault"].includes(value)) return "error";
  return "neutral";
}
export function statusText(t: TFunction, value: string): string {
  return Object.hasOwn(nvrEn.status, value) ? t(`nvr.status.${value as keyof typeof nvrEn.status}`) : value;
}
export function eventText(t: TFunction, value: string): string {
  switch (value) {
    case "person": return t("nvr.person");
    case "vehicle": return t("nvr.vehicle");
    case "analytics": return t("nvr.analytics_available");
    case "subscription_gap": return t("nvr.subscription_gap");
    case "subscription_resumed": return t("nvr.subscription_resumed");
    case "queue_overflow": return t("nvr.queue_overflow");
    default: return value;
  }
}
