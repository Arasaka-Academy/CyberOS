/**
 * [INPUT]: 依赖共享下载分页与观察版本契约及同源 REST。
 * [OUTPUT]: 提供分页读取、版本化操作与版本化删除。
 * [POS]: 下载列表请求边界；旧下载客户端由 api.ts 保持兼容。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import type { DownloadFilter, DownloadTaskKey, DownloadTaskPage, DownloadObservation, DownloadTaskRecord as DownloadTask } from "@cyberos/shared";
async function ensureOk(response: Response): Promise<void> {
  if (response.ok) return;
  const body = await response.json().catch(() => ({})) as { error?: string };
  throw new Error(body.error ?? `Download request failed (${response.status})`);
}
export async function getDownloadPage(input: { filter: DownloadFilter; cursor?: string; anchor?: DownloadTaskKey; limit?: number }, signal?: AbortSignal): Promise<DownloadTaskPage> {
  const query = new URLSearchParams({ mode: "page", filter: input.filter, limit: String(input.limit ?? 50) });
  if (input.cursor) query.set("cursor", input.cursor);
  if (input.anchor) query.set("anchor", JSON.stringify(input.anchor));
  const response = await fetch(`/api/downloads?${query}`, signal ? { signal } : {});
  await ensureOk(response);
  return await response.json() as DownloadTaskPage;
}

export async function actOnDownloadObserved(id: string, action: "pause" | "resume" | "cancel" | "retry" | "stop-seeding"): Promise<{ task: DownloadTask; observation: DownloadObservation }> {
  const response = await fetch(`/api/downloads/${encodeURIComponent(id)}/${action}`, { method: "POST" });
  await ensureOk(response);
  return await response.json() as { task: DownloadTask; observation: DownloadObservation };
}

export async function deleteDownloadObserved(id: string): Promise<DownloadObservation> {
  const response = await fetch(`/api/downloads/${encodeURIComponent(id)}`, { method: "DELETE" });
  await ensureOk(response);
  const observation = response.headers.get("X-CyberOS-Download-Observation");
  if (!observation) throw new Error("Download deletion observation is missing");
  return JSON.parse(observation) as DownloadObservation;
}

