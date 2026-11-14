import { Button, EmptyState, Field, Input, Notice, Section } from "@cyberos/ui";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Home, Move, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrPtzCommand, NvrPtzStatus } from "@cyberos/shared";
import { nvrRequest, PtzLease } from "./api.js";

export function NvrPtz({ deviceId, connected = true, onFault }: { deviceId: string; connected?: boolean; onFault: (message: string) => void }) {
  const { t } = useTranslation(); const [status, setStatus] = useState<NvrPtzStatus | null>(null); const [error, setError] = useState("");
  const [statusError, setStatusError] = useState("");
  const faultRef = useRef(onFault); faultRef.current = onFault;
  const finiteMotion = useRef(false);
  const motionRequest = useRef<Promise<void> | null>(null);
  const generation = useRef(0);
  const faulted = useRef(false);
  const [pan, setPan] = useState("0"); const [tilt, setTilt] = useState("0"); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const lease = useMemo(() => new PtzLease((command) => nvrRequest<void>(`/devices/${deviceId}/ptz`, "POST", command), (cause) => {
    const message = cause instanceof Error ? cause.message : t("nvr.fault");
    faulted.current = true;
    setError(message); faultRef.current(message);
  }), [deviceId, t]);
  const stopMotion = useCallback(() => {
    const force = finiteMotion.current; finiteMotion.current = false;
    const request = motionRequest.current;
    const stopped = lease.stop();
    // A finite move may still be awaiting its acknowledgement. Its stop must
    // follow that request, including when the dialog has already unmounted.
    return force ? stopped.then(() => request?.catch(() => undefined)).then(() => lease.stop(true)) : stopped;
  }, [lease]);
  useEffect(() => {
    let disposed = false; let pending = false; const controller = new AbortController();
    const refresh = () => { if (pending || document.hidden) return; pending = true;
      void nvrRequest<NvrPtzStatus>(`/devices/${deviceId}/ptz`, "GET", undefined, controller.signal).then((value) => { if (!disposed) { setStatus(value); setStatusError(""); if (!value.enabled || value.state !== "running" || value.calibrationRequired) void stopMotion(); } }).catch((cause: unknown) => { if (!disposed) { setStatus(null); setStatusError(cause instanceof Error ? cause.message : t("nvr.fault")); void stopMotion(); } }).finally(() => { pending = false; });
    };
    const stop = () => { void stopMotion(); };
    let timer: ReturnType<typeof setInterval> | undefined;
    if (connected) { refresh(); timer = setInterval(refresh, 2500); }
    else { setStatus(null); setStatusError(""); stop(); }
    for (const event of ["blur", "pagehide", "offline"]) window.addEventListener(event, stop);
    document.addEventListener("visibilitychange", stop);
    return () => { disposed = true; generation.current += 1; controller.abort(); clearInterval(timer); stop(); for (const event of ["blur", "pagehide", "offline"]) window.removeEventListener(event, stop); document.removeEventListener("visibilitychange", stop); };
  }, [deviceId, connected, stopMotion, t]);
  const command = async (value: NvrPtzCommand) => {
    const currentGeneration = generation.current;
    const stopped = stopMotion(); setBusy(true);
    try {
      await stopped;
      if (generation.current !== currentGeneration || faulted.current && value.action !== "stop") return;
      setError("");
      if (["absolute_move", "relative_move", "home", "goto_preset"].includes(value.action)) finiteMotion.current = true;
      const request = nvrRequest<void>(`/devices/${deviceId}/ptz`, "POST", value);
      motionRequest.current = request;
      await request;
      if (value.action === "stop") { finiteMotion.current = false; faulted.current = false; }
      if (generation.current === currentGeneration) setStatus(await nvrRequest<NvrPtzStatus>(`/devices/${deviceId}/ptz`));
    } catch (cause) { const message = cause instanceof Error ? cause.message : t("nvr.fault"); setError(message); if (value.action === "stop") { faulted.current = true; faultRef.current(message); } } finally { setBusy(false); }
  };
  const enabled = Boolean(connected && status?.enabled && status.state === "running" && !status.calibrationRequired && !busy && !error && !statusError && !faulted.current);
  if (!connected) return <Section className="nvr-ptz nvr-ptz-offline" title={t("nvr.ptz")} icon={<Move size={18} aria-hidden="true" />}
    actions={<Button variant="danger" onClick={() => { void command({ action: "stop" }); }}><Square size={14} aria-hidden="true" />{t("nvr.stop")}</Button>}>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    <EmptyState title={t("nvr.ptzUnavailable")} description={t("nvr.ptzOfflineHint")} />
  </Section>;
  return <Section className="nvr-ptz" title={t("nvr.ptz")} description={t("nvr.holdHint")} icon={<Move size={18} aria-hidden="true" />}>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {statusError ? <Notice tone="danger">{statusError}</Notice> : null}
    {status?.lastError ? <Notice tone="warning">{status.lastError}</Notice> : null}
    {status?.simulated ? <Notice>{t("nvr.simulated")}</Notice> : null}
    {status && (status.calibrationRequired || status.state === "calibration_required" || status.state === "uncalibrated") ? <Notice tone="warning">{t("nvr.calibrationRequired")}</Notice> : null}
    <div className="nvr-ptz-controls">
      <div className="nvr-direction-pad">
        {([{ key: "up", pan: 0, tilt: 0.4, Icon: ArrowUp }, { key: "left", pan: -0.4, tilt: 0, Icon: ArrowLeft }, { key: "right", pan: 0.4, tilt: 0, Icon: ArrowRight }, { key: "down", pan: 0, tilt: -0.4, Icon: ArrowDown }] as const).map(({ key, pan: p, tilt: q, Icon }) => <Button key={key} variant="secondary" iconOnly className={`nvr-direction-${key}`} aria-label={t(`nvr.${key}`)} disabled={!enabled || !status?.continuousMove}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); lease.start(p, q); }} onPointerUp={() => lease.stop()} onPointerCancel={() => lease.stop()} onLostPointerCapture={() => lease.stop()} onBlur={() => lease.stop()}
          onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); lease.start(p, q); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); lease.stop(); } }}><Icon size={19} /></Button>)}
        <Button variant="danger" iconOnly className="nvr-direction-stop" aria-label={t("nvr.stop")} onClick={() => { void command({ action: "stop" }); }}><Square size={16} /></Button>
      </div>
      <div className="nvr-ptz-feedback"><span>{t("nvr.position")}: {status?.position ? `${status.position.pan.toFixed(3)} / ${status.position.tilt.toFixed(3)}` : "—"}</span><span>{t("nvr.movement")}: {status?.position ? t(status.position.moving ? "nvr.moving" : "nvr.stationary") : t("nvr.unknown")}</span><Button variant="secondary" disabled={!enabled} onClick={() => { void command({ action: "home" }); }}><Home size={15} />{t("nvr.home")}</Button></div>
    </div>
    <form className="nvr-form" onSubmit={(event) => { event.preventDefault(); void command({ action: "absolute_move", pan: Number(pan), tilt: Number(tilt) }); }}>
      <Field label={t("nvr.pan")}><Input type="number" min="-1" max="1" step="0.01" required value={pan} onChange={(e) => setPan(e.target.value)} /></Field>
      <Field label={t("nvr.tilt")}><Input type="number" min="-1" max="1" step="0.01" required value={tilt} onChange={(e) => setTilt(e.target.value)} /></Field>
      <div className="nvr-actions"><Button type="submit" variant="secondary" disabled={!enabled || !status?.absoluteMove}>{t("nvr.absolute")}</Button><Button type="button" variant="secondary" disabled={!enabled || !status?.relativeMove || !Number.isFinite(Number(pan)) || !Number.isFinite(Number(tilt)) || Math.abs(Number(pan)) > 1 || Math.abs(Number(tilt)) > 1} onClick={() => { void command({ action: "relative_move", pan: Number(pan), tilt: Number(tilt) }); }}>{t("nvr.relative")}</Button></div>
    </form>
    <form className="nvr-form" onSubmit={(event) => { event.preventDefault(); void command({ action: "set_preset", name, token: null }); }}><Field label={t("nvr.presetName")}><Input required maxLength={64} value={name} onChange={(e) => setName(e.target.value)} /></Field><Button variant="secondary" type="submit" disabled={!enabled}>{t("nvr.setPreset")}</Button></form>
    <ul className="nvr-presets">{status?.presets.map((preset) => <li key={preset.token}><span>{preset.name}</span><Button variant="secondary" disabled={!enabled} onClick={() => { void command({ action: "goto_preset", token: preset.token }); }}>{t("nvr.gotoPreset")}</Button><Button variant="plain" disabled={!enabled} onClick={() => { void command({ action: "remove_preset", token: preset.token }); }}>{t("nvr.removePreset")}</Button></li>)}</ul>
  </Section>;
}
