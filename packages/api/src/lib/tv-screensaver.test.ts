/**
 * [INPUT]: 依赖隔离存储目录、路径保护和可替换图片预览器。
 * [OUTPUT]: 验证屏保枚举边界、离线回退与预览缓存。
 * [POS]: TV 素材服务的文件系统回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { defaultTvSettings } from "@cyberos/db";
import type { StoragePoolScope } from "./storage-scope.js";
import { TvScreensaverCatalog } from "./tv-screensaver.js";

const directories: string[] = [];
afterEach(async () => { for (const directory of directories) await rm(directory, { recursive: true, force: true }); directories.length = 0; });
async function fixture() {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "tv-materials-"))); directories.push(root);
  const pool = path.join(root, "data", "pool-1");
  await mkdir(path.join(pool, "Pictures", "nested"), { recursive: true });
  const scope = { workspace: { id: "pool-1", path: pool }, dataRoot: path.join(root, "data"), dataRootRealPath: path.join(root, "data"), mountpointRealPath: pool, mountpointPath: ".", nestedMountpointRealPaths: [] } as unknown as StoragePoolScope;
  const settings = { ...defaultTvSettings(), screensaverSource: { kind: "directory" as const, storagePoolId: "pool-1", path: "Pictures" } };
  return { root, pool, scope, settings };
}
describe("TV screensaver materials", () => {
  it("lists nested images without following symlinks or returning other files", async () => {
    const { root, pool, scope, settings } = await fixture();
    await writeFile(path.join(pool, "Pictures", "one.jpg"), "image");
    await writeFile(path.join(pool, "Pictures", "nested", "two.png"), "image");
    await writeFile(path.join(pool, "Pictures", "secret.txt"), "text");
    await writeFile(path.join(root, "outside.jpg"), "outside");
    await symlink(path.join(root, "outside.jpg"), path.join(pool, "Pictures", "link.jpg"));
    const catalog = new TvScreensaverCatalog({ resolveScope: async () => scope, cacheDirectory: path.join(root, "cache") });
    const listing = await catalog.list(settings);
    expect(listing.items).toHaveLength(2);
    expect(listing.items.every(item => item.url.startsWith("/api/tv/screensaver/image/"))).toBe(true);
    expect(listing.fallbackReason).toBeNull();
  });
  it("falls back for offline/empty sources and rejects stale item tokens", async () => {
    const { root, scope, settings } = await fixture();
    const catalog = new TvScreensaverCatalog({ resolveScope: async () => scope, cacheDirectory: path.join(root, "cache") });
    expect(await catalog.list(settings)).toMatchObject({ items: [], fallbackReason: "directory_empty" });
    await expect(catalog.image(settings, "unknown")).rejects.toThrow();
    const offline = new TvScreensaverCatalog({ resolveScope: async () => { throw new Error("offline"); }, cacheDirectory: path.join(root, "cache") });
    expect(await offline.list(settings)).toMatchObject({ items: [], fallbackReason: "directory_unavailable" });
  });
  it("skips excluded nested mounts without discarding valid sibling images", async () => {
    const { root, pool, scope, settings } = await fixture();
    await writeFile(path.join(pool, "Pictures", "one.jpg"), "image");
    await writeFile(path.join(pool, "Pictures", "nested", "two.png"), "excluded");
    scope.nestedMountpointRealPaths = [path.join(pool, "Pictures", "nested")];
    const catalog = new TvScreensaverCatalog({ resolveScope: async () => scope, cacheDirectory: path.join(root, "cache") });
    expect(await catalog.list(settings)).toMatchObject({ items: [expect.anything()], fallbackReason: null });
  });
  it("decodes a bounded private snapshot when the original pathname changes", async () => {
    const { root, pool, scope, settings } = await fixture();
    const original = path.join(pool, "Pictures", "one.jpg");
    const outside = path.join(root, "outside.jpg");
    await writeFile(original, "authorized image");
    await writeFile(outside, "outside pool");
    const cacheDirectory = path.join(root, "cache");
    const catalog = new TvScreensaverCatalog({ resolveScope: async () => scope, cacheDirectory, thumbnail: async (source, destination) => {
      await rm(original);
      await symlink(outside, original);
      expect(path.dirname(source)).toBe(cacheDirectory);
      expect(await readFile(source, "utf8")).toBe("authorized image");
      await writeFile(destination, "preview");
    } });
    const { items } = await catalog.list(settings);
    expect(await readFile(await catalog.image(settings, items[0]!.id), "utf8")).toBe("preview");
    await expect(catalog.image(settings, items[0]!.id)).rejects.toThrow();
  });
  it("revalidates the source before serving a cached bounded preview", async () => {
    const { root, pool, scope, settings } = await fixture();
    await writeFile(path.join(pool, "Pictures", "one.jpg"), "image");
    let conversions = 0;
    const catalog = new TvScreensaverCatalog({ resolveScope: async () => scope, cacheDirectory: path.join(root, "cache"), thumbnail: async (_source, destination) => { conversions++; await writeFile(destination, "preview"); } });
    const { items } = await catalog.list(settings);
    const preview = await catalog.image(settings, items[0]!.id);
    expect(await readFile(preview, "utf8")).toBe("preview");
    expect(await catalog.image(settings, items[0]!.id)).toBe(preview);
    expect(conversions).toBe(1);
    await rm(path.join(pool, "Pictures", "one.jpg"));
    await expect(catalog.image(settings, items[0]!.id)).rejects.toThrow();
  });
});
