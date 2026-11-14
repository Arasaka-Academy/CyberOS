import { useEffect, useRef, useState } from "react";
import type { NvrPreviewState } from "./NvrMedia.js";

/** JPEG frames use WebSocket so four cameras cannot exhaust HTTP/1 sockets. */
export function NvrPreview({ deviceId, name, onStateChange }: {
  deviceId: string; name: string; onStateChange: (state: NvrPreviewState) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  const [state, setState] = useState<NvrPreviewState>("loading");
  useEffect(() => {
    const node = image.current;
    if (!node) return;
    const url = new URL(`/api/nvr/devices/${encodeURIComponent(deviceId)}/preview-socket`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    let disposed = false; let failed = false; let loading = false; let queued: Blob | null = null;
    let current: string | null = null; let retired: string | null = null;
    let timeout: ReturnType<typeof setTimeout>;
    const update = (value: NvrPreviewState) => { setState(value); onStateChange(value); };
    const fail = () => {
      if (disposed || failed) return;
      failed = true; queued = null; clearTimeout(timeout); node.hidden = true;
      update("unavailable"); socket.close();
    };
    const deadline = () => { clearTimeout(timeout); timeout = setTimeout(fail, 15000); };
    update("loading"); deadline();
    const show = (frame: Blob) => {
      if (loading) { queued = frame; return; }
      loading = true; retired = current;
      current = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
      node.src = current;
    };
    const complete = () => {
      if (disposed || failed) return;
      if (retired) URL.revokeObjectURL(retired);
      retired = null; loading = false; update("available"); deadline();
      if (queued) { const frame = queued; queued = null; show(frame); }
    };
    node.addEventListener("load", complete); node.addEventListener("error", fail);
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (disposed || failed) return;
      if (event.data instanceof Blob && event.data.size > 0 && event.data.size <= 8 * 1024 * 1024) show(event.data);
      else fail();
    };
    socket.onerror = socket.onclose = fail;
    return () => {
      disposed = true; clearTimeout(timeout); socket.close(); node.removeAttribute("src");
      node.removeEventListener("load", complete); node.removeEventListener("error", fail);
      if (current) URL.revokeObjectURL(current);
      if (retired) URL.revokeObjectURL(retired);
    };
  }, [deviceId, onStateChange]);
  return <img ref={image} alt={name} hidden={state !== "available"} />;
}
