import { Button as UiButton, Checkbox, DialogHeader, EmptyState, Field, Input, Notice, SectionHeader, StatusBadge, Textarea } from "@cyberos/ui";
import { CustomSelect } from "../common/CustomSelect.js";
import { ModalPortal } from "../common/ModalPortal.js";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { IscsiAction, IscsiImage, IscsiSummary, IscsiTarget } from "@cyberos/shared";
import { CircleAlert, Database, HardDrive, LoaderCircle, Plus, RefreshCw, Server, Trash2, X } from "lucide-react";
import { applyIscsiAction, getIscsiSummary } from "../../api.js";
import { ISCSI_REFRESH_EVENT, iscsiGiBToBytes, parseIscsiInitiators, validateIscsiTarget, type IscsiTargetForm } from "../../config/iscsi.js";
import { formatBytes } from "../../i18n/format.js";
import type { SupportedLocale } from "../../i18n/locale.js";
import { Switch } from "../common/Switch.js";
import { useModalDialog } from "./useModalDialog.js";
import { IscsiInitialSkeleton } from "./PanelLoadingSkeletons.js";

const KEY = "workspace.management.storage.iscsi";
type Mutation = IscsiAction extends infer Action ? Action extends IscsiAction ? Omit<Action, "confirmed" | "expectedRevision"> : never : never;
type Apply = (action: Mutation) => Promise<boolean>;
type Modal = { kind: "create" } | { kind: "target"; id: string } | { kind: "image"; id: string };

function useIscsiText() {
  const { t } = useTranslation();
  const translate = t as (key: string, options?: Record<string, unknown>) => string;
  return (key: string, options?: Record<string, unknown>) => translate(`${KEY}.${key}`, options);
}

