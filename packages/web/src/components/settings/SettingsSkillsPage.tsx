import { Button as UiButton, DialogActions, DialogHeader, Field, Input, Notice, Section } from "@cyberos/ui";
import { useEffect, useId, useState, type FormEvent } from "react";
import { AlertTriangle, GitBranch, LoaderCircle, Package, Plus, RefreshCw, ShieldCheck, Trash2, Upload, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  deleteAgentSkill,
  getAgentSkills,
  importAgentSkill,
  installGitAgentSkill,
  setAgentSkillEnabled,
  updateAgentSkill,
  type AgentSkill,
  type AgentSkillsSettings
} from "../../api.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { Switch } from "../common/Switch.js";
import { ModalPortal } from "../common/ModalPortal.js";
import { HelpTip } from "../common/HelpTip.js";
import { useModalDialog } from "../workspace/useModalDialog.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import {
  StorageFilePickerDialog,
  type StorageFilePickerPool,
  type StorageFileSelection
} from "../workspace/StorageFilePickerDialog.js";

export function SettingsSkillsPage({
  activeSessionId,
  storagePools,
  locale
}: {
  activeSessionId: string;
  storagePools: StorageFilePickerPool[];
  locale: SupportedLocale;
}) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<AgentSkillsSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pickerTarget, setPickerTarget] = useState<AgentSkill | "new" | null>(null);
  const [gitTarget, setGitTarget] = useState<AgentSkill | "new" | null>(null);
  const [gitDraft, setGitDraft] = useState({ url: "https://", ref: "", subdirectory: "" });
  const gitTitleId = useId();
  const gitDescriptionId = useId();
  const gitDialogRef = useModalDialog(closeGitDialog, busyId !== null, gitTarget !== null);

  function closeGitDialog() {
    if (busyId === null) setGitTarget(null);
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      setSettings(await getAgentSkills(activeSessionId || undefined));
    } catch (nextError) {
      setError(message(nextError));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, [activeSessionId]);

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

  function replaceSkill(skill: AgentSkill) {
    setSettings((current) => current ? {
      ...current,
      global: current.global.some((entry) => entry.id === skill.id)
        ? current.global.map((entry) => entry.id === skill.id ? skill : entry)
        : [...current.global, skill].sort((left, right) => left.name.localeCompare(right.name))
    } : current);
  }

  async function chooseZip(selection: StorageFileSelection) {
    if (!window.confirm(t("settings.skills.confirmInstall"))) return;
    const target = pickerTarget;
    setPickerTarget(null);
    await run(target === "new" ? "install" : target?.id ?? "install", async () => {
      replaceSkill(await importAgentSkill({
        storagePoolId: selection.storagePoolId,
        path: selection.path,
        ...(target && target !== "new" ? { replaceId: target.id } : {})
      }));
    });
  }

  async function installGit(event: FormEvent) {
    event.preventDefault();
    if (busyId !== null || !gitTarget) return;
    if (!window.confirm(t("settings.skills.confirmInstall"))) return;
    const target = gitTarget;
    await run(target === "new" ? "install" : target?.id ?? "install", async () => {
      replaceSkill(await installGitAgentSkill({
        url: gitDraft.url.trim(),
        ...(gitDraft.ref.trim() ? { ref: gitDraft.ref.trim() } : {}),
        ...(gitDraft.subdirectory.trim() ? { subdirectory: gitDraft.subdirectory.trim() } : {}),
        ...(target && target !== "new" ? { replaceId: target.id } : {})
      }));
      setGitTarget(null);
    });
  }

  async function toggle(skill: AgentSkill, enabled: boolean) {
    if (enabled && !window.confirm(t("settings.skills.confirmEnable", { name: skill.name }))) return;
    await run(skill.id, async () => replaceSkill(await setAgentSkillEnabled(skill.id, enabled)));
  }

  async function update(skill: AgentSkill) {
    if (!window.confirm(t("settings.skills.confirmUpdate", { name: skill.name }))) return;
    await run(skill.id, async () => replaceSkill(await updateAgentSkill(skill.id)));
  }

  async function remove(skill: AgentSkill) {
    if (!window.confirm(t("settings.skills.confirmDelete", { name: skill.name }))) return;
    await run(skill.id, async () => {
      await deleteAgentSkill(skill.id);
      setSettings((current) => current ? {
        ...current,
        global: current.global.filter((entry) => entry.id !== skill.id)
      } : current);
    });
  }

  function replace(skill: AgentSkill) {
    if (skill.sourceType === "zip") setPickerTarget(skill);
    else {
      setError(null);
      setGitDraft({
        url: skill.sourceUrl ?? "https://",
        ref: skill.sourceRef ?? "",
        subdirectory: skill.sourceSubdirectory ?? ""
      });
      setGitTarget(skill);
    }
  }

  if (loading && !settings) {
    return <div className="settings-content-body"><PanelContentSkeleton /></div>;
  }

  return (
    <div className="settings-content-body settings-resource-page">
      {error && !gitTarget ? <Notice className="settings-inline-alert" role="alert" tone="danger" icon={<AlertTriangle aria-hidden="true" size={16} />}>{error}</Notice> : null}
      <Section className="settings-section-card" title={t("settings.skills.globalTitle")} description={t("settings.skills.globalDescription")} actions={<><div className="settings-inline-actions">
            <UiButton variant="ghost" type="button" onClick={() => setPickerTarget("new")} disabled={storagePools.length === 0}><Upload aria-hidden="true" size={15} />{t("settings.skills.importZip")}</UiButton>
            <UiButton variant="ghost" type="button" disabled={busyId !== null} onClick={() => { setError(null); setGitDraft({ url: "https://", ref: "", subdirectory: "" }); setGitTarget("new"); }}><Plus aria-hidden="true" size={15} />{t("settings.skills.installGit")}</UiButton>
          </div></>}>

        <div className="settings-resource-list">
          {settings?.global.length ? settings.global.map((skill) => (
            <article className="settings-resource-row settings-skill-row" key={skill.id} data-state={skill.diagnostics.length ? "error" : "ready"}>
              <span className="settings-resource-icon" aria-hidden="true">{skill.sourceType === "git" ? <GitBranch size={18} /> : <Package size={18} />}</span>
              <div className="settings-resource-copy">
                <strong>{skill.name}{skill.version ? <small> v{skill.version}</small> : null}</strong>
                <span>{skill.description}</span>
                <small>{skill.sourceType === "git" ? skill.resolvedCommit?.slice(0, 12) ?? t("common.states.unknown") : `${skill.sourceStoragePoolId}:${skill.sourcePath}`}</small>
                {skill.diagnostics.map((diagnostic) => <em key={diagnostic} role="alert">{diagnostic}</em>)}
              </div>
              <div className="settings-resource-actions">
                {skill.sourceType === "git" ? <UiButton iconOnly variant="ghost" type="button" data-tooltip={t("common.actions.update")} aria-label={t("common.actions.update")} onClick={() => void update(skill)} disabled={busyId === skill.id}><RefreshCw aria-hidden="true" size={15} /></UiButton> : null}
                <UiButton iconOnly variant="ghost" type="button" data-tooltip={t("settings.skills.replace")} aria-label={t("settings.skills.replace")} onClick={() => replace(skill)} disabled={busyId === skill.id}><Upload aria-hidden="true" size={15} /></UiButton>
                <UiButton iconOnly variant="danger" className="is-danger" type="button" data-tooltip={t("common.actions.delete")} aria-label={t("common.actions.delete")} onClick={() => void remove(skill)} disabled={busyId === skill.id}><Trash2 aria-hidden="true" size={15} /></UiButton>
              </div>
              <Switch checked={skill.enabled} onCheckedChange={(checked) => void toggle(skill, checked)} ariaLabel={t("settings.skills.toggle", { name: skill.name })} compact busy={busyId === skill.id} />
            </article>
          )) : <div className="settings-resource-empty"><Package aria-hidden="true" size={20} /><span>{t("settings.skills.empty")}</span></div>}
        </div>
      </Section>

      <Section className="settings-section-card" title={t("settings.skills.projectTitle")} description={t("settings.skills.projectDescription")} icon={<ShieldCheck aria-hidden="true" size={14} />} actions={<><span className="settings-resource-status" data-state={settings?.project.trusted ? "ready" : "attention"}><ShieldCheck aria-hidden="true" size={14} />{settings?.project.trusted ? t("settings.skills.trusted") : t("settings.skills.untrusted")}</span></>}>

        <div className="settings-resource-list">
          {settings?.project.skills.length ? settings.project.skills.map((skill) => (
            <article className="settings-resource-row settings-project-skill" key={skill.path} data-state={skill.valid ? "ready" : "error"}>
              <span className="settings-resource-icon" aria-hidden="true"><Package size={18} /></span>
              <div className="settings-resource-copy"><strong>{skill.name}</strong><span>{skill.description || skill.path}</span><small>{skill.path}</small>{skill.diagnostics.map((diagnostic) => <em key={diagnostic}>{diagnostic}</em>)}</div>
              <span>{t("settings.skills.readOnly")}</span>
            </article>
          )) : <div className="settings-resource-empty"><Package aria-hidden="true" size={20} /><span>{activeSessionId ? t("settings.skills.noProjectSkills") : t("settings.skills.noSession")}</span></div>}
        </div>
      </Section>

      {gitTarget ? (
        <ModalPortal className="management-modal-backdrop" role="presentation" onMouseDown={closeGitDialog}>
          <section
            ref={gitDialogRef}
            className="settings-section-card settings-resource-editor settings-git-skill-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby={gitTitleId}
            aria-describedby={gitDescriptionId}
            tabIndex={-1}
            onMouseDown={(event) => event.stopPropagation()}
          >
            <DialogHeader title={gitTarget === "new" ? t("settings.skills.installGit") : t("settings.skills.replace")} icon={<GitBranch aria-hidden="true" size={18} />} headingLevel={3} headingId={gitTitleId} actions={<><HelpTip label={gitTarget === "new" ? t("settings.skills.installGit") : t("settings.skills.replace")} content={t("settings.skills.securityNotice")} id={gitDescriptionId} /><UiButton iconOnly variant="ghost" type="button" aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")} onClick={closeGitDialog} disabled={busyId !== null}><X aria-hidden="true" size={16} /></UiButton></>} />
            <form className="settings-git-skill-form" onSubmit={(event) => void installGit(event)} aria-busy={busyId !== null || undefined}>
              <div className="settings-git-skill-body">
                {error ? <Notice className="settings-inline-alert" role="alert" tone="danger" icon={<AlertTriangle aria-hidden="true" size={16} />}>{error}</Notice> : null}
                <div className="settings-field-grid settings-resource-fields">
                  <Field className="settings-field-wide" label={t("settings.skills.gitUrl")}><Input type="url" required value={gitDraft.url} disabled={busyId !== null} onChange={(event) => setGitDraft((current) => ({ ...current, url: event.target.value }))} /></Field>
                  <Field label={t("settings.skills.gitRef")}><Input value={gitDraft.ref} disabled={busyId !== null} onChange={(event) => setGitDraft((current) => ({ ...current, ref: event.target.value }))} /></Field>
                  <Field label={t("settings.skills.gitSubdirectory")}><Input value={gitDraft.subdirectory} disabled={busyId !== null} onChange={(event) => setGitDraft((current) => ({ ...current, subdirectory: event.target.value }))} /></Field>
                </div>
              </div>
              <DialogActions className="settings-inline-actions">
                <UiButton variant="secondary" type="button" className="secondary-button" onClick={closeGitDialog} disabled={busyId !== null}>{t("common.actions.cancel")}</UiButton>
                <UiButton variant="primary" type="submit" className="primary-button" disabled={busyId !== null}>{busyId !== null ? <LoaderCircle aria-hidden="true" size={14} className="is-spinning" /> : null}{t("settings.skills.install")}</UiButton>
              </DialogActions>
            </form>
          </section>
        </ModalPortal>
      ) : null}

      {pickerTarget ? <StorageFilePickerDialog pools={storagePools} initialPoolId={storagePools[0]?.id ?? ""} locale={locale} mode="skill-zip" onCancel={() => setPickerTarget(null)} onSelect={(selection) => void chooseZip(selection)} /> : null}
    </div>
  );
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
