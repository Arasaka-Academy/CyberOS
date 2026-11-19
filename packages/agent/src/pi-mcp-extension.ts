/**
 * [INPUT]: 依赖 Pi MCP 扩展和公开 ExtensionAPI。
 * [OUTPUT]: 提供内置 CyberOS 单下划线工具名适配。
 * [POS]: 隔离 SDK 名称约定；保留协议调用和连接生命周期。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import {
  createMcpExtension,
  type BeforeAgentStartEvent,
  type BeforeAgentStartEventResult,
  type ExtensionAPI,
  type ExtensionFactory,
  type ExtensionHandler,
  type McpExtensionOptions,
  type ToolCallEvent,
  type ToolCallEventResult,
  type ToolNamespace
} from "@earendil-works/pi-coding-agent";

const SDK_NAMESPACE = "mcp__cyberos";
const PUBLIC_NAMESPACE = "mcp_cyberos";

function publicName(name: string): string {
  return name.startsWith(`${SDK_NAMESPACE}__`)
    ? `${PUBLIC_NAMESPACE}_${name.slice(SDK_NAMESPACE.length + 2)}`
    : name;
}

function sdkName(name: string): string {
  return name.startsWith(`${PUBLIC_NAMESPACE}_`)
    ? `${SDK_NAMESPACE}__${name.slice(PUBLIC_NAMESPACE.length + 1)}`
    : name;
}

function publicNamespace(namespace: ToolNamespace): ToolNamespace {
  return namespace.name === SDK_NAMESPACE
    ? { ...namespace, name: PUBLIC_NAMESPACE, aliases: [...(namespace.aliases ?? []), SDK_NAMESPACE] }
    : namespace;
}

export function createCyberOsMcpExtension(options: McpExtensionOptions): ExtensionFactory {
  return (pi) => {
    // SDK 的工具归属表保留原名。只向 MCP 扩展还原名称视图。
    const on = new Proxy(pi.on, {
      apply(target, thisArg, args: unknown[]) {
        const [event, handler] = args;
        if (event === "tool_call") {
          const original = handler as ExtensionHandler<ToolCallEvent, ToolCallEventResult>;
          const wrapped: typeof original = (call, ctx) => original({ ...call, toolName: sdkName(call.toolName) }, ctx);
          return Reflect.apply(target, thisArg, [event, wrapped]);
        }
        if (event === "before_agent_start") {
          const original = handler as ExtensionHandler<BeforeAgentStartEvent, BeforeAgentStartEventResult>;
          const wrapped: typeof original = async (start, ctx) => {
            const result = await original(start, ctx);
            const sections = start.systemPromptOptions.sections;
            if (sections.mcp_servers) {
              sections.mcp_servers = sections.mcp_servers.replace(/^- mcp__cyberos(?= \()/gm, `- ${PUBLIC_NAMESPACE}`);
            }
            return result;
          };
          return Reflect.apply(target, thisArg, [event, wrapped]);
        }
        return Reflect.apply(target, thisArg, args);
      }
    });
    const adapted: ExtensionAPI = {
      ...pi,
      on,
      registerTool: (definition) => pi.registerTool({
        ...definition, name: publicName(definition.name),
        ...(definition.namespace ? { namespace: publicNamespace(definition.namespace) } : {})
      }),
      getAllTools: () => pi.getAllTools().map((tool) => ({
        ...tool,
        name: sdkName(tool.name),
        ...(tool.reachesTools ? {
          reachesTools: (input: Record<string, unknown>) => {
            const reach = tool.reachesTools!(input);
            return reach === "all" ? reach : reach.map((word) => word.replaceAll(PUBLIC_NAMESPACE, SDK_NAMESPACE));
          }
        } : {})
      })),
      getActiveTools: () => pi.getActiveTools().map(sdkName),
      setActiveTools: (names) => pi.setActiveTools(names.map(publicName)),
      registerToolRenderer: (resolve) => pi.registerToolRenderer((name, next) => resolve(sdkName(name), next))
    };
    return createMcpExtension(options)(adapted);
  };
}
