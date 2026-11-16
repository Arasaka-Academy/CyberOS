import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { nvrRequest } from "./api.js";
import { dayRange } from "./history.js";

export function useNvrHistory<Value>(route: "segments" | "events", deviceId: string, date: string, refreshToken: number) {
  const { t } = useTranslation();
  const key = `${route}:${deviceId}:${date}`;
  const [result, setResult] = useState<{ key: string; items: Value[]; loading: boolean; loaded: boolean; error: string }>({ key: "", items: [], loading: false, loaded: false, error: "" });
  const reload = useRef<() => void>(() => undefined);
  useEffect(() => {
    if (!deviceId) { reload.current = () => undefined; return; }
    const controller = new AbortController();
    let pending = false;
    const load = async () => {
      if (pending || controller.signal.aborted) return;
      pending = true;
      setResult(previous => ({ key, items: previous.key === key ? previous.items : [], loading: true, loaded: previous.key === key && previous.loaded, error: previous.key === key ? previous.error : "" }));
      try {
        const query = new URLSearchParams({ deviceId, ...dayRange(date) });
        const items = await nvrRequest<Value[]>(`/${route}?${query}`, "GET", undefined, controller.signal);
        if (!controller.signal.aborted) setResult({ key, items, loading: false, loaded: true, error: "" });
      } catch (cause) {
        if (!controller.signal.aborted) setResult(previous => ({ ...previous, loading: false, error: cause instanceof Error ? cause.message : t("nvr.serviceUnavailable") }));
      } finally { pending = false; }
    };
    reload.current = () => { void load(); };
    void load();
    const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { controller.abort(); clearInterval(timer); };
  }, [route, deviceId, date, key, t]);
  useEffect(() => { reload.current(); }, [refreshToken]);
  return { ...(result.key === key ? result : { items: [], loading: Boolean(deviceId), loaded: !deviceId, error: "" }), retry: () => reload.current() };
}
