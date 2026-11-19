---
title: Pi Agent、MCP 与 Skills
description: 管理 Pi Agent 策略、内置与第三方 MCP，以及全局和项目 Skills 的信任边界。
type: reference
status: current
audience: [developer, operator]
sourceOfTruth:
  - packages/agent/src/pi-agent.ts
  - packages/agent/src/pi-mcp-extension.ts
  - packages/worker/src/processor.ts
  - packages/api/src/routes/agent-resources.ts
  - packages/api/src/lib/agent-mcp-service.ts
  - packages/api/src/lib/agent-skills.ts
  - packages/shared/src/mcp-network.ts
  - packages/capabilities/src/parity-manifest.ts
  - packages/capabilities/src/system-contracts.ts
  - packages/capabilities/src/product-actions.ts
  - packages/api/src/lib/system-read-capabilities.ts
  - packages/api/src/lib/system-mutation-capabilities.ts
  - packages/mcp/src/tasks.ts
  - packages/mcp/src/server.ts
  - packages/mcp/src/tool-names.ts
  - packages/db/src/repositories/agent-capability-authorization.ts
  - packages/capability-runtime/src/run-queue.ts
  - packages/web/src/components/settings/SettingsToolPolicyPage.tsx
  - packages/web/src/components/settings/SettingsMcpPage.tsx
  - packages/web/src/components/settings/SettingsSkillsPage.tsx
  - packages/web/src/components/settings/SettingsAudioPage.tsx
---

CyberOS 把 AI 设置拆成模型 Provider、Pi Agent、Audio、MCP 和 Skills 五个同级页面。所有产品设置保存在 SQLite；MCP secret 和已安装 Skill 使用固定的受限 state 目录，不需要产品配置文件。本文的系统 MCP 面向内部 Agent。下文的审批和明确确认说明适用于标准模式；完全权限使用自动授权，所需秘密通过补充信息界面提交。

## Audio

**设置 > AI > Audio** 管理 CyberAudio 地址、独立 token、输入／输出设备、STT/TTS 语言、音色、音量及播报设置，提供服务、录音和语音测试。填写 NAS 可访问的 HTTP/HTTPS 基础地址；`localhost` 指 NAS 本机。`cyberos.audio.status` 读取服务、设备、脱敏设置或有界历史，`cyberos.audio.control-propose` 申请配置、测试、停止或重置。录音和播报测试会使用设备，必须经第一方明确确认。token 只通过审批的独立 secret input 输入。

## Pi Agent

**设置 > Pi Agent** 管理完全权限和逐项 capability 策略。完全权限默认关闭；开启后，所有已启用的内部系统能力自动授权，覆盖逐项权限但保留原配置。关闭后恢复逐项策略。主机功能开关、scope、路径和目标状态检查持续生效。

标准模式下，`auto` 直接返回有界读取结果，`approve` 和 `confirm` 创建持久 capability run/approval，`disabled` 从 Pi 工具目录移除能力。文件 mutation 仍使用持久运行。完全权限通过 `GET/PATCH /api/settings/agent-capability-policy` 的 `fullAccess` 字段保存；Agent 的设置工具不能修改此开关。

自动执行仍记录 run、作业归属、结果与 `system:full-access` 授权来源。开启开关不自动执行历史待审批提案；关闭后尚未开始的自动授权运行终止。需要密码等新凭据时显示“补充信息”，第一方提交后自动执行，秘密不进入模型参数、上下文或运行记录。

当前会话信任项目后，Pi 才会加载项目中的 `.agents/skills`。信任只影响项目资源，不影响由 CyberOS 管理的全局 Skills。

## CyberOS 内置 MCP

CyberOS 内置 MCP 缺少设置记录时默认开启。**设置 > MCP** 可以启停它，但不能修改地址、认证或删除。首次启用或受保护 token 丢失时，API 创建或修复 `Built-in Pi` 身份，并把 token 以 `0600` 写入 `/cyberos/state/mcp/pi.token`；数据库只保存 token 摘要。

