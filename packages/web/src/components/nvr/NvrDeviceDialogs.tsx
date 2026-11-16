import { Button, DialogActions, DialogHeader, Field, Input, Notice } from "@cyberos/ui";
import type { NvrDevice, NvrDiscovery } from "@cyberos/shared";
import { Plus, Search, Trash2, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal.js";
import { useModalDialog } from "../workspace/useModalDialog.js";
import { nvrRequest } from "./api.js";

export function NvrAddDialog({ full, onClose, onAdded }: { full: boolean; onClose: () => void; onAdded: () => Promise<void> }) {
  const { t } = useTranslation();
  const titleId = useId();
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [discovering, setDiscovering] = useState(false);
  const [discovered, setDiscovered] = useState<NvrDiscovery[] | null>(null);
  const [discoveryError, setDiscoveryError] = useState("");
  const discovery = useRef<AbortController | null>(null);
  const submitting = useRef(false);
  const active = useRef(true);
  const dialogRef = useModalDialog(onClose, busy);
  useEffect(() => { active.current = true; return () => { active.current = false; discovery.current?.abort(); }; }, []);
  const scan = async () => {
    if (discovery.current || busy) return;
    const controller = new AbortController(); discovery.current = controller;
    setDiscovering(true); setDiscoveryError("");
    try {
      const results = await nvrRequest<NvrDiscovery[]>("/discover", "POST", undefined, controller.signal);
      if (!controller.signal.aborted) setDiscovered(results);
    } catch (cause) { if (!controller.signal.aborted) setDiscoveryError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { if (!controller.signal.aborted) { setDiscovering(false); discovery.current = null; } }
  };
  const add = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || full) return;
    submitting.current = true; setBusy(true); setError("");
    try {
      await nvrRequest("/devices", "POST", { name: name.trim(), onvifUrl: address.trim(), username, password });
      if (active.current) { setPassword(""); await onAdded(); }
    } catch (cause) { if (active.current) setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { submitting.current = false; if (active.current) setBusy(false); }
  };
  return <ModalPortal className="management-modal-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="management-modal nvr-form-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <DialogHeader title={t("nvr.add")} description={t("nvr.management.addHint")} headingId={titleId} icon={<Plus size={20} />} actions={<Button variant="ghost" iconOnly disabled={busy} aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")} onClick={onClose}><X size={18} /></Button>} />
      <form className="nvr-dialog-form" onSubmit={(event) => { void add(event); }} autoComplete="off">
        <div className="dialog-body nvr-form-body">
          {error ? <Notice tone="danger" role="alert">{error}</Notice> : null}
          {full ? <Notice tone="warning">{t("nvr.management.limit")}</Notice> : null}
          <fieldset className="nvr-form" disabled={busy}>
            <Field label={t("nvr.name")}><Input value={name} required maxLength={64} onChange={(event) => setName(event.target.value)} /></Field>
            <Field label={t("nvr.address")}><Input type="url" value={address} required placeholder="http://camera:8000/onvif/device_service" onChange={(event) => setAddress(event.target.value)} /></Field>
            <Field label={t("nvr.username")}><Input value={username} required maxLength={256} autoComplete="off" onChange={(event) => setUsername(event.target.value)} /></Field>
            <Field label={t("nvr.password")}><Input type="password" value={password} required maxLength={4096} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} /></Field>
          </fieldset>
          <div className="nvr-discovery-tools"><Button type="button" variant="secondary" disabled={busy || discovering} aria-busy={discovering} onClick={() => { void scan(); }}><Search size={16} aria-hidden="true" />{t(discovering ? "nvr.discovering" : "nvr.discover")}</Button></div>
          {discoveryError ? <Notice tone="danger" role="alert">{discoveryError}</Notice> : null}
          {discovered?.length === 0 ? <p className="metadata">{t("nvr.management.discoveryEmpty")}</p> : null}
          {discovered?.length ? <ul className="nvr-discovery">{discovered.map((item) => <li key={item.id}><Button type="button" variant="plain" disabled={busy} onClick={() => setAddress(item.onvifUrl)}>{item.onvifUrl}</Button></li>)}</ul> : null}
        </div>
        <DialogActions><Button type="button" variant="secondary" disabled={busy} onClick={onClose}>{t("nvr.cancel")}</Button><Button type="submit" variant="primary" disabled={busy || full} aria-busy={busy}>{t("nvr.connect")}</Button></DialogActions>
      </form>
    </section>
  </ModalPortal>;
}

export function NvrRemoveDialog({ device, onClose, onRemoved }: { device: NvrDevice; onClose: () => void; onRemoved: () => Promise<void> }) {
  const { t } = useTranslation();
  const titleId = useId();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const submitting = useRef(false);
  const dialogRef = useModalDialog(onClose, busy);
  const remove = async () => {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { await nvrRequest(`/devices/${device.id}`, "DELETE"); await onRemoved(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <ModalPortal className="management-modal-backdrop" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="management-modal nvr-form-dialog nvr-remove-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <DialogHeader title={t("nvr.remove")} description={device.name} headingId={titleId} icon={<Trash2 size={20} />} />
      <div className="dialog-body nvr-form-body"><p>{t("nvr.removeHint")}</p>{error ? <Notice tone="danger" role="alert">{error}</Notice> : null}</div>
      <DialogActions><Button variant="secondary" disabled={busy} onClick={onClose}>{t("nvr.cancel")}</Button><Button variant="danger" disabled={busy} aria-busy={busy} onClick={() => { void remove(); }}>{t("nvr.confirmRemove")}</Button></DialogActions>
    </section>
  </ModalPortal>;
}
