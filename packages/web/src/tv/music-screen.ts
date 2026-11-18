/**
 * [INPUT]: 依赖共享播放快照的所有者、状态和实际音频路由。
 * [OUTPUT]: 提供 HDMI 音乐页面的进入和保留判定。
 * [POS]: TV 页面策略；初次进入要求 HDMI，切歌保留现有页面。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
interface Snapshot {
  owner: string | null;
  music: { state: string };
  actualAudioRoute?: { kind: string };
}
export function hdmiMusic(snapshot: Snapshot | null): boolean {
  return snapshot?.owner === "music" && snapshot.actualAudioRoute?.kind === "hdmi";
}
export function nextMusicScreen(open: boolean, snapshot: Snapshot | null): boolean {
  if (!snapshot || snapshot.owner !== "music") return false;
  const state = snapshot.music.state;
  if (!open) return hdmiMusic(snapshot) && state === "playing";
  const route = snapshot.actualAudioRoute?.kind ?? "unknown";
  return ["hdmi", "unknown"].includes(route) && ["starting", "playing", "paused"].includes(state);
}
