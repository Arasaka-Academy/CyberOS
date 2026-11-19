/**
 * [INPUT]: 依赖真实素材目录、SQLite 设置和可控存储池库存。
 * [OUTPUT]: 验证视频范围读取、失效素材和离线保护。
 * [POS]: 视频屏保的 HTTP 与文件描述符集成回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import Fastify from "fastify";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { defaultTvSettings, openCyberOsDb, saveTvSettings } from "@cyberos/db";
import { loadCyberOsRuntime } from "@cyberos/shared";
import type { ApiRouteContext } from "../context.js";
import type { StoragePoolScope } from "../lib/storage-scope.js";
import { registerTvScreensaverRoutes } from "./tv-screensaver.js";

const { resolveScope } = vi.hoisted(() => ({ resolveScope: vi.fn() }));
vi.mock("../lib/storage-scope.js", async importOriginal => ({ ...await importOriginal<typeof import("../lib/storage-scope.js")>(), resolveStoragePoolScope: resolveScope }));
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => { for (const cleanup of cleanups.reverse()) await cleanup(); cleanups.length = 0; resolveScope.mockReset(); });

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tv-video-http-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const config = loadCyberOsRuntime({ CYBEROS_ROOT: root }, root);
  const pool = path.join(config.paths.dataRoot, "pool-1");
  await mkdir(path.join(pool, "Videos"), { recursive: true });
  const file = path.join(pool, "Videos", "sample.mp4");
  await writeFile(file, "0123456789");
  const scope = { workspace: { id: "pool-1", path: pool }, dataRoot: config.paths.dataRoot, dataRootRealPath: config.paths.dataRoot, mountpointRealPath: pool, mountpointPath: ".", nestedMountpointRealPaths: [] } as unknown as StoragePoolScope;
  resolveScope.mockResolvedValue(scope);
  const db = openCyberOsDb(config.paths.databasePath);
  cleanups.push(async () => db.close());
  const settings = saveTvSettings(db, { ...defaultTvSettings(), screensaverSource: { kind: "video-directory", storagePoolId: "pool-1", path: "Videos" } });
  const server = Fastify();
  cleanups.push(() => server.close());
  registerTvScreensaverRoutes(server, { config, db } as ApiRouteContext);
  const list = (await server.inject("/api/tv/screensaver/items")).json();
  expect(list.items).toHaveLength(1);
  return { root, file, db, settings, server, url: list.items[0].url as string };
}

describe("TV screensaver video streams", () => {
  it("serves exact byte ranges and metadata without opening a playback session", async () => {
    const { server, url } = await fixture();
    const full = await server.inject(url);
    expect(full.statusCode).toBe(200); expect(full.body).toBe("0123456789");
    expect(full.headers["content-type"]).toBe("video/mp4");
    expect(full.headers["accept-ranges"]).toBe("bytes");
    expect(full.headers["cache-control"]).toBe("private, no-store");
    const ranged = await server.inject({ url, headers: { range: "bytes=2-5" } });
    expect(ranged.statusCode).toBe(206); expect(ranged.body).toBe("2345");
    expect(ranged.headers["content-range"]).toBe("bytes 2-5/10");
    expect(ranged.headers["content-length"]).toBe("4");
    const suffix = await server.inject({ url, headers: { range: "bytes=-2" } });
    expect(suffix.statusCode).toBe(206); expect(suffix.body).toBe("89");
    const head = await server.inject({ method: "HEAD", url });
    expect(head.statusCode).toBe(200); expect(head.body).toBe("");
    expect(head.headers["content-length"]).toBe("10");
    for (const range of ["bytes=10-", "bytes=0-1,3-4", "bytes=-0"]) {
      const invalid = await server.inject({ url, headers: { range } });
      expect(invalid.statusCode).toBe(416); expect(invalid.headers["content-range"]).toBe("bytes */10");
    }
  });
  it("rejects path replacement, offline storage and tokens from an old source", async () => {
    const { root, file, db, settings, server, url } = await fixture();
    const outside = path.join(root, "outside.mp4");
    await writeFile(outside, "outside"); await rm(file); await symlink(outside, file);
    expect((await server.inject(url)).statusCode).toBe(404);
    resolveScope.mockRejectedValue(new Error("offline"));
    expect((await server.inject(url)).statusCode).toBe(404);
    saveTvSettings(db, { ...settings, screensaverSource: { kind: "builtin" } });
    expect((await server.inject(url)).statusCode).toBe(404);
    expect((await server.inject("/api/tv/screensaver/video/arbitrary-path")).statusCode).toBe(404);
  });
});