内置 MCP 把 CyberOS capability registry 作为 Streamable HTTP 提供给内部 Pi。工具保留固有风险和审批元数据，同时公开有效策略及授权模式。Pi 的 mutation 遵循当前权限；权限或资源配置改变后，worker 在下一轮对话重建工具目录，不中断正在执行的 turn。

内置 MCP 复用 loopback API 的 `/mcp` 路由。完全权限只作用于内部 Pi 身份，不增加对外访问能力。

工具名省略能力 ID 的 `cyberos.` 前缀。例如，能力 `cyberos.downloads.list` 对应 MCP 工具 `downloads.list`，Pi 使用单下划线名称 `mcp_cyberos_downloads_list`，Codemode 命名空间为 `mcp_cyberos`。第三方 MCP 保留 Pi SDK 的名称规则。`catalog.get` 返回稳定的 `id` 和可调用的 `toolName`；下表使用能力 ID。历史 `cyberos.*` 协议工具调用继续有效，但工具发现只返回短名称。

### 音乐、影视与 NAS 播放

媒体工具复用现有媒体库和共享播放器，不启动独立 MCP 服务，也不控制某个浏览器的播放。

| 工具 | 用途 |
| --- | --- |
| `cyberos.music.query` | 按 `entity: tracks/albums/artists/playlists` 搜索，支持现有筛选、排序和游标分页 |
| `cyberos.music.get` | 按实体和 ID 读取详情；`entity: lyrics` 读取有界歌词 |
| `cyberos.music.status` | `view: home/sources/scans/library`，默认音乐库状态 |
| `cyberos.music.manage-propose` | 收藏、歌单、媒体源和扫描审批 |
| `cyberos.music.control-propose` | NAS 音乐播放、队列、音量、模式和已有音频输出控制审批 |
| `cyberos.media.query` | 搜索影片／剧集，支持个人状态、合集及匹配状态筛选 |
| `cyberos.media.get` | `entity: titles/next/match-candidates`，读取季集、文件版本、下一集及匹配候选 |
| `cyberos.media.status` | `view: home/sources/scans/library/collections/settings`，默认影视库状态 |
| `cyberos.media.manage-propose` | 个人状态、进度、合集、媒体源、扫描、匹配纠错及非敏感设置审批 |
| `cyberos.media.play-propose` | 按 `fileId` 在 NAS 播放，可指定 `startPositionSeconds` |
| `cyberos.playback.status` | 读取共享播放器 owner、实例、会话及音乐队列 |
| `cyberos.playback.outputs` | 查询系统默认输出及已有可用蓝牙音频设备；不配对设备 |
| `cyberos.playback.control-propose` | 暂停、恢复、停止、定位、音量、输出、音轨、字幕及音频延迟控制审批 |

音乐、影视、播放分别使用 `cyberos:music:read`、`cyberos:media:read`、`cyberos:playback:read`。申请变更使用对应域的 `:propose` scope，且仅内置 Pi 可以调用；外部客户端即使误授予 propose scope 也没有写工具。既有外部身份不自动新增权限，管理员必须显式重新授权需要的只读 scopes。内置 Pi 沿用现有 capability 目录同步机制。

查询默认每页 40、上限 100。音乐查询返回 `items/nextCursor`，影视查询返回 `titles/nextCursor`；查询下一页时原样传入 `cursor`。详情、首页及队列使用 `limit` 限制嵌套数组；长歌词、嵌套详情和达到总输出预算的结果会返回 `truncated: true` 和 `truncation` 路径／数量说明，不能把截断队列当作完整队列提交重排。媒体文件和图片二进制不进入工具结果。

播放操作必须先读取 `cyberos.playback.status`，将 `status.serviceInstanceId` 和 `status.sessionId` 分别作为 `serviceInstanceId`、`playbackSessionId` 传入。音乐命令还必须携带 `status.music.queueVersion` 对应的 `expectedQueueVersion`；统一播放控制额外携带目标 `sessionId`。没有播放会话时 `playbackSessionId` 为 `null`。

