/**
 * [INPUT]: 依赖 DRM 连接器、ALSA 播放设备和已应用输出。
 * [OUTPUT]: 提供 TV 输出候选与应用结果的 HTTP 契约。
 * [POS]: 设置页面与输出枚举服务的共享数据边界。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
export interface TvOutputOptions {
  drm: { items: Array<{ id: string; name: string; connected: boolean; modes: string[] }>; error: string | null };
  audio: { items: Array<{ id: string; name: string }>; error: string | null };
  applied: { known: boolean; drmConnector: string | null };
  restartRequired: boolean;
}
export interface TvOutputApplyResult { applied: true; drmConnector: string | null }
