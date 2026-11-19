/**
 * [INPUT]: 依赖共享配置、协议、类型与权限规则。
 * [OUTPUT]: 提供跨工作空间的共享公共接口。
 * [POS]: shared 的包入口。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export * from "./agent-capability-policy.js";
export * from "./notifications.js";
export * from "./config.js";
export * from "./docker-images.js";
export * from "./docker-resources.js";
export * from "./download-list.js";
export * from "./hostd-protocol.js";
export * from "./tailscale.js";
export * from "./iscsi.js";
export * from "./monitoring.js";
export * from "./monitoring-alerts.js";
export * from "./mcp-credentials.js";
export * from "./photos-config.js";
export * from "./photos-semantic.js";
export * from "./photos-embedding-client.js";
export * from "./vod-player-protocol.js";
export * from "./vod-player-client.js";
export * from "./terminal-protocol.js";
export * from "./types.js";
export * from "./system-proxy.js";
export * from "./share-protocols.js";
export * from "./paths.js";
export * from "./music.js";
export * from "./music-player.js";
export * from "./video.js";
export * from "./playback.js";
export * from "./playback-client.js";
export * from "./media-stream.js";
export * from "./media-stream-client.js";
export * from "./audio-settings.js";
export * from "./tv.js";
export * from "./nvr-client.js";
export * from "./generated/nvr.js";

export type { TvOutputOptions, TvOutputApplyResult } from "./tv-outputs.js";
