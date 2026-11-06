import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { CapabilityError, type CapabilityExecution, type JsonValue } from "@cyberos/capabilities";
import type { CyberOsDatabase } from "@cyberos/db";
import { isPathInside, resolveSafeExistingPath, toRootRelative } from "@cyberos/storage-tools";
import type { CyberOsRuntime } from "@cyberos/shared";
import { requireStoragePool, type ResolvedStoragePool } from "./storage-pools.js";
import { BoundedRegexMatcher, type GrepMatchPage } from "./bounded-regex.js";

const execFileAsync = promisify(execFile);
const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_OUTPUT_BYTES = 128 * 1024;

export type ExtendedFileReadCapabilityId =
  | "cyberos.files.grep"
  | "cyberos.files.find"
  | "cyberos.files.git"
  | "cyberos.files.archive-inspect";

interface WalkEntry {
  absolutePath: string;
  relativePath: string;
  kind: "file" | "directory";
  size: number;
  mtimeMs: number;
}

export async function executeExtendedFileReadCapability(
  dependencies: { db: CyberOsDatabase; config: CyberOsRuntime },
  capabilityId: ExtendedFileReadCapabilityId,
  input: Record<string, JsonValue>
): Promise<CapabilityExecution> {
  const root = requireStoragePool(dependencies.config, requiredString(input.storagePoolId, "storagePoolId"));
  switch (capabilityId) {
    case "cyberos.files.grep": return grepFiles(root, input);
    case "cyberos.files.find": return findFiles(root, input);
    case "cyberos.files.git": return inspectGit(root, input);
    case "cyberos.files.archive-inspect": return inspectArchive(root, input);
  }
}

async function grepFiles(root: ResolvedStoragePool, input: Record<string, JsonValue>): Promise<CapabilityExecution> {
  const requestedPath = optionalString(input.path) ?? ".";
  const pattern = requiredString(input.pattern, "pattern");
  const mode = optionalString(input.mode) ?? "literal";
  if (mode !== "literal" && mode !== "regex") throw new CapabilityError("INVALID_ARGUMENT", "mode must be literal or regex");
  const caseSensitive = input.caseSensitive === true;
  const flags = caseSensitive ? "u" : "iu";
  if (mode === "regex") {
    try {
      new RegExp(pattern, flags);
    } catch {
      throw new CapabilityError("INVALID_ARGUMENT", "pattern is not a valid regular expression");
    }
  }
  const needle = caseSensitive ? pattern : pattern.toLocaleLowerCase();
  const limit = boundedInteger(input.limit, 50, 1, 200);
  const maxFiles = boundedInteger(input.maxFiles, 5_000, 1, 20_000);
  const maxBytes = boundedInteger(input.maxBytes, 64 * 1024 * 1024, 1, 256 * 1024 * 1024);
  const timeoutMs = boundedInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000);
  const include = stringArray(input.include, "include", 32).map(globToRegExp);
  const exclude = stringArray(input.exclude, "exclude", 32).map(globToRegExp);
  const startedAt = Date.now();
  const walked = await walk(root, requestedPath, { maxEntries: maxFiles, timeoutMs, startedAt });
  const files = walked.entries.filter((entry) => entry.kind === "file" && matchesFilters(entry.relativePath, include, exclude));
  const signature = stableSignature({ storagePoolId: root.id, requestedPath, pattern, mode, caseSensitive, include: stringArray(input.include, "include", 32), exclude: stringArray(input.exclude, "exclude", 32) });
  const offset = decodeCursor(optionalString(input.cursor), signature);
  const matches: JsonValue[] = [];
  let scannedBytes = 0;
  let scannedFiles = 0;
  let matchedOffset = 0;
  let hasMore = false;
  let regexMatcher: BoundedRegexMatcher | undefined;
  try {
    outer: for (const file of files) {
      ensureWithinBudget(startedAt, timeoutMs);
      if (scannedBytes + file.size > maxBytes) break;
      const content = await readFile(file.absolutePath);
      scannedFiles += 1;
      scannedBytes += content.byteLength;
      if (content.includes(0)) continue;
      const text = content.toString("utf8");
      const skip = Math.max(0, offset - matchedOffset);
      const remaining = limit - matches.length + 1;
      let page: GrepMatchPage;
      if (mode === "regex") {
        regexMatcher ??= new BoundedRegexMatcher(pattern, flags);
        page = await regexMatcher.match(text, skip, remaining, timeoutMs - (Date.now() - startedAt));
      } else {
        page = matchLiteralLines(text, needle, caseSensitive, skip, remaining);
      }
      matchedOffset += page.skipped;
      for (const match of page.matches) {
        if (matches.length >= limit) {
          hasMore = true;
          break outer;
        }
        matches.push({ path: file.relativePath, ...match });
        matchedOffset += 1;
      }
    }
  } finally {
    await regexMatcher?.close();
  }
  const truncated = walked.truncated || scannedFiles < files.length || hasMore;
  return {
    data: {
      storagePoolId: root.id,
      path: requestedPath,
      matches,
      scannedFiles,
      scannedBytes,
      truncated
    },
    warnings: [
      ...(walked.skippedSymlinks > 0 ? [`Skipped ${walked.skippedSymlinks} symbolic link(s)`] : []),
      ...(truncated ? ["Search stopped at a configured budget"] : [])
    ],
    page: {
      limit,
      nextCursor: hasMore ? encodeCursor(offset + matches.length, signature) : null
    }
  };
}

