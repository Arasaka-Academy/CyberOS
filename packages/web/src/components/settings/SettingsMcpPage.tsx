import { Button as UiButton, DialogActions, DialogHeader, Field, Input, Notice, Section, Textarea } from "@cyberos/ui";
import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, Check, CheckCircle2, KeyRound, LoaderCircle, Pencil, Plus, RefreshCw, Server, Trash2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import {
  createAgentMcpServer,
  deleteAgentMcpCredentials,
  deleteAgentMcpServer,
  getAgentMcpSettings,
  saveAgentMcpCredentials,
  saveBuiltInAgentMcpSettings,
  testAgentMcpServer,
  updateAgentMcpServer,
  type AgentMcpServer,
  type AgentMcpServerInput,
  type AgentMcpSettings,
  type McpAuthMode,
  type McpExposure
} from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { Switch } from "../common/Switch.js";
import { HelpTip } from "../common/HelpTip.js";
import { ModalPortal } from "../common/ModalPortal.js";
import { useModalDialog } from "../workspace/useModalDialog.js";

const EXPOSURE_OPTIONS: McpExposure[] = ["codemode", "deferred", "direct"];
const AUTH_OPTIONS: McpAuthMode[] = ["none", "bearer", "headers"];

interface McpDraft extends AgentMcpServerInput {
  bearerToken: string;
  secretHeaders: string;
}

const EMPTY_DRAFT: McpDraft = {
  name: "",
  description: "",
  url: "https://",
  timeoutSeconds: 30,
  exposure: "codemode",
  authMode: "none",
  allowInsecureHttp: false,
  bearerToken: "",
  secretHeaders: ""
};

