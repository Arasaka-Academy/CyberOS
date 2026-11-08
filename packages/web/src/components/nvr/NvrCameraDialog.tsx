import { Button, DialogHeader } from "@cyberos/ui";
import type { NvrDevice } from "@cyberos/shared";
import { Video, X } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { ModalPortal } from "../common/ModalPortal.js";
import { useModalDialog } from "../workspace/useModalDialog.js";
import { NvrDeviceState } from "./NvrLive.js";
import { NvrPreview } from "./NvrPreview.js";
import { NvrPtz } from "./NvrPtz.js";
import { NvrVideo } from "./NvrVideo.js";

export function NvrCameraDialog({ device, onClose, onFault }: { device: NvrDevice; onClose: () => void; onFault: (message: string) => void }) {
  const { t } = useTranslation();
  const titleId = useId();
  const dialogRef = useModalDialog(onClose);
  const [raw, setRaw] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  return <ModalPortal className="management-modal-backdrop nvr-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section ref={dialogRef} className="management-modal nvr-camera-dialog" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
      <DialogHeader title={device.name} icon={<Video size={20} aria-hidden="true" />} headingId={titleId} actions={<Button variant="ghost" iconOnly aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")} onClick={onClose}><X size={18} aria-hidden="true" /></Button>} />
      <div className="dialog-body nvr-camera-dialog-body">
        <div className="nvr-camera-view">
          <div className="nvr-stream-switch" role="group" aria-label={t("nvr.previewStream")}>
            {([false, true] as const).map((original) => <Button key={String(original)} variant={raw === original ? "secondary" : "plain"} aria-pressed={raw === original} onClick={() => { setRaw(original); setVideoError(false); }}>{t(original ? "nvr.raw" : "nvr.annotated")}</Button>)}
          </div>
          {raw ? <NvrVideo deviceId={device.id} /> : <div className="nvr-preview"><NvrPreview deviceId={device.id} name={device.name} attempt={attempt} onErrorChange={setVideoError} />{videoError ? <span role="alert">{t("nvr.videoUnavailable")} <Button variant="secondary" onClick={() => { setVideoError(false); setAttempt(attempt + 1); }}>{t("nvr.retry")}</Button></span> : null}</div>}
          <NvrDeviceState device={device} videoError={videoError} />
          {device.lastError ? <p className="nvr-device-error">{device.lastError}</p> : null}
        </div>
        <NvrPtz deviceId={device.id} onFault={onFault} />
      </div>
    </section>
  </ModalPortal>;
}
