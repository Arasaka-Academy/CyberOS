/**
 * [INPUT]: 依赖当前语言、通知浏览器适配器和共享 HUD 设置控件。
 * [OUTPUT]: 提供当前浏览器的显式启用、分类偏好、测试和状态恢复。
 * [POS]: 常规设置的自加载通知页面；不请求会话或审批内容。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, Notice, Section } from "@cyberos/ui";
import { useEffect, useRef, useState } from "react";
import { BellRing, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { DEFAULT_NOTIFICATION_PREFERENCES, type NotificationPreferences } from "@cyberos/shared";
import type { SupportedLocale } from "../../i18n/locale.js";
import {
  BrowserNotificationError, enableBrowserNotifications, getBrowserNotificationState,
  testBrowserNotifications, updateBrowserNotifications, type BrowserNotificationState
} from "../../lib/browser-notifications.js";
import { HelpTip } from "../common/HelpTip.js";
import { Switch } from "../common/Switch.js";

export function SettingsNotificationsPage({ locale }: { locale: SupportedLocale }) {
  const [state, setState] = useState<BrowserNotificationState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testSent, setTestSent] = useState(false);
  const operation = useRef(false);
  const generation = useRef(0);

  async function refresh() {
    const current = ++generation.current;
    try {
      const next = await getBrowserNotificationState();
      if (generation.current === current) { setState(next); setError(null); }
    } catch (failure) { if (generation.current === current) setError(errorCode(failure)); }
  }

  useEffect(() => {
    void refresh();
    const onFocus = () => { if (!operation.current) void refresh(); };
    window.addEventListener("focus", onFocus);
    return () => { generation.current += 1; window.removeEventListener("focus", onFocus); };
  }, []);

  async function action(execute: () => Promise<BrowserNotificationState | void>, test = false) {
    if (operation.current) return;
    operation.current = true;
    const current = ++generation.current;
    setBusy(true); setError(null); setTestSent(false);
    try {
      // execute 直接调用 enable，保留浏览器的用户手势。
      const next = await execute();
      if (generation.current === current) { if (next) setState(next); if (test) setTestSent(true); }
    } catch (failure) {
      if (generation.current === current) {
        setError(errorCode(failure));
        if (typeof Notification !== "undefined") setState(previous => previous ? { ...previous, permission: Notification.permission } : previous);
      }
    } finally {
      operation.current = false;
      if (generation.current === current) setBusy(false);
    }
  }

  return <SettingsNotificationsContent
    state={state} busy={busy} error={error} testSent={testSent}
    onRefresh={() => void refresh()}
    onEnabledChange={enabled => void action(() => enabled ? enableBrowserNotifications(locale, state?.subscription?.preferences) : updateBrowserNotifications({ enabled: false }))}
    onPreferencesChange={preferences => void action(() => updateBrowserNotifications({ preferences, locale }))}
    onTest={() => void action(testBrowserNotifications, true)}
  />;
}

function errorCode(error: unknown): string { return error instanceof BrowserNotificationError ? error.code : "request"; }

export function SettingsNotificationsContent({ state, busy, error, testSent, onRefresh, onEnabledChange, onPreferencesChange, onTest }: {
  state: BrowserNotificationState | null; busy: boolean; error: string | null; testSent: boolean;
  onRefresh: () => void; onEnabledChange: (enabled: boolean) => void;
  onPreferencesChange: (preferences: NotificationPreferences) => void; onTest: () => void;
}) {
  const { t } = useTranslation();
  const enabled = Boolean(state?.subscription?.enabled && state.permission === "granted");
  const reason = state?.support !== undefined && state.support !== "supported" ? state.support : state?.permission === "denied" ? "denied" : state && !state.available ? "unavailable" : null;
  const preferences = state?.subscription?.preferences ?? DEFAULT_NOTIFICATION_PREFERENCES;
  const disabled = busy || !state || Boolean(reason);
  return <div className="settings-content-body" aria-busy={!state && !error || busy}>
    <div className="settings-page-grid">
      <Section className="settings-section-card" title={<>{t("browserNotifications.browserTitle")} <HelpTip label={t("browserNotifications.browserTitle")} content={t("browserNotifications.browserHelp")} /></>}>
        <dl className="settings-summary-list" aria-live="polite">
          <div><dt>{t("browserNotifications.permission")}</dt><dd>{state ? t(`browserNotifications.permissions.${state.permission}`) : t("browserNotifications.loading")}</dd></div>
          <div><dt>{t("browserNotifications.connection")}</dt><dd>{busy ? t("browserNotifications.busy") : enabled ? t("browserNotifications.enabled") : t("browserNotifications.disabled")}</dd></div>
        </dl>
        <Switch label={t("browserNotifications.enable")} checked={enabled} disabled={disabled} busy={busy} onCheckedChange={onEnabledChange} />
        {reason ? <Notice tone="warning" role="status">{t(`browserNotifications.reasons.${reason}`)}</Notice> : null}
        {state?.subscription?.lastError ? <Notice tone="warning" role="status">{t("browserNotifications.deliveryFailed")}</Notice> : null}
        {error ? <Notice tone="danger" role="alert">{t(`browserNotifications.reasons.${error as "request"}`)}</Notice> : null}
        {testSent ? <Notice tone="success" role="status">{t("browserNotifications.testSent")}</Notice> : null}
        <div className="settings-inline-actions">
          <Button variant="secondary" type="button" disabled={busy} onClick={onRefresh}><RefreshCw size={14} aria-hidden="true" />{t(error ? "browserNotifications.retry" : "browserNotifications.refresh")}</Button>
          <Button variant="secondary" type="button" disabled={busy || !enabled} onClick={onTest}><BellRing size={14} aria-hidden="true" />{t("browserNotifications.test")}</Button>
        </div>
      </Section>
      <Section className="settings-section-card" title={<>{t("browserNotifications.categoriesTitle")} <HelpTip label={t("browserNotifications.categoriesTitle")} content={`${t("browserNotifications.categoriesHelp")} ${t("browserNotifications.privacyHelp")}`} /></>}>
        <fieldset className="settings-field-grid" disabled={busy || !enabled}>
          {(["replies", "actionRequired", "failures"] as const).map(key => <Switch key={key} label={t(`browserNotifications.${key}`)} checked={preferences[key]} onCheckedChange={checked => onPreferencesChange({ ...preferences, [key]: checked })} />)}
        </fieldset>
      </Section>
    </div>
  </div>;
}
