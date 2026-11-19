---
title: Agent 与 Worker
description: Pi agent、job queue 和 capability approval 状态机。
type: explanation
status: current
audience: [developer]
sourceOfTruth: [packages/worker/src/processor.ts, packages/worker/src/notifications.ts, packages/agent/src/pi-agent.ts, packages/db/src/repositories/jobs.ts, packages/db/src/repositories/capability-runs.ts, packages/db/src/repositories/notifications.ts, packages/shared/src/notifications.ts, packages/shared/src/browser-push-node.ts, packages/web/public/sw.js]
sidebar:
  order: 3
---

API 只写入 message 和 queued job。worker 负责 claim、取消检测、provider session、事件持久化和最终 job 状态。只有 Pi 在 Agent 对话中按策略请求能力时才会创建 approval；Workspace 右侧面板调用各自的 REST 操作并直接返回结果，不进入 Agent approval 状态机。

一次 Pi turn 可以并行产生多个 approval。worker 会关联全部 capability run，等待它们全部进入终态，再把完整结果集合交回同一个 provider session 继续对话。取消 Agent job 会同时过期仍待处理的 approval，并删除对应的私有执行 payload。

Pi 工具按 `read`、`grep`、`find`、`ls`、`bash`、`edit`、`write` 分组，策略可配置。模型和凭据由数据库及设置界面管理；没有可用模型时，Pi turn 明确失败。

CyberOS 内置 MCP 缺少 SQLite 设置记录时默认开启。开启时 API 自动创建或修复受保护的 `Built-in Pi` 身份和 `0600` token；worker 在每轮执行前读取内置 MCP、已启用第三方 MCP 与全局 Skills。资源 generation 改变后，下一轮会重建 Pi 资源，但不会中断正在运行的 turn。

第三方 MCP 只支持 Streamable HTTP，并按用户选择的 `codemode`、`deferred` 或 `direct` 模式暴露。第三方工具调用不创建 CyberOS capability approval；Server 新增、修改、测试、启用和凭据操作仍属于高风险设置变更。全局 Skills 独立于项目信任加载；项目 `.agents/skills` 只在当前 session 已信任项目资源时加载。

当 session root 与配置的 Photos 图库 root 一致时，worker 额外注入只读 `search_photos` 和 `get_photos_metadata`。工具名中的 `photos` 是内部模块标识；两者复用 Photos 数据库查询服务并强制限制到当前库版本。位置可以作为筛选条件，但工具输出再次移除精确 GPS、设备/镜头序列号、联系信息和人物区域，避免敏感元数据进入云模型上下文。

## 通用浏览器通知

通知生产者调用数据库的 `publishNotification`。业务状态、通知事件和启用订阅的投递任务在同一事务写入。worker 使用独立发送循环领取投递租约，不占用 Agent 执行槽。Web Push 使用 `aes128gcm` 加密与持久 VAPID 密钥；私钥位于 `secretsDir/browser-push-vapid.json`，权限为 `0600`。备份状态时保留该文件，避免已有订阅因密钥丢失失效。

首版只通知普通聊天：非空最终回复、人工审批或补充输入、作业失败。回复和失败按 job 去重，人工请求按 capability run 去重。自动授权、流式文字、工具过程、主动取消及语音会话不通知。已解决、过期或取消的人工请求在发送前再次校验。现有操作、蓝牙和告警通知中心保留原接口及已读语义。

投递先等待约两秒。当前浏览器聚焦对应会话，且目标内容已完成呈现并进入可视区域时，页面提交该订阅的展示确认。其他浏览器继续接收；关闭页面、加载失败或未看到目标内容时继续推送。Service Worker 收到 Push 后展示泛化提示，不包含回复、会话标题、审批参数或错误详情。点击通知聚焦主页面或重新打开，并通过会话 ID 直接读取历史。

网络错误、`429` 与 `5xx` 进入有界重试；`404/410` 停用订阅。事件有效期为 24 小时，通知事实和终态投递保留 30 天。服务重启会继续领取队列；推送服务接受请求不代表用户已看到通知，进程在确认前退出仍可能重发。浏览器以事件 ID 合并重复通知。

### 启用与检查

1. 使用稳定的 Tailscale HTTPS 地址访问 CyberOS。入口配置沿用[浏览器安全上下文](/docs/operations/audio/#配置)的 HTTPS 方式；不启用 Funnel。
2. 打开“系统设置 → 通知”，点击启用并允许浏览器权限。每台电脑、每个浏览器分别订阅，初次订阅不补发历史。
3. 使用“测试通知”检查当前浏览器。关闭主页面后验证回复、人工处理和失败提示。测试按钮只表示任务已排队，实际显示由浏览器和操作系统决定。
4. 查看 worker 日志与设置中的投递错误状态。排查时不要打印订阅 endpoint、加密密钥、身份令牌或 VAPID 私钥。

CyberOS 和接收设备需要访问浏览器厂商的公网推送服务；接收提示不要求 Tailscale 在线，点击查看详情要求站点可达。首版验收目标是桌面 Chrome、Edge、Firefox 和 macOS Safari。浏览器被强制退出、设备休眠或系统免打扰会影响展示时机。HTTP 局域网地址无法订阅；开发环境只允许安全的 localhost 例外。

新增依赖与数据库迁移要求完整软件包升级，不能组件热替换。不要用浏览器测试中的本地 Push 注入代替真实厂商通道验收。