例如，搜索并申请播放歌曲：

```json
{"entity":"tracks","query":"歌曲名","limit":40}
```

```json
{
  "request": {
    "operation": "replace",
    "trackIds": ["查询得到的歌曲 ID"],
    "serviceInstanceId": "刚读取的播放器实例 ID",
    "playbackSessionId": null,
    "expectedQueueVersion": 0
  },
  "idempotencyKey": "play-music-request-001"
}
```

上述值必须取自实际状态，不能照抄示例。所有播放变更都要求第一方明确确认；跨音乐／影视接管会中断当前播放，但保留音乐队列。审批返回的 `runId` 沿用现有 `cyberos.runs.*` 查询流程。审批期间实例、会话、队列或目标文件改变后返回冲突，必须重新读取状态并发起新审批，不能自动更新抢占条件重试。正常播放进度推进不会使审批失效。

管理操作使用明确的 `operation`：音乐支持 `favorite`、`playlist_create/update/delete`，两种库均支持 `source_create/update/delete` 和 `scan`；影视另支持 `title_state`、`episode_state`、`progress`、`collection_create/update/delete`、`match`、`settings`。移除媒体源不删除原始文件。`settings` 仅接受语言和地区；TMDB Token 仍在第一方设置中配置，不能通过 MCP 提交或读取。NAS 播放器不可用时仍可查询媒体库。

## 第三方 MCP Server

第三方只支持 MCP Streamable HTTP，不支持旧 SSE、stdio 或自定义 transport。每个 Server 使用 1–63 位小写 slug 作为稳定工具命名空间，可选择：

- `codemode`：优先通过 Codemode 聚合工具。
- `deferred`：工具按需发现和加载。
- `direct`：直接注册为可调用工具。

第三方 MCP 工具是用户信任后的外部执行能力，调用时**不创建 CyberOS capability approval**。新增、修改、启用和凭据变更属于高风险设置操作；Server 必须测试成功后才能启用。修改 URL、认证方式或明文 HTTP 策略会立即清除测试与信任状态并关闭 Server。

公网 Server 必须使用 HTTPS。明文 HTTP 只允许用户明确确认后的 loopback 或 RFC1918/ULA 私有地址。连接层阻止 link-local、云 metadata、危险 Header、跨 origin 重定向、DNS rebinding 和解析地址漂移。

Bearer Token 或自定义 Secret Headers 原子写入 `/cyberos/state/secrets/mcp/<server-id>.json`，目录权限为 `0700`，文件权限为 `0600`。SQLite 和公开 API 只保存或返回认证类型、Header 名称和 `credentialsConfigured`；secret 内容不得进入 Agent 上下文、日志、错误、通知或设置响应。

## Skills

全局 Skills 安装在 `/cyberos/state/pi-agent/skills/<skill-id>/`，由 CyberOS 负责安装、校验、启停、更新、替换和删除：

- ZIP 必须从 storage pool 选择。导入限制压缩包大小、展开大小和文件数量，并在解压前拒绝 traversal、符号链接、硬链接、设备、socket 与特殊文件。
- Git 只允许无凭据的公开 HTTPS 仓库，可指定 ref 和仓库子目录。安装使用浅克隆、禁止重定向和本地协议，并记录实际解析 commit。
- 每个来源必须且只能包含一个有效 `SKILL.md`；名称、描述、目录结构、可读性、嵌套压缩包和重复名称都在临时目录中校验。
- 校验通过后才原子替换正式目录；数据库失败时恢复原版本。

安装或启用 Skill 前必须确认：Skill 能改变 Pi 的工具选择，并可能引用或执行仓库中的脚本。项目 `.agents/skills` 只读展示，系统设置不会修改项目文件；项目未获信任时只禁用项目 Skills，全局 Skills 仍按自身开关加载。

## Capability parity

`cyberos.settings.public` 返回脱敏后的内置 MCP 状态、第三方 Server 摘要、全局 Skills 摘要和共享 generation。`cyberos.settings.update-propose` 提供 MCP/Skills 的 CRUD、测试、启停、安装与更新操作。凭据由审批 UI 的 secret input 通道注入，永远不成为模型工具参数。

