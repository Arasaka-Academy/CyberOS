/**
 * [INPUT]: 依赖能力 ID 与 MCP 调用请求。
 * [OUTPUT]: 提供短工具名和历史调用名称转换。
 * [POS]: MCP 名称边界；能力目录和传输层共用映射。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export function mcpToolName(capabilityId: string): string {
  return capabilityId.replace(/^cyberos\./u, "");
}

export function normalizeLegacyMcpToolCall(body: unknown): unknown {
  if (!body || typeof body !== "object" || !("method" in body) || body.method !== "tools/call"
    || !("params" in body) || !body.params || typeof body.params !== "object"
    || !("name" in body.params) || typeof body.params.name !== "string") return body;
  return { ...body, params: { ...body.params, name: mcpToolName(body.params.name) } };
}
