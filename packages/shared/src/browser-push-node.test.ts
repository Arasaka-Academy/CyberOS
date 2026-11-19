/**
 * [INPUT]: 依赖临时秘密目录、真实 P-256 密钥和注入 DNS。
 * [OUTPUT]: 验证 VAPID 持久化、订阅输入和公网传输边界。
 * [POS]: Node 通知发送基础设施的安全回归。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createECDH } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, stat, chmod } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadBrowserPushVapidKeys, validateBrowserPushSubscription, validateBrowserPushEndpoint, createBrowserPushTransport } from "./browser-push-node.js";

let directory: string | undefined;
afterEach(async () => { if (directory) await rm(directory, { recursive: true, force: true }); directory = undefined; });

export function pushSubscription(endpoint = "https://push.example/send/secret") {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { endpoint, expirationTime: null, keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") } };
}

describe("browser push node boundary", () => {
  it("persists one private VAPID key pair across repeated initializers", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-vapid-"));
    const first = loadBrowserPushVapidKeys(directory);
    expect(loadBrowserPushVapidKeys(directory)).toEqual(first);
    expect(first.publicKey).toHaveLength(87);
    expect((await stat(path.join(directory!, "browser-push-vapid.json"))).mode & 0o777).toBe(0o600);
    expect(JSON.parse(await readFile(path.join(directory!, "browser-push-vapid.json"), "utf8"))).toEqual(first);
  });

  it("rejects a VAPID secret with group permissions", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-vapid-"));
    loadBrowserPushVapidKeys(directory);
    await chmod(path.join(directory!, "browser-push-vapid.json"), 0o640);
    expect(() => loadBrowserPushVapidKeys(directory!)).toThrow(/private/u);
  });

  it("publishes one complete key pair when separate processes initialize concurrently", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-vapid-race-"));
    const moduleUrl = new URL("./browser-push-node.ts", import.meta.url).href;
    const code = `import { loadBrowserPushVapidKeys } from ${JSON.stringify(moduleUrl)}; console.log(JSON.stringify(loadBrowserPushVapidKeys(process.argv[1])));`;
    const results = await Promise.all(Array.from({ length: 4 }, () => promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", code, directory!])));
    const keys = results.map((result) => JSON.parse(result.stdout));
    expect(keys).toEqual(Array.from({ length: 4 }, () => keys[0]));
    expect(loadBrowserPushVapidKeys(directory)).toEqual(keys[0]);
  });

  it("checks P-256 subscription keys before accepting them", () => {
    expect(validateBrowserPushSubscription(pushSubscription()).keys.auth).toBe(Buffer.alloc(16, 1).toString("base64url"));
    expect(() => validateBrowserPushSubscription({ ...pushSubscription(), keys: { auth: "secret", p256dh: "invalid" } })).toThrow(/subscription/u);
  });

  it("rejects every private DNS answer and insecure endpoint", async () => {
    for (const address of ["127.0.0.1", "192.168.1.1", "100.64.0.1", "169.254.169.254", "::1", "fd00::1", "fec0::1", "::127.0.0.1", "2002:a00:1::", "2001:0::1", "3fff::1"]) {
      await expect(validateBrowserPushEndpoint("https://push.example/id", async () => [{ address, family: address.includes(":") ? 6 : 4 }])).rejects.toThrow(/public/u);
    }
    await expect(validateBrowserPushEndpoint("http://8.8.8.8/id")).rejects.toThrow();
    await expect(validateBrowserPushEndpoint("https://push.example/id", async () => [{ address: "8.8.8.8", family: 4 }, { address: "10.0.0.1", family: 4 }])).rejects.toThrow(/public/u);
    await expect(validateBrowserPushEndpoint("https://push.example/id", async () => [{ address: "2001:4860:4860::8888", family: 6 }])).resolves.toMatchObject({ addresses: ["2001:4860:4860::8888"] });
  });

  it("classifies temporary DNS failures as retryable network errors", async () => {
    await expect(validateBrowserPushEndpoint("https://push.example/id", async () => { throw new Error("temporary DNS failure"); })).rejects.toMatchObject({ kind: "network" });
    await expect(validateBrowserPushEndpoint("https://push.example/id", async () => [])).rejects.toMatchObject({ kind: "network" });
  });

  it("encrypts a standard payload before the injected HTTP request and disables redirects", async () => {
    directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-vapid-"));
    let captured: { url: string; body: Buffer; headers: Record<string, string> } | undefined;
    const transport = createBrowserPushTransport({
      resolve: async () => [{ address: "8.8.8.8", family: 4 }],
      request: async (url, init) => { captured = { url, body: init.body, headers: init.headers }; expect(init.redirect).toBe("manual"); return { status: 201, retryAfter: null }; }
    });
    const result = await transport(pushSubscription(), { version: 1, eventId: 1, type: "system.test", title: "private-title", body: "private-body", target: { kind: "home" } }, loadBrowserPushVapidKeys(directory), undefined, 60, "https://nas.example");
    expect(result.status).toBe(201);
    expect(captured?.body.includes(Buffer.from("private-title"))).toBe(false);
    expect(captured?.headers["Content-Encoding"]).toBe("aes128gcm");
    expect(captured?.headers.Authorization).toMatch(/^vapid /u);
    expect(captured?.headers.TTL).toBe(60);
    const jwt = /t=([^,]+)/u.exec(captured!.headers.Authorization!)![1]!;
    expect(JSON.parse(Buffer.from(jwt.split(".")[1]!, "base64url").toString())).toMatchObject({ sub: "https://nas.example" });
  });
});
