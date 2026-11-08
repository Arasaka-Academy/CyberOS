import { Button, Field, Input, Notice, Section } from "@cyberos/ui";
import { Camera, HardDrive, Plus } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useTranslation } from "react-i18next";
import type { NvrDiscovery, NvrOverview, RecordingPolicy } from "@cyberos/shared";
import type { StoragePool } from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { nvrRequest } from "./api.js";
import { NvrDeviceState } from "./NvrLive.js";

export function NvrDevices({ overview, storagePools, refresh }: { overview: NvrOverview; storagePools: StoragePool[]; refresh: () => Promise<void> }) {
  const { t } = useTranslation(); const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [discovered, setDiscovered] = useState<NvrDiscovery[]>([]);
  const [policy, setPolicy] = useState<RecordingPolicy>(overview.policy); const [address, setAddress] = useState(""); const [name, setName] = useState(""); const [username, setUsername] = useState(""); const [password, setPassword] = useState(""); const [removing, setRemoving] = useState("");
  const run = async (work: () => Promise<unknown>) => { setBusy(true); setError(""); try { await work(); await refresh(); } catch (cause) { setError(cause instanceof Error ? cause.message : t("nvr.serviceUnavailable")); } finally { setBusy(false); } };
  const add = (event: FormEvent) => { event.preventDefault(); void run(async () => { try { await nvrRequest("/devices", "POST", { name, onvifUrl: address, username, password }); setAddress(""); setName(""); } finally { setPassword(""); } }); };
  return <div className="nvr-devices">
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <Section className="nvr-card" title={t("nvr.storage")} description={t("nvr.recordingHint")} icon={<HardDrive size={18} aria-hidden="true" />}>
      <form className="nvr-form" onSubmit={(event) => { event.preventDefault(); void run(() => nvrRequest("/policy", "PUT", policy)); }}>
        <Field label={t("nvr.pool")}><CustomSelect value={policy.storagePoolId ?? ""} onChange={(value) => setPolicy({ ...policy, storagePoolId: value || null })} required options={[{ value: "", label: t("nvr.selectPool"), disabled: true }, ...storagePools.map((p) => ({ value: p.id, label: p.name, disabled: p.status !== "ready" }))]} /></Field>
        <Field label={t("nvr.directory")}><Input value={policy.directory} required maxLength={2048} onChange={(event) => setPolicy({ ...policy, directory: event.target.value })} /></Field>
        <Field label={t("nvr.retention")}><Input type="number" min={1} max={3650} step={1} required value={policy.retentionDays} onChange={(event) => setPolicy({ ...policy, retentionDays: Number(event.target.value) })} /></Field>
        <Field label={t("nvr.quota")}><Input type="number" min={1} max={8388607} step={1} required value={policy.quotaBytes / 2 ** 30} onChange={(event) => setPolicy({ ...policy, quotaBytes: Number(event.target.value) * 2 ** 30 })} /></Field>
        <Button type="submit" variant="primary" disabled={busy} aria-busy={busy}>{t("nvr.save")}</Button>
      </form><p className="metadata">{t("nvr.policyHint")}</p>
    </Section>
    <div className="nvr-card-grid" aria-label={t("nvr.devices")}>
      {overview.devices.filter((d) => !d.removedAt).map((device) => <article className="nvr-card nvr-device-row" key={device.id}><header className="nvr-card-header"><Camera size={17} aria-hidden="true" /><h3>{device.name}</h3></header><p className="metadata">{device.onvifUrl}</p><NvrDeviceState device={device} />{device.lastError ? <Notice tone="warning">{device.lastError}</Notice> : null}
        <div className="nvr-actions"><CustomSelect ariaLabel={`${device.name} · ${t("nvr.profile")}`} value={device.recordingProfile} onChange={(recordingProfile) => { void run(() => nvrRequest(`/devices/${device.id}`, "PATCH", { recordingProfile })); }} disabled={busy} options={device.profiles.map((p) => ({ value: p.token, label: t(p.token === "raw" ? "nvr.raw" : "nvr.annotated") }))} />
          <Button variant={device.recordingEnabled ? "secondary" : "primary"} disabled={busy || !device.recordingEnabled && !overview.policy.storagePoolId} onClick={() => { void run(() => nvrRequest(`/devices/${device.id}`, "PATCH", { recordingEnabled: !device.recordingEnabled })); }}>{t(device.recordingEnabled ? "nvr.stopRecording" : "nvr.startRecording")}</Button>
          <Button variant="plain" disabled={busy} onClick={() => setRemoving(device.id)}>{t("nvr.remove")}</Button></div>
        {removing === device.id ? <Notice tone="warning" actions={<><Button variant="danger" disabled={busy} onClick={() => { void run(async () => { await nvrRequest(`/devices/${device.id}`, "DELETE"); setRemoving(""); }); }}>{t("nvr.confirmRemove")}</Button><Button variant="secondary" onClick={() => setRemoving("")}>{t("nvr.cancel")}</Button></>}>{t("nvr.removeHint")}</Notice> : null}
      </article>)}
    </div>
    <Section className="nvr-card" title={t("nvr.add")} icon={<Plus size={18} aria-hidden="true" />} actions={<Button variant="secondary" disabled={busy} onClick={() => { void run(async () => setDiscovered(await nvrRequest<NvrDiscovery[]>("/discover", "POST"))); }}>{t("nvr.discover")}</Button>}>
      {discovered.length ? <ul className="nvr-discovery">{discovered.map((item) => <li key={item.id}><Button variant="plain" onClick={() => setAddress(item.onvifUrl)}>{item.onvifUrl}</Button></li>)}</ul> : null}
      <form className="nvr-form" onSubmit={add} autoComplete="off">
        <Field label={t("nvr.name")}><Input value={name} required maxLength={64} onChange={(event) => setName(event.target.value)} /></Field>
        <Field label={t("nvr.address")}><Input type="url" value={address} required placeholder="http://camera:8000/onvif/device_service" onChange={(event) => setAddress(event.target.value)} /></Field>
        <Field label={t("nvr.username")}><Input value={username} required maxLength={256} autoComplete="off" onChange={(event) => setUsername(event.target.value)} /></Field>
        <Field label={t("nvr.password")}><Input type="password" value={password} required maxLength={4096} autoComplete="new-password" onChange={(event) => setPassword(event.target.value)} /></Field>
        <Button type="submit" variant="primary" disabled={busy || overview.devices.filter((d) => !d.removedAt).length >= 4} aria-busy={busy}>{t("nvr.connect")}</Button>
      </form>
    </Section>
  </div>;
}