export function IscsiManagementCard({ locale, onNotifySuccess, onWorkQueuesChanged }: {
  locale: SupportedLocale;
  onNotifySuccess: (message: string | null) => void;
  onWorkQueuesChanged: () => void | Promise<void>;
}) {
  const text = useIscsiText();
  const [summary, setSummary] = useState<IscsiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [modal, setModal] = useState<Modal | null>(null);
  const [modalError, setModalError] = useState<string | null>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  const modalRef = useRef<Modal | null>(null);
  const busyRef = useRef(false);
  const modalRevision = useRef("");
  modalRef.current = modal;

  const refresh = useCallback(async (background = false) => {
    if (busyRef.current || modalRef.current) return;
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    if (!background) setLoading(true);
    try {
      const next = await getIscsiSummary(request.signal);
      if (!mounted.current || current !== sequence.current) return;
      setSummary(next);
      setError(null);
    } catch (nextError) {
      if (!mounted.current || request.signal.aborted || current !== sequence.current) return;
      setError(nextError instanceof Error ? nextError.message : String(nextError));
    } finally {
      if (mounted.current && current === sequence.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const update = () => { if (document.visibilityState === "visible") void refresh(true); };
    const timer = window.setInterval(update, 10_000);
    window.addEventListener(ISCSI_REFRESH_EVENT, update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mounted.current = false;
      sequence.current += 1;
      controller.current?.abort();
      window.clearInterval(timer);
      window.removeEventListener(ISCSI_REFRESH_EVENT, update);
      document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);

  function open(next: Modal) {
    if (!summary || busyRef.current) return;
    ++sequence.current;
    controller.current?.abort();
    setLoading(false);
    modalRevision.current = summary.revision;
    modalRef.current = next;
    setModalError(null);
    setModal(next);
  }

  function close() {
    if (busyRef.current) return;
    modalRef.current = null;
    setModal(null);
    setModalError(null);
    void refresh(true);
  }

  async function refreshDetails() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const current = ++sequence.current;
    controller.current?.abort();
    const request = new AbortController();
    controller.current = request;
    try {
      const next = await getIscsiSummary(request.signal);
      if (mounted.current && current === sequence.current) {
        setSummary(next);
        modalRevision.current = next.revision;
        setModalError(null);
      }
    } catch (nextError) {
      if (mounted.current && !request.signal.aborted) setModalError(nextError instanceof Error ? nextError.message : text("loadError"));
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  const apply: Apply = async (action) => {
    if (busyRef.current || !summary?.available) return false;
    busyRef.current = true;
    setBusy(true);
    setModalError(null);
    ++sequence.current;
    controller.current?.abort();
    try {
      const next = await applyIscsiAction({ ...action, confirmed: true, expectedRevision: modalRevision.current });
      if (!mounted.current) return false;
      setSummary(next);
      modalRevision.current = next.revision;
      onNotifySuccess(text("operationComplete"));
      void Promise.resolve().then(onWorkQueuesChanged).catch(() => undefined);
      return true;
    } catch (nextError) {
      if (mounted.current) setModalError(nextError instanceof Error ? nextError.message : text("staleError"));
      return false;
    } finally {
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const target = modal?.kind === "target" ? summary?.targets.find((item) => item.id === modal.id) : undefined;
  const image = modal?.kind === "image" ? summary?.images.find((item) => item.id === modal.id) : undefined;
  if (loading && !summary) return <IscsiInitialSkeleton />;
  return <section className="management-section iscsi-card" aria-label={text("title")} aria-busy={busy || loading || undefined}>
    <SectionHeader className="management-section-header" title={text("title")} description={text("description")} icon={<Server aria-hidden="true" size={16} />} actions={<><div className="iscsi-actions">
        <UiButton variant="ghost" iconOnly type="button" className="icon-button" data-tooltip={text("refresh")} aria-label={text("refresh")} disabled={loading || busy} aria-busy={loading || undefined} onClick={() => void refresh()}>{loading ? <LoaderCircle className="is-spinning" size={16} aria-hidden="true" /> : <RefreshCw size={16} aria-hidden="true" />}</UiButton>
        <UiButton variant="primary" type="button" className="primary-button" disabled={!summary?.available || loading || busy} onClick={() => open({ kind: "create" })}><Plus size={15} aria-hidden="true" />{text("createTarget")}</UiButton>
      </div></>} />
    <div className="iscsi-card-body">
      {error ? <Notice className="iscsi-error" role="alert" tone="danger" icon={<CircleAlert size={16} aria-hidden="true" />}>{text("loadError")} {error}</Notice> : null}
      {summary ? <>
        <div className="iscsi-summary"><StatusBadge className="management-status-pill" data-state={summary.available ? "ready" : "warning"}>{text(summary.available ? "ready" : "unavailable")}</StatusBadge><span>{summary.targets.length} {text("targets")}</span><span>{summary.targets.reduce((count, item) => count + item.luns.length, 0)} {text("luns")}</span><span>{text("sessionCount", { count: summary.targets.reduce((count, item) => count + item.sessions.length, 0) })}</span></div>
        {summary.error ? <Notice className="iscsi-error" role="alert" tone="danger" icon={<CircleAlert size={16} aria-hidden="true" />}>{summary.error}</Notice> : null}
        <IscsiInventory summary={summary} busy={busy} locale={locale} onSelectTarget={(id) => open({ kind: "target", id })} onSelectImage={(id) => open({ kind: "image", id })} />
      </> : null}
    </div>
    {modal && summary ? <IscsiDialog title={modal.kind === "create" ? text("createTarget") : target?.name ?? image?.name ?? text("title")} busy={busy} error={modalError} onClose={close}>
      {modal.kind === "create" ? <TargetForm summary={summary} busy={busy} onCancel={close} onSave={async (input) => { if (await apply(input)) close(); }} /> : null}
      {target ? <TargetDetails key={target.id} target={target} summary={summary} busy={busy} locale={locale} apply={apply} onClose={close} onRefresh={() => void refreshDetails()} /> : null}
      {image ? <RetainedImageDetails key={image.id} image={image} summary={summary} busy={busy} locale={locale} apply={apply} onClose={close} /> : null}
    </IscsiDialog> : null}
  </section>;
}

export function IscsiInventory({ summary, busy, locale, onSelectTarget, onSelectImage }: {
  summary: IscsiSummary; busy: boolean; locale: SupportedLocale;
  onSelectTarget: (id: string) => void; onSelectImage: (id: string) => void;
}) {
  const text = useIscsiText();
  const retained = summary.images.filter((image) => image.attachedTargetId === null);
  return <>
    <div className="iscsi-target-list">{summary.targets.length ? summary.targets.map((target) => <article className="iscsi-target-row" key={target.id}>
      <Server size={18} aria-hidden="true" />
      <div className="iscsi-target-identity"><UiButton variant="ghost" type="button" className="storage-pool-name-button" onClick={() => onSelectTarget(target.id)} disabled={busy} aria-label={text("details", { name: target.name })}>{target.name}</UiButton><code>{target.iqn}</code><small>{target.address.includes(":") ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`}</small></div>
      <div className="iscsi-target-state"><StatusBadge className="management-status-pill" data-state={target.status === "running" ? "ready" : target.status === "degraded" ? "warning" : "neutral"}>{text(target.status)}</StatusBadge><small>{target.luns.length} {text("luns")} · {text("sessionCount", { count: target.sessions.length })}</small></div>
    </article>) : <EmptyState className="management-empty">{text("noTargets")}</EmptyState>}</div>
    <div className="iscsi-retained"><h4><HardDrive size={15} aria-hidden="true" />{text("retained")}</h4>{retained.length ? retained.map((image) => <article className="iscsi-image-row" key={image.id}><div><strong>{image.name}</strong><small>{image.storagePoolId} · {formatBytes(image.sizeBytes, locale)}</small></div><UiButton variant="secondary" type="button" className="secondary-button" onClick={() => onSelectImage(image.id)} disabled={busy || !summary.available}>{text("attach")} / {text("destroyImage")}</UiButton></article>) : <EmptyState className="management-empty">{text("noRetained")}</EmptyState>}</div>
  </>;
}

function IscsiDialog({ title, busy, error, onClose, children }: { title: string; busy: boolean; error: string | null; onClose: () => void; children: ReactNode }) {
  const text = useIscsiText();
  const ref = useModalDialog(onClose, busy);
  return <ModalPortal className="management-modal-backdrop iscsi-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <section ref={ref} tabIndex={-1} className="management-modal iscsi-dialog" role="dialog" aria-modal="true" aria-labelledby="iscsi-dialog-title" aria-busy={busy || undefined}>
      <DialogHeader title={title} eyebrow={<>iSCSI</>} headingLevel={3} headingId="iscsi-dialog-title" actions={<><UiButton variant="ghost" iconOnly type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label={text("close")} data-tooltip={text("close")}><X size={18} aria-hidden="true" /></UiButton></>} />
      {error ? <Notice className="iscsi-error" role="alert" tone="danger" icon={<CircleAlert size={16} aria-hidden="true" />} actions={<><UiButton variant="secondary" type="button" className="secondary-button" onClick={onClose} disabled={busy}>{text("retry")}</UiButton></>}><span>{error}</span></Notice> : null}
      <div className="iscsi-dialog-body">{children}</div>
    </section>
  </ModalPortal>;
}

function TargetForm({ target, summary, busy, onSave, onCancel }: { target?: IscsiTarget; summary: IscsiSummary; busy: boolean; onSave: (input: Mutation) => void | Promise<void>; onCancel: () => void }) {
  const text = useIscsiText();
  const [form, setForm] = useState<IscsiTargetForm>(() => ({ name: target?.name ?? "", address: target?.address ?? "", port: String(target?.port ?? 3260), initiators: target?.initiators.join("\n") ?? "", chapEnabled: target?.chapEnabled ?? true, username: target?.chapUsername ?? "", password: "" }));
  const [error, setError] = useState<string | null>(null);
  const update = (patch: Partial<IscsiTargetForm>) => setForm((current) => ({ ...current, ...patch }));
  const addresses = summary.listenAddresses;
  async function submit(event: FormEvent) {
    event.preventDefault();
    const issue = validateIscsiTarget(form, addresses, Boolean(target?.credentialConfigured));
    if (issue) { setError(text(`validation.${issue}`)); return; }
    const input = { name: form.name.trim(), address: form.address, port: Number(form.port), initiators: parseIscsiInitiators(form.initiators), chap: { enabled: form.chapEnabled, username: form.username, ...(form.password ? { password: form.password } : {}) } };
    await onSave(target ? { action: "update_target", targetId: target.id, ...input } : { action: "create_target", ...input, enabled: true });
  }
  return <form className="iscsi-form" onSubmit={(event) => void submit(event)}>
    <fieldset disabled={busy || !summary.available}>
      <div className="iscsi-form-grid">
        <Field className="iscsi-field" label={text("name")}><Input value={form.name} maxLength={64} onChange={(event) => update({ name: event.target.value })} required /></Field>
        <Field className="iscsi-field" label={text("address")}><CustomSelect value={form.address} onChange={(selectedValue) => update({ address: selectedValue })} required ariaLabel={text("address")} options={[{ value: "", label: text("selectAddress") }, ...(addresses.map((address) => ({ value: address, label: address }))), ...(form.address && !addresses.includes(form.address) ? [{ value: form.address, label: form.address, disabled: true }] : [])]} /></Field>
        <Field className="iscsi-field" label={text("port")}><Input inputMode="numeric" value={form.port} onChange={(event) => update({ port: event.target.value })} required /></Field>
        <Field className="iscsi-field" label={text("initiators")} wide><Textarea value={form.initiators} onChange={(event) => update({ initiators: event.target.value })} rows={3} required /><small>{text("initiatorsHint")}</small></Field>
      </div>
      <Switch label={text("chap")} checked={form.chapEnabled} onCheckedChange={(chapEnabled) => update({ chapEnabled })} />
      {form.chapEnabled ? <div className="iscsi-form-grid"><Field className="iscsi-field" label={text("username")}><Input autoComplete="off" value={form.username} maxLength={128} onChange={(event) => update({ username: event.target.value })} required /></Field><Field className="iscsi-field" label={text("password")}><Input type="password" autoComplete="new-password" value={form.password} maxLength={16} minLength={12} onChange={(event) => update({ password: event.target.value })} required={!target?.credentialConfigured} /><small>{text(target?.credentialConfigured ? "keepPassword" : "passwordHint")}</small></Field></div> : null}
    </fieldset>
    {error ? <Notice className="iscsi-error" role="alert" tone="danger">{error}</Notice> : null}
    <footer className="iscsi-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{text("cancel")}</UiButton><UiButton variant="primary" type="submit" className="primary-button" disabled={busy || !summary.available} aria-busy={busy || undefined}>{busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : null}{text("save")}</UiButton></footer>
  </form>;
}

function TargetDetails({ target, summary, busy, locale, apply, onClose, onRefresh }: { target: IscsiTarget; summary: IscsiSummary; busy: boolean; locale: SupportedLocale; apply: Apply; onClose: () => void; onRefresh: () => void }) {
  const text = useIscsiText();
  const [view, setView] = useState<"details" | "edit" | "create" | "attach" | "delete">("details");
  const [removeImage, setRemoveImage] = useState<IscsiImage | null>(null);
  const locked = busy || !summary.available || target.sessions.length > 0;
  if (removeImage) return <RemovalForm name={removeImage.name} title={text("removeLun")} busy={busy} available={!locked} onCancel={() => setRemoveImage(null)} onConfirm={async (destroy, confirmation) => { if (await apply({ action: "detach_lun", targetId: target.id, imageId: removeImage.id, destroyImage: destroy, confirmation })) setRemoveImage(null); }} />;
  if (view === "edit") return <TargetForm target={target} summary={summary} busy={busy} onCancel={() => setView("details")} onSave={async (action) => { if (await apply(action)) setView("details"); }} />;
  if (view === "create") return <CreateLunForm targetId={target.id} summary={summary} busy={busy} locale={locale} onCancel={() => setView("details")} apply={async (action) => { const ok = await apply(action); if (ok) setView("details"); return ok; }} />;
  if (view === "attach") return <AttachForm targetId={target.id} summary={summary} busy={busy} onCancel={() => setView("details")} apply={async (action) => { const ok = await apply(action); if (ok) setView("details"); return ok; }} />;
  if (view === "delete") return <RemovalForm name={target.name} title={text("deleteTarget")} target busy={busy} available={!locked} onCancel={() => setView("details")} onConfirm={async (destroy, confirmation) => { if (await apply({ action: "delete_target", targetId: target.id, destroyImages: destroy, confirmation })) onClose(); }} />;
  return <div className="iscsi-detail">
    <dl className="iscsi-connection"><div><dt>{text("iqn")}</dt><dd><code>{target.iqn}</code></dd></div><div><dt>{text("address")}</dt><dd><code>{target.address.includes(":") ? `[${target.address}]:${target.port}` : `${target.address}:${target.port}`}</code></dd></div><div><dt>{text("chap")}</dt><dd>{text(target.chapEnabled ? "enabled" : "disabled")}</dd></div></dl>
    <div className="iscsi-actions"><Switch label={text("enabled")} checked={target.enabled} disabled={locked} onCheckedChange={(enabled) => void apply({ action: "set_target_enabled", targetId: target.id, enabled })} /><UiButton variant="secondary" type="button" className="secondary-button" disabled={locked} onClick={() => setView("edit")}>{text("editTarget")}</UiButton><UiButton variant="danger" type="button" className="danger-button" disabled={locked} onClick={() => setView("delete")}><Trash2 size={14} aria-hidden="true" />{text("deleteTarget")}</UiButton><UiButton variant="ghost" iconOnly type="button" className="icon-button" disabled={busy} onClick={onRefresh} aria-label={text("refresh")} data-tooltip={text("refresh")}><RefreshCw size={15} aria-hidden="true" /></UiButton></div>
    {target.sessions.length ? <p className="iscsi-warning"><CircleAlert size={16} aria-hidden="true" />{text("connectedWarning")}</p> : null}
    {target.error ? <Notice className="iscsi-error" role="alert" tone="danger">{target.error}</Notice> : null}
    <section><header className="iscsi-subheading"><h4>{text("luns")}</h4><div className="iscsi-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={locked} onClick={() => setView("create")}><Plus size={14} aria-hidden="true" />{text("addLun")}</UiButton><UiButton variant="secondary" type="button" className="secondary-button" disabled={locked || !summary.images.some((image) => image.attachedTargetId === null)} onClick={() => setView("attach")}>{text("attach")}</UiButton></div></header>
      {target.luns.length ? target.luns.map((lun) => { const image = summary.images.find((item) => item.id === lun.imageId); return <article className="iscsi-image-row" key={lun.imageId}><Database size={15} aria-hidden="true" /><div><strong>{image?.name ?? lun.imageId}</strong><small>LUN {lun.lun} · {image?.storagePoolId} · {image ? formatBytes(image.sizeBytes, locale) : "—"}</small></div><UiButton variant="secondary" type="button" className="secondary-button" disabled={locked || !image} onClick={() => image && setRemoveImage(image)}>{text("removeLun")}</UiButton></article>; }) : <EmptyState className="management-empty">{text("noLuns")}</EmptyState>}
    </section>
    <section><h4>{text("sessions")}</h4>{target.sessions.length ? <ul className="iscsi-session-list">{target.sessions.map((session, index) => <li key={`${session.initiator}-${index}`}><code>{session.initiator}</code><span>{session.address ?? "—"}</span></li>)}</ul> : <EmptyState className="management-empty">{text("noSessions")}</EmptyState>}</section>
    <section><h4>{text("initiators")}</h4><ul className="iscsi-session-list">{target.initiators.map((iqn) => <li key={iqn}><code>{iqn}</code></li>)}</ul></section>
  </div>;
}

function CreateLunForm({ targetId, summary, busy, locale, apply, onCancel }: { targetId: string; summary: IscsiSummary; busy: boolean; locale: SupportedLocale; apply: Apply; onCancel: () => void }) {
  const text = useIscsiText();
  const [name, setName] = useState("");
  const [poolId, setPoolId] = useState("");
  const [size, setSize] = useState("");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const pool = summary.pools.find((item) => item.id === poolId && item.ready);
    const sizeBytes = iscsiGiBToBytes(size);
    if (!name.trim() || name.trim().length > 64 || [...name].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127)) { setError(text("validation.name")); return; }
    if (!pool) { setError(text("validation.pool")); return; }
    if (sizeBytes === null || pool.availableBytes === null || sizeBytes > pool.availableBytes) { setError(text("validation.capacity")); return; }
    await apply({ action: "create_lun", targetId, name: name.trim(), storagePoolId: poolId, sizeBytes });
  }
  return <form className="iscsi-form" onSubmit={(event) => void submit(event)}><h4>{text("addLun")}</h4><fieldset disabled={busy}><div className="iscsi-form-grid"><Field className="iscsi-field" label={text("name")}><Input value={name} maxLength={64} onChange={(event) => setName(event.target.value)} required /></Field><Field className="iscsi-field" label={text("storagePool")}><CustomSelect value={poolId} onChange={(selectedValue) => setPoolId(selectedValue)} required ariaLabel={text("storagePool")} options={[{ value: "", label: text("selectPool") }, ...(summary.pools.filter((pool) => pool.ready && pool.availableBytes !== null).map((pool) => ({ value: pool.id, label: `${pool.name} · ${text("free", { size: formatBytes(pool.availableBytes ?? 0, locale) })}` })))]} /></Field><Field className="iscsi-field" label={text("size")}><Input inputMode="numeric" pattern="[1-9][0-9]*" value={size} onChange={(event) => setSize(event.target.value)} required /><small>{text("capacityHint")}</small></Field></div></fieldset><p className="iscsi-warning">{text("backupHint")}</p>{error ? <Notice className="iscsi-error" role="alert" tone="danger">{error}</Notice> : null}<footer className="iscsi-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{text("back")}</UiButton><UiButton variant="primary" type="submit" className="primary-button" disabled={busy || !summary.available} aria-busy={busy || undefined}>{busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : null}{text("addLun")}</UiButton></footer></form>;
}

function AttachForm({ targetId, imageId, summary, busy, apply, onCancel }: { targetId?: string; imageId?: string; summary: IscsiSummary; busy: boolean; apply: Apply; onCancel: () => void }) {
  const text = useIscsiText();
  const [selectedTarget, setTarget] = useState(targetId ?? "");
  const [selectedImage, setImage] = useState(imageId ?? "");
  const [error, setError] = useState<string | null>(null);
  async function submit(event: FormEvent) {
    event.preventDefault();
    const target = summary.targets.find((item) => item.id === selectedTarget);
    if (!target || target.sessions.length) { setError(text("validation.target")); return; }
    if (!summary.images.some((item) => item.id === selectedImage && item.attachedTargetId === null)) { setError(text("validation.image")); return; }
    await apply({ action: "attach_lun", targetId: selectedTarget, imageId: selectedImage });
  }
  return <form className="iscsi-form" onSubmit={(event) => void submit(event)}><h4>{text("attach")}</h4><fieldset disabled={busy}><div className="iscsi-form-grid">{!targetId ? <Field className="iscsi-field" label={text("targets")}><CustomSelect value={selectedTarget} onChange={(selectedValue) => setTarget(selectedValue)} required ariaLabel={text("targets")} options={[{ value: "", label: text("selectTarget") }, ...(summary.targets.filter((item) => item.sessions.length === 0).map((item) => ({ value: item.id, label: item.name })))]} /></Field> : null}{!imageId ? <Field className="iscsi-field" label={text("retained")}><CustomSelect value={selectedImage} onChange={(selectedValue) => setImage(selectedValue)} required ariaLabel={text("retained")} options={[{ value: "", label: text("selectImage") }, ...(summary.images.filter((item) => item.attachedTargetId === null).map((item) => ({ value: item.id, label: `${item.name} · ${item.storagePoolId}` })))]} /></Field> : null}</div></fieldset>{error ? <Notice className="iscsi-error" role="alert" tone="danger">{error}</Notice> : null}<footer className="iscsi-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{text("back")}</UiButton><UiButton variant="primary" type="submit" className="primary-button" disabled={busy || !summary.available}>{text("attach")}</UiButton></footer></form>;
}

function RemovalForm({ name, title, target = false, destroyOnly = false, busy, available, onConfirm, onCancel }: { name: string; title: string; target?: boolean; destroyOnly?: boolean; busy: boolean; available: boolean; onConfirm: (destroy: boolean, confirmation: string) => void | Promise<void>; onCancel: () => void }) {
  const text = useIscsiText();
  const [destroy, setDestroy] = useState(destroyOnly);
  const [confirmation, setConfirmation] = useState("");
  return <form className="iscsi-form" onSubmit={(event) => { event.preventDefault(); if (confirmation.trim() === name) void onConfirm(destroy, confirmation.trim()); }}><h4>{title}</h4><p>{text(destroy ? "destroyWarning" : "keepImages")}</p><fieldset disabled={busy || !available}>{!destroyOnly ? <label className="iscsi-confirmation"><Checkbox  checked={destroy} onChange={(event) => setDestroy(event.target.checked)} />{text(target ? "destroyAll" : "destroyAlso")}</label> : null}<Field className="iscsi-field" label={text("confirmName", { name })}><Input autoComplete="off" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} required /></Field></fieldset><footer className="iscsi-actions"><UiButton variant="secondary" type="button" className="secondary-button" disabled={busy} onClick={onCancel}>{text("back")}</UiButton><UiButton variant="danger" type="submit" className="danger-button" disabled={busy || !available || confirmation.trim() !== name} aria-busy={busy || undefined}>{busy ? <LoaderCircle className="is-spinning" size={15} aria-hidden="true" /> : <Trash2 size={15} aria-hidden="true" />}{text("confirm")}</UiButton></footer></form>;
}

function RetainedImageDetails({ image, summary, busy, locale, apply, onClose }: { image: IscsiImage; summary: IscsiSummary; busy: boolean; locale: SupportedLocale; apply: Apply; onClose: () => void }) {
  const text = useIscsiText();
  const [destroy, setDestroy] = useState(false);
  if (destroy) return <RemovalForm name={image.name} title={text("destroyImage")} destroyOnly busy={busy} available={summary.available} onCancel={() => setDestroy(false)} onConfirm={async (_destroy, confirmation) => { if (await apply({ action: "destroy_image", imageId: image.id, confirmation })) onClose(); }} />;
  return <><dl className="iscsi-connection"><div><dt>{text("storagePool")}</dt><dd>{image.storagePoolId}</dd></div><div><dt>{text("size")}</dt><dd>{formatBytes(image.sizeBytes, locale)}</dd></div></dl><AttachForm imageId={image.id} summary={summary} busy={busy} onCancel={onClose} apply={async (action) => { const ok = await apply(action); if (ok) onClose(); return ok; }} /><div className="iscsi-actions"><UiButton variant="danger" type="button" className="danger-button" disabled={busy || !summary.available} onClick={() => setDestroy(true)}><Trash2 size={15} aria-hidden="true" />{text("destroyImage")}</UiButton></div></>;
}
