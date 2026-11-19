/**
 * [INPUT]: 依赖 sysfs HDMI 库存、原生音频枚举与输出标记。
 * [OUTPUT]: 提供互相独立的输出候选及待应用状态。
 * [POS]: TV 设置只读设备边界；不写入设备和用户草稿。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { TvOutputOptions } from "@cyberos/shared";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import type { AudioRuntime } from "./audio-runtime.js";

export interface TvOutputPaths { drmDirectory: string; appliedConnectorFile: string }
export async function readTvOutputOptions(
  settings: { enabled: boolean; drmConnector: string | null },
  audio: Pick<AudioRuntime, "devices"> | undefined,
  paths: TvOutputPaths
): Promise<TvOutputOptions> {
  const [drm, audioOptions, applied] = await Promise.all([
    readDrm(paths.drmDirectory), readAudio(audio), readApplied(paths.appliedConnectorFile)
  ]);
  return { drm, audio: audioOptions, applied, restartRequired: settings.enabled && (!applied.known || applied.drmConnector !== settings.drmConnector) };
}

async function readDrm(directory: string): Promise<TvOutputOptions["drm"]> {
  try {
    const names = (await readdir(directory)).filter(name => /^card\d+-HDMI-A-[1-9]\d*$/u.test(name)).sort().slice(0, 128);
    const items = await Promise.all(names.map(async name => {
      const [status, modes] = await Promise.all([
        readFile(path.join(directory, name, "status"), "utf8"),
        readFile(path.join(directory, name, "modes"), "utf8").catch(() => "")
      ]);
      const id = name.replace(/^card\d+-/u, "");
      return { id, name: id, connected: status.trim() === "connected", modes: modes.split("\n").filter(mode => /^\d+x\d+$/u.test(mode)).slice(0, 64) };
    }));
    return { items: [...new Map(items.map(item => [item.id, item])).values()], error: null };
  } catch { return { items: [], error: "DRM output enumeration is unavailable" }; }
}

async function readAudio(runtime: Pick<AudioRuntime, "devices"> | undefined): Promise<TvOutputOptions["audio"]> {
  try {
    if (!runtime) throw new Error("Audio daemon unavailable");
    const devices = await runtime.devices();
    const items = devices.outputs.filter(device => typeof device.id === "string" && device.id.startsWith("alsa/") && device.id.length <= 256 && typeof device.name === "string")
      .slice(0, 128).map(device => ({ id: device.id, name: device.name.slice(0, 512) }));
    return { items: [...new Map(items.map(item => [item.id, item])).values()], error: null };
  } catch { return { items: [], error: "Audio output enumeration is unavailable" }; }
}

async function readApplied(file: string): Promise<TvOutputOptions["applied"]> {
  try {
    const connector = (await readFile(file, "utf8")).trim();
    if (connector === "auto") return { known: true, drmConnector: null };
    if (/^HDMI-A-[1-9]\d*$/u.test(connector)) return { known: true, drmConnector: connector };
  } catch { /* 首次启动前没有输出记录。 */ }
  return { known: false, drmConnector: null };
}
