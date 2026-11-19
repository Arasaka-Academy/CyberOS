# workspace/
> L2 | Parent: ../../AGENTS.md

成员列表
AGENTS.md: 本目录成员与职责地图。
DockerComposeAppDialog.tsx: 提供 DockerComposeAppDialog。
DockerCreateDialogs.tsx: 提供 DockerCreateDialogs, ContainerResources。
DockerDaemonSettingsDialog.tsx: 提供 DockerDaemonSettingsDialog。
DockerImageManagement.test.ts: DockerImageManagement 的行为回归。
DockerImageManagement.tsx: 提供 DockerImageManagement, DockerImageDetailsDialog。
DockerInspectDetails.test.ts: DockerInspectDetails 的行为回归。
DockerInspectDetails.tsx: 提供 DockerNetworkDetailsState, DockerVolumeDetailsState, DockerNetworkDetailsDialog, DockerVolumeDetailsDialog。
DockerResourceStatus.test.ts: DockerResourceStatus 的行为回归。
DockerResourceStatus.tsx: 提供 DockerResourceStatus。
DownloadCreateDialog.tsx: 下载创建；公网链接、BT 预览、文件多选与目录选择。
DownloadDeleteDialog.tsx: 删除确认；冻结任务清单、保留文件说明和批次进度。
DownloadSelectionToolbar.tsx: 已加载任务全选半选、选择数量和批删入口。
DownloadTaskList.tsx: 受控多选窗口列表；滚动分页、缺页补齐与阅读锚点。
DownloadTaskRow.tsx: 可多选下载行；状态图标、校验阶段和任务操作。
FilePreviewDialog.test.ts: FilePreviewDialog 的行为回归。
FilePreviewDialog.tsx: 提供 FilePreviewDialog。
HostAccessPicker.test.ts: HostAccessPicker 的行为回归。
HostAccessPicker.tsx: 提供 HostAccessPicker, hostAccessPickerBlocked, validContainerTarget。
HttpDownloaderPanel.test.ts: HttpDownloaderPanel 的行为回归。
HttpDownloaderPanel.tsx: 下载入口；持有任务选择、冻结删除目标并展示批次结果。
IscsiManagementCard.test.tsx: IscsiManagementCard 的行为回归。
IscsiManagementCard.tsx: 提供 IscsiManagementCard, IscsiInventory。
LocalTerminalPanel.test.ts: LocalTerminalPanel 的行为回归。
LocalTerminalPanel.tsx: 提供 LocalTerminalPanel, TerminalTabBar, terminalInitialLoadPending。
ManagementDashboard.test.ts: ManagementDashboard 的行为回归。
ManagementDashboard.tsx: 提供 ManagementDashboardItem, ManagementDashboardController, useManagementDashboard, ManagementDashboardControls。
ManagementSkeleton.tsx: 提供 SkeletonBlock, PanelContentSkeleton, ManagementWidgetSkeleton, FileListSkeleton。
MonitoringAlertsView.tsx: 提供 MonitoringAlertsView。
MonitoringPanel.test.tsx: MonitoringPanel 的行为回归。
MonitoringPanel.tsx: 提供 MonitoringPanel, mergeMonitoringSeries, mergeMonitoringSamples。
PanelHeader.test.ts: PanelHeader 的行为回归。
PanelHeader.tsx: 提供 PanelHeaderProps, PanelHeader, PanelHeaderActions, PanelHeaderAction。
PanelLoadingSkeletons.tsx: 提供 PhotoQuerySkeleton, PhotoTimelineSkeleton, DownloadsInitialSkeleton, TerminalTabsSkeleton。
PhotoLibraryPanel.test.ts: PhotoLibraryPanel 的行为回归。
PhotoLibraryPanel.tsx: 提供 PHOTO_ACCEPT, shouldRefreshPhotoSnapshot, PhotoLibraryPanel, PhotoLibraryEmptyState。
PhotoMapView.tsx: 提供 configureMapLibreWorker, PhotoMapView, mapArchiveReady, PhotoMapDownloadPanel。
PhotoSearchFilterMenu.tsx: 提供 PhotoSearchFilterMenu, photoFilterMenuIsActive, photoFiltersWithTextOnly, mergePhotoFilterDraft。
ShareManagementPanel.test.ts: ShareManagementPanel 的行为回归。
ShareManagementPanel.tsx: 提供 ShareManagementPanel, ShareProtocolSection, shareStatusTone, shareStatusLabel。
ShareProtocolFields.tsx: 提供 ShareProtocolFields。
StorageFilePickerDialog.test.ts: StorageFilePickerDialog 的行为回归。
StorageFilePickerDialog.tsx: 提供文件、目录和镜像的模态选择器。
SystemEthernetManagement.test.ts: SystemEthernetManagement 的行为回归。
SystemEthernetManagement.tsx: 提供 SystemEthernetManagement。
SystemManagementPanel.test.tsx: SystemManagementPanel 的行为回归。
SystemManagementPanel.tsx: 提供 SystemNetworkManagementPanel, SystemStorageManagementPanel, NetworkReadinessSummary, StorageHealthCharts。
SystemWifiManagement.test.ts: SystemWifiManagement 的行为回归。
SystemWifiManagement.tsx: 提供 SystemWifiManagement。
SystemWifiReadonly.test.ts: SystemWifiReadonly 的行为回归。
SystemWifiReadonly.tsx: 提供 SystemWifiReadonly。
WorkspaceManagementPanel.test.ts: WorkspaceManagementPanel 的行为回归。
WorkspaceManagementPanel.tsx: 提供 ManagementPanelId, WorkspaceManagementPanel, VmInstanceDetailsDialog, VmInstanceActions。
WorkspacePane.test.ts: WorkspacePane 的行为回归。
WorkspacePane.tsx: 提供 FileStoragePoolOption, storagePoolRootDepth, WorkspaceSearchOptions, defaultWorkspaceSearchOptions。
WorkspacePanelBoundary.tsx: 提供 WorkspacePanelBoundary。
WorkspacePanelLoading.test.tsx: WorkspacePanelLoading 的行为回归。
WorkspacePanelLoading.tsx: 提供 WorkspacePanelLoading。
download-task-cache.test.ts: download-task-cache 的行为回归。
download-task-deletion.ts: 串行删除确认目标；逐项进度与部分失败结果。
download-task-selection.ts: 按任务 ID 切换选择、校准加载集合与计算全选半选。
download-task-selection.test.ts: 选择快照、集合校准和串行部分失败回归。
download-history-gaps.ts: 连续补页边界与请求归属；重启恢复不释放新请求。
download-task-cache.ts: 版本化任务缓存；按 ID 合并、权威窗口删除与旧实例隔离。
terminal/: terminal 子模块。
use-download-tasks.ts: 下载同步；分页、窗口 SSE、控制互斥和版本化批删。
useModalDialog.ts: 提供 closeModalForHome, useModalDialog。

[PROTOCOL]: Update this header on change, then check AGENTS.md
