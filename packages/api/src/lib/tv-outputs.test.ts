/**
 * [INPUT]: 依赖临时 DRM 目录与音频枚举边界。
 * [OUTPUT]: 验证真实候选、独立失败和待应用状态。
 * [POS]: TV 输出库存服务的文件系统契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { readTvOutputOptions } from "./tv-outputs.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it("lists HDMI only, filters incompatible voice devices and compares applied output", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tv-outputs-")); roots.push(root);
  for (const [name, status] of [["card1-HDMI-A-1", "connected"], ["card1-HDMI-A-2", "disconnected"], ["card1-DP-1", "connected"]] as const) {
    await mkdir(path.join(root, name), { recursive: true });
    await writeFile(path.join(root, name!, "status"), status!);
    await writeFile(path.join(root, name!, "modes"), "1920x1080\n1280x720\n");
  }
  const appliedConnectorFile = path.join(root, "applied"); await writeFile(appliedConnectorFile, "HDMI-A-1\n");
  const options = await readTvOutputOptions({ enabled: true, drmConnector: "HDMI-A-2" }, { devices: async () => ({ inputs: [], outputs: [
    { id: "alsa/hdmi:CARD=vc4hdmi0,DEV=0", name: "HDMI 0", connected: true },
    { id: "ble-playback:voice", name: "Voice", connected: true }
  ] }) }, { drmDirectory: root, appliedConnectorFile });
  expect(options.drm.items).toEqual([
    { id: "HDMI-A-1", name: "HDMI-A-1", connected: true, modes: ["1920x1080", "1280x720"] },
    { id: "HDMI-A-2", name: "HDMI-A-2", connected: false, modes: ["1920x1080", "1280x720"] }
  ]);
  expect(options.audio.items).toEqual([{ id: "alsa/hdmi:CARD=vc4hdmi0,DEV=0", name: "HDMI 0" }]);
  expect(options).toMatchObject({ restartRequired: true, applied: { known: true, drmConnector: "HDMI-A-1" } });
});

it("reports an audio enumeration failure independently from an empty DRM inventory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "tv-outputs-")); roots.push(root);
  const result = await readTvOutputOptions({ enabled: false, drmConnector: null }, { devices: async () => { throw new Error("offline"); } }, { drmDirectory: root, appliedConnectorFile: path.join(root, "missing") });
  expect(result.drm).toEqual({ items: [], error: null });
  expect(result.audio.items).toEqual([]);
  expect(result.audio.error).toBeTruthy();
  expect(result.restartRequired).toBe(false);
});
