/**
 * [INPUT]: 依赖媒体、视频素材和 TV 的第一方 HTTP 契约。
 * [OUTPUT]: 提供 TV 页面读取、播放与屏保渲染接口。
 * [POS]: TV 网络边界；不创建本地媒体播放节点。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { MediaHome, MediaTitleDetail, MediaTitlePage, TvModeStatus, TvSettingsRecord, TvDisplayStatus, TvScreensaverItems, VodPlayerCommand, VodPlayerStatus } from "@cyberos/shared";

export interface TvDisplaySnapshot { display: TvDisplayStatus; settings: TvSettingsRecord }
export type { TvScreensaverItems };
export function getTvScreensaverItems(cursor: string | null, signal: AbortSignal): Promise<TvScreensaverItems> {
  return fetchJson(`/api/tv/screensaver/items${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { signal });
}
export function reportTvRenderer(ready: boolean): Promise<unknown> {
  return fetchJson("/api/tv/renderer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ready }) });
}

export async function getMediaHome(): Promise<MediaHome> {
  return fetchJson<MediaHome>("/api/media/home");
}

export async function getMediaTitle(id: string): Promise<MediaTitleDetail> {
  const result = await fetchJson<{ title: MediaTitleDetail }>(`/api/media/titles/${encodeURIComponent(id)}`);
  return result.title;
}

export async function searchMedia(query: string, signal?: AbortSignal): Promise<MediaTitlePage> {
  const params = new URLSearchParams({ query, limit: "60" });
  return fetchJson<MediaTitlePage>(
    `/api/media/titles?${params.toString()}`,
    signal ? { signal } : undefined
  );
}

export async function playMediaFile(fileId: string, startPositionSeconds?: number, expectedSessionId?: string): Promise<VodPlayerStatus> {
  const response = await fetch(`/api/media/files/${encodeURIComponent(fileId)}/play`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...(startPositionSeconds === undefined ? {} : { startPositionSeconds }), ...(expectedSessionId ? { expectedSessionId } : {}) })
  });
  await ensureOk(response);
  return ((await response.json()) as { status: VodPlayerStatus }).status;
}

export async function getVodPlayerStatus(): Promise<VodPlayerStatus> {
  const result = await fetchJson<{ status: VodPlayerStatus }>("/api/vod-player/status");
  return result.status;
}

export async function getTvModeStatus(): Promise<TvModeStatus> {
  const result = await fetchJson<{ status: TvModeStatus }>("/api/tv/status");
  return result.status;
}

export async function sendVodPlayerCommand(
  command: Exclude<VodPlayerCommand, { type: "play" }>
): Promise<VodPlayerStatus> {
  const response = await fetch("/api/vod-player/command", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(command)
  });
  await ensureOk(response);
  return ((await response.json()) as { status: VodPlayerStatus }).status;
}

export function mediaArtworkUrl(titleId: string, kind: "poster" | "backdrop" | "still"): string {
  return `/api/media/titles/${encodeURIComponent(titleId)}/artwork/${kind}`;
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  await ensureOk(response);
  return (await response.json()) as T;
}

async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  let message = response.statusText || "Request failed";
  try {
    const body = (await response.json()) as { error?: string };
    message = body.error ?? message;
  } catch {
    // Keep the HTTP status text.
  }
  throw Object.assign(new Error(message), { statusCode: response.status });
}
