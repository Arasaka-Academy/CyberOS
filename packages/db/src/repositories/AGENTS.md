# packages/db/src/repositories/
> L2 | Parent: ../AGENTS.md

成员列表
AGENTS.md: 本目录成员和依赖边界。
agent-capability-authorization.ts: Agent 授权边界；按作业归属区分自动执行、凭据输入和人工审批。
agent-mappers.ts: 公开 mapSession, mapMessage, mapJob, mapEvent。
agent-resources.ts: 公开 AgentMcpServerInput, AgentSkillInput, getAgentResourceGeneration, listAgentMcpServers 等接口。
agent-session-commands.ts: 公开 AgentSessionCommandStateError, createAgentSessionCommand, getAgentSessionCommand, getAgentSessionCommandByKey 等接口。
audio.ts: 公开 findVoiceSession, ensureVoiceSession, resetVoiceSession, getVoiceTurn 等接口。
backup-runs.ts: 公开 startBackupRun, recordBackupFailure, finishBackupRun, getBackupRun 等接口。
bluetooth-transfers.ts: 公开 createBluetoothSendTransfers, getBluetoothTransfer, BluetoothReceiveFinalization, listBluetoothReceiveFinalizations 等接口。
capability-runs.ts: 持久能力运行、审批和 Agent 作业关联仓库。
docker-compose-apps.ts: 公开 DockerComposeAppEnvironmentRecord, DockerComposeAppRecord, DockerComposeAppSummaryRecord, DockerComposeAppWriteInput 等接口。
docker-compose-host-access-drafts.test.ts: docker-compose-host-access-drafts 的行为与契约验证。
docker-compose-host-access-drafts.ts: 公开 DockerComposeHostAccessDraftRecord, createDockerComposeHostAccessDraft, getDockerComposeHostAccessDraft, deleteDockerComposeHostAccessDraft 等接口。
docker-console-authorizations.ts: 公开 createDockerConsoleAuthorization, consumeDockerConsoleAuthorization, markDockerConsoleAuthorizationFailed。
docker-operations.ts: 公开 createDockerOperationRecord, getDockerOperation, listDockerOperations, updateDockerOperationStatus。
docker-registry-credentials.ts: 公开 DockerRegistryCredentialRecord, DockerRegistryCredentialConflictError, listDockerRegistryCredentials, createDockerRegistryCredential 等接口。
downloads.test.ts: downloads 的行为与契约验证。
downloads.ts: 公开 createTorrentPreview, getTorrentPreview, deleteTorrentPreview, claimNextTorrentPreview 等接口。
execution-locks.ts: 公开 acquireExecutionLock, isExecutionLockOwner, heartbeatExecutionLock, releaseExecutionLock。
file-batches.ts: 公开 FileBatchItemRecord, ClaimedFileBatchItem, createFileBatch, FileBatchConflictError 等接口。
file-operations.ts: 公开 recordAppliedOperation, getFileOperation, markFileOperationRolledBack, createTrashEntry 等接口。
health-alerts.ts: 公开 upsertHealthAlert, resolveHealthAlert, listHealthAlerts, reconcileHealthAlerts。
index-run-lifecycle.ts: 公开 recoverInterruptedIndexRuns, startIndexRun, isIndexRunRunning, recordIndexFailure 等接口。
index-run-status.ts: 公开 listIndexRunHistory, listIndexStoragePoolStatuses, getIndexStoragePoolStatus。
index-runs.ts: index-runs 模块入口或运行脚本。
index-search.ts: 公开 queryIndexedText, queryIndexAdvanced。
indexed-file-maintenance.ts: 公开 upsertIndexedFile, removeMissingIndexedFiles。
indexed-files.ts: 公开 IndexedFileSnapshot, listIndexedFilesForStoragePool, removeIndexedFile。
indexer-queue.ts: 公开 EnqueueIndexTaskInput, EnqueuedIndexTask, enqueueIndexTask, getIndexerServiceStatus。
jobs.ts: 作业租约、状态转换和事件快照仓库。
mcp-clients.ts: 公开 McpClientKind, McpClientRecord, CreatedMcpClient, createMcpClient 等接口。
mcp-resource-tokens.ts: 公开 McpResourceKind, McpResourceRecord, createMcpResourceToken, consumeMcpResourceToken 等接口。
mcp-transfer-tokens.ts: 公开 McpTransferRecord, createMcpTransferToken, consumeMcpTransferToken, deleteExpiredMcpTransferTokens。
media-library.ts: 公开 MediaCatalogEntryInput, defaultMediaLibrarySettings, getMediaLibrarySettings, saveMediaLibrarySettings 等接口。
monitoring-alerts.ts: 公开 MonitoringAlertRevisionConflictError, MonitoringAlertReferenceConflictError, MonitoringAlertDeliveryCapacityError, MonitoringSmtpUnavailableError 等接口。
music.ts: 公开 listMusicSources, getMusicSource, createMusicSource, updateMusicSource 等接口。
operation-mappers.ts: 公开 mapProviderSession, mapDockerOperation, mapShareOperation, mapStorageOperation 等接口。
operation-notifications.ts: 公开 createOperationNotification, getOperationNotificationByOperation, getOperationNotificationByJob, listOperationNotifications 等接口。
ops-maintenance.ts: 公开 OpsMaintenanceRetentionResult, runOpsMaintenanceRetention, countUnrestoredTrashEntries。
ops-runs.ts: 公开 recoverStaleOpsRuns, startOpsRun, heartbeatOpsRun, finishOpsRun 等接口。
photos-metadata.ts: 公开 PhotosMetadataValueInput, PhotosMetadataWriteInput, PhotosMetadataState, PhotosQueryCursor 等接口。
photos-search-corpus.ts: 公开 PhotosSearchCorpus, PhotosSearchCorpusCache, photosCorpusFacets。
photos-search.ts: 公开 PhotosSearchMatch, rankPhotosSearchMatches, loadPhotosSearchFacets。
photos-semantic.ts: 公开 photosEmbeddingInputSql, PhotosEmbeddingProfile, PhotosEmbeddingRuntime, PhotosEmbeddingJob 等接口。
photos.ts: 公开 PhotosTimelineCursor, PhotosUploadReservationInput, PhotosUploadReservationRecord, PhotosUploadReservationResult 等接口。
repository-rows.ts: 公开 DbSessionRow, DbMessageRow, DbJobRow, DbEventRow 等接口。
sessions.ts: 公开 createSession, getSession, listSessions, updateSessionPath 等接口。
settings-constants.ts: 设置键和默认策略；完全权限默认关闭。
settings-mappers.ts: 持久设置转换和字段校验；兼容旧权限记录。
settings-storage.ts: SQLite 设置读写、记录格式和文本规范化。
tv-settings.ts: TV 输出、独立待机开关和记忆分钟值；兼容旧记录。
settings.ts: 设置类型、默认值和持久化接口。
share-operations.ts: 公开 createShareOperationRecord, getShareOperation, listShareOperations, updateShareOperationStatus。
share-settings-mapper.ts: 公开 mapShareSettings, normalizeShareSettings。
storage-operations.ts: 公开 createStorageOperationRecord, getStorageOperation, listStorageOperations, updateStorageOperationStatus。
system-status.ts: system-status 模块入口或运行脚本。
terminal-tabs.ts: 公开 getTerminalTab, getTerminalTabState, initializeTerminalTabs, createTerminalTab 等接口。
transcript.ts: 公开 AgentTranscriptItemRecord, listTranscriptItems。
video-library.ts: 公开 getVideoTitle, saveMediaState, saveEpisodeWatched, getVideoFilterOptions 等接口。
vm-console-authorizations.ts: 公开 VM_CONSOLE_AUTHORIZATION_TTL_MS, createVmConsoleAuthorization, consumeVmConsoleAuthorization。
vm-operations.ts: 公开 createVmOperationRecord, getVmOperation, getProposedVmOperationForTarget, listVmOperations 等接口。
voice-history.ts: 公开 reserveClientVoiceTurn, reserveBrowserVoiceTurn, findBrowserVoiceTurn, addVoiceMedia 等接口。

[PROTOCOL]: Update this header on change, then check AGENTS.md