function matchLiteralLines(content: string, needle: string, caseSensitive: boolean, skip: number, limit: number): GrepMatchPage {
  const lines = content.split(/\r?\n/u);
  const page: GrepMatchPage = { skipped: 0, matches: [] };
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!;
    const column = (caseSensitive ? line : line.toLocaleLowerCase()).indexOf(needle);
    if (column < 0) continue;
    if (page.skipped < skip) { page.skipped += 1; continue; }
    page.matches.push({ line: index + 1, column: column + 1, length: needle.length, text: line.slice(0, 1000) });
    if (page.matches.length >= limit) break;
  }
  return page;
}

async function findFiles(root: ResolvedStoragePool, input: Record<string, JsonValue>): Promise<CapabilityExecution> {
  const requestedPath = optionalString(input.path) ?? ".";
  const kind = optionalString(input.kind) ?? "any";
  if (!new Set(["any", "file", "directory"]).has(kind)) {
    throw new CapabilityError("INVALID_ARGUMENT", "kind must be any, file, or directory");
  }
  const glob = optionalString(input.glob);
  const globPattern = glob ? globToRegExp(glob) : null;
  const limit = boundedInteger(input.limit, 50, 1, 200);
  const maxEntries = boundedInteger(input.maxEntries, 20_000, 1, 100_000);
  const timeoutMs = boundedInteger(input.timeoutMs, DEFAULT_TIMEOUT_MS, 100, 30_000);
  const walked = await walk(root, requestedPath, { maxEntries, timeoutMs, startedAt: Date.now() });
  const filtered = walked.entries.filter((entry) => (
    (kind === "any" || kind === entry.kind) &&
    (!globPattern || globPattern.test(entry.relativePath) || globPattern.test(path.basename(entry.relativePath)))
  ));
  const signature = stableSignature({ storagePoolId: root.id, requestedPath, kind, glob: glob ?? null });
  const offset = decodeCursor(optionalString(input.cursor), signature);
  const entries = filtered.slice(offset, offset + limit).map(({ relativePath, kind: entryKind, size, mtimeMs }) => ({
    path: relativePath,
    kind: entryKind,
    size,
    mtime: new Date(mtimeMs).toISOString()
  }));
  const nextOffset = offset + entries.length;
  const hasMore = nextOffset < filtered.length;
  return {
    data: { storagePoolId: root.id, path: requestedPath, entries, scannedEntries: walked.entries.length, truncated: walked.truncated },
    warnings: [
      ...(walked.skippedSymlinks > 0 ? [`Skipped ${walked.skippedSymlinks} symbolic link(s)`] : []),
      ...(walked.truncated ? ["Find stopped at a configured budget"] : [])
    ],
    page: { limit, nextCursor: hasMore ? encodeCursor(nextOffset, signature) : null }
  };
}

