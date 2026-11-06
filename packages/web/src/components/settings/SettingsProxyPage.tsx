import { Button as UiButton, Field, Input, Notice, Section } from "@cyberos/ui";
import { useEffect, useState, type FormEvent } from "react";
import { Check, LoaderCircle, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getSystemProxySettings, updateSystemProxySettings, type SystemProxyProtocol } from "../../api.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { HelpTip } from "../common/HelpTip.js";
import { CustomSelect } from "../common/CustomSelect.js";

export function SettingsProxyPage({ onNotifySuccess }: { onNotifySuccess: (message: string) => void }) {
  const { t } = useTranslation();
  const [protocol, setProtocol] = useState<SystemProxyProtocol>("http");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void getSystemProxySettings().then((settings) => {
      if (!active) return;
      setProtocol(settings.protocol);
      setHost(settings.host ?? "");
      setPort(settings.port === null ? "" : String(settings.port));
    }).catch((nextError: unknown) => {
      if (active) setError(nextError instanceof Error ? nextError.message : String(nextError));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    try {
      const settings = await updateSystemProxySettings({ protocol, host: host.trim(), port: Number(port) });
      setProtocol(settings.protocol);
      setHost(settings.host ?? "");
      setPort(settings.port === null ? "" : String(settings.port));
      setError(null);
      onNotifySuccess(t("settings.proxy.saved"));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <div className="settings-content-body"><PanelContentSkeleton /></div>;
  return (
    <form className="settings-content-body" onSubmit={save}>
      {error ? <Notice className="settings-inline-error" role="alert" tone="danger">{error}</Notice> : null}
      <div className="settings-page-grid">
        <Section className="settings-section-card settings-field-wide" title={t("settings.proxy.title")} description={t("settings.proxy.description")} icon={<Network size={18} aria-hidden="true" />}>

          <fieldset className="settings-field-grid" disabled={busy}>
            <Field label={t("settings.proxy.protocol")}><CustomSelect<SystemProxyProtocol> value={protocol} disabled={busy} ariaLabel={t("settings.proxy.protocol")} options={[{ value: "http", label: "HTTP" }, { value: "https", label: "HTTPS" }, { value: "socks5", label: "SOCKS5" }]} onChange={setProtocol} /></Field>
            <Field label={t("settings.proxy.host")} help={<HelpTip label={t("settings.proxy.host")} content={t("settings.proxy.addressHint")} />}><Input required maxLength={253} value={host} placeholder="192.168.1.2" autoComplete="off" spellCheck={false} onChange={(event) => setHost(event.target.value)} /></Field>
            <Field label={t("settings.proxy.port")}><Input required type="number" inputMode="numeric" min={1} max={65535} step={1} value={port} onChange={(event) => setPort(event.target.value)} /></Field>
          </fieldset>
          <div className="settings-card-actions"><UiButton variant="primary" type="submit" className="primary-button" disabled={busy} aria-busy={busy || undefined}>{busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <Check size={15} aria-hidden="true" />}{t(busy ? "common.actions.saving" : "common.actions.saveChanges")}</UiButton></div>
        </Section>
      </div>
    </form>
  );
}
