---
title: 系统语音通道
description: 配置浏览器与 CyberController 共用的语音会话、可回放历史及 CyberAudio 服务。
type: operation
status: current
audience: [operator, developer]
sourceOfTruth:
  - crates/audiod/src/main.rs
  - crates/audiod/src/bluez.rs
  - packages/api/src/lib/audio-coordinator.ts
  - packages/api/src/routes/audio.ts
  - packages/db/src/migrations/audio.ts
  - packaging/systemd/cyberos-audiod.service
sidebar:
  order: 8
---

## 支持边界

系统语音通道默认关闭。支持小米遥控器、CyberController StickS3 和 AtomS3 + Voice Pyramid 的
ATVV 1.0 / 16 kHz IMA ADPCM 输入，通过 BlueZ GATT 接收按住说话的录音，不拦截普通 HID 按键。
同时只监听一个显式选择的输入，切换后仍共享原来的持久化系统语音会话。
协议测试和模拟闭环不代表某一遥控器固件已经通过真实收音验收。
遥控器不可用时可以先配置和检查服务，但不要以其他麦克风替代其验收。

模型调用在 API 内协调；非 root 的 `cyberos-audiod` 只负责 GATT、音频解码、
有界录音、WAV 转换和主机/BLE 输出，不持有 CyberAudio 凭据。浏览器也可独立录音与回放，
无需 CyberController 在线；两种输入共享同一个语音会话、上下文和审批规则。

## 配置

1. 在蓝牙页面配对、信任并连接遥控器。Audio 只列出已配对且可信的支持设备。
2. 在 **设置 → Audio** 保存 CyberAudio 基础地址和 Token。Token 留空保留，
   清除必须显式操作；读取 API 只返回 `tokenConfigured`。
3. 测试服务，分别确认地址可达、鉴权成功以及 STT、TTS 就绪，读取服务音色。
   `/ready` 不鉴权，不能代替 Token 测试。
4. 选择可信输入和明确的主机输出设备或同一输入设备的内置扬声器，设置录音上限（1–30 秒）、语言、音色、
   朗读指令、播报开关和音量。输出离线不会切到其他扬声器。
5. 保存后执行录音测试和语音输出测试。录音测试只显示转写，不创建 Agent 消息；
   BLE 输出必须等待设备确认扬声器播完；软件完成也不等于人耳已确认实际出声。
6. 启用语音通道，按住语音键说话、松开投递。播放器上方的麦克风入口打开语音侧栏，
   可回放双方历史，也可在浏览器“录音 → 试听 → 发送”。仅使用浏览器时可不选择设备输入、输出。
   Audio 的“打开语音历史”及侧栏的完整会话入口仍进入同一个系统语音会话。

浏览器只在点击开始录音后请求权限，优先 WebM/Opus，Safari 使用 MP4/AAC。
录音最长 30 秒，且遵循保存的更短上限；单文件不超过 8 MiB。API 通过 FFmpeg 校验真实音频，
统一为 16 kHz 单声道 PCM16 WAV。拒绝无效或超长文件，不创建 Agent 任务。
失败保留当前页试听草稿，重试使用同一个幂等键；关闭侧栏会结束录音并保留草稿。
识别失败且尚未创建 Agent 任务时，重试复用原轮次和已归档录音；任务一旦投递不重复执行。

麦克风需要安全上下文。管理员可在 CyberMachine 启用仅 Tailnet 可访问的 HTTPS，
代理现有 Nginx（API 仍绑定 loopback，不启用 Funnel）：

```bash
sudo tailscale serve status --json  # 变更前保存现有配置
sudo tailscale serve --bg --https=443 http://127.0.0.1:80
```

使用 `tailscale status --json` 中本机 DNSName 对应的 HTTPS 地址访问。

首次启用创建唯一系统语音会话；跨重启保留 ID 和上下文。普通聊天仍为 `chat`，
语音会话为 `voice`。只能重置其模型上下文，不能普通删除；重置保留历史，
清除持久化 provider 映射并递增上下文代数，工作进程下次执行前丢弃旧运行时。
存在录音、识别、排队、运行或审批中的任务时拒绝重置。

## 播放与审批

StickS3 返回播放使用[独立 BLE 播放协议](/docs/reference/ble-playback/)，不修改 ATVV 特征。
普通 AtomS3 + Voice Pyramid 使用 [Wi-Fi 设备协议](/docs/reference/wifi-voice/)，由设备主动连接 CyberOS。
手机连接设备热点，配置 Wi-Fi、CyberOS 局域网地址和独立设备令牌；不需要蓝牙配对或 BlueZ 设备选择。
Wi-Fi 回复直接回到发起设备，不走 audiod，也不改投主机扬声器。现有会话、凭据、历史与审批继续共用。

Wi-Fi 主机将 WAV 转为 16 kHz 单声道 PCM 后按能力切段，各段独立 IMA ADPCM、CRC32 和播放 ID，
等待设备 COMPLETED 后再发下一段。AtomS3 无 PSRAM，每段最多 131072 样本（8.192 秒），压缩缓冲最多 64 KiB。
总音频仍不超过 130 秒；整次期限为 265 秒加每个额外分段 5 秒。取消、新录音、断连或任一段失败均终止后续段。
StickS3 的现有单段 130 秒限制及 ALSA/蓝牙音箱路径保持原行为。
首次烧录和扬声器验收从低音量开始，按住屏幕按键（StickS3 为 A）立即停止旧播报；不自动取消 Agent。
AtomS3 的 TP1 连续触摸两秒打开 Wi-Fi 配置热点，松开后才可再次触发；屏幕显示热点密码。
Voice Pyramid 底部 USB-C 负责供电，AtomS3 USB 用于烧录和诊断。首版不支持自动唤醒、流式 TTS 或全双工。

