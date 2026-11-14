import { Button, EmptyState } from "@cyberos/ui";
import { CameraOff, LoaderCircle, Pause, RefreshCw, VideoOff } from "lucide-react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";

export type NvrPreviewState = "loading" | "available" | "unavailable";
export type NvrMediaState = NvrPreviewState | "offline" | "paused";

export function NvrMedia({ state, className, children, message, onRetry, retrying = false }: {
  state: NvrMediaState; className: string; children?: ReactNode; message?: string;
  onRetry?: (() => void) | undefined; retrying?: boolean;
}) {
  const { t } = useTranslation();
  const Icon = state === "offline" ? CameraOff : state === "paused" ? Pause : state === "loading" ? LoaderCircle : VideoOff;
  return <div className={`nvr-media-frame ${className}`} data-state={state} aria-busy={state === "loading" || retrying}>
    {children}
    {state !== "available" ? <EmptyState className="nvr-media-state"
      icon={<Icon size={28} className={state === "loading" ? "is-spinning" : undefined} aria-hidden="true" />}
      title={t(`nvr.media.${state}`)} description={message || t(`nvr.media.${state}Hint`)}
      actions={onRetry && (state === "offline" || state === "unavailable") ? <Button variant="secondary" disabled={retrying} aria-busy={retrying} onClick={onRetry}><RefreshCw size={14} aria-hidden="true" />{t("nvr.retry")}</Button> : undefined} /> : null}
  </div>;
}
