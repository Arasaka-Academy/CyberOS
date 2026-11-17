# packages/shared/src/
> L2 | Parent: ../../../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-capability-policy.ts: 共享权限规则；统一能力别名和完全权限优先级。
appearance-palettes.json: appearance-palettes 静态数据。
appearance.css: appearance 视觉样式。
appearance.test.ts: appearance 的行为与契约验证。
appearance.ts: 公开 AppearancePreference, appearanceSchemes, DEFAULT_APPEARANCE, APPEARANCE_STORAGE_KEY 等接口。
audio-settings.ts: 公开 AUDIO_SETTING_FIELDS, normalizeAudioSettings, publicAudioSettings, normalizeCyberAudioBaseUrl。
browser.ts: browser 模块入口或运行脚本。
config.test.ts: config 的行为与契约验证。
config.ts: 公开 DEFAULT_MONITORING_CONFIG, WORKER_POLL_MS, WORKER_CONCURRENCY, HOSTD_SOCKET_PATH 等接口。
cyberui-tokens.ts: 公开 Palette, Mode, ThemeMode, Locale 等接口。
docker-images.test.ts: docker-images 的行为与契约验证。
docker-images.ts: 公开 normalizeDockerRegistryServerAddress, parseDockerImageReference。
docker-resources.test.ts: docker-resources 的行为与契约验证。
docker-resources.ts: 公开 DOCKER_RESOURCE_FIELDS, getDockerResourceCapability, getUnsupportedDockerResource。
hostd-protocol.test.ts: hostd-protocol 的行为与契约验证。
hostd-protocol.ts: 公开 HostdRequest, HostdNetworkMutationRequest, HostdNetworkInspectionResult, HostdResult 等接口。
hud-tokens.css: hud-tokens 视觉样式。
index.ts: 本模块公共导出入口。
iscsi-protocol.test.ts: iscsi-protocol 的行为与契约验证。
iscsi.test.ts: iscsi 的行为与契约验证。
iscsi.ts: 公开 IscsiChapInput, IscsiTargetInput, IscsiAction, IscsiImage 等接口。
mcp-credentials.ts: 公开 AgentMcpCredentials, agentMcpCredentialHeaders, validateAgentMcpCredentials。
mcp-network.test.ts: mcp-network 的行为与契约验证。
mcp-network.ts: 公开 AddressClass, ValidatedMcpEndpoint, SecureMcpFetch, McpAddressResolver 等接口。
media-stream-client.ts: 公开 mediaStreamerSocketPath, MediaStreamError, MediaStreamRuntime, createMediaStreamRuntime。
media-stream.ts: 公开 StreamTrack, StreamOptions, StreamSession。
monitoring-alerts.ts: 公开 MonitoringAlertSeverity, MonitoringAlertTransform, MonitoringAlertAggregation, MonitoringAlertComparator 等接口。
monitoring.ts: 公开 MonitoringState, MonitoringMetricKind, MonitoringTransform, MonitoringResolution 等接口。
music-player.test.ts: music-player 的行为与契约验证。
music-player.ts: 公开 MusicRepeatMode, MusicQueueEntry, MusicPlayerStatus, MusicPlayerCommand 等接口。
music.ts: 公开 MusicScanState, MusicSource, MusicScan, MusicTrack 等接口。
nvr-client.ts: 公开 NvrMethod, nvrSocketPath, NvrError, NvrRuntime 等接口。
paths.test.ts: paths 的行为与契约验证。
paths.ts: 公开 CyberOsPaths, resolveCyberOsPaths, isPathInside, assertPathInside。
photos-config.test.ts: photos-config 的行为与契约验证。
photos-config.ts: 公开 PHOTOS_DATA_DIRECTORY_NAME, PHOTOS_BASE_MAP_DIRECTORY_NAME, PHOTOS_BASE_MAP_NAME, PHOTOS_BASE_MAP_VERSION 等接口。
photos-embedding-client.test.ts: photos-embedding-client 的行为与契约验证。
photos-embedding-client.ts: 公开 PhotosEmbeddingApiError, PhotosEmbeddingClient。
photos-semantic.ts: 公开 PHOTOS_EMBEDDING_PROTOCOL, PHOTOS_DEFAULT_EMBEDDING_MODEL, PhotosEmbeddingModel, PhotosEmbeddingResponse 等接口。
playback-client.ts: 公开 parsePlaybackSnapshot, createPlaybackRuntime。
playback.ts: 公开 NasPlaybackStatus, PlaybackRuntime。
share-protocols.ts: 公开 isShareProtocol。
system-proxy.ts: 公开 normalizeSystemProxySettings, systemProxyUrl。
tailscale.test.ts: tailscale 的行为与契约验证。
tailscale.ts: 公开 parseTailscaleStatus, unavailableTailscaleStatus。
terminal-protocol.test.ts: terminal-protocol 的行为与契约验证。
terminal-protocol.ts: 公开 TERMINAL_PROTOCOL_VERSION, TERMINAL_MAX_FRAME_BYTES, TERMINAL_MAX_INPUT_BYTES, TERMINAL_MAX_OUTPUT_BYTES 等接口。
types.ts: shared 的跨进程类型契约。
video.ts: 公开 MediaPersonalState, VideoTitle, VideoTitleDetail, MediaCollection 等接口。
vod-player-client.test.ts: vod-player-client 的行为与契约验证。
vod-player-client.ts: 公开 VodPlayerRuntime, VodPlayerRuntimeError, createVodPlayerRuntime。
vod-player-protocol.test.ts: vod-player-protocol 的行为与契约验证。
vod-player-protocol.ts: 公开 VOD_PLAYER_PROTOCOL_VERSION, VOD_PLAYER_BROKER_MAX_FRAME_BYTES, VOD_PLAYER_BROKER_CONNECT_TIMEOUT_MS, VodPlayerState 等接口。
fonts/: 字体文件和许可。
generated/: 协议生成类型。

[PROTOCOL]: Update this header on change, then check AGENTS.md
