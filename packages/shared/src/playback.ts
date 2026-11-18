/**
 * [INPUT]: 组合音乐、视频、输出偏好和实际路由契约。
 * [OUTPUT]: 提供 NAS 共享播放快照与命令接口。
 * [POS]: 跨界面共享播放状态的公共类型。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { MusicPlayerStatus } from "./music-player.js";
import type {
  ActualAudioRoute,
  VodPlayerStatus,
  VodPlayerCommand,
} from "./vod-player-protocol.js";
import type { PlaybackPreferences } from "./generated/vod-player.js";
import type { PlaybackOutput } from "./video.js";
export interface NasPlaybackStatus {
  actualAudioRoute?: ActualAudioRoute;
  target: "nas";
  owner: "music" | "video" | null;
  sessionId: string | null;
  serviceInstanceId: string;
  revision: number;
  music: MusicPlayerStatus;
  video: VodPlayerStatus;
  preferences: PlaybackPreferences;
  output: PlaybackOutput;
  audioDelayKey: string;
}
export interface PlaybackRuntime {
  getStatus(): Promise<NasPlaybackStatus>;
  command(command: VodPlayerCommand): Promise<NasPlaybackStatus>;
}