内部 Agent 可以用 `cyberos.runs.get`、`cyberos.runs.list` 和 `cyberos.runs.wait` 观察自己拥有的持久 run；`cyberos.runs.cancel` 只能取消同一身份拥有且可中断的 run。MCP 不提供 approve 工具，标准模式的审批由第一方 UI 完成。

### 系统与日常领域能力

能力目录、工具 Schema 和实际 adapter 一起决定可调用范围。先调用 `catalog.get`，检查 scope、策略和运行状态；目录中的能力不表示对应硬件已连接或服务已就绪。资源权限直接采用对应 capability 的 scope，例如 `cyberos://storage-pools/{id}` 使用 `cyberos:storage:read`。

| 工具 | 用途与边界 |
| --- | --- |
| `cyberos.system.health`、`system.info` | 实际健康、存储就绪度，以及硬件和操作系统信息；`system.status` 仍提供构建摘要 |
| `cyberos.system.services`、`system.logs` | 固定 CyberOS unit 的状态、退出原因及脱敏日志；日志最多 200 条，可指定 RFC3339 `since`，不接受任意 unit 或命令 |
| `cyberos.files.history`、`files.batches` | 文件历史的稳定游标分页、批量任务进度 |
| `cyberos.files.restore-propose`、`files.extract-propose` | 按历史中的 `trashEntryId` 恢复，或在同一存储池的新目标中解压；既有 rollback 工具继续可用 |
| `cyberos.files.batch-propose`、`files.batch-cancel-propose` | 批量 move/trash 和取消；最多 500 个源路径，保持路径、symlink 和挂载检查 |
| `cyberos.photos.query`、`photos.metadata` | 时间、相机／镜头、标签、位置、评分及高级元数据条件；支持排序、游标、facets，元数据始终排除敏感字段 |
| `cyberos.photos.semantic-status`、`photos.semantic-propose` | 语义查询配置、测试、重建和重试；API key 经独立 secret input 输入 |
| `cyberos.downloads.preview-propose`、`downloads.preview`、`downloads.files` | Magnet 或存储池内最多 16 MiB 的 `.torrent` 预览、文件分页和选择 |
| `cyberos.downloads.manage-propose` | 新增 `create_torrent`、`stop_seeding`；创建必须提供 `fileName`，做种上限固定 ratio 1.0／7200 秒；状态筛选包含 `seeding` |
| `cyberos.docker.get` | 按 container/app/network/volume ID 读取详情，或读取 daemon 配置和容器日志；environment、Compose 正文和凭据脱敏 |
| `cyberos.alerts.get` | `entity: incident/delivery/smtp`，读取事件、投递详情或脱敏 SMTP 配置 |
| `cyberos.nvr.status`、`nvr.query`、`nvr.resource-link` | 摄像头、策略、PTZ 状态和有界时间线；快照和录像使用 60 秒、认证、客户端绑定的一次性资源链接 |
| `cyberos.nvr.manage-propose` | 发现、添加／更新／移除摄像头、录像策略和 PTZ；配置改变使审批失效，正常心跳不影响已准备的操作 |
| `cyberos.tailscale.status`、`tailscale.manage-propose` | Tailscale／Headscale 状态、连接、路由、出口节点及确认／回滚；保留现有事务超时恢复机制 |
| `cyberos.bluetooth.status`、`bluetooth.transfers`、`bluetooth.manage-propose` | 适配器、配对、信任、连接、接收配置和文件传输；配对 challenge 仍由用户在第一方界面响应 |
| `cyberos.iscsi.status`、`iscsi.manage-propose` | Target、LUN、会话和容量；操作携带 `expectedRevision`，销毁沿用现有名称确认，CHAP 密码经独立 secret input 输入 |
| `cyberos.settings.proxy`、`settings.proxy-propose` | 系统代理读取与配置审批 |
| `cyberos.backup.status`、`backup.coverage`、`backup.snapshots`、`backup.restore-propose` | 仓库和凭据可用性、保护范围、快照分页及经过验证的 staging 恢复 |

