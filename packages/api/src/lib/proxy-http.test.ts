import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { createServer as createTcpServer, connect, type AddressInfo, type Server, type Socket } from "node:net";
import { readFileSync } from "node:fs";
import { once } from "node:events";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import { ProxyHttpClient } from "./proxy-http.js";
import type { SystemProxySettingsRecord } from "@cyberos/shared";

// Public test-only certificate and private key. Never used by runtime services.
const cert = readFileSync(new URL("../../../shared/test-fixtures/proxy/test-cert.pem", import.meta.url), "utf8");
const key = readFileSync(new URL("../../../shared/test-fixtures/proxy/test-key.pem", import.meta.url), "utf8");
const ca = readFileSync(new URL("../../../shared/test-fixtures/proxy/test-ca.pem", import.meta.url), "utf8");
const servers: Server[] = [];
const sockets = new Set<Socket>();
const clients: ProxyHttpClient[] = [];

async function listen(server: Server): Promise<number> {
  servers.push(server);
  server.on("connection", (socket: Socket) => { sockets.add(socket); socket.on("close", () => sockets.delete(socket)); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  await Promise.all(clients.splice(0).map((client) => client.close()));
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
});

describe("explicit outbound proxy", () => {
  it("survives a truncated response with excessive content encodings", async () => {
    const source = `
      import { createServer } from "node:net";
      import { ProxyHttpClient } from ${JSON.stringify(new URL("./proxy-http.ts", import.meta.url).href)};
      const server = createServer(socket => socket.once("data", request => {
        const response = request.toString().startsWith("GET /bad ")
          ? "HTTP/1.1 200 OK\\r\\nContent-Length: 100\\r\\nContent-Encoding: gzip, gzip, gzip, gzip, gzip, gzip\\r\\n\\r\\n"
          : "HTTP/1.1 200 OK\\r\\nContent-Length: 2\\r\\nConnection: close\\r\\n\\r\\nok";
        socket.end(response);
      }));
      await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
      const client = new ProxyHttpClient(() => null);
      const origin = "http://127.0.0.1:" + server.address().port;
      try {
        await client.fetch(origin + "/bad").catch(() => undefined);
        await new Promise(resolve => setTimeout(resolve, 50));
        const response = await client.fetch(origin + "/healthy");
        if (await response.text() !== "ok") throw new Error("Subsequent request failed");
        console.log("survived");
      } finally {
        await client.close();
        await new Promise(resolve => server.close(resolve));
      }
    `;
    const result = await promisify(execFile)(process.execPath,
      ["--import", "tsx", "--input-type=module", "--eval", source], { timeout: 5_000, maxBuffer: 64 * 1024 });
    expect(result.stdout.trim()).toBe("survived");
  });

  it.each(["http", "https", "socks5"] as const)("keeps the %s proxy snapshot across HTTPS redirects with proxy-side DNS", async (protocol) => {
    let selectedProxy: SystemProxySettingsRecord | null = null;
    const origin = await listen(createHttpsServer({ key, cert }, (req, res) => {
      if (req.url === "/proxy-test") {
        selectedProxy = null;
        res.writeHead(302, { location: "https://image.tmdb.org/map.pmtiles" });
        res.end();
      } else res.end(`received ${req.url}`);
    }));
    const destinations: string[] = [];
    const tunnel = (socket: Socket, initial: Buffer) => {
      const upstream = connect(origin, "127.0.0.1", () => { if (initial.length) upstream.write(initial); socket.pipe(upstream).pipe(socket); });
      sockets.add(upstream);
      upstream.on("close", () => sockets.delete(upstream));
      upstream.on("error", () => socket.destroy());
      socket.on("error", () => upstream.destroy());
    };
    let port: number;
    if (protocol === "socks5") {
      port = await listen(createTcpServer((socket) => {
        let buffer = Buffer.alloc(0);
        let greeted = false;
        const receive = (chunk: Buffer) => {
          buffer = Buffer.concat([buffer, chunk]);
          if (!greeted) {
            if (buffer.length < 2 || buffer.length < 2 + buffer[1]!) return;
            buffer = buffer.subarray(2 + buffer[1]!);
            socket.write(Buffer.from([5, 0]));
            greeted = true;
          }
          if (buffer.length < 5) return;
          expect(buffer[3]).toBe(3); // Hostname, rather than locally resolved IP.
          const length = buffer[4]!;
          if (buffer.length < 7 + length) return;
          destinations.push(`${buffer.subarray(5, 5 + length).toString()}:${buffer.readUInt16BE(5 + length)}`);
          socket.off("data", receive);
          socket.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]));
          tunnel(socket, buffer.subarray(7 + length));
        };
        socket.on("data", receive);
      }));
    } else {
      const proxy = protocol === "https" ? createHttpsServer({ key, cert }) : createHttpServer();
      proxy.on("connect", (req, socket, head) => {
        destinations.push(req.url!);
        socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        tunnel(socket as Socket, head);
      });
      port = await listen(proxy);
    }
    selectedProxy = { protocol, host: "127.0.0.1", port, updatedAt: "test" };
    const client = new ProxyHttpClient(() => selectedProxy, { ca }, { followHttpsRedirects: true });
    clients.push(client);
    const response = await client.fetch("https://api.themoviedb.org/proxy-test", { signal: AbortSignal.timeout(3000) });
    expect(await response.text()).toBe("received /map.pmtiles");
    expect(destinations).toEqual(["api.themoviedb.org:443", "image.tmdb.org:443"]);
  });

  it("follows relative HTTPS redirects directly, rejects downgrade and stops after five redirects", async () => {
    let loopRequests = 0;
    const port = await listen(createHttpsServer({ key, cert }, (req, res) => {
      if (req.url === "/relative") res.writeHead(302, { location: "/ready" });
      else if (req.url === "/loop") {
        loopRequests += 1;
        res.writeHead(307, { location: "/loop" });
      } else if (req.url === "/downgrade") res.writeHead(302, { location: "http://127.0.0.1:9/" });
      res.end("ready");
    }));
    const client = new ProxyHttpClient(() => null, { ca }, { followHttpsRedirects: true });
    clients.push(client);
    expect(await (await client.fetch(`https://127.0.0.1:${port}/relative`)).text()).toBe("ready");
    await expect(client.fetch(`https://127.0.0.1:${port}/downgrade`)).rejects.toThrow(/HTTPS/iu);
    await expect(client.fetch(`https://127.0.0.1:${port}/loop`)).rejects.toThrow(/redirect.*limit/iu);
    expect(loopRequests).toBe(6);
  });

  it("uses new settings on subsequent requests, rejects redirects and never falls back to direct", async () => {
    const port = await listen(createHttpServer((req, res) => {
      if (req.url === "/redirect") res.writeHead(302, { location: "http://example.invalid/" });
      res.end("direct");
    }));
    let proxy: SystemProxySettingsRecord | null = null;
    const client = new ProxyHttpClient(() => proxy);
    clients.push(client);
    expect(await (await client.fetch(`http://127.0.0.1:${port}`)).text()).toBe("direct");
    proxy = { protocol: "http", host: "127.0.0.1", port: 1, updatedAt: "test" };
    await expect(client.fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1000) })).rejects.toThrow();
    proxy = null;
    await expect(client.fetch(`http://127.0.0.1:${port}/redirect`)).rejects.toThrow(/redirect/iu);
    expect(await (await client.fetch(`http://127.0.0.1:${port}`)).text()).toBe("direct");
  });

  it("times out when the proxy does not complete the tunnel", async () => {
    const proxy = createHttpServer();
    proxy.on("connect", () => undefined);
    const port = await listen(proxy);
    const client = new ProxyHttpClient(() => ({ protocol: "http", host: "127.0.0.1", port, updatedAt: "test" }));
    clients.push(client);
    await expect(client.fetch("https://api.themoviedb.org/", { signal: AbortSignal.timeout(50) })).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
