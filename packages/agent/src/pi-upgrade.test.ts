/**
 * [INPUT]: 依赖真实 Pi SDK、隔离会话与本地 MCP 服务。
 * [OUTPUT]: 验证 SDK 升级边界和 CyberOS 工具命名契约。
 * [POS]: Agent 宿主与 SDK 的集成回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { copyFile, mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import {
  createAgentSession,
  createCodemodeExtension,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type ExtensionFactory,
  type ExtensionAPI,
  type ToolDefinition
} from "@earendil-works/pi-coding-agent";
import { McpClient } from "@earendil-works/pi-mcp";
import { Type } from "typebox";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { capabilityPendingRunId, loadControlledPiMcpConfig, piAgentToolNames, projectPiSessionEntry, registerConfiguredProvider } from "./pi-agent.js";
import { createCyberOsMcpExtension } from "./pi-mcp-extension.js";

let directory: string;
beforeEach(async () => { directory = await mkdtemp(path.join(os.tmpdir(), "cyberos-pi-upgrade-")); });
afterEach(async () => { vi.unstubAllEnvs(); await rm(directory, { recursive: true, force: true }); });

describe("embedded Pi upgrade boundaries", () => {
  it("discovers and executes single-underscore CyberOS names through direct tools and Codemode", async () => {
    const probe = await mcpNamingSession();
    const { session } = probe;
    try {
      const prompt = await session.extensionRunner.emitBeforeAgentStart(
        { messageType: "user", prompt: "List downloads" }, { cwd: directory }
      );
      expect(session.getActiveToolNames()).toContain("mcp_cyberos_files_read");
      expect(session.getCallableToolNames()).toContain("mcp_cyberos_downloads_list");
      expect(session.getCallableToolNames()).not.toContain("mcp__cyberos__downloads_list");
      expect(prompt.systemPromptOptions.sections.mcp_servers).toContain("- mcp_cyberos (codemode)");
      const direct = session.agent.state.tools.find((tool) => tool.name === "mcp_cyberos_files_read")!;
      expect(JSON.stringify(await direct.execute("direct", { path: "notes.txt" }))).toContain("files.read");
      const result = await executeCodemode(session, "discovery", `
        text(await describeNamespace("mcp_cyberos"));
        text(await searchTools("downloads", { namespace: "mcp_cyberos" }));
        text(await tools.mcp_cyberos_downloads_list({}));
      `);
      expect(JSON.stringify(result)).toContain("mcp_cyberos_downloads_list");
      expect(JSON.stringify(result)).toContain("downloads.list");
      expect(probe.calls).toEqual([
        { name: "files.read", arguments: { path: "notes.txt" } },
        { name: "downloads.list", arguments: {} }
      ]);
    } finally { await probe.close(); }
  });

  it("waits for a connecting CyberOS server before a single-underscore Codemode call", async () => {
    const gate = latch();
    const probe = await mcpNamingSession(gate.promise);
    try {
      let settled = false;
      const ready = probe.session.extensionRunner.emitToolCall({
        type: "tool_call", toolCallId: "cold", toolName: "codemode",
        input: { code: "await tools.mcp_cyberos_downloads_list({});" }
      }).finally(() => { settled = true; });
      await delay(30);
      expect(settled).toBe(false);
      gate.release();
      await ready;
      const result = await executeCodemode(probe.session, "cold", "text(await tools.mcp_cyberos_downloads_list({}));");
      expect(JSON.stringify(result)).toContain("downloads.list");
      expect(probe.calls).toEqual([{ name: "downloads.list", arguments: {} }]);
    } finally { gate.release(); await probe.close(); }
  });

  it("hides withdrawn single-underscore tools and restores them after reconnecting", async () => {
    const probe = await mcpNamingSession(undefined, true);
    try {
      await probe.session.extensionRunner.emitBeforeAgentStart(
        { messageType: "user", prompt: "Read a file" }, { cwd: directory }
      );
      const prepared = probe.session.agent.state.tools.find((tool) => tool.name === "mcp_cyberos_files_read")!;
      probe.control!.unregisterMcpServer("cyberos");
      await vi.waitFor(() => expect(probe.session.getCallableToolNames()).not.toContain("mcp_cyberos_files_read"));
      await expect(prepared.execute("withdrawn", {})).rejects.toThrow(/disabled|no longer available/);
      probe.control!.registerMcpServer("cyberos", probe.config);
      await vi.waitFor(() => expect(probe.session.getActiveToolNames()).toContain("mcp_cyberos_files_read"));
      expect(probe.session.getCallableToolNames()).toContain("mcp_cyberos_downloads_list");
    } finally { await probe.close(); }
  });

  it("reopens a Pi 1.1 JSONL without changing message or projection identities", async () => {
    const sessionFile = path.join(directory, "legacy.jsonl");
    await copyFile(new URL("./fixtures/pi-1.1.0-session.jsonl", import.meta.url), sessionFile);
    const original = await readFile(sessionFile, "utf8");
    const manager = SessionManager.open(sessionFile, directory, directory);
    expect(manager.getSessionId()).toBe("pi-1-1-restore");
    expect(manager.getBranch().map((entry) => entry.id)).toEqual(["model-1", "user-1", "assistant-1"]);
    expect(manager.buildSessionContext().messages).toHaveLength(2);
    const events: Array<{ type: string; sourceId?: string }> = [];
    for (const entry of manager.getBranch()) {
      await projectPiSessionEntry(entry, (event) => { events.push(event); });
    }
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "model_change", sourceId: "entry:model-1" }),
      expect.objectContaining({ type: "agent.message", sourceId: "entry:assistant-1:assistant" })
    ]));
    expect(await readFile(sessionFile, "utf8")).toBe(original);
  });

  it("keeps a starting session busy and honours cancellation before a provider request", async () => {
    const entered = latch();
    const release = latch();
    let requests = 0;
    const server = createServer((_request, response) => {
      requests += 1;
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "test", object: "chat.completion.chunk", created: 0,
        model: "upgrade-test-model", choices: [{ index: 0, delta: { content: "unexpected request" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    const url = await listen(server);
    const session = await sdkSession(url, [(pi) => {
      pi.on("before_agent_start", async () => { entered.release(); await release.promise; });
    }]);
    const prompt = session.prompt("This run will be cancelled", { source: "rpc" });
    let abort: Promise<void> | undefined;
    try {
      await entered.promise;
      expect(session.isIdle).toBe(false);
      abort = session.abort();
      release.release();
      await Promise.all([prompt, abort]);
      expect(requests).toBe(0);
      expect(session.isIdle).toBe(true);
    } finally {
      release.release();
      await Promise.allSettled([prompt, abort]);
      session.dispose();
      await close(server);
    }
  });

  it("accepts arbitrary MCP JSON without confusing it with a pending CyberOS approval", async () => {
    const pending = { runId: "approval-run", data: { state: "waiting_approval" } };
    const values: unknown[] = [[{ id: 1 }], null, 42, pending];
    const server = createServer(async (request, response) => {
      if (request.method !== "POST") { response.writeHead(405).end(); return; }
      let text = "";
      for await (const chunk of request) text += String(chunk);
      const rpc = JSON.parse(text) as { id?: number; method: string; params?: { protocolVersion?: string; arguments?: { index: number } } };
      if (rpc.id === undefined) { response.writeHead(202).end(); return; }
      const result = rpc.method === "initialize"
        ? { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "upgrade-test", version: "1" } }
        : { content: [], structuredContent: values[rpc.params?.arguments?.index ?? 0] };
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
    });
    const url = await listen(server);
    const loaded = await loadControlledPiMcpConfig({ generation: 1, servers: [{
      id: "00000000-0000-4000-8000-000000000001", name: "upgrade-test", url,
      description: "Upgrade probe", exposure: "codemode", timeoutSeconds: 2, allowInsecureHttp: true
    }] });
    const client = new McpClient({ name: "CyberOS upgrade test", version: "1", requestTimeoutMs: 2_000 });
    try {
      await client.connect(loaded.createTransport(loaded.config.servers[0]!, directory, undefined));
      for (const [index, value] of values.entries()) {
        const result = await client.callTool("probe", { index });
        expect(result.structuredContent).toEqual(value);
        expect(capabilityPendingRunId(result)).toBe(index === 3 ? "approval-run" : null);
      }
    } finally {
      await client.close();
      await loaded.close();
      await close(server);
    }
  });

  it("compacts with the model output limit instead of treating reserveTokens as an output cap", async () => {
    const requests: Array<Record<string, unknown>> = [];
    const server = createServer(async (request, response) => {
      let body = "";
      for await (const chunk of request) body += String(chunk);
      requests.push(JSON.parse(body) as Record<string, unknown>);
      response.writeHead(200, { "Content-Type": "text/event-stream" });
      response.end(`data: ${JSON.stringify({ id: "summary", object: "chat.completion.chunk", created: 0,
        model: "upgrade-test-model", choices: [{ index: 0, delta: { content: "Compacted checkpoint" }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
    });
    const url = await listen(server);
    const manager = SessionManager.inMemory(directory);
    const fixture = (await readFile(new URL("./fixtures/pi-1.1.0-session.jsonl", import.meta.url), "utf8")).trim().split("\n");
    const saved = JSON.parse(fixture[3]!) as { message: Parameters<SessionManager["appendMessage"]>[0] };
    for (let turn = 0; turn < 4; turn += 1) {
      manager.appendMessage({ role: "user", content: `Turn ${turn}: ${"workspace details ".repeat(200)}`, timestamp: turn });
      manager.appendMessage(saved.message);
    }
    const session = await sdkSession(url, [], [], {
      sessionManager: manager,
      settings: { compaction: { enabled: true, reserveTokens: 128, keepRecentTokens: 32 } }
    });
    try {
      const result = await session.compact("Keep the workspace facts");
      expect(result.summary).toContain("Compacted checkpoint");
      expect(requests.length).toBeGreaterThan(0);
      for (const request of requests) expect(request.max_completion_tokens ?? request.max_tokens).toBe(16384);
      expect(manager.getEntries().some((entry) => entry.type === "compaction")).toBe(true);
    } finally {
      session.dispose();
      await close(server);
    }
  });

  it("queues codemode calls at capacity and cancels queued scripts without executing them", async () => {
    vi.stubEnv("PI_CODEMODE_MAX_WORKERS", "2");
    const release = latch();
    const busy = latch();
    let entered = 0;
    const hold: ToolDefinition = {
      name: "hold", label: "hold", description: "Wait for the test barrier", exposure: "codemode",
      parameters: Type.Object({}),
      execute: async () => {
        entered += 1;
        if (entered === 2) busy.release();
        await release.promise;
        return { content: [{ type: "text", text: "released" }], details: undefined };
      }
    };
    const session = await sdkSession("http://127.0.0.1:1/v1", [
      createCodemodeExtension({ mode: "on", models: false }), (pi) => { pi.registerTool(hold); }
    ], ["codemode", "hold"]);
    const codemode = session.agent.state.tools.find((tool) => tool.name === "codemode");
    if (!codemode) throw new Error("Codemode is missing from the SDK tool loadout");
    const assistant = {
      role: "assistant" as const,
      content: ["hold-1", "hold-2", "queued", "cancelled", "models-disabled"].map((id) => ({
        type: "toolCall" as const, id, name: "codemode", arguments: {}
      })),
      api: "openai-completions" as const, provider: "openai", model: "upgrade-test-model",
      usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: "toolUse" as const, timestamp: 0
    };
    session.sessionManager.appendMessage(assistant);
    session.agent.state.messages.push(assistant);
    const active = [1, 2].map((index) => codemode.execute(`hold-${index}`, { code: "await tools.hold({});" }));
    const controller = new AbortController();
    let queued: ReturnType<typeof codemode.execute> | undefined;
    let cancelled: ReturnType<typeof codemode.execute> | undefined;
    try {
      await Promise.race([busy.promise, ...active.map(async (result) => {
        throw new Error(`Codemode finished before entering the tool: ${JSON.stringify(await result)}`);
      })]);
      let settled = false;
      queued = codemode.execute("queued", { code: 'text("queued finished");' }).finally(() => { settled = true; });
      cancelled = codemode.execute("cancelled", { code: "await tools.hold({});" }, controller.signal);
      await delay(50);
      expect(settled).toBe(false);
      controller.abort();
      const stopped = await cancelled;
      expect(JSON.stringify(stopped.content)).toMatch(/abort|cancel/iu);
      release.release();
      await Promise.all(active);
      expect(JSON.stringify((await queued).content)).toContain("queued finished");
      expect(entered).toBe(2);
      const models = await codemode.execute("models-disabled", { code: "text(typeof models);" });
      expect(JSON.stringify(models.content)).toContain("undefined");
    } finally {
      controller.abort();
      release.release();
      await Promise.allSettled([...active, queued, cancelled]);
      session.dispose();
    }
  }, 15_000);
});

async function sdkSession(url: string, extensions: ExtensionFactory[], tools: string[] = [], options: {
  settings?: Parameters<typeof SettingsManager.inMemory>[0];
  sessionManager?: SessionManager;
} = {}) {
  const runtime = await ModelRuntime.create({ authPath: path.join(directory, "auth.json"), modelsPath: null });
  registerConfiguredProvider(runtime, {
    generation: 1, providerName: "openai", baseUrl: url, model: "upgrade-test-model", apiKey: null, updatedAt: "2026-10-07T00:00:00.000Z"
  });
  await runtime.setRuntimeApiKey("openai", "test-only");
  const settingsManager = SettingsManager.inMemory({ defaultProjectTrust: "never", ...options.settings });
  const resourceLoader = new DefaultResourceLoader({
    cwd: directory, agentDir: directory, settingsManager, noExtensions: true, extensionFactories: extensions,
    noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true
  });
  await resourceLoader.reload();
  const { session } = await createAgentSession({
    cwd: directory, agentDir: directory, modelRuntime: runtime, model: runtime.getModel("openai", "upgrade-test-model")!,
    tools, resourceLoader, settingsManager, sessionManager: options.sessionManager ?? SessionManager.inMemory(directory)
  });
  await session.bindExtensions({});
  return session;
}

async function mcpNamingSession(listGate?: Promise<void>, dynamic = false) {
  const calls: unknown[] = [];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST") { response.writeHead(405).end(); return; }
    let body = "";
    for await (const chunk of request) body += String(chunk);
    const rpc = JSON.parse(body) as { id?: number; method: string; params?: Record<string, unknown> };
    if (rpc.id === undefined) { response.writeHead(202).end(); return; }
    let result: unknown;
    if (rpc.method === "initialize") {
      result = { protocolVersion: rpc.params?.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "naming", version: "1" } };
    } else if (rpc.method === "tools/list") {
      await listGate;
      result = { tools: ["files.read", "downloads.list"].map((name) => ({
        name, description: name, inputSchema: { type: "object", properties: {} }
      })) };
    } else {
      calls.push({ name: rpc.params?.name, arguments: rpc.params?.arguments });
      result = { content: [{ type: "text", text: String(rpc.params?.name) }] };
    }
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ jsonrpc: "2.0", id: rpc.id, result }));
  });
  const url = await listen(server);
  const loaded = await loadControlledPiMcpConfig({ generation: 1, servers: [{
    id: "builtin", name: "cyberos", url, description: "CyberOS", exposure: "codemode", timeoutSeconds: 3, allowInsecureHttp: true
  }] });
  if (listGate) loaded.config.servers[0]!.config.toolExposure = {};
  const config = loaded.config.servers[0]!.config;
  let control: ExtensionAPI | undefined;
  const session = await sdkSession("http://127.0.0.1:1/v1", [
    createCodemodeExtension({ mode: "on", models: false }),
    (pi) => { control = pi; if (dynamic) pi.registerMcpServer("cyberos", config); },
    createCyberOsMcpExtension({
      loadConfig: () => dynamic ? { ...loaded.config, servers: [] } : loaded.config,
      createTransport: loaded.createTransport, logPath: path.join(directory, "mcp.log")
    })
  ], piAgentToolNames({ mcpServerNames: ["cyberos"] }));
  return { session, calls, control, config, close: async () => { session.dispose(); await loaded.close(); await close(server); } };
}

async function executeCodemode(session: Awaited<ReturnType<typeof sdkSession>>, id: string, code: string) {
  const assistant = {
    role: "assistant" as const, content: [{ type: "toolCall" as const, id, name: "codemode", arguments: { code } }],
    api: "openai-completions" as const, provider: "openai", model: "upgrade-test-model",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
    stopReason: "toolUse" as const, timestamp: 0
  };
  session.sessionManager.appendMessage(assistant);
  session.agent.state.messages.push(assistant);
  return session.agent.state.tools.find((tool) => tool.name === "codemode")!.execute(id, { code });
}

function latch() {
  let release = () => {};
  const promise = new Promise<void>((resolve) => { release = resolve; });
  return { promise, release };
}

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Test server did not get a port");
  return `http://127.0.0.1:${address.port}/v1`;
}

async function close(server: Server): Promise<void> {
  server.closeAllConnections();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
