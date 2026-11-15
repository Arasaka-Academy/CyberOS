# mcp — Stateless MCP 接入、能力目录与资源传输

`@cyberos/mcp` 把 CyberOS 的能力目录接入 MCP HTTP 协议。它嵌入 Fastify API，负责客户端认证、Host/Origin 检查、并发/速率限制、按 scope 与 Agent 策略过滤目录，以及工具调用和资源传输。

本包提供服务注册函数，不单独监听端口。默认内置 Pi 使用 loopback `/mcp`；LAN 客户端需要配对凭据和另外启用的受管 HTTPS 入口。

[返回工作空间总览](../README.md) · [包定义](package.json)

## 架构图

![MCP 认证、按客户端装配与能力分派架构](docs/architecture.svg)

认证后的请求生成当前客户端专属 runtime。目录可见性、执行授权和审批提案分别检查，不能用“工具在列表里”替代调用时的权限判断。

## 源码导航

| 文件 | 职责 |
| --- | --- |
| [src/server.ts](src/server.ts) | Fastify 注册、HTTP guard、SDK server/tool/resource 装配和资源传输端点 |
| [src/runtime.ts](src/runtime.ts) | 客户端上下文、目录过滤、领域读取、提案与 run 查询/控制 |
| [src/tasks.ts](src/tasks.ts) | 按拥有者关联固定领域任务、聚合进度与取消支持 |
| [src/index.ts](src/index.ts) | 公共导出 |

## HTTP 与认证边界

| 入口 | 行为 |
| --- | --- |
| `POST /mcp` | Stateless MCP；校验 Bearer token 后创建请求 runtime |
| `GET /mcp` / `DELETE /mcp` | 返回 405，不提供持久 MCP session 管理 |
| `GET /mcp-transfer/:token` | 配对客户端认证，再消费所属客户端的短期传输 token，核对文件身份 |
| `GET /mcp-resource/:token` | 认证并消费资源 token，交给领域 responder 或文件回退处理 |

默认 Host 和 Origin 允许 loopback。MCP 请求体上限 1 MiB，每客户端默认并发 4、每分钟请求 120；Fastify 层还设路由限流。

标记为外部入口的请求要求 `externalEnabled`，并要求转发协议为 HTTPS。该标记和转发头依赖受控代理配置；不能让任意外部请求直接访问未经保护的 loopback API。

## 请求如何变成能力调用

1. `registerMcp` 检查开关，安装 guard、认证和限流，建立 SDK handler。
2. `createClientRuntime` 生成 subject、scopes 与 trace 上下文，读取当前 Agent 能力策略。
3. 从 capabilities 目录构造 descriptor。非 Pi 客户端不安装第一方写提案能力；被禁用的 Pi 能力和关闭的 shell 也被过滤。
4. 按内置实现、readAdapter 或 domain Adapter 注入 executor；未安装实现的能力保留不可用原因。
5. `catalogForClient` 再按 scope 输出目录与 availability；调用时注册表重查权限。
6. `executeImplemented` 根据 ID 和策略分派读取、资源链接、文件提案、领域提案或拥有者 run 操作。
7. 执行结果统一封装 schemaVersion、data、warnings、page、runId、traceId；错误转为稳定能力错误格式。

Pi 的读取策略可以要求批准；文件 resource-link 只有自动读取策略下才可用。文件写能力始终生成提案，实际变更由第一方审批后交给 runtime 执行。

## 资源与大数据传输

工具响应有字节限额，较大文件和媒体使用资源/传输端点。传输 token 与 clientId 绑定；请求还需正常 Bearer 认证，不能把 URL 自身视为长期公开下载地址。

文件传输重新解析 pool 内路径，打开文件后检查类型、大小和修改时间；变化时返回冲突，避免把旧元数据对应到新文件。资源 responder 可由 API 注入，以支持照片等领域资源。

资源 token、凭据和 capability run 位于业务库；每客户端并发和速率计数在进程内存，进程重启后重建。请求关闭时会释放活跃计数和 SDK handler。

## 与相邻模块的关系

| 模块 | 本包从它取得什么 |
| --- | --- |
| [capabilities](../capabilities/README.md) | 目录、Schema、风险、scope、注册表和结果格式 |
| [capability-runtime](../capability-runtime/README.md) | 文件读能力、提案准备与批准后执行机制 |
| [db](../db/README.md) | 配对认证、设置、run、资源和传输 token |
| [API](../api/README.md) | 领域 readAdapter、domain Adapter、资源 responder 和宿主 HTTP 进程 |
| [mcp-cli](../mcp-cli/README.md) | 管理员配对、token 生命周期和 TLS 配置 |

本包不向外部 MCP 客户端开放批准入口。`cyberos.runs.cancel` 只能控制其拥有且允许取消的 run，不表示拥有所有运行的管理权限。

## 系统领域与任务完成

API 通过 `system-read-capabilities` 和 `system-mutation-capabilities` 接入健康／服务日志、文件历史／恢复／解压／batch、照片高级查询、BT、Docker 详情、告警投递、NVR、Tailscale、蓝牙、iSCSI、Audio、代理及快照恢复。新增领域采用对应 `cyberos:<domain>:read/propose` scopes，外部身份需要显式重新授权；写工具只安装到内置 Pi，秘密由第一方独立输入。

资源的 scope 从关联 descriptor 推导。NVR 快照和 MPEG-TS 录像通过认证、客户端绑定、一次性 60 秒 token 返回，并在下载时复查身份。大型查询使用分页与截断说明，不嵌入媒体正文或未脱敏配置。

`runs.*` 观察审批／提交，`tasks.get/list/wait` 观察关联领域任务。`completion: submission` 或 `submissionCompleted: true` 仅表示提交成功，实际完成以 `task.terminal/state` 为准；被清理的任务返回 `unavailable`。`tasks.wait` 最多 20 秒，支持字符串 `afterRevision`；`runs.wait` 使用数字 revision。取消下载、文件 batch 和蓝牙任务使用审批工具 `tasks.cancel-propose`，其他任务不声称支持取消。

快照恢复复用受锁保护的备份服务，匹配同一 backup run 的 data/state 快照，校验 v2 state manifest 和 SHA-256，始终恢复至新 staging。保护范围明确排除 Docker named volumes、iSCSI 镜像及其 Target/CHAP 状态；普通文件备份不保证应用一致性。

完整参数和操作边界见 [MCP 与 Agent 参考](../../docs/src/content/docs/reference/mcp-agent-capabilities.md)。新增产品动作需要通过双向覆盖清单并增加行为测试。

## 开发与验证

```bash
npx vitest run packages/mcp packages/capabilities
npm run typecheck
```

测试覆盖认证、协议、目录、scope、资源和提案分派。调试真实 Pi 链路需同时运行 API/worker 并安装有效 Pi 配对 token；外部客户端 TLS、代理与网络连通性需要独立验收。
