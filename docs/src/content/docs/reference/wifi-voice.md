---
title: Wi-Fi 语音设备协议
description: AtomS3 与 Voice Pyramid 的热点配置及局域网双向语音传输。
type: reference
status: current
audience: [operator, developer]
sourceOfTruth:
  - packages/api/src/routes/audio-device.ts
  - packages/api/src/lib/wifi-voice-output.ts
  - packages/api/src/lib/audio-coordinator.ts
sidebar:
  order: 21
---

## 连接与配置

普通 AtomS3 + Voice Pyramid 使用 Wi-Fi，不通过 BlueZ/audiod。StickS3 原有 BLE 不变。
设备首次启动开启 `CyberController-Setup` WPA2 热点，屏幕显示随机八位密码；手机打开
`http://192.168.4.1/`，填写 Wi-Fi、CyberOS 局域网 `http://主机[:端口]` 和独立设备令牌。
信息保存到 NVS；不打印 Wi-Fi 密码或令牌。长按 TP1 两秒重新配网，松开才允许再次触发。
配置页面只允许从热点接口保存。已有配置时，未保存的手动配置窗口五分钟后结束。
首版仅支持可信局域网 HTTP/WebSocket、主机名/IPv4 和根路径；不支持 HTTPS 或 IPv6 字面地址。

主机 API 服务环境配置 `CYBEROS_WIFI_VOICE_TOKEN`，32–128 个字母、数字、`_` 或 `-`；建议
使用 `openssl rand -hex 32` 生成，通过受保护的 systemd 环境文件提供。该凭据独立于模型服务 Token，
绝不能放入 URL、日志或版本库。未设置或无效时端点拒绝全部设备。修改环境文件或单元需按既有部署流程操作。
API 保持 loopback 监听，使用现有 Nginx 入口提供局域网 WebSocket 升级，不直接暴露 API 监听器。

设备主动连接 `ws://主机[:端口]/api/audio/device`，携带：

| 请求头 | 内容 |
| --- | --- |
| `Authorization` | `Bearer <设备令牌>` |
| `X-Cyber-Device` | 设备 MAC，`DC:54:75:CD:FB:A0` 格式 |
| `X-Cyber-Max-Samples` | 单段样本上限，AtomS3 为 `131072` |

最多四个连接，同一设备只允许一个连接；容量范围 `131072..2080000`，不合法则拒绝。
首版共享一个配置令牌，通过 MAC 区分连接与回复，MAC 本身不作身份凭据。

## 二进制消息

每条 WebSocket 消息由一个类型字节和负载组成，最大 513 字节。文本、分片和乱序录音报文会断开连接。

| 方向 | 类型 | 负载 |
| --- | --- | --- |
| 主机 → 设备 | `0` | `u8=1`，认证完成/协议版本 |
| 设备 → 主机 | `1` | 空，按下开始录音并打断旧播报 |
| 设备 → 主机 | `2` | 120 字节 IMA ADPCM，即 240 样本、15 ms |
| 设备 → 主机 | `3` | 空，松开并提交录音 |
| 主机 → 设备 | `4` | 既有播放 START/END/CANCEL 控制报文 |
| 主机 → 设备 | `5` | 播放 ID `u32LE`、序号 `u32LE`、最多 480 字节压缩音频 |
| 设备 → 主机 | `6` | 既有 20 字节播放状态 |

控制/状态负载沿用 [BLE 播放协议](/docs/reference/ble-playback/) 的 START、DATA、END、CANCEL 和 COMPLETED 定义；
Wi-Fi 不使用 BLE characteristic，能力由握手请求头提供。ADPCM 高半字节在前，录音开始及每个播放段重置 predictor/index 为零。
上行录音最多 30 秒，按设置的更短上限截取最后一帧；35 秒未松开则终止。断连立即丢弃未提交录音。
心跳每 15 秒一次，45 秒无活动则主机断开；连接恢复不会补发旧录音或旧回复。

## 业务与播放

设备录音使用现有语音协调器、持久会话、ASR、Agent、TTS、媒体归档和审批；记录来源为 `device`，
设备 ID 为 `wifi:<MAC>`。不新增数据库迁移，不复用浏览器的自动回放来源。
需要已启用系统语音通道、配置 CyberAudio，并启用回复播报；Wi-Fi 输入不要求选择 BlueZ 输入/输出。

按下立即停止旧播报并抑制旧轮次后续语音，不取消 Agent。审批仍在 CyberOS 既有界面完成。
回复只能发送到发起设备的当前连接；断连、重连或改配置后不自动补播，失败不切换主机扬声器。

WAV 先转为 16 kHz 单声道 PCM，按能力切段，再分别编码、计算 CRC32 和分配播放 ID。
每段收到 COMPLETED 才开始下一段；取消、断连、任一段失败立即终止全部后续段。
总音频最多 130 秒；单段传输 120 秒，每次确认最多 10 秒，播放期限为样本时长加 5 秒。
整次操作期限为 `265 + 5 × (段数 - 1)` 秒，且包含解码时间。设备最多 64 KiB 压缩缓冲，收齐校验后增量解码。
I2S DMA 实际发送回调确认排空才上报完成。段间允许接收等待，首版不提供无缝播放、自动唤醒或全双工。

## 验收

模拟协议与软件完成不等于人工听音通过。实机必须分别确认热点配置、重启恢复、网络重连、清晰收音、
低音量播放、超过 8.192 秒分段回复、取消，以及至少 20 轮真实对话。Voice Pyramid 底部 USB-C 供电，AtomS3 USB 用于烧录和诊断。
