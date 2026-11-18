/**
 * [INPUT]: 依赖临时 Unix socket 与显示策略客户端。
 * [OUTPUT]: 验证策略同步、渲染握手和失联降级。
 * [POS]: API 与 Weston 模块的集成契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import net from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTvSettings } from "@cyberos/db";
import { TvDisplayClient } from "./tv-display.js";

const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; });

describe("TV display bridge", () => {
  it("sends policy and renderer readiness, observes native transitions and fails awake on disconnect", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "tv-display-"));
    cleanups.push(() => rm(directory, { recursive: true, force: true }));
    const socketPath = path.join(directory, "display.sock");
    const commands: string[] = [];
    let peer: net.Socket | undefined;
    const server = net.createServer(socket => {
      peer = socket;
      socket.on("data", chunk => { commands.push(...chunk.toString().trim().split("\n")); socket.write('{"state":"active","supported":true,"reason":null}\n'); });
    });
    await new Promise<void>(resolve => server.listen(socketPath, resolve));
    cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    const client = new TvDisplayClient(socketPath);
    cleanups.push(async () => client.close());
    client.start(defaultTvSettings);
    await expect.poll(() => commands).toContain("POLICY 300000 1800000");
    client.rendererReady(true);
    await expect.poll(() => commands).toContain("RENDERER 1");
    peer!.write('{"state":"screensaver","supported":true,"reason":null}\n');
    await expect.poll(() => client.status().state).toBe("screensaver");
    peer!.destroy();
    await expect.poll(() => client.status()).toMatchObject({ state: "active", supported: false });
  });
  it("represents independent Never values as zero without enabling host TV mode", async () => {
    const client = new TvDisplayClient("/nonexistent/tv-display.sock");
    cleanups.push(async () => client.close());
    client.configure({ ...defaultTvSettings(), screensaverAfterMinutes: null, screenOffAfterMinutes: null });
    expect(client.policy()).toBe("POLICY 0 0");
    expect(client.status()).toMatchObject({ state: "active", supported: false });
  });
});
