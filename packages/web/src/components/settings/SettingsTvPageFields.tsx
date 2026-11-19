/**
 * [INPUT]: 依赖 TV 表单草稿、输出候选与共享滑块。
 * [OUTPUT]: 提供输出下拉、屏保来源和独立待机开关。
 * [POS]: TV 设置的纯字段层；只更新草稿，不请求或保存设置。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { Button, Field, Slider } from "@cyberos/ui";
import type { TvOutputOptions } from "@cyberos/shared";
import { useTranslation } from "react-i18next";
import type { TvSettings } from "../../api.js";
import { CustomSelect } from "../common/CustomSelect.js";
import { Switch } from "../common/Switch.js";
import { HelpTip } from "../common/HelpTip.js";

export type TvForm = Pick<TvSettings, "audioDevice" | "drmConnector" | "hardwareDecoding" | "screensaverSource" | "screensaverEnabled" | "screenOffEnabled" | "screensaverAfterMinutes" | "screenOffAfterMinutes">;
export function tvForm(settings: TvSettings): TvForm {
  return { audioDevice: settings.audioDevice, drmConnector: settings.drmConnector, hardwareDecoding: settings.hardwareDecoding,
    screensaverSource: settings.screensaverSource, screensaverEnabled: settings.screensaverEnabled ?? settings.screensaverAfterMinutes !== null,
    screenOffEnabled: settings.screenOffEnabled ?? settings.screenOffAfterMinutes !== null,
    screensaverAfterMinutes: settings.screensaverAfterMinutes ?? 5, screenOffAfterMinutes: settings.screenOffAfterMinutes ?? 30 };
}
export function validTvTimers(form: TvForm): boolean {
  const saver = form.screensaverAfterMinutes;
  const off = form.screenOffAfterMinutes;
  return typeof saver === "number" && Number.isInteger(saver) && saver >= 1 && saver <= 60 &&
    typeof off === "number" && Number.isInteger(off) && off >= 1 && off <= 120 &&
    (!form.screensaverEnabled || !form.screenOffEnabled || off > saver);
}
export function tvDeviceOptions(items: Array<{ id: string; name: string }>, selected: string | null, defaultLabel: string, missingLabel: string) {
  const options = [{ value: "", label: defaultLabel }, ...items.map(item => ({ value: item.id, label: item.name }))];
  if (selected && !items.some(item => item.id === selected)) options.push({ value: selected, label: `${selected} · ${missingLabel}` });
  return options;
}
export function TvSettingsFields({ draft, busy, outputs, onChange, onChooseDirectory }: {
  draft: TvForm; busy: boolean; outputs?: TvOutputOptions | null;
  onChange: (patch: Partial<TvForm>) => void; onChooseDirectory: () => void;
}) {
  const { t } = useTranslation();
  const source = draft.screensaverSource;
  const audioOptions = tvDeviceOptions(outputs?.audio.items ?? [], draft.audioDevice, t("tvIdle.systemDefault"), t("tvIdle.notDetected"));
  const drmOptions = tvDeviceOptions((outputs?.drm.items ?? []).map(item => ({ id: item.id, name: `${item.name} · ${t(item.connected ? "tvIdle.connected" : "tvIdle.disconnected")}` })), draft.drmConnector, t("tvIdle.automatic"), t("tvIdle.notDetected"));
  return <fieldset className="settings-field-grid" disabled={busy}>
    <Field label={t("settings.media.audioDevice")} help={<HelpTip label={t("settings.media.audioDevice")} content={t("tvIdle.audioHelp")} />}><CustomSelect value={draft.audioDevice ?? ""} ariaLabel={t("settings.media.audioDevice")} options={audioOptions} disabled={busy} onChange={value => onChange({ audioDevice: value || null })} /></Field>
    <Field label={t("settings.media.drmConnector")} help={<HelpTip label={t("settings.media.drmConnector")} content={t("tvIdle.drmHelp")} />}><CustomSelect value={draft.drmConnector ?? ""} ariaLabel={t("settings.media.drmConnector")} options={drmOptions} disabled={busy} onChange={value => onChange({ drmConnector: value || null })} /></Field>
    <Field label={t("settings.media.hardwareDecoding")}><CustomSelect value={draft.hardwareDecoding} ariaLabel={t("settings.media.hardwareDecoding")} disabled={busy} options={[{ value: "auto-safe", label: t("settings.media.hwdec.autoSafe") }, { value: "auto", label: t("settings.media.hwdec.auto") }, { value: "no", label: t("settings.media.hwdec.no") }]} onChange={hardwareDecoding => onChange({ hardwareDecoding })} /></Field>
    <Field label={t("tvIdle.source")} help={source.kind === "video-directory" ? <HelpTip label={t("tvIdle.source")} content={t("tvIdle.videoHelp")} /> : undefined}><CustomSelect value={source.kind} ariaLabel={t("tvIdle.source")} disabled={busy} options={[{ value: "builtin", label: t("tvIdle.builtin") }, { value: "directory", label: t("tvIdle.directory") }, { value: "video-directory", label: t("tvIdle.videoDirectory") }]} onChange={kind => onChange({ screensaverSource: kind === "builtin" ? { kind } : { kind, storagePoolId: source.kind === "builtin" ? "" : source.storagePoolId, path: source.kind === "builtin" ? "." : source.path } })} /></Field>
    {source.kind !== "builtin" ? <Field wide label={t(source.kind === "video-directory" ? "tvIdle.videoDirectory" : "tvIdle.directory")}><Button type="button" variant="secondary" disabled={busy} className="settings-tv-directory" onClick={onChooseDirectory}>{source.storagePoolId ? source.path : t("tvIdle.chooseDirectory")}</Button></Field> : null}
    <div className="settings-tv-timer">
      <Switch checked={draft.screensaverEnabled} disabled={busy} label={t("tvIdle.screensaverEnabled")} onCheckedChange={screensaverEnabled => onChange({ screensaverEnabled })} />
      <Slider label={t("tvIdle.saverAfter")} value={draft.screensaverAfterMinutes ?? 5} minValue={1} maxValue={60} step={1} isDisabled={busy || !draft.screensaverEnabled} formatOptions={{ style: "unit", unit: "minute", unitDisplay: "long" }} onChange={screensaverAfterMinutes => onChange({ screensaverAfterMinutes })} />
    </div>
    <div className="settings-tv-timer">
      <Switch checked={draft.screenOffEnabled} disabled={busy} label={t("tvIdle.screenOffEnabled")} onCheckedChange={screenOffEnabled => onChange({ screenOffEnabled })} />
      <Slider label={t("tvIdle.offAfter")} value={draft.screenOffAfterMinutes ?? 30} minValue={1} maxValue={120} step={1} isDisabled={busy || !draft.screenOffEnabled} formatOptions={{ style: "unit", unit: "minute", unitDisplay: "long" }} onChange={screenOffAfterMinutes => onChange({ screenOffAfterMinutes })} />
    </div>
  </fieldset>;
}
