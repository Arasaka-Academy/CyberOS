import { Button, DescriptionList, DialogHeader, Section } from "@cyberos/ui";
import type { NvrDevice } from "@cyberos/shared";
import { Activity, ChevronDown, Video, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal.js";
import { useModalDialog } from "../workspace/useModalDialog.js";
import { NvrConnectionBadge, NvrDeviceState } from "./NvrLive.js";
import { NvrCameraMedia } from "./NvrCameraMedia.js";
import type { NvrMediaState } from "./NvrMedia.js";
import { NvrPtz } from "./NvrPtz.js";

export function NvrCameraDialog({ device, onClose, onFault, onRefresh }: {
  device: NvrDevice; onClose: () => void; onFault: (message: string) => void; onRefresh: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);
  const [raw, setRaw] = useState(false);
  const [mediaState, setMediaState] = useState<NvrMediaState>("loading");
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const retry = async () => {
    if (retrying) return;
    dialogRef.current?.querySelector<HTMLButtonElement>('.nvr-stream-switch [aria-pressed="true"]')?.focus();
    setRetrying(true);
    try { await onRefresh(); setAttempt((value) => value + 1); }
    finally { setRetrying(false); }
  };
  return <ModalPortal className="management-modal-backdrop nvr-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="management-modal nvr-camera-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <DialogHeader title={device.name} icon={<Video size={20} aria-hidden="true" />} headingId={titleId} actions={<><NvrConnectionBadge connection={device.connection} /><Button variant="ghost" iconOnly aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")} onClick={onClose}><X size={18} aria-hidden="true" /></Button></>} />
      <div className="dialog-body nvr-camera-dialog-body">
        <div className="nvr-camera-view">
          <div className="nvr-stream-switch" role="group" aria-label={t("nvr.previewStream")}>
            {([false, true] as const).map((original) => <Button key={String(original)} size="compact" variant={raw === original ? "secondary" : "plain"} aria-pressed={raw === original} onClick={() => setRaw(original)}>{t(original ? "nvr.raw" : "nvr.annotated")}</Button>)}
          </div>
          <NvrCameraMedia key={`${device.id}:${device.connection}:${raw}:${attempt}`} device={device} raw={raw} onStateChange={setMediaState} onRetry={() => { void retry(); }} retrying={retrying} />
        </div>
        <div className="nvr-camera-inspector">
          <Section className="nvr-camera-status" title={t("nvr.deviceStatus")} icon={<Activity size={18} aria-hidden="true" />}>
            <NvrDeviceState device={device} mediaState={mediaState} />
          </Section>
          <NvrPtz deviceId={device.id} connected={device.connection !== "disconnected"} onFault={onFault} />
          <details className="nvr-diagnostics">
            <summary tabIndex={0}>{t("nvr.diagnostics")}<ChevronDown size={15} aria-hidden="true" /></summary>
            <DescriptionList items={[
              { label: t("nvr.address"), value: device.onvifUrl, mono: true },
              ...(device.lastError ? [{ label: t("nvr.lastError"), value: device.lastError, mono: true }] : [])
            ]} />
          </details>
        </div>
      </div>
    </section>
  </ModalPortal>;
}
