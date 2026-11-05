import { isIP } from "node:net";
import { Agent, Client, ProxyAgent, buildConnector, fetch as undiciFetch, type Dispatcher } from "undici";
import { systemProxyUrl, type SystemProxySettingsRecord } from "@cyberos/shared";

/** A scoped client: explicit direct/proxy dispatchers never change process-wide routing. */
export class ProxyHttpClient {
  private active: { key: string; dispatcher: Dispatcher } | null = null;
  private readonly retiring = new Set<Promise<void>>();
  private closed = false;

  constructor(
    private readonly resolveProxy: () => SystemProxySettingsRecord | null,
    private readonly tls?: { ca: string },
    private readonly options: { followHttpsRedirects?: boolean } = {}
  ) {}

  async fetch(input: string | URL | Request, init?: RequestInit): Promise<Response> {
    if (this.closed) throw new Error("Outbound client is closed");
    const proxy = this.resolveProxy();
    const key = proxy ? systemProxyUrl(proxy) : "direct";
    if (this.active?.key !== key) {
      const dispatcher = proxy
        ? this.proxyDispatcher(proxy, key)
        : new Agent(this.tls ? { connect: this.tls } : {});
      if (this.active) this.retire(this.active.dispatcher);
      this.active = { key, dispatcher };
    }
    const requestInit = {
      ...(init as Parameters<typeof undiciFetch>[1]),
      dispatcher: this.active.dispatcher,
      redirect: "manual" as const
    };
    let target = input;
    for (let redirects = 0; ; redirects += 1) {
      const response = await undiciFetch(target as string | URL, requestInit);
      if (response.status < 300 || response.status >= 400) return response as unknown as Response;
      await response.body?.cancel();
      const location = response.headers.get("location");
      const method = requestInit.method ?? (input instanceof Request ? input.method : "GET");
      if (!this.options.followHttpsRedirects || ![301, 302, 303, 307, 308].includes(response.status)
        || !location || !["GET", "HEAD"].includes(method.toUpperCase())) {
        throw new Error("Upstream redirects are not allowed");
      }
      if (redirects >= 5) throw new Error("Upstream redirect limit exceeded");
      const next = new URL(location, response.url);
      if (next.protocol !== "https:" || next.username || next.password) {
        throw new Error("Upstream redirects must use HTTPS without credentials");
      }
      if (new URL(response.url).origin !== next.origin) {
        const headers = new Headers(requestInit.headers as HeadersInit);
        for (const name of ["authorization", "cookie", "proxy-authorization", "host"]) headers.delete(name);
        requestInit.headers = Array.from(headers.entries());
      }
      target = next;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    if (this.active) this.retire(this.active.dispatcher);
    this.active = null;
    await Promise.all(this.retiring);
  }

  private retire(dispatcher: Dispatcher): void {
    const closing = dispatcher.close().catch(() => undefined).finally(() => this.retiring.delete(closing));
    this.retiring.add(closing);
  }

  private proxyDispatcher(proxy: SystemProxySettingsRecord, uri: string): Dispatcher {
    const connector = buildConnector({ ...this.tls, timeout: 5_000 });
    return new ProxyAgent({
      uri,
      connectTimeout: 5_000,
      ...(this.tls ? { requestTls: this.tls } : {}),
      // SOCKS5 negotiation is plaintext; TLS is applied to the destination afterward.
      ...(proxy.protocol === "https" && this.tls ? { proxyTls: this.tls } : {}),
      ...(proxy.protocol === "https" && isIP(proxy.host!) ? {
        // Undici passes the proxy IP as SNI. Omit SNI while retaining IP certificate verification.
        clientFactory: (origin, options) => new Client(origin, {
          ...options,
          connect: (connection, callback) => connector({ ...connection, servername: "" }, callback)
        })
      } satisfies Pick<ProxyAgent.Options, "clientFactory"> : {})
    });
  }
}
