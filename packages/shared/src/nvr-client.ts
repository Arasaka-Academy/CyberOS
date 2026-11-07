import { request } from "node:http";
import path from "node:path";
import type { CyberOsRuntime } from "./types.js";

export type NvrMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
export const nvrSocketPath = (config: Pick<CyberOsRuntime, "environment" | "paths">) =>
  config.environment === "production" ? "/run/cyberos/nvr.sock" : path.join(config.paths.stateDir, "nvr.sock");
export class NvrError extends Error {
  constructor(message: string, readonly statusCode: number) { super(message); }
}
export interface NvrRuntime {
  command(method: NvrMethod, route: string, body?: unknown): Promise<unknown>;
}
export function createNvrRuntime(config: CyberOsRuntime): NvrRuntime {
  return {
    command: (method, route, body) => new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ socketPath: nvrSocketPath(config), path: route, method,
        headers: data ? { "content-type": "application/json", "content-length": Buffer.byteLength(data) } : {},
      }, (res) => {
        const chunks: Buffer[] = []; let size = 0;
        res.on("data", (chunk: Buffer) => {
          size += chunk.length;
          if (size > 8 * 1024 * 1024) req.destroy(); else chunks.push(chunk);
        });
        res.on("error", () => reject(new NvrError("NVR service unavailable", 503)));
        res.on("end", () => {
          if (res.statusCode === 204) { resolve(undefined); return; }
          try {
            const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            if ((res.statusCode ?? 503) >= 400) {
              const message = value && typeof value === "object" && "error" in value && typeof value.error === "string" ? value.error : "NVR request failed";
              reject(new NvrError(message, res.statusCode ?? 503));
            } else resolve(value);
          } catch { reject(new NvrError("Invalid NVR response", 503)); }
        });
      });
      req.setTimeout(30000, () => req.destroy());
      req.on("error", () => reject(new NvrError("NVR service unavailable", 503)));
      req.end(data);
    }),
  };
}
