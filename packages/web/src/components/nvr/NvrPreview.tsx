import { useEffect, useRef } from "react";

/** JPEG frames use WebSocket so four cameras cannot exhaust HTTP/1 sockets. */
export function NvrPreview({ deviceId, name, attempt, onErrorChange }: {
  deviceId: string; name: string; attempt: number; onErrorChange: (failed: boolean) => void;
}) {
  const image = useRef<HTMLImageElement>(null);
  useEffect(() => {
    const node = image.current;
    if (!node) return;
    const url = new URL(`/api/nvr/devices/${encodeURIComponent(deviceId)}/preview-socket`, location.href);
    url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const socket = new WebSocket(url);
    let disposed = false; let loading = false; let queued: Blob | null = null;
    let current: string | null = null; let retired: string | null = null;
    const show = (frame: Blob) => {
      if (loading) { queued = frame; return; }
      loading = true; retired = current;
      current = URL.createObjectURL(new Blob([frame], { type: "image/jpeg" }));
      node.src = current;
    };
    const complete = (failed: boolean) => {
      if (disposed) return;
      if (retired) URL.revokeObjectURL(retired);
      retired = null; loading = false; onErrorChange(failed);
      if (queued) { const frame = queued; queued = null; show(frame); }
    };
    const loaded = () => complete(false); const failed = () => complete(true);
    node.addEventListener("load", loaded); node.addEventListener("error", failed);
    socket.onmessage = (event: MessageEvent<unknown>) => {
      if (!disposed && event.data instanceof Blob && event.data.size <= 8 * 1024 * 1024) show(event.data);
      else if (!disposed) { onErrorChange(true); socket.close(); }
    };
    socket.onerror = socket.onclose = () => { if (!disposed) onErrorChange(true); };
    return () => {
      disposed = true; socket.close(); node.removeAttribute("src");
      node.removeEventListener("load", loaded); node.removeEventListener("error", failed);
      if (current) URL.revokeObjectURL(current);
      if (retired) URL.revokeObjectURL(retired);
    };
  }, [deviceId, attempt, onErrorChange]);
  return <img ref={image} alt={name} />;
}