async function inspectGit(root: ResolvedStoragePool, input: Record<string, JsonValue>): Promise<CapabilityExecution> {
  const requestedPath = optionalString(input.path) ?? ".";
  const safe = await safeExisting(root, requestedPath);
  const metadata = await stat(safe.realPath);
  const cwd = metadata.isDirectory() ? safe.realPath : path.dirname(safe.realPath);
  const gitArgs = [
    "-c", "core.hooksPath=/dev/null",
    "-c", "core.fsmonitor=false",
    "-c", "core.untrackedCache=false",
    "-c", "submodule.recurse=false",
    "-c", "core.pager=cat",
    "-c", "pager.status=false",
    "-c", "diff.external=",
    "--no-optional-locks"
  ];
  let repositoryPath: string;
  let statusOutput: string;
  try {
    const repository = await execFileAsync("git", [...gitArgs, "rev-parse", "--show-toplevel"], gitOptions(cwd));
    repositoryPath = repository.stdout.trim();
    if (!isPathInside(safe.rootRealPath, repositoryPath)) {
      throw new CapabilityError("INVALID_ARGUMENT", "Git repository escapes the storage pool");
    }
    const statusResult = await execFileAsync(
      "git",
      [...gitArgs, "status", "--porcelain=v2", "--branch", "--untracked-files=normal"],
      gitOptions(repositoryPath)
    );
    statusOutput = statusResult.stdout;
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CapabilityError("NOT_READY", "Git executable is unavailable", { retryable: true });
    }
    throw new CapabilityError("INVALID_ARGUMENT", "Path is not inside a readable Git repository", { cause: error });
  }
  const branch: Record<string, JsonValue> = { head: null, oid: null, upstream: null, ahead: 0, behind: 0 };
  const files: JsonValue[] = [];
  for (const line of statusOutput.split("\n")) {
    if (line.startsWith("# branch.head ")) branch.head = line.slice(14);
    else if (line.startsWith("# branch.oid ")) branch.oid = line.slice(13);
    else if (line.startsWith("# branch.upstream ")) branch.upstream = line.slice(18);
    else if (line.startsWith("# branch.ab ")) {
      const match = /^# branch\.ab \+(\d+) -(\d+)$/u.exec(line);
      if (match) {
        branch.ahead = Number(match[1]);
        branch.behind = Number(match[2]);
      }
    } else if (line && !line.startsWith("#") && files.length < 2000) {
      files.push({ code: line[0] ?? "?", value: line.slice(2, 4098) });
    }
  }
  return {
    data: {
      storagePoolId: root.id,
      repositoryPath: toRootRelative(safe.rootRealPath, repositoryPath),
      branch,
      files,
      clean: files.length === 0,
      truncated: statusOutput.split("\n").filter((line) => line && !line.startsWith("#")).length > files.length
    }
  };
}