读取使用 `cyberos:<domain>:read`，申请变更使用 `cyberos:<domain>:propose`。内置 Pi 通过既有目录同步获得能力，变更经过当前授权模式、有效期、目标 revision 和执行时检查。完全权限不会跳过 scope 校验。

照片查询每页最多 100；文件历史、下载文件、快照及任务列表最多 200。Docker 日志 `tail` 最多 500，结果仍受总字节预算限制；其他大数组、长字符串也会返回 `truncated/truncation`。分页使用响应中的 `nextCursor`（任务列表位于统一结果的 `page`），保持筛选条件一致。游标失效、资源过期或目标改变后重新读取，不要把截断结果当作完整清单。

NVR `segments/events` 必须提供 `from/to`，使用时间及 ID 的稳定游标。更新、删除和 PTZ 先读取设备，将 `updatedAt` 作为 `expectedUpdatedAt`；审批执行时还会在 NVR 服务中检查稳定配置，防止覆盖另一个管理操作。录像原始资源为 MPEG-TS；媒体字节不进入工具 JSON。登录 key、摄像头凭据、CHAP、CyberAudio 和语义搜索 token 都不属于模型参数或工具返回值，不能写进 URL。

### 后台任务与 Agent 上下文

`cyberos.runs.*` 跟踪审批和能力执行；`cyberos.tasks.get/list/wait` 使用 `runId` 跟踪该客户端提交的领域任务。下载、torrent 预览、文件 batch、文件索引、照片 job、音乐／影视扫描、Docker／VM operation、备份 run 和蓝牙传输会关联固定的任务引用。文件索引保留队列代际与持久扫描记录的关联，队列清理后仍查询保留的终态；同一队列被新请求替代时返回 `superseded`。多个蓝牙文件保留各自的子任务，不能只观察第一个文件。

能力 run 成功提交后台任务时，`completion` 为 `submission`，`domainTask` 给出引用；`submissionCompleted: true` 不等于领域任务已完成。以 `task.state/terminal/progress` 判断实际进度。记录被删除时返回 `unavailable`，不伪造成功。`tasks.wait` 最多等待 20 秒，`afterRevision` 使用上次任务返回的字符串 revision；`runs.wait` 的 `afterRevision` 使用能力 run 的数字 revision。

```json
{"runId":"自己提交的能力 run ID","timeoutMs":5000,"afterRevision":"上次 tasks.get 返回的 revision"}
```

`cyberos.tasks.cancel-propose` 仍创建审批，仅支持下载、文件 batch 和蓝牙传输已有的取消机制；其他任务明确不可取消。停止做种等操作先提交控制请求，再观察领域终态。`runs.cancel` 取消能力执行本身，不能代替后台任务取消。

worker 每轮向 Pi 注入有界、隐藏的当前工作路径、可见存储目录、当前会话关联 run 和未过期审批 ID 摘要。该摘要不包含提案正文或 secret，目录存在不代表挂载就绪，存储操作前仍应查询 `system.health`。缓存会话下一轮会刷新该上下文。

### 覆盖维护

`packages/capabilities/src/product-actions.ts` 保存产品动作的补充映射与明确排除原因；`parity-routes.test.ts` 双向检查 REST／NVR 路由、capability 映射及排除项。新增产品动作必须补 capability 或说明排除原因，同时添加实际行为测试，单独登记路由不代表已经实现。审批决定、配对 challenge、人机流媒体传输和第一方管理界面等边界保持明确排除。

## 运维检查

```bash
sudo systemctl restart cyberos-api.service cyberos-worker@1.service
sudo journalctl -u cyberos-api.service -u cyberos-worker@1.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3010/health
curl -fsS http://127.0.0.1:3010/api/settings/mcp
```

排障时只记录 Server ID、测试状态、工具数量、generation 和脱敏错误。不要复制 token、Secret Header、MCP secret 文件或 Skill 中的私密内容。
