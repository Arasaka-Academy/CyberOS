import { Button, DialogActions, DialogHeader, Notice, ThemePicker, useAppearance } from "@cyberos/ui";
import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendVodPlayerCommand } from "../api.js";
import { ModalPortal } from "../components/common/ModalPortal.js";
import { useModalDialog } from "../components/workspace/useModalDialog.js";
import { createTrailingSingleFlight } from "../lib/trailing-single-flight.js";

export function useNativeAppearance(serviceInstanceId: string | undefined) {
  const preference = useAppearance();
  const latest = useRef(preference);
  latest.current = preference;
  const [error, setError] = useState(false);
  const mounted = useRef(true);
  const sync = useRef(createTrailingSingleFlight(async () => {
    try {
      await sendVodPlayerCommand({ type: "set-ui-theme", ...latest.current });
      if (mounted.current) setError(false);
    } catch { if (mounted.current) setError(true); }
  }));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => { void sync.current.request(); }, [preference, serviceInstanceId]);
  useEffect(() => {
    const retry = () => { void sync.current.request(); };
    window.addEventListener("online", retry);
    return () => window.removeEventListener("online", retry);
  }, []);
  return { error, retry: () => { void sync.current.request(); } };
}

export function AppearanceDialog({ onClose, error, onRetry }: { onClose: () => void; error: boolean; onRetry: () => void }) {
  const { t } = useTranslation();
  const dialog = useModalDialog(onClose);
  return <ModalPortal className="tv-theme-backdrop" onRequestClose={onClose}>
    <section ref={dialog} role="dialog" aria-modal="true" aria-labelledby="tv-appearance-title" className="tv-theme-dialog" tabIndex={-1}>
      <DialogHeader title={t("settings.appearance.title")} headingId="tv-appearance-title" />
      <ThemePicker />
      {error ? <Notice tone="warning" actions={<Button variant="secondary" onClick={onRetry}>{t("common.actions.retry")}</Button>}>{t("settings.appearance.nativeSyncFailed")}</Notice> : null}
      <DialogActions><Button variant="secondary" onClick={onClose}>{t("common.actions.done")}</Button></DialogActions>
    </section>
  </ModalPortal>;
}