- 新录音打断旧播报，但不自动取消正在执行的 Agent 任务。旧结果仍留在历史，
  被打断轮次的后续语音不再抢播。最多两个未完成轮次，超出明确报忙。
- 回复跟随发起端：设备输入使用保存的设备输出；浏览器输入只在发起的标签页自动播放，
  其他页面仅更新历史。浏览器阻止自动播放时显示手动播放入口。关闭、后台、刷新后不补播旧回复。
  历史回放始终使用当前浏览器；本地录音和回放临时暂停当前浏览器播放器，
  只有原媒体会话、位置及用户操作均未改变时才恢复，不控制 NAS 的历史回放输出。
- 录音和播报使用 15 秒媒体占用凭证，API 持续续约。VOD player 退出当前 MPV
  进程以真正释放 ALSA；保留原媒体、位置和暂停状态。到期或结束时仅在凭证
  仍有效且未被用户或 Agent 的新媒体操作替代时恢复。API/播放连接断开会停止语音。
- 只从已关联 `jobId` 的 `agent.completed` 最终回复生成语音。不播放思考、工具
  参数或普通聊天的结果。Markdown、链接目标和代码块移除后按句有界分段，
  每段不超过 500 个 Unicode 字符，串行合成非流式 WAV。
- 蓝牙来源不是身份认证。权限规则与普通 Agent 完全相同；待审批时在语音会话
  审核，不能用一句口头确认绕过审批。

## 故障诊断

Audio 显示设备连接、协议、服务鉴权、独立模型就绪、最近轮次阶段、错误和耗时。
`sttMs` 为识别调用耗时，`ttsMs` 为首段合成到播放投递的耗时，`replyMs` 为
轮次登记到首段播放投递的耗时；这些不是声学实测的首次出声时间。
audiod 日志另按 `playback_id` 记录 `ble_transfer_ms` 与 `device_playback_ms`；后者只有收到
设备 COMPLETED 才记录。Agent 执行阶段仍从关联 job 的事件时间计算，不以 BLE 事件替代。

STT 失败或空转写不创建 Agent 任务。TTS/输出失败不重跑 Agent；查看会话中的
文字。429 按 `Retry-After` 有限重试，连接和响应体有超时及大小限制；重定向不
转发凭据。录音唯一 ID、事务和命令幂等键防止重复投递。

用户录音在 daemon 确认清除前归档；Agent 每段合成后归档，按准确的 recordingId/jobId 关联。
双方音频长期保存在配置 `stateDir/audio/history`（生产为 `/cyberos/state/audio/history`），
不按时间自动淘汰；备份和容量规划应包含该目录。目录权限 0700、文件权限 0600，服务端生成文件名并原子发布。
旧轮次缺少原音频时显示“无音频”；保存、合成失败或中断时保留文字并标记音频不可用或不完整，
不会重跑 Agent 或为回放重新调用 TTS。录音测试不进入正式历史。
daemon 未消费录音仍最长暂存五分钟，消费后确认清除其内存副本。
API 重启保留已有任务关联，但抑制旧轮次播报；不重播可能已经播放的内容。
蓝牙重连后重新发现特征并订阅，不复用旧 GATT 路径。

本地诊断接口（与其他管理 API 一样仅由 loopback API 和既有 Nginx 入口提供）：

| 接口 | 用途 |
| --- | --- |
| `GET/PATCH /api/settings/audio` | 兼容原服务地址的配置与凭据写入 |
| `GET /api/audio/status` | 会话 ID、设备状态、轮次、审批及录音测试结果 |
| `GET /api/audio/devices` | 可信输入和显式主机/BLE 输出枚举 |
| `POST /api/audio/test/service` | 分别检查服务、鉴权、STT、TTS 和音色 |
| `POST /api/audio/test/recording` | 45 秒内对下一段遥控器录音做仅测试转写 |
| `POST /api/audio/test/speech` | 使用已保存配置在选定设备测试播报 |
| `POST /api/audio/stop` | 打断播报，不取消 Agent |
| `POST /api/audio/session/reset` | 空闲时重置默认语音上下文 |
| `GET /api/audio/history` | 默认最近 20 轮，使用 before 稳定游标加载更早记录，limit 最大 50 |
| `GET /api/audio/history/events` | SSE history 事件；每次重连同步最近页，客户端按 recordingId 合并 |
| `POST /api/audio/recordings` | 一个 multipart file，x-voice-client 与 Idempotency-Key 标头，接受后返回 202 |
| `GET /api/audio/media/:id` | 按保存资产 ID 回放，支持 Range；通道关闭或设备离线仍可读取 |

```bash
systemctl status cyberos-audiod.service cyberos-vod-player.service cyberos-api.service
journalctl -u cyberos-audiod.service -u cyberos-api.service -n 100 --no-pager
curl -fsS http://127.0.0.1:3010/api/audio/status
curl -fsS http://127.0.0.1:3010/api/audio/devices
```

## 升级与实机验收

本功能新增数据库迁移及 systemd 单元，必须走 Debian 包升级，不可用组件热替换。
升级前停索引及维护/健康/备份定时器，备份匹配旧包和 SQLite/state，再执行包升级、
重启及稳定性检查。回滚二进制不会自动逆转迁移；恢复旧包可能也需要恢复匹配 state。

真实验收仍需：遥控器生成可听 WAV、带 Token 的 STT/TTS、指定输出实际出声、
方向/返回等 HID 无回归，以及至少 20 轮对话、断连重连、审批、媒体暂停恢复、
手动切换媒体不被覆盖和输出离线不误播。无遥控器时只能报告这些项目尚未验证。
