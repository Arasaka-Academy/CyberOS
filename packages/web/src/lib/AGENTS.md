# lib/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 本目录成员与职责地图。
agent-composer.ts: 提供 composeAgentMessage, hasActiveAgentTurn。
agent-job-state.test.ts: agent-job-state 的行为回归。
agent-job-state.ts: 提供 ActiveAgentJobState, EMPTY_ACTIVE_AGENT_JOB, markActiveAgentJobRunning, markActiveAgentJobWaitingApproval。
browser-audio-focus.test.ts: browser-audio-focus 的行为回归。
browser-audio-focus.ts: 提供 acquireBrowserAudioFocus。
browser-notifications.ts: 当前浏览器的显式 Push 订阅、身份恢复、偏好与观察确认。
browser-notifications.test.ts: 权限手势、幂等注册、身份恢复与受控跳转回归。
browser-notification-worker.test.ts: 根 Service Worker 的必展示与同源窗口跳转回归。
chat-paths.test.ts: chat-paths 的行为回归。
chat-paths.ts: 提供 WorkspaceMessagePath, MessagePathSegment, resolveWorkspaceMessagePath, resolveWorkspaceMessageLink。
client-id.test.ts: client-id 的行为回归。
client-id.ts: 提供 createClientId。
docker-compose-apps.test.ts: docker-compose-apps 的行为回归。
docker-compose-apps.ts: 提供 DockerComposeEnvironmentFormRow, DockerComposeAppForm, initialDockerComposeAppForm, dockerComposeAppForm。
docker-create-form.test.ts: docker-create-form 的行为回归。
docker-create-form.ts: 提供 DockerCreateKind, DockerCreateForm, initialDockerCreateForm, validateDockerCreateStep。
docker-daemon.test.ts: docker-daemon 的行为回归。
docker-daemon.ts: 提供 DockerDaemonTone, DockerDaemonJsonValidation, validateDockerDaemonJson, dockerDaemonTone。
docker-images.test.ts: docker-images 的行为回归。
docker-images.ts: 提供 isValidDockerImageReference, filterDockerImages, dockerImageDisplayName, dockerImageDeleteTargets。
docker-inventory.test.ts: docker-inventory 的行为回归。
docker-inventory.ts: 提供 DockerImageUsage, sortDockerContainers, sortDockerImages, sortDockerNetworks。
downloads-api.ts: 下载 REST 边界；游标分页、观察版本和保留 HTTP 状态的请求错误。
events.test.ts: events 的行为回归。
events.ts: 提供 reduceAgentToolActivities, eventToTranscriptMessage, getEventJobId。
file-listing-sort.test.ts: file-listing-sort 的行为回归。
file-listing-sort.ts: 提供 FileSortDirection, FileSortKey, FileSortState, sortEntries。
file-selection.test.ts: file-selection 的行为回归。
file-selection.ts: 提供 FileSelectionMode, FileDownloadMode, fileDownloadMode, updateFileSelection。
format.test.ts: format 的行为回归。
format.ts: 提供 toErrorMessage, formatFileModifiedAt。
layout.test.ts: layout 的行为回归。
layout.ts: 提供 DEFAULT_SPLIT_WIDTH, MIN_CHAT_WIDTH, MIN_WORKSPACE_WIDTH, SPLIT_WIDTH_STORAGE_KEY。
management-dashboard-layout.test.ts: management-dashboard-layout 的行为回归。
management-dashboard-layout.ts: 提供 ManagementDashboardId, ManagementDashboardBreakpoint, ManagementDashboardWidgetSize, ManagementDashboardWidgetDefinition。
music-api.test.ts: music-api 的行为回归。
music-api.ts: 提供 MusicApiError, musicRequest, getMusicPlayer, sendMusicCommand。
music-state.test.ts: music-state 的行为回归。
music-state.ts: 提供 VersionedMusicSnapshot, acceptMusicSnapshot, moveQueueItem, MusicLyricLine。
network-traffic.test.ts: network-traffic 的行为回归。
network-traffic.ts: 提供 NetworkTrafficRate, calculateNetworkTrafficRate。
notification-navigation.ts: 通知会话深链接；直接读取历史会话，不依赖最近会话列表。
notification-navigation.test.ts: 历史会话直读与 URL 参数校验。
notification-observation.ts: 当前会话、焦点与实际内容展示的免打扰规则。
notification-observation.test.ts: 后台、未渲染、非当前会话与未完成内容不确认。
use-browser-notifications.ts: 通用通知 SSE、有界重试的展示确认与通知点击跳转。
playback-dock-state.test.ts: playback-dock-state 的行为回归。
playback-dock-state.ts: 提供 readPlaybackBarExpanded, writePlaybackBarExpanded, getPlaybackDockState。
playback-menu-layout.test.ts: playback-menu-layout 的行为回归。
playback-menu-layout.ts: 提供 playbackMenuLayout。
playback-state.test.ts: playback-state 的行为回归。
playback-state.ts: 提供 playbackControlTarget, acceptPlaybackRevision。
preview-settings.test.ts: preview-settings 的行为回归。
preview-settings.ts: 提供 BYTES_PER_MEBIBYTE, DEFAULT_PREVIEW_FILE_SIZE_LIMIT_BYTES, MIN_PREVIEW_FILE_SIZE_LIMIT_BYTES, MAX_PREVIEW_FILE_SIZE_LIMIT_BYTES。
remote-keys.ts: 提供 isBackKey, isHomeKey。
session-api.test.ts: session-api 的行为回归。
session.test.ts: session 的行为回归。
session.ts: 提供 LoadedSessionEntries, isAgentSession, loadEntriesForSession, loadFileListingForView。
spreadsheet-preview.ts: 提供 loadSpreadsheetPreview。
storage-pool-settings.test.ts: storage-pool-settings 的行为回归。
storage-pool-settings.ts: 提供 STORAGE_POOL_STORAGE_KEY, readStoredStoragePoolId, writeStoredStoragePoolId。
system-bluetooth.test.ts: system-bluetooth 的行为回归。
system-bluetooth.ts: 提供 parseSystemBluetoothStatus。
system-ethernet.test.ts: system-ethernet 的行为回归。
system-ethernet.ts: 提供 SystemEthernetTone, parseSystemEthernetStatus, systemEthernetDeviceTone, validateSystemEthernetConfig。
system-wifi.test.ts: system-wifi 的行为回归。
system-wifi.ts: 提供 SystemWifiNetworkGroup, groupSystemWifiAccessPoints, validSystemWifiSsid, validSystemWifiPassword。
tailscale-api.ts: 提供 TailscaleApiError, getSystemTailscale, loginSystemTailscale, updateSystemTailscaleService。
tailscale-settings.test.ts: tailscale-settings 的行为回归。
tailscale-settings.ts: 提供 TailscaleDraft, createTailscaleDraft, tailscaleSettingsPatch, receiveTailscaleStatus。
terminal-tabs.test.ts: terminal-tabs 的行为回归。
terminal-tabs.ts: 提供 TerminalTabNavigationKey, terminalTabLabel, terminalTabNavigationTarget, shouldInitializeTerminalTabs。
terminal-theme.ts: 提供 terminalOptions, applyTerminalOptions。
terminal-workbench.test.ts: terminal-workbench 的行为回归。
terminal-workbench.ts: 提供 TERMINAL_INPUT_LIMIT_BYTES, TerminalStatus, TerminalViewState, TerminalPasteTarget。
toast.test.ts: toast 的行为回归。
toast.ts: 提供 TOAST_DISMISS_MS, scheduleToastDismissal。
tooltip-layer.ts: 提供 mountTooltipLayer。
tooltip-position.test.ts: tooltip-position 的行为回归。
tooltip-position.ts: 提供 TooltipLayout, tooltipPosition, measureTooltipPosition。
tooltip.test.ts: tooltip 的行为回归。
tooltip.ts: 提供 positionTooltip, tooltipDescription。
trailing-single-flight.test.ts: trailing-single-flight 的行为回归。
trailing-single-flight.ts: 提供 TrailingSingleFlight, createTrailingSingleFlight。
transcript.test.ts: transcript 的行为回归。
transcript.ts: 提供 TranscriptPhase, TranscriptItem, TranscriptState, TranscriptAction。
uploads.test.ts: uploads 的行为回归。
uploads.ts: 提供 UploadStatus, UploadSource, UploadItemState, UploadBatchState。
use-bluetooth-transfers.test.ts: use-bluetooth-transfers 的行为回归。
use-bluetooth-transfers.ts: 提供 useBluetoothTransfers, parseBluetoothTransfersEvent。
use-system-bluetooth-status.ts: 提供 useSystemBluetoothStatus。
use-system-wifi-status.ts: 提供 useSystemWifiStatus。
video-api.ts: 提供 mediaRequest, getVideoHome, getVideoFilterOptions, getVideoDetail。
video-progress.test.ts: video-progress 的行为回归。
video-progress.ts: 提供 VIDEO_PROGRESS_STORAGE_PREFIX, VideoProgressIdentity, StoredVideoProgress, videoProgressStorageKey。
vm-create-form.test.ts: vm-create-form 的行为回归。
vm-create-form.ts: 提供 VmCreateForm, isArmVmArchitecture, initialVmCreateForm, vmSnapshotName。
vod-player-status.test.ts: vod-player-status 的行为回归。
vod-player-status.ts: 提供 acceptVodPlayerStatus。
workspace-panel-settings.test.ts: workspace-panel-settings 的行为回归。
workspace-panel-settings.ts: 提供 WORKSPACE_PANEL_STORAGE_KEY, WORKSPACE_PANEL_IDS, WorkspacePanelId, DEFAULT_WORKSPACE_PANEL。

[PROTOCOL]: Update this header on change, then check AGENTS.md
