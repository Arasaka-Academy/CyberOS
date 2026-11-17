# packages/mcp/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
index.ts: 本模块公共导出入口。
runtime.test.ts: runtime 的行为与契约验证。
runtime.ts: 内部 Agent 的 MCP 能力入口；目录映射短工具名，主机功能开关独立生效。
server.test.ts: 验证短工具名、历史名称、鉴权与资源协议。
server.ts: API 内嵌的 MCP 传输层；注册短工具名并兼容历史调用。
tasks.ts: 公开 OwnedDomainTask, domainTaskReference, ownedDomainTask。
tool-names.ts: 能力 ID 与短工具名映射；兼容历史 tools/call 名称。

[PROTOCOL]: Update this header on change, then check AGENTS.md
