/**
 * [INPUT]: 依赖存储池安全解析、文件描述符与 libvips。
 * [OUTPUT]: 提供有界素材清单、图片预览和安全视频描述符。
 * [POS]: TV 素材只读边界；不建立媒体会话或修改源文件。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createHash, randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { constants, createWriteStream } from "node:fs";
import { mkdir, open, opendir, readdir, realpath, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import type { TvScreensaverItems, TvScreensaverSource, TvSettingsRecord } from "@cyberos/shared";
import { assertPathInsideStoragePool, resolveScopedExistingPath, type StoragePoolScope } from "./storage-scope.js";

type DirectorySource = Exclude<TvScreensaverSource, { kind: "builtin" }>;
interface CatalogOptions {
  resolveScope(source: DirectorySource): Promise<StoragePoolScope>;
  cacheDirectory: string;
  thumbnail?: (source: string, destination: string) => Promise<void>;
}
interface Catalog { key: string; paths: Map<string, string>; expires: number; truncated: boolean }
const MAX_ITEMS = 1_000;
const MAX_ENTRIES = 10_000;
const CACHE_MAX_BYTES = 128 * 1024 ** 2;
const MAX_SOURCE_BYTES = 256 * 1024 ** 2;
const EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".avif"]);
const VIDEO_EXTENSIONS = new Map([[".mp4", "video/mp4"], [".webm", "video/webm"]]);

export class TvScreensaverCatalog {
  private cached: Catalog | undefined;
  private scanning: { key: string; promise: Promise<Catalog> } | undefined;
  private readonly previews = new Map<string, Promise<string>>();
  private queue = Promise.resolve();
  constructor(private readonly options: CatalogOptions) {}

  async list(settings: TvSettingsRecord, cursor?: string): Promise<TvScreensaverItems> {
    const sourceKey = hash(JSON.stringify(settings.screensaverSource)).slice(0, 16);
    const empty = (fallbackReason: string | null): TvScreensaverItems => ({ items: [], nextCursor: null, sourceKey, fallbackReason });
    const source = settings.screensaverSource;
    if (source.kind === "builtin") return empty(null);
    let scope: StoragePoolScope;
    try {
      scope = await this.options.resolveScope(source);
      const directory = await resolveScopedExistingPath(scope, source.path);
      if (!(await stat(directory.realPath)).isDirectory()) return empty("directory_unavailable");
    } catch { return empty("directory_unavailable"); }
    let catalog: Catalog;
    try { catalog = await this.catalog(source, sourceKey, scope); }
    catch { return empty("directory_unavailable"); }
    const match = cursor ? /^([a-f0-9]{16}):(\d{1,5})$/u.exec(cursor) : null;
    if (cursor && (!match || match[1] !== sourceKey)) throw new TvScreensaverError("Screensaver cursor is no longer valid", 400);
    const offset = match ? Number(match[2]) : 0;
    const entries = [...catalog.paths.keys()];
    if (offset > entries.length) throw new TvScreensaverError("Screensaver cursor is invalid", 400);
    const ids = entries.slice(offset, offset + 100);
    return {
      items: ids.map(id => {
        const kind = source.kind === "video-directory" ? "video" : "image";
        return { id, kind, mimeType: kind === "video" ? VIDEO_EXTENSIONS.get(path.extname(catalog.paths.get(id)!).toLowerCase())! : "image/jpeg", url: `/api/tv/screensaver/${kind}/${id}` };
      }),
      nextCursor: offset + ids.length < entries.length ? `${sourceKey}:${offset + ids.length}` : null,
      sourceKey,
      fallbackReason: !entries.length ? "directory_empty" : catalog.truncated ? "catalog_truncated" : null
    };
  }

  async video(settings: TvSettingsRecord, id: string) {
    const source = settings.screensaverSource;
    const sourceKey = hash(JSON.stringify(source)).slice(0, 16);
    const relative = this.cached?.key === sourceKey ? this.cached.paths.get(id) : undefined;
    const mimeType = relative && VIDEO_EXTENSIONS.get(path.extname(relative).toLowerCase());
    if (source.kind !== "video-directory" || !relative || !mimeType) throw new TvScreensaverError("Screensaver video is no longer available", 404);
    try {
      const scope = await this.options.resolveScope(source);
      const safe = await resolveScopedExistingPath(scope, relative);
      const metadata = await stat(safe.realPath);
      const handle = await open(safe.realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
      try {
        const opened = await handle.stat();
        if (!opened.isFile() || !Number.isSafeInteger(opened.size) || opened.size <= 0 || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size || opened.mtimeMs !== metadata.mtimeMs || opened.ctimeMs !== metadata.ctimeMs) throw new Error("Video changed while opening");
        if (process.platform === "linux") assertPathInsideStoragePool(scope, await realpath(`/proc/self/fd/${handle.fd}`));
        const verified = await resolveScopedExistingPath(scope, relative);
        const current = await stat(verified.realPath);
        if (current.dev !== opened.dev || current.ino !== opened.ino) throw new Error("Video path changed");
        return { handle, size: opened.size, mimeType };
      } catch (error) { await handle.close(); throw error; }
    } catch { throw new TvScreensaverError("Screensaver video is unavailable", 404); }
  }

  async image(settings: TvSettingsRecord, id: string): Promise<string> {
    const source = settings.screensaverSource;
    const sourceKey = hash(JSON.stringify(source)).slice(0, 16);
    const relative = this.cached?.key === sourceKey ? this.cached.paths.get(id) : undefined;
    if (source.kind !== "directory" || !relative) throw new TvScreensaverError("Screensaver image is no longer available", 404);
    const scope = await this.options.resolveScope(source);
    const safe = await resolveScopedExistingPath(scope, relative);
    const metadata = await stat(safe.realPath);
    if (!metadata.isFile() || metadata.size > MAX_SOURCE_BYTES || !EXTENSIONS.has(path.extname(relative).toLowerCase())) throw new TvScreensaverError("Screensaver image is unsupported", 415);
    const key = hash(JSON.stringify([sourceKey, relative, metadata.dev, metadata.ino, metadata.size, metadata.mtimeMs, metadata.ctimeMs]));
    const destination = path.join(this.options.cacheDirectory, `${key}.jpg`);
    if (await usable(destination)) return destination;
    const existing = this.previews.get(key);
    if (existing) return existing;
    const preview = this.queue.then(async () => {
      if (await usable(destination)) return destination;
      await mkdir(this.options.cacheDirectory, { recursive: true });
      const temporary = path.join(this.options.cacheDirectory, `.${key}-${randomUUID()}.jpg`);
      const staged = path.join(this.options.cacheDirectory, `.${key}-${randomUUID()}${path.extname(relative).toLowerCase()}`);
      try {
        const currentScope = await this.options.resolveScope(source);
        const current = await resolveScopedExistingPath(currentScope, relative);
        const handle = await open(current.realPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        try {
          const opened = await handle.stat();
          if (!opened.isFile() || opened.dev !== metadata.dev || opened.ino !== metadata.ino || opened.size !== metadata.size || opened.mtimeMs !== metadata.mtimeMs || opened.ctimeMs !== metadata.ctimeMs) throw new Error("Image changed while queued");
          if (process.platform === "linux") assertPathInsideStoragePool(currentScope, await realpath(`/proc/self/fd/${handle.fd}`));
          const verified = await resolveScopedExistingPath(currentScope, relative);
          const verifiedMetadata = await stat(verified.realPath);
          if (verifiedMetadata.dev !== opened.dev || verifiedMetadata.ino !== opened.ino) throw new Error("Image path changed");
          await pipeline(handle.createReadStream({ autoClose: false, start: 0, end: MAX_SOURCE_BYTES }), createWriteStream(staged, { flags: "wx", mode: 0o600 }), { signal: AbortSignal.timeout(15_000) });
          if ((await stat(staged)).size > MAX_SOURCE_BYTES) throw new Error("Image grew beyond size limit");
        } finally { await handle.close(); }
        await (this.options.thumbnail ?? thumbnail)(staged, temporary);
        if (!(await usable(temporary))) throw new Error("Empty preview");
        await rename(temporary, destination);
        await this.prune(destination);
        return destination;
      } catch { throw new TvScreensaverError("Screensaver image could not be decoded", 415); }
      finally { await Promise.all([temporary, staged].map(file => rm(file, { force: true }).catch(() => undefined))); }
    });
    this.queue = preview.then(() => undefined, () => undefined);
    this.previews.set(key, preview);
    try { return await preview; } finally { this.previews.delete(key); }
  }

  private async catalog(source: DirectorySource, key: string, scope: StoragePoolScope): Promise<Catalog> {
    if (this.cached?.key === key && this.cached.expires > Date.now()) return this.cached;
    if (this.scanning?.key === key) return this.scanning.promise;
    const promise = this.scan(source, key, scope);
    this.scanning = { key, promise };
    try { const result = await promise; if (this.scanning?.promise === promise) this.cached = result; return result; }
    finally { if (this.scanning?.promise === promise) this.scanning = undefined; }
  }

  private async scan(source: DirectorySource, key: string, scope: StoragePoolScope): Promise<Catalog> {
    const paths: string[] = [];
    const queue = [{ relative: source.path, depth: 0 }];
    let visited = 0;
    const deadline = Date.now() + 5_000;
    while (queue.length && visited < MAX_ENTRIES && paths.length < MAX_ITEMS && Date.now() < deadline) {
      const directory = queue.shift()!;
      let entries: Awaited<ReturnType<typeof opendir>>;
      try {
        const safe = await resolveScopedExistingPath(scope, directory.relative);
        entries = await opendir(safe.realPath);
      } catch (error) {
        if (directory.depth === 0) throw error;
        continue;
      }
      for await (const entry of entries) {
        visited++;
        if (visited > MAX_ENTRIES || paths.length >= MAX_ITEMS || Date.now() >= deadline) break;
        if (entry.name.startsWith(".") || entry.isSymbolicLink()) continue;
        const relative = path.posix.join(directory.relative, entry.name);
        if (entry.isDirectory() && directory.depth < 16) queue.push({ relative, depth: directory.depth + 1 });
        else if (entry.isFile() && (source.kind === "video-directory" ? VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) : EXTENSIONS.has(path.extname(entry.name).toLowerCase()))) paths.push(relative);
      }
    }
    return { key, paths: new Map(paths.sort().map(relative => [hash(`${key}:${relative}`), relative])), expires: Date.now() + 60_000, truncated: queue.length > 0 || visited >= MAX_ENTRIES || paths.length >= MAX_ITEMS || Date.now() >= deadline };
  }

  private async prune(keep: string): Promise<void> {
    const files = await Promise.all((await readdir(this.options.cacheDirectory)).filter(name => /^[a-f0-9]{64}\.jpg$/u.test(name)).map(async name => {
      const file = path.join(this.options.cacheDirectory, name);
      const info = await stat(file);
      return { file, size: info.size, modified: info.mtimeMs };
    }));
    let bytes = files.reduce((sum, file) => sum + file.size, 0);
    for (const file of files.sort((a, b) => a.modified - b.modified)) {
      if (bytes <= CACHE_MAX_BYTES) break;
      if (file.file === keep) continue;
      await rm(file.file, { force: true }); bytes -= file.size;
    }
  }
}

export class TvScreensaverError extends Error { constructor(message: string, readonly statusCode: number) { super(message); } }
function hash(value: string): string { return createHash("sha256").update(value).digest("hex"); }
async function usable(file: string): Promise<boolean> { try { const info = await stat(file); return info.isFile() && info.size > 0; } catch { return false; } }
async function thumbnail(source: string, destination: string): Promise<void> {
  const run = promisify(execFile);
  const options = { timeout: 15_000, maxBuffer: 65_536, env: { ...process.env, VIPS_CONCURRENCY: "1", VIPS_DISC_THRESHOLD: "33554432" } };
  const [{ stdout: width }, { stdout: height }] = await Promise.all([run("vipsheader", ["-f", "width", source], options), run("vipsheader", ["-f", "height", source], options)]);
  const pixels = Number(width.trim()) * Number(height.trim());
  if (!Number.isSafeInteger(pixels) || pixels <= 0 || pixels > 128_000_000) throw new Error("Image exceeds decoded pixel limit");
  await run("vipsthumbnail", ["--size", "1920x1080", "--output", `${destination}[Q=85,strip]`, "--", source], options);
}