async function inspectArchive(root: ResolvedStoragePool, input: Record<string, JsonValue>): Promise<CapabilityExecution> {
  const requestedPath = requiredString(input.path, "path");
  const safe = await safeExisting(root, requestedPath);
  const metadata = await stat(safe.realPath);
  if (!metadata.isFile()) throw new CapabilityError("INVALID_ARGUMENT", "Archive path must be a regular file");
  const lower = safe.realPath.toLocaleLowerCase();
  let command: string;
  let args: string[];
  if (lower.endsWith(".zip")) {
    command = "unzip";
    args = ["-Z1", safe.realPath];
  } else if (lower.endsWith(".tar") || lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    command = "tar";
    args = ["-tf", safe.realPath];
  } else if (lower.endsWith(".rar")) {
    command = "unrar";
    args = ["lb", safe.realPath];
  } else if (lower.endsWith(".gz")) {
    command = "gzip";
    args = ["-l", safe.realPath];
  } else {
    throw new CapabilityError("INVALID_ARGUMENT", "Supported archives are zip, tar, tgz, gzip, and rar");
  }
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(command, args, {
      timeout: DEFAULT_TIMEOUT_MS,
      maxBuffer: MAX_OUTPUT_BYTES,
      encoding: "utf8",
      env: restrictedEnvironment(path.dirname(safe.realPath))
    }));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new CapabilityError("NOT_READY", `${command} archive reader is unavailable`, { retryable: true });
    }
    throw new CapabilityError("INVALID_ARGUMENT", "Archive could not be inspected safely", { cause: error });
  }
  const rawEntries = command === "gzip"
    ? [path.basename(safe.realPath).replace(/\.gz$/iu, "")]
    : stdout.split(/\r?\n/u).filter(Boolean);
  if (rawEntries.some(unsafeArchiveEntry)) {
    throw new CapabilityError("INVALID_ARGUMENT", "Archive contains an unsafe absolute or traversal entry");
  }
  const limit = boundedInteger(input.limit, 100, 1, 200);
  const signature = stableSignature({ storagePoolId: root.id, requestedPath, size: metadata.size, mtimeMs: metadata.mtimeMs });
  const offset = decodeCursor(optionalString(input.cursor), signature);
  const entries = rawEntries.slice(offset, offset + limit).map((entry) => ({ path: entry }));
  const nextOffset = offset + entries.length;
  return {
    data: { storagePoolId: root.id, path: safe.relativePath, format: archiveFormat(lower), entries, totalEntries: rawEntries.length },
    page: { limit, nextCursor: nextOffset < rawEntries.length ? encodeCursor(nextOffset, signature) : null }
  };
}

async function walk(
  root: ResolvedStoragePool,
  requestedPath: string,
  budget: { maxEntries: number; timeoutMs: number; startedAt: number }
): Promise<{ entries: WalkEntry[]; skippedSymlinks: number; truncated: boolean }> {
  const start = await safeExisting(root, requestedPath);
  const startStat = await lstat(start.absolutePath);
  if (startStat.isSymbolicLink()) throw new CapabilityError("INVALID_ARGUMENT", "Symbolic link paths are not supported");
  const entries: WalkEntry[] = [];
  let skippedSymlinks = 0;
  let truncated = false;
  const queue = [start.realPath];
  while (queue.length > 0) {
    ensureWithinBudget(budget.startedAt, budget.timeoutMs);
    const current = queue.shift()!;
    const currentStat = await lstat(current);
    if (currentStat.isSymbolicLink()) {
      skippedSymlinks += 1;
      continue;
    }
    if (current !== start.rootRealPath || requestedPath !== ".") {
      entries.push({
        absolutePath: current,
        relativePath: toRootRelative(start.rootRealPath, current),
        kind: currentStat.isDirectory() ? "directory" : "file",
        size: currentStat.size,
        mtimeMs: currentStat.mtimeMs
      });
      if (entries.length >= budget.maxEntries) {
        truncated = queue.length > 0 || currentStat.isDirectory();
        break;
      }
    }
    if (!currentStat.isDirectory()) continue;
    const children = await readdir(current, { withFileTypes: true });
    children.sort((left, right) => left.name.localeCompare(right.name));
    for (const child of children) {
      if (child.isSymbolicLink()) {
        skippedSymlinks += 1;
        continue;
      }
      queue.push(path.join(current, child.name));
    }
  }
  entries.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { entries, skippedSymlinks, truncated };
}

async function safeExisting(root: ResolvedStoragePool, requestedPath: string) {
  try {
    const safe = await resolveSafeExistingPath(root.path, requestedPath);
    if (path.resolve(safe.absolutePath) !== path.resolve(safe.realPath)) {
      throw new CapabilityError("INVALID_ARGUMENT", "Symbolic link paths are not supported");
    }
    return safe;
  } catch (error) {
    if (error instanceof CapabilityError) throw error;
    throw new CapabilityError("INVALID_ARGUMENT", "NAS path is invalid or unavailable", { cause: error });
  }
}

