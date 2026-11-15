import { createHash } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { capabilityInputSchema, CapabilityError, type JsonValue } from "@cyberos/capabilities";
import { boundMediaResult } from "./media-capabilities.js";

export type CapabilityInput = Record<string, JsonValue>;
export type CapabilityHttpRequest = { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; url: string; payload?: unknown };

export function object(value: unknown): CapabilityInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CapabilityError("INVALID_ARGUMENT", "An object is required");
  return value as CapabilityInput;
}
export function validateCapability(id: string, value: JsonValue): CapabilityInput {
  const schema = z.fromJSONSchema(capabilityInputSchema(id) as Parameters<typeof z.fromJSONSchema>[0]);
  if (!schema.safeParse(value).success) throw new CapabilityError("INVALID_ARGUMENT", "Invalid capability arguments");
  return object(value);
}
export function identifier(value: JsonValue | undefined): string {
  if (typeof value !== "string" || !value) throw new CapabilityError("INVALID_ARGUMENT", "An identifier is required");
  return encodeURIComponent(value);
}
export function json(value: unknown): JsonValue { return JSON.parse(JSON.stringify(value)) as JsonValue; }
export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function omit(input: CapabilityInput, ...keys: string[]): CapabilityInput {
  return Object.fromEntries(Object.entries(input).filter(([key]) => !keys.includes(key)));
}
export function query(base: string, input: CapabilityInput): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) if (value !== undefined && value !== null) params.set(key, String(value));
  return `${base}?${params}`;
}
export async function capabilityHttp(server: FastifyInstance, request: CapabilityHttpRequest): Promise<JsonValue> {
  const response = await server.inject({ method: request.method, url: request.url,
    ...(request.payload === undefined ? {} : { payload: JSON.stringify(request.payload), headers: { "content-type": "application/json" } }) });
  if (response.statusCode >= 400) {
    const code = response.statusCode === 409 ? "CONFLICT" : [401, 403].includes(response.statusCode) ? "FORBIDDEN" : response.statusCode < 500 ? "INVALID_ARGUMENT" : "NOT_READY";
    // Backend errors may echo credentials or request bodies.
    throw new CapabilityError(code, `Domain operation failed (HTTP ${response.statusCode})`, { retryable: response.statusCode >= 500 });
  }
  if (response.statusCode === 204) return { saved: true };
  try { return response.json<JsonValue>(); } catch { throw new CapabilityError("INTERNAL", "Domain returned an invalid response"); }
}

export function redactText(value: string): string {
  return value
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/giu, "Bearer [redacted]")
    .replace(/(\b[a-z][a-z0-9+.-]{0,63}:\/\/)[^\s/@]+@/giu, "$1[redacted]@")
    .replace(/((?:authorization|password|passwd|api[_-]?key|auth[_-]?key|secret|access[_-]?token|bearer)[\s"'=:]+)[^\s,"'};]+/giu, "$1[redacted]")
    .replace(/([?&](?:token|key|password|secret|auth)=[^&#\s]*)/giu, "[redacted]");
}
export function redactCapability(value: JsonValue): JsonValue {
  if (typeof value === "string") return redactText(value);
  if (Array.isArray(value)) return value.map(redactCapability);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key,
    /^(password|passwd|chapPassword|api[_-]?key|auth[_-]?key|cyberAudioToken|authorization|auth|secret|clientSecret|privateKey|token|access[_-]?token|refresh[_-]?token|secretHeaders|headers|environment|env|composeContent|rawConfig|username|auths|identityToken|registryToken|content)$/iu.test(key)
      ? "[redacted]" : redactCapability(item)]));
}
export function safeCapabilityResult(value: JsonValue, input: CapabilityInput = {}): JsonValue {
  const root = value && typeof value === "object" && !Array.isArray(value) ? value : { items: value };
  return boundMediaResult(redactCapability(root), input);
}

/** Fingerprinted offset pagination for bounded domain collections without native cursors. */
export function boundedPageItems<T>(items: readonly T[], limit: number): T[] {
  const selected: T[] = [];
  let bytes = 0;
  for (const item of items.slice(0, limit)) {
    const size = Buffer.byteLength(JSON.stringify(item));
    if (selected.length && bytes + size > 100_000) break;
    selected.push(item);
    bytes += size;
  }
  return selected;
}

export function collectionPage(items: JsonValue[], input: CapabilityInput, identity: unknown): JsonValue {
  const fingerprint = digest(identity);
  let offset = 0;
  if (input.cursor) {
    try {
      const cursor = JSON.parse(Buffer.from(String(input.cursor), "base64url").toString()) as { fingerprint: string; offset: number };
      if (cursor.fingerprint !== fingerprint || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > items.length) throw new Error();
      offset = cursor.offset;
    } catch { throw new CapabilityError("INVALID_ARGUMENT", "Cursor is invalid or belongs to another query"); }
  }
  const limit = typeof input.limit === "number" ? input.limit : 40;
  const selected = boundedPageItems(items.slice(offset), limit);
  return { total: items.length, limit,
    nextCursor: offset + selected.length < items.length ? Buffer.from(JSON.stringify({ fingerprint, offset: offset + selected.length })).toString("base64url") : null,
    items: selected };
}
