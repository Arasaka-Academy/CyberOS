import { Button, Field, Input, Notice, Section } from "@cyberos/ui";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Home, Square } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import type { NvrPtzCommand, NvrPtzStatus } from "@cyberos/shared";
import { nvrRequest, PtzLease } from "./api.js";

export function NvrPtz({ deviceId }: { deviceId: string }) {
  const { t } = useTranslation(); const [status, setStatus] = useState<NvrPtzStatus | null>(null); const [error, setError] = useState("");
  const [pan, setPan] = useState("0"); const [tilt, setTilt] = useState("0"); const [name, setName] = useState(""); const [busy, setBusy] = useState(false);
  const lease = useMemo(() => new PtzLease((command) => nvrRequest<void>(`/devices/${deviceId}/ptz`, "POST", command), (cause) => setError(cause instanceof Error ? cause.message : t("nvr.fault"))), [deviceId, t]);
  useEffect(() => {
    let disposed = false; let pending = false; const controller = new AbortController();
    const refresh = () => { if (pending || document.hidden) return; pending = true;
      void nvrRequest<NvrPtzStatus>(`/devices/${deviceId}/ptz`, "GET", undefined, controller.signal).then((value) => { if (!disposed) { setStatus(value); setError(""); } }).catch((cause: unknown) => { if (!disposed) setError(cause instanceof Error ? cause.message : t("nvr.fault")); }).finally(() => { pending = false; });
    };
    const stop = () => lease.stop(); refresh(); const timer = setInterval(refresh, 2500);
    for (const event of ["blur", "pagehide", "offline"]) window.addEventListener(event, stop);
    document.addEventListener("visibilitychange", stop);
    return () => { disposed = true; controller.abort(); clearInterval(timer); lease.stop(); for (const event of ["blur", "pagehide", "offline"]) window.removeEventListener(event, stop); document.removeEventListener("visibilitychange", stop); };
  }, [deviceId, lease, t]);
  const command = async (value: NvrPtzCommand) => {
    const stopped = lease.stop(); setBusy(true); setError("");
    try { await stopped; await nvrRequest<void>(`/devices/${deviceId}/ptz`, "POST", value); setStatus(await nvrRequest<NvrPtzStatus>(`/devices/${deviceId}/ptz`)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t("nvr.fault")); } finally { setBusy(false); }
  };
  const enabled = Boolean(status?.enabled && status.state === "running" && !status.calibrationRequired && !busy);
  return <Section className="nvr-ptz" title={t("nvr.ptz")} description={t("nvr.holdHint")}>
    {error ? <Notice tone="danger">{error}</Notice> : null}
    {status?.lastError ? <Notice tone="warning">{status.lastError}</Notice> : null}
    {status?.simulated ? <Notice>{t("nvr.simulated")}</Notice> : null}
    {status?.state === "calibration_required" ? <Notice tone="warning">{t("nvr.calibrationRequired")}</Notice> : null}
    <div className="nvr-ptz-controls">
      <div className="nvr-direction-pad">
        {([{ key: "up", pan: 0, tilt: 0.4, Icon: ArrowUp }, { key: "left", pan: -0.4, tilt: 0, Icon: ArrowLeft }, { key: "right", pan: 0.4, tilt: 0, Icon: ArrowRight }, { key: "down", pan: 0, tilt: -0.4, Icon: ArrowDown }] as const).map(({ key, pan: p, tilt: q, Icon }) => <Button key={key} variant="secondary" iconOnly className={`nvr-direction-${key}`} aria-label={t(`nvr.${key}`)} disabled={!enabled}
          onPointerDown={(event) => { if (event.button !== 0) return; event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId); lease.start(p, q); }} onPointerUp={() => lease.stop()} onPointerCancel={() => lease.stop()} onLostPointerCapture={() => lease.stop()} onBlur={() => lease.stop()}
          onKeyDown={(event) => { if ((event.key === " " || event.key === "Enter") && !event.repeat) { event.preventDefault(); lease.start(p, q); } }} onKeyUp={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); lease.stop(); } }}><Icon size={19} /></Button>)}
        <Button variant="danger" iconOnly className="nvr-direction-stop" aria-label={t("nvr.stop")} disabled={!status?.enabled} onClick={() => { void command({ action: "stop" }); }}><Square size={16} /></Button>
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
