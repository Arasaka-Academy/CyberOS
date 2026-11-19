/**
 * [INPUT]: 依赖 Node 密钥、私有文件、受控 HTTPS 和发送前授权检查。
 * [OUTPUT]: 提供持久 VAPID、订阅校验与加密推送传输。
 * [POS]: API 与 worker 共用的 Node 边界；浏览器入口不导出秘密能力。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createECDH, randomUUID } from "node:crypto";
import { lookup } from "node:dns/promises";
import { constants, closeSync, fstatSync, fsyncSync, linkSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { LookupFunction } from "node:net";
import { Agent, fetch as undiciFetch } from "undici";
import { generateVAPIDKeys, generateRequestDetails } from "web-push";
import { validateMcpEndpoint, type McpAddressResolver, type ValidatedMcpEndpoint } from "./mcp-network.js";
import type { BrowserPushPayload, BrowserPushSubscriptionInput } from "./notifications.js";

export interface BrowserPushVapidKeys { publicKey: string; privateKey: string }
export interface BrowserPushResult { status: number; retryAfter: string | null; cancelled?: true }
export type BrowserPushTransport = (subscription: BrowserPushSubscriptionInput, payload: BrowserPushPayload, keys: BrowserPushVapidKeys, signal?: AbortSignal, ttlSeconds?: number, subject?: string, beforeSend?: () => boolean) => Promise<BrowserPushResult>;
interface EncryptedPushRequest {
  body: Buffer;
  headers: Record<string, string>;
  signal: AbortSignal;
  redirect: "manual";
  endpoint: ValidatedMcpEndpoint;
}
interface BrowserPushTransportOptions {
  resolve?: McpAddressResolver;
  request?: (url: string, init: EncryptedPushRequest) => Promise<BrowserPushResult>;
}

export class BrowserPushTransportError extends Error {
  constructor(readonly kind: "unsafe_endpoint" | "network") {
    super(kind === "unsafe_endpoint" ? "Push endpoint is not a public HTTPS service" : "Push service request failed");
    this.name = "BrowserPushTransportError";
  }
}

export function loadBrowserPushVapidKeys(directory: string): BrowserPushVapidKeys {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = path.join(directory, "browser-push-vapid.json");
  try { return readVapid(file); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  const temporary = `${file}.${randomUUID()}.tmp`;
  const keys = generateVAPIDKeys();
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, 0o600);
    writeFileSync(descriptor, JSON.stringify(keys));
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    // 原子硬链接只发布完整文件；并发初始化保留先发布的密钥。
    try { linkSync(temporary, file); } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
    return readVapid(file);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    try { unlinkSync(temporary); } catch { /* 临时秘密始终为 0600；清理失败不覆盖初始化结果。 */ }
  }
}

function readVapid(file: string): BrowserPushVapidKeys {
  const descriptor = openSync(file, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || (metadata.mode & 0o077) !== 0) throw new Error("VAPID file must be a private regular file");
    const value: unknown = JSON.parse(readFileSync(descriptor, "utf8"));
    if (!isRecord(value) || !validBase64Url(value.publicKey, 65) || !validBase64Url(value.privateKey, 32)) throw new Error("VAPID file is invalid");
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(Buffer.from(value.privateKey, "base64url"));
    if (ecdh.getPublicKey().toString("base64url") !== value.publicKey) throw new Error("VAPID key pair is invalid");
    return { publicKey: value.publicKey, privateKey: value.privateKey };
  } finally { closeSync(descriptor); }
}

