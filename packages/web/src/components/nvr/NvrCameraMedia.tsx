import type { NvrDevice } from "@cyberos/shared";
import { useEffect, useState } from "react";
import { NvrMedia, type NvrMediaState, type NvrPreviewState } from "./NvrMedia.js";
import { NvrPreview } from "./NvrPreview.js";
import { NvrVideo } from "./NvrVideo.js";

export function NvrCameraMedia({ device, paused = false, raw = false, onStateChange, onRetry, retrying = false }: {
  device: NvrDevice; paused?: boolean; raw?: boolean; onStateChange?: (state: NvrMediaState) => void;
  onRetry?: () => void; retrying?: boolean;
}) {
  const [previewState, setPreviewState] = useState<NvrPreviewState>("loading");
  const state = device.connection === "disconnected" ? "offline" : paused ? "paused" : previewState;
  useEffect(() => { onStateChange?.(state); }, [state, onStateChange]);
  if (raw && state !== "offline" && state !== "paused") {
    return <NvrVideo deviceId={device.id} onStateChange={setPreviewState} onRetry={onRetry} retrying={retrying} />;
  }
  return <NvrMedia className="nvr-preview" state={state} onRetry={onRetry} retrying={retrying}>
    {state !== "offline" && state !== "paused" ? <NvrPreview deviceId={device.id} name={device.name} onStateChange={setPreviewState} /> : null}
  </NvrMedia>;
}
