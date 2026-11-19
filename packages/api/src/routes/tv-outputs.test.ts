/**
 * [INPUT]: 依赖真实设置数据库、HTTP 注入与宿主重配边界。
 * [OUTPUT]: 验证显式确认、会话保护和已保存配置应用。
 * [POS]: TV 输出应用路由的行为回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import Fastify from "fastify";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { defaultTvSettings, openCyberOsDb, saveTvSettings } from "@cyberos/db";
import { loadCyberOsRuntime } from "@cyberos/shared";
import { registerTvOutputRoutes } from "./tv-outputs.js";
import { withTvSettingsMutation } from "../lib/tv-settings-lock.js";

const cleanup: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const action of cleanup.splice(0).reverse()) await action(); });
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "tv-output-api-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: root }, root);
  const db = openCyberOsDb(config.paths.databasePath); cleanup.push(async () => db.close());
  saveTvSettings(db, { ...defaultTvSettings(), drmConnector: "HDMI-A-2" });
  const drmDirectory = path.join(root, "drm"); await mkdir(path.join(drmDirectory, "card1-HDMI-A-2"), { recursive: true });
  await writeFile(path.join(drmDirectory, "card1-HDMI-A-2/status"), "connected\n");
  const calls: Array<string | null> = [];
  const session = { owner: null as "music" | "video" | null, sessionId: null as string | null };
  const server = Fastify(); cleanup.push(() => server.close());
  registerTvOutputRoutes(server, { config, db, playback: { getStatus: async () => session }, tvMode: {
    apply: async () => {}, reconfigure: async connector => { calls.push(connector); }
  } }, { drmDirectory, appliedConnectorFile: path.join(root, "applied") });
  return { server, db, calls, session };
}

it("requires explicit confirmation and rejects paused sessions without host changes", async () => {
  const f = await fixture();
  expect((await f.server.inject({ method: "POST", url: "/api/settings/tv/apply-output", payload: {} })).statusCode).toBe(400);
  f.session.owner = "video"; f.session.sessionId = "paused-session";
  expect((await f.server.inject({ method: "POST", url: "/api/settings/tv/apply-output", payload: { confirmed: true } })).statusCode).toBe(409);
  expect(f.calls).toEqual([]);
});

it("applies only saved output and serializes against in-flight settings changes", async () => {
  const f = await fixture();
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const change = withTvSettingsMutation(f.db, async () => { await gate; saveTvSettings(f.db, { ...defaultTvSettings(), drmConnector: null }); });
  const pending = Promise.resolve(f.server.inject({ method: "POST", url: "/api/settings/tv/apply-output", payload: { confirmed: true } }));
  await new Promise(resolve => setTimeout(resolve, 20));
  expect(f.calls).toEqual([]);
  release(); await change;
  const result = await pending;
  expect(result.statusCode).toBe(200);
  expect(result.json()).toEqual({ applied: true, drmConnector: null });
  expect(f.calls).toEqual([null]);
});

it("lists output inventory and refuses application when TV is disabled", async () => {
  const f = await fixture();
  const list = await f.server.inject({ method: "GET", url: "/api/settings/tv/outputs" });
  expect(list.statusCode).toBe(200);
  expect(list.json().drm.items[0].id).toBe("HDMI-A-2");
  saveTvSettings(f.db, { ...defaultTvSettings(), enabled: false });
  expect((await f.server.inject({ method: "POST", url: "/api/settings/tv/apply-output", payload: { confirmed: true } })).statusCode).toBe(409);
  expect(f.calls).toEqual([]);
});