export function validateBrowserPushSubscription(value: unknown): BrowserPushSubscriptionInput {
  if (!isRecord(value) || typeof value.endpoint !== "string" || value.endpoint.length > 4096 || !isRecord(value.keys)
    || !validBase64Url(value.keys.p256dh, 65) || !validBase64Url(value.keys.auth, 16)
    || (value.expirationTime !== null && (typeof value.expirationTime !== "number" || !Number.isFinite(value.expirationTime) || value.expirationTime <= Date.now()))) {
    throw new Error("Push subscription is invalid");
  }
  try {
    const key = Buffer.from(value.keys.p256dh, "base64url");
    if (key[0] !== 4) throw new Error("Invalid curve point");
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    ecdh.computeSecret(key);
    const url = new URL(value.endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.hash) throw new Error("Invalid endpoint");
  } catch { throw new Error("Push subscription is invalid"); }
  return { endpoint: value.endpoint, expirationTime: value.expirationTime as number | null, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

export async function validateBrowserPushEndpoint(rawUrl: string, resolve?: McpAddressResolver): Promise<ValidatedMcpEndpoint> {
  let resolutionFailed = false;
  try {
    const endpoint = await validateMcpEndpoint(rawUrl, false, async (hostname) => {
      try {
        const records = await (resolve ? resolve(hostname) : lookup(hostname, { all: true, verbatim: true }));
        if (records.length === 0) resolutionFailed = true;
        return records;
      } catch (error) { resolutionFailed = true; throw error; }
    });
    if (endpoint.url.protocol !== "https:" || endpoint.addressClasses.some((entry) => entry !== "public") || endpoint.addresses.some((address) => !globalUnicast(address))) throw new Error("Not public");
    return endpoint;
  } catch { throw new BrowserPushTransportError(resolutionFailed ? "network" : "unsafe_endpoint"); }
}

export function createBrowserPushTransport(options: BrowserPushTransportOptions = {}): BrowserPushTransport {
  return async (subscription, payload, keys, signal, ttlSeconds = 24 * 60 * 60, subject = "mailto:notifications@cyberos.local", beforeSend) => {
    const requestSignal = AbortSignal.any([AbortSignal.timeout(10_000), ...(signal ? [signal] : [])]);
    try {
      requestSignal.throwIfAborted();
      const endpoint = await abortable(validateBrowserPushEndpoint(subscription.endpoint, options.resolve), requestSignal);
      requestSignal.throwIfAborted();
      const details = generateRequestDetails(subscription, JSON.stringify(payload), {
        TTL: Math.max(1, Math.min(24 * 60 * 60, Math.floor(ttlSeconds))),
        urgency: "normal",
        contentEncoding: "aes128gcm",
        vapidDetails: { subject, ...keys }
      });
      if (!details.body) throw new Error("Missing encrypted payload");
      requestSignal.throwIfAborted();
      // DNS 等待后重查持久授权；同步检查后立即开始网络请求。
      if (beforeSend && !beforeSend()) return { status: 0, retryAfter: null, cancelled: true };
      return await (options.request ?? sendEncryptedPush)(subscription.endpoint, {
        body: details.body, headers: details.headers, signal: requestSignal, redirect: "manual", endpoint
      });
    } catch (error) {
      if (error instanceof BrowserPushTransportError) throw error;
      throw new BrowserPushTransportError("network");
    }
  };
}

async function sendEncryptedPush(url: string, init: EncryptedPushRequest): Promise<BrowserPushResult> {
  const records = init.endpoint.addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));
  const dispatcher = new Agent({ connect: { lookup: ((_hostname, options, callback) => {
    const normalized = typeof options === "object" && options !== null ? options : {};
    // 每个请求只连接校验时的公网地址，不再次解析 DNS。
    if ("all" in normalized && normalized.all) callback(null, records);
    else { const record = records.find((entry) => !normalized.family || entry.family === normalized.family) ?? records[0]!; callback(null, record.address, record.family); }
  }) as LookupFunction } });
  try {
    const response = await undiciFetch(url, { method: "POST", headers: init.headers, body: init.body, dispatcher, signal: init.signal, redirect: init.redirect });
    await response.body?.cancel();
    return { status: response.status, retryAfter: response.headers.get("retry-after") };
  } finally { await dispatcher.close(); }
}

async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return await new Promise<T>((resolve, reject) => {
    const abort = () => reject(new Error("Push request aborted"));
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
    if (signal.aborted) abort();
  });
}
function validBase64Url(value: unknown, bytes: number): value is string { return typeof value === "string" && /^[A-Za-z0-9_-]+$/u.test(value) && Buffer.from(value, "base64url").length === bytes && Buffer.from(value, "base64url").toString("base64url") === value; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null && !Array.isArray(value); }
function hasCode(value: unknown, code: string): boolean { return isRecord(value) && value.code === code; }

function globalUnicast(address: string): boolean {
  if (!address.includes(":")) return true;
  // IPv6 只接受全球单播；拒绝保留区、站点本地和内嵌 IPv4 过渡机制。
  const first = Number.parseInt(address.split(":")[0]!, 16);
  const second = Number.parseInt(address.split(":")[1] || "0", 16);
  return first >= 0x2000 && first <= 0x3fff && first !== 0x2002 && first !== 0x3fff
    && !(first === 0x2001 && second < 0x200);
}
