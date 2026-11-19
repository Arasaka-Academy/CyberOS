# packages/agent/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-session-manager.test.ts: agent-session-manager 的行为与契约验证。
agent-session-manager.ts: 公开 ManagedAgentSession, AgentSessionRunInput, AgentSessionManager。
index.ts: 本模块公共导出入口。
model-runtime-manager.test.ts: model-runtime-manager 的行为与契约验证。
model-runtime-manager.ts: 公开 ModelRuntimeBinding, ModelRuntimeFactory, registerConfiguredProvider, ModelRuntimeManager 等接口。
pi-agent.test.ts: 验证会话续跑、MCP 短工具名和模型工具可见性。
pi-agent.ts: Pi 会话宿主；按单下划线名称配置内置 MCP 可见性，按权限重建工具并保留历史。
pi-mcp-extension.ts: 适配内置 MCP 公开名称；向 SDK 保留工具归属和连接等待视图。
pi-compatibility.test.ts: pi-compatibility 的行为与契约验证。
pi-resource-policy.test.ts: pi-resource-policy 的行为与契约验证。
pi-resource-policy.ts: 公开 PiResourcePolicyDecision, PiResourcePolicy。
pi-upgrade.test.ts: 验证 SDK 升级边界、内置 MCP 命名与 Codemode 连接等待。
fixtures/: 测试输入夹具。

[PROTOCOL]: Update this header on change, then check AGENTS.md