export function SettingsMcpPage() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AgentMcpSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<AgentMcpServer | "new" | null>(null);
  const [draft, setDraft] = useState<McpDraft>(EMPTY_DRAFT);
  const editorTitleId = useId();
  const editorDescriptionId = useId();
  const editorDialogRef = useModalDialog(closeEditor, busyId !== null, editing !== null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getAgentMcpSettings());
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function openEditor(server?: AgentMcpServer) {
    if (busyId !== null) return;
    setError(null);
    setEditing(server ?? "new");
    setDraft(server ? {
      name: server.name,
      description: server.description,
      url: server.url,
      timeoutSeconds: server.timeoutSeconds,
      exposure: server.exposure,
      authMode: server.authMode,
      allowInsecureHttp: server.allowInsecureHttp,
      bearerToken: "",
      secretHeaders: ""
    } : EMPTY_DRAFT);
  }

  function closeEditor() {
    if (busyId !== null) return;
    setEditing(null);
    setDraft(EMPTY_DRAFT);
    setError(null);
  }

  async function run(id: string, operation: () => Promise<void>) {
    setBusyId(id);
    setError(null);
    try {
      await operation();
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setBusyId(null);
    }
  }

  async function toggleBuiltIn(enabled: boolean) {
    if (!window.confirm(t("settings.mcp.confirmBuiltIn"))) return;
    await run("builtin", async () => {
      const builtIn = await saveBuiltInAgentMcpSettings(enabled);
      setSettings((current) => current ? { ...current, builtIn } : current);
    });
  }

  async function toggleServer(server: AgentMcpServer, enabled: boolean) {
    if (enabled && !window.confirm(t("settings.mcp.confirmEnable", { name: server.name }))) return;
    await run(server.id, async () => {
      const updated = await updateAgentMcpServer(server.id, { enabled });
      replaceServer(updated);
    });
  }

  async function testConnection(server: AgentMcpServer) {
    await run(server.id, async () => replaceServer(await testAgentMcpServer(server.id)));
  }

  async function removeServer(server: AgentMcpServer) {
    if (!window.confirm(t("settings.mcp.confirmDelete", { name: server.name }))) return;
    await run(server.id, async () => {
      await deleteAgentMcpServer(server.id);
      setSettings((current) => current ? {
        ...current,
        servers: current.servers.filter((entry) => entry.id !== server.id)
      } : current);
    });
  }

  async function clearCredentials(server: AgentMcpServer) {
    if (!window.confirm(t("settings.mcp.confirmCredentials", { name: server.name }))) return;
    await run(server.id, async () => replaceServer(await deleteAgentMcpCredentials(server.id)));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!window.confirm(t("settings.mcp.confirmSave"))) return;
    await run(editing === "new" ? "new" : editing?.id ?? "editor", async () => {
      const input: AgentMcpServerInput = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        url: draft.url.trim(),
        timeoutSeconds: draft.timeoutSeconds,
        exposure: draft.exposure,
        authMode: draft.authMode,
        allowInsecureHttp: draft.allowInsecureHttp
      };
      let server = editing === "new"
        ? await createAgentMcpServer(input)
        : await updateAgentMcpServer(editing!.id, input);
      replaceServer(server);
      if (editing === "new") setEditing(server);
      if (draft.authMode === "bearer" && draft.bearerToken) {
        server = await saveAgentMcpCredentials(server.id, { bearerToken: draft.bearerToken });
      } else if (draft.authMode === "headers" && draft.secretHeaders.trim()) {
        server = await saveAgentMcpCredentials(server.id, {
          headers: parseSecretHeaders(draft.secretHeaders, t("settings.mcp.invalidHeaders"))
        });
      }
      replaceServer(server);
      setEditing(null);
      setDraft(EMPTY_DRAFT);
    });
  }

  function replaceServer(server: AgentMcpServer) {
    setSettings((current) => current ? {
      ...current,
      servers: current.servers.some((entry) => entry.id === server.id)
        ? current.servers.map((entry) => entry.id === server.id ? server : entry)
        : [...current.servers, server].sort((left, right) => left.name.localeCompare(right.name))
    } : current);
  }

  if (loading && !settings) {
    return <div className="settings-content-body"><PanelContentSkeleton /></div>;
  }

  return (
    <div className="settings-content-body settings-resource-page">
      {error && !editing ? <Notice className="settings-inline-alert" role="alert" tone="danger" icon={<AlertTriangle aria-hidden="true" size={16} />}>{error}</Notice> : null}

      <Section className="settings-section-card settings-resource-primary" title={t("settings.mcp.builtInTitle")} description={t("settings.mcp.builtInDescription")} actions={<><Switch
            checked={settings?.builtIn.enabled ?? false}
            onCheckedChange={(checked) => void toggleBuiltIn(checked)}
            ariaLabel={t("settings.mcp.builtInToggle")}
            compact
            busy={busyId === "builtin"}
            disabled={!settings?.builtIn.available}
          /></>}>

        <ResourceStatus
          status={settings?.builtIn.status ?? "unavailable"}
          label={settings?.builtIn.paired ? t("settings.mcp.paired") : t("settings.mcp.needsRepair")}
        />
      </Section>

      <Section className="settings-section-card" title={t("settings.mcp.externalTitle")} description={t("settings.mcp.externalDescription")} icon={<Plus aria-hidden="true" size={15} />} actions={<><UiButton variant="ghost" className="settings-resource-command" type="button" onClick={() => openEditor()} disabled={busyId !== null}>
            <Plus aria-hidden="true" size={15} />{t("settings.mcp.addServer")}
          </UiButton></>}>

        <div className="settings-resource-list">
          {settings?.servers.length ? settings.servers.map((server) => (
            <article className="settings-resource-row" key={server.id} data-state={server.testStatus}>
              <span className="settings-resource-icon" aria-hidden="true"><Server size={18} /></span>
              <div className="settings-resource-copy">
                <strong>{server.name}</strong>
                <span>{server.description || server.url}</span>
                <small>{t(`settings.mcp.exposure.${server.exposure}`)} · {t("settings.mcp.tools", { count: server.toolCount })} · {server.credentialsConfigured ? t("settings.mcp.credentialsReady") : t("settings.mcp.credentialsMissing")}</small>
                {server.lastError ? <em role="alert">{server.lastError}</em> : null}
              </div>
              <ResourceStatus status={server.testStatus} label={t(`settings.mcp.testStatus.${server.testStatus}`)} />
              <div className="settings-resource-actions">
                <UiButton iconOnly variant="ghost" type="button" data-tooltip={t("settings.mcp.test")} aria-label={t("settings.mcp.test")} onClick={() => void testConnection(server)} disabled={busyId === server.id}><RefreshCw aria-hidden="true" size={15} /></UiButton>
                <UiButton iconOnly variant="ghost" type="button" data-tooltip={t("common.actions.edit")} aria-label={t("common.actions.edit")} onClick={() => openEditor(server)} disabled={busyId === server.id}><Pencil aria-hidden="true" size={15} /></UiButton>
                {server.authMode !== "none" && server.credentialsConfigured ? <UiButton iconOnly variant="ghost" type="button" data-tooltip={t("settings.mcp.clearCredentials")} aria-label={t("settings.mcp.clearCredentials")} onClick={() => void clearCredentials(server)} disabled={busyId === server.id}><KeyRound aria-hidden="true" size={15} /></UiButton> : null}
                <UiButton iconOnly variant="danger" className="is-danger" type="button" data-tooltip={t("common.actions.delete")} aria-label={t("common.actions.delete")} onClick={() => void removeServer(server)} disabled={busyId === server.id}><Trash2 aria-hidden="true" size={15} /></UiButton>
              </div>
              <Switch
                checked={server.enabled}
                onCheckedChange={(checked) => void toggleServer(server, checked)}
                ariaLabel={t("settings.mcp.toggleServer", { name: server.name })}
                compact
                busy={busyId === server.id}
                disabled={busyId === server.id || (!server.enabled && (
                  server.testStatus !== "ready" || (server.authMode !== "none" && !server.credentialsConfigured)
                ))}
              />
            </article>
          )) : <div className="settings-resource-empty"><Server aria-hidden="true" size={20} /><span>{t("settings.mcp.empty")}</span></div>}
        </div>
      </Section>

      {editing ? (
        <ModalPortal className="management-modal-backdrop" role="presentation" onMouseDown={closeEditor}>
          <section
            ref={editorDialogRef}
            className="settings-section-card settings-resource-editor settings-mcp-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={editorTitleId}
            aria-describedby={editorDescriptionId}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DialogHeader title={editing === "new" ? t("settings.mcp.addServer") : t("settings.mcp.editServer")} icon={<Server aria-hidden="true" size={18} />} headingLevel={3} headingId={editorTitleId} actions={<><HelpTip label={editing === "new" ? t("settings.mcp.addServer") : t("settings.mcp.editServer")} content={t("settings.mcp.securityNotice")} id={editorDescriptionId} /><UiButton iconOnly variant="ghost" type="button" data-tooltip={t("common.actions.close")} aria-label={t("common.actions.close")} onClick={closeEditor} disabled={busyId !== null}><X aria-hidden="true" size={16} /></UiButton></>} />
            <form className="settings-mcp-form" onSubmit={(event) => void submit(event)} aria-busy={busyId !== null || undefined}>
              <div className="settings-mcp-body">
                {error ? <Notice className="settings-inline-alert" role="alert" tone="danger" icon={<AlertTriangle aria-hidden="true" size={16} />}>{error}</Notice> : null}
                <fieldset className="settings-field-grid settings-resource-fields" disabled={busyId !== null}>
                  <Field label={t("settings.mcp.name")}><Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} required maxLength={63} pattern="[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?" /></Field>
                  <Field label={t("settings.mcp.url")}><Input type="url" value={draft.url} onChange={(event) => setDraft((current) => ({ ...current, url: event.target.value }))} required /></Field>
                  <Field className="settings-field-wide" label={t("settings.mcp.description")}><Input value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></Field>
                  <Field label={t("settings.mcp.exposureLabel")}><CustomSelect value={draft.exposure} options={EXPOSURE_OPTIONS.map((value) => ({ value, label: t(`settings.mcp.exposure.${value}`) }))} onChange={(exposure) => setDraft((current) => ({ ...current, exposure }))} ariaLabel={t("settings.mcp.exposureLabel")} /></Field>
                  <Field label={t("settings.mcp.authLabel")}><CustomSelect value={draft.authMode} options={AUTH_OPTIONS.map((value) => ({ value, label: t(`settings.mcp.auth.${value}`) }))} onChange={(authMode) => setDraft((current) => ({ ...current, authMode }))} ariaLabel={t("settings.mcp.authLabel")} /></Field>
                  <Field label={t("settings.mcp.timeout")}><Input type="number" min={1} max={300} value={draft.timeoutSeconds} onChange={(event) => setDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value) }))} /></Field>
                  <span className="help-label"><Switch checked={draft.allowInsecureHttp} onCheckedChange={(allowInsecureHttp) => setDraft((current) => ({ ...current, allowInsecureHttp }))} label={t("settings.mcp.allowHttp")} /><HelpTip label={t("settings.mcp.allowHttp")} content={t("settings.mcp.allowHttpHelp")} /></span>
                  {draft.authMode === "bearer" ? <Field className="settings-field-wide" label={t("settings.mcp.bearerToken")}><Input type="password" autoComplete="new-password" value={draft.bearerToken} onChange={(event) => setDraft((current) => ({ ...current, bearerToken: event.target.value }))} placeholder={editing === "new" ? "" : t("settings.mcp.keepCredential")} /></Field> : null}
                  {draft.authMode === "headers" ? <Field className="settings-field-wide" label={t("settings.mcp.secretHeaders")}><Textarea value={draft.secretHeaders} onChange={(event) => setDraft((current) => ({ ...current, secretHeaders: event.target.value }))} placeholder={t("settings.mcp.secretHeadersPlaceholder")} /></Field> : null}
                </fieldset>
              </div>
              <DialogActions className="settings-inline-actions">
                <UiButton variant="secondary" type="button" className="secondary-button" onClick={closeEditor} disabled={busyId !== null}>{t("common.actions.cancel")}</UiButton>
                <UiButton variant="primary" type="submit" className="primary-button" disabled={busyId !== null} aria-busy={busyId !== null || undefined}>{busyId !== null ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : <Check aria-hidden="true" size={14} />}{t("common.actions.saveChanges")}</UiButton>
              </DialogActions>
            </form>
          </section>
        </ModalPortal>
      ) : null}
    </div>
  );
}

function ResourceStatus({ status, label }: { status: string; label: string }) {
  const ready = status === "ready";
  return <span className="settings-resource-status" data-state={status}>{ready ? <CheckCircle2 aria-hidden="true" size={14} /> : <AlertTriangle aria-hidden="true" size={14} />}{label}</span>;
}

function parseSecretHeaders(value: string, invalidMessage: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of value.split(/\r?\n/u).filter((entry) => entry.trim())) {
    const separator = line.indexOf(":");
    if (separator <= 0) throw new Error(invalidMessage);
    headers[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return headers;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
