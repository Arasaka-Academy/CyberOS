import { Button, EmptyState, Notice, StatusBadge } from "@cyberos/ui";
import { Camera, Plus, Trash2 } from "lucide-react";
import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrOverview } from "@cyberos/shared";
import { CustomSelect } from "../common/CustomSelect.js";
import { nvrRequest } from "./api.js";
import { NvrConnectionBadge } from "./NvrLive.js";
import { NvrAddDialog, NvrRemoveDialog } from "./NvrDeviceDialogs.js";
import { statusState, statusText } from "./labels.js";

export function NvrDevices({ overview, refresh, onOpen }: {
  overview: NvrOverview; refresh: () => Promise<void>; onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState("");
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const pending = useRef(new Set<string>());
  const devices = overview.devices.filter(device => !device.removedAt);
  const removedDevice = devices.find(device => device.id === removing);
  const update = async (id: string, body: { recordingEnabled?: boolean; recordingProfile?: string }) => {
    if (pending.current.has(id)) return;
    pending.current.add(id); setBusy(new Set(pending.current)); setErrors(value => ({ ...value, [id]: "" }));
    try { await nvrRequest(`/devices/${id}`, "PATCH", body); await refresh(); }
    catch (cause) { setErrors(value => ({ ...value, [id]: cause instanceof Error ? cause.message : t("nvr.serviceUnavailable") })); }
    finally { pending.current.delete(id); setBusy(new Set(pending.current)); }
  };
  return <div className="nvr-devices">
    <div className="nvr-management-toolbar"><div><h3>{t("nvr.devices")}</h3><span className="metadata">{t("nvr.deviceCount", { count: devices.length })}</span></div>
      <Button variant="primary" disabled={devices.length >= 4} aria-haspopup="dialog" onClick={() => setAdding(true)}><Plus size={16} aria-hidden="true" />{t("nvr.add")}</Button>
    </div>
    {!overview.policy.storagePoolId ? <Notice tone="warning">{t("nvr.recordingHint")}</Notice> : null}
    {!devices.length ? <EmptyState icon={<Camera />} title={t("nvr.empty")} description={t("nvr.emptyHint")} /> : <div className="nvr-table-wrap" role="region" aria-label={t("nvr.devices")} tabIndex={0}>
      <table className="nvr-table nvr-device-table" aria-label={t("nvr.devices")}><thead><tr><th scope="col">{t("nvr.camera")}</th><th scope="col">{t("nvr.deviceStatus")}</th><th scope="col">{t("nvr.recording")}</th><th scope="col">{t("nvr.management.capabilities")}</th><th scope="col">{t("nvr.management.actions")}</th></tr></thead>
        <tbody>{devices.map(device => <tr key={device.id} data-device-id={device.id}>
          <td><Button className="nvr-device-name" variant="plain" onClick={() => onOpen(device.id)} data-tooltip={device.name}><Camera size={16} aria-hidden="true" /><span>{device.name}</span></Button><span className="nvr-device-address" data-tooltip={device.onvifUrl}>{device.onvifUrl}</span></td>
          <td><div className="nvr-cell-stack"><NvrConnectionBadge connection={device.connection} /><span className="metadata">{t("nvr.video")} · {statusText(t, device.video)}</span></div></td>
          <td><div className="nvr-cell-stack"><StatusBadge state={statusState(device.recording)}>{statusText(t, device.recording)}</StatusBadge><CustomSelect ariaLabel={`${device.name} · ${t("nvr.profile")}`} value={device.recordingProfile} disabled={busy.has(device.id)} onChange={(recordingProfile) => { void update(device.id, { recordingProfile }); }} options={device.profiles.map(profile => ({ value: profile.token, label: t(profile.token === "raw" ? "nvr.raw" : "nvr.annotated") }))} /></div></td>
          <td><div className="nvr-cell-stack"><span className="metadata">{t("nvr.analytics")} · {t(device.analytics === null ? "nvr.unknown" : device.analytics ? "nvr.status.available" : "nvr.status.unavailable")}</span><span className="metadata">{t("nvr.ptz")} · {statusText(t, device.ptz)}</span></div></td>
          <td><div className="nvr-row-actions"><Button variant="secondary" disabled={busy.has(device.id) || !device.recordingEnabled && !overview.policy.storagePoolId} aria-busy={busy.has(device.id)} onClick={() => { void update(device.id, { recordingEnabled: !device.recordingEnabled }); }}>{t(device.recordingEnabled ? "nvr.stopRecording" : "nvr.startRecording")}</Button><Button variant="plain" iconOnly disabled={busy.has(device.id)} aria-label={`${t("nvr.remove")} · ${device.name}`} data-tooltip={t("nvr.remove")} onClick={() => setRemoving(device.id)}><Trash2 size={16} aria-hidden="true" /></Button></div>{errors[device.id] ? <Notice tone="danger" role="alert">{errors[device.id]}</Notice> : null}</td>
        </tr>)}</tbody>
      </table>
    </div>}
    {adding ? <NvrAddDialog full={devices.length >= 4} onClose={() => setAdding(false)} onAdded={async () => { await refresh(); setAdding(false); }} /> : null}
    {removedDevice ? <NvrRemoveDialog device={removedDevice} onClose={() => setRemoving("")} onRemoved={async () => { await refresh(); setRemoving(""); }} /> : null}
  </div>;
}
