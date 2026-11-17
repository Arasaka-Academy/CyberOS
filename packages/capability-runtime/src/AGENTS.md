# packages/capability-runtime/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
adapters.ts: 公开 CapabilitySecretRequirement, CapabilityAdapterContext, PreparedCapabilityAction, CapabilityAdapterExecution 等接口。
bounded-regex.ts: 公开 GrepMatchPage, BoundedRegexMatcher。
file-read.test.ts: file-read 的行为与契约验证。
file-read.ts: 公开 ExtendedFileReadCapabilityId, executeExtendedFileReadCapability。
index.ts: 本模块公共导出入口。
orchestrator.test.ts: orchestrator 的行为与契约验证。
orchestrator.ts: 能力执行编排；检查权限、目标状态和持久运行转换。
restricted-shell.test.ts: restricted-shell 的行为与契约验证。
restricted-shell.ts: 公开 createRestrictedShellAdapter。
run-queue.ts: API 执行队列；关闭时等待当前执行并保留未开始的运行。
storage-pools.ts: 公开 ResolvedStoragePool, listStoragePools, requireStoragePool。

[PROTOCOL]: Update this header on change, then check AGENTS.md
