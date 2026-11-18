# packages/api/src/routes/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-resources.test.ts: agent-resources 的行为与契约验证。
agent-resources.ts: 公开 registerAgentResourceRoutes。
approvals.test.ts: approvals 的行为与契约验证。
approvals.ts: 第一方交互边界；凭据仅在请求内存中交给执行器。
audio-device.test.ts: audio-device 的行为与契约验证。
audio-device.ts: 公开 registerAudioDevice。
audio.test.ts: audio 的行为与契约验证。
audio.ts: 公开 registerAudioRoutes。
backup.ts: 公开 registerBackupRoutes。
bluetooth-transfers.test.ts: bluetooth-transfers 的行为与契约验证。
bluetooth-transfers.ts: 公开 registerBluetoothTransferRoutes, finalizeBluetoothReceives, bluetoothAudioDevices, streamBluetoothTransfers。
docker.ts: 公开 registerDockerRoutes, streamDockerDaemonEvents。
downloads.test.ts: downloads 的行为与契约验证。
downloads.ts: 公开 registerDownloadRoutes。
files.ts: 公开 registerFileRoutes。
health-status.ts: 公开 registerHealthStatusRoutes。
health.ts: 公开 registerHealthRoutes。
index.ts: 本模块公共导出入口。
indexer.ts: 公开 registerIndexerRoutes。
iscsi.test.ts: iscsi 的行为与契约验证。
iscsi.ts: 公开 registerIscsiRoutes。
jobs.ts: 作业取消与重试的第一方 HTTP 接口。
media-stream.test.ts: media-stream 的行为与契约验证。
media-stream.ts: 公开 registerMediaStreamRoutes。
media.test.ts: media 的行为与契约验证。
media.ts: 公开 registerMediaRoutes。
monitoring-alerts.test.ts: monitoring-alerts 的行为与契约验证。
monitoring-alerts.ts: 公开 registerMonitoringAlertRoutes。
monitoring.test.ts: monitoring 的行为与契约验证。
monitoring.ts: 公开 registerMonitoringRoutes。
music.test.ts: music 的行为与契约验证。
music.ts: 公开 registerMusicRoutes。
notifications.test.ts: notifications 的行为与契约验证。
notifications.ts: 公开 registerNotificationRoutes。
nvr-preview.test.ts: nvr-preview 的行为与契约验证。
nvr-preview.ts: 公开 MjpegFrames, registerNvrPreview。
nvr.test.ts: nvr 的行为与契约验证。
nvr.ts: 公开 registerNvrRoutes。
operations.ts: 公开 registerOperationRoutes。
photos.test.ts: photos 的行为与契约验证。
photos.ts: 公开 registerPhotoRoutes。
playback.test.ts: playback 的行为与契约验证。
playback.ts: 公开 playbackRuntime, registerPlaybackRoutes。
service-diagnostics.ts: 公开 registerServiceDiagnosticsRoutes。
sessions.ts: Agent 会话接口；补充凭据不计为人工审批。
settings.test.ts: settings 的行为与契约验证。
settings-tv.ts: TV 设置读写；校验素材目录并同步空闲策略。
settings.ts: 系统设置 HTTP 接口；第一方保存完全权限开关。
shares.ts: 公开 registerShareRoutes。
storage.ts: 公开 registerStorageRoutes。
system-operations.test.ts: system-operations 的行为与契约验证。
system-operations.ts: 公开 registerSystemOperationsRoutes。
system.ts: 公开 registerSystemRoutes, streamEthernetEvents, streamWifiEvents, streamBluetoothEvents。
tailscale.test.ts: tailscale 的行为与契约验证。
tailscale.ts: 公开 registerTailscaleRoutes。
terminal.test.ts: terminal 的行为与契约验证。
terminal.ts: 公开 registerTerminalRoutes。
tv-music.test.ts: tv-music 的行为与契约验证。
tv.test.ts: tv 的行为与契约验证。
tv-display.ts: TV 显示事件流；渲染握手限本机，隔离远程 TV 页面。
tv-display.test.ts: 显示事件断连清理、渲染输入和素材接口回归。
tv-screensaver.ts: 已保存 NAS 素材的只读清单与图片接口。
tv.ts: 公开 registerTvRoutes。
vms.test.ts: vms 的行为与契约验证。
vms.ts: 公开 vmConsoleSpawnSpec, registerVmRoutes。
vod-player.test.ts: vod-player 的行为与契约验证。
vod-player.ts: 公开 registerVodPlayerRoutes。
voice-history.test.ts: voice-history 的行为与契约验证。

[PROTOCOL]: Update this header on change, then check AGENTS.md