function gitOptions(cwd: string) {
  return {
    cwd,
    timeout: DEFAULT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    encoding: "utf8" as const,
    env: {
      ...restrictedEnvironment(cwd),
      GIT_CONFIG_NOSYSTEM: "1",
      GIT_CONFIG_GLOBAL: "/dev/null",
      GIT_OPTIONAL_LOCKS: "0",
      GIT_TERMINAL_PROMPT: "0"
    }
  };
}

function restrictedEnvironment(cwd: string): NodeJS.ProcessEnv {
  return { HOME: cwd, PATH: "/usr/local/bin:/usr/bin:/bin", LANG: "C.UTF-8", LC_ALL: "C.UTF-8", TMPDIR: "/tmp" };
}

function unsafeArchiveEntry(entry: string): boolean {
  if (!entry || entry.includes("\0") || path.posix.isAbsolute(entry) || path.win32.isAbsolute(entry)) return true;
  const normalized = entry.replaceAll("\\", "/");
  return normalized.split("/").some((segment) => segment === "..");
}

function archiveFormat(filePath: string): string {
  if (filePath.endsWith(".zip")) return "zip";
  if (filePath.endsWith(".rar")) return "rar";
  if (filePath.endsWith(".tar")) return "tar";
  if (filePath.endsWith(".tar.gz") || filePath.endsWith(".tgz")) return "tgz";
  return "gzip";
}

function globToRegExp(glob: string): RegExp {
  if (!glob || glob.length > 500 || glob.includes("\0")) throw new CapabilityError("INVALID_ARGUMENT", "glob is invalid");
  let source = "^";
  for (let index = 0; index < glob.length; index += 1) {
    const character = glob[index]!;
    if (character === "*") {
      if (glob[index + 1] === "*") {
        source += ".*";
        index += 1;
      } else source += "[^/]*";
    } else if (character === "?") source += "[^/]";
    else source += character.replace(/[\\^$.*+?()[\]{}|]/gu, "\\$&");
  }
  return new RegExp(`${source}$`, "u");
}

function matchesFilters(relativePath: string, include: RegExp[], exclude: RegExp[]): boolean {
  const basename = path.basename(relativePath);
  if (include.length > 0 && !include.some((pattern) => pattern.test(relativePath) || pattern.test(basename))) return false;
  return !exclude.some((pattern) => pattern.test(relativePath) || pattern.test(basename));
}

function stableSignature(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("base64url").slice(0, 24);
}

function encodeCursor(offset: number, signature: string): string {
  return Buffer.from(JSON.stringify({ offset, signature }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined, signature: string): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as { offset?: unknown; signature?: unknown };
    if (!Number.isSafeInteger(parsed.offset) || Number(parsed.offset) < 0 || parsed.signature !== signature) throw new Error();
    return Number(parsed.offset);
  } catch {
    throw new CapabilityError("INVALID_ARGUMENT", "cursor is invalid for this request");
  }
}

function ensureWithinBudget(startedAt: number, timeoutMs: number): void {
  if (Date.now() - startedAt > timeoutMs) throw new CapabilityError("RATE_LIMITED", "File scan exceeded its time budget", { retryable: true });
}

function requiredString(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new CapabilityError("INVALID_ARGUMENT", `${field} is required`);
  return value.trim();
}

function optionalString(value: JsonValue | undefined): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function boundedInteger(value: JsonValue | undefined, fallback: number, minimum: number, maximum: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new CapabilityError("INVALID_ARGUMENT", `integer must be between ${minimum} and ${maximum}`);
  }
  return value;
}

function stringArray(value: JsonValue | undefined, field: string, maximum: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximum || value.some((item) => typeof item !== "string" || !item || item.length > 500)) {
    throw new CapabilityError("INVALID_ARGUMENT", `${field} must be a bounded string array`);
  }
  return value as string[];
}
