import type { NvrSegment } from "@cyberos/shared";

export function localDate(value = new Date()): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export function dayRange(date: string): { from: string; to: string } {
  const start = new Date(`${date}T00:00:00`);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return { from: start.toISOString(), to: new Date(end.getTime() - 1).toISOString() };
}

export interface PlaybackSelection { deviceId: string; from: string; to: string }

export function playbackRange(deviceId: string, occurredAt: string): PlaybackSelection {
  const range = dayRange(localDate(new Date(occurredAt)));
  return { deviceId, from: new Date(Math.max(Date.parse(range.from), Date.parse(occurredAt) - 15000)).toISOString(), to: range.to };
}

export function historyPage<Value>(items: Value[], requested: number) {
  const pages = Math.max(1, Math.ceil(items.length / 50));
  const page = Math.min(pages, Math.max(1, requested));
  return { items: items.slice((page - 1) * 50, page * 50), page, pages, total: items.length };
}

export function playable(segment: NvrSegment): boolean {
  return segment.status === "ready" || segment.status === "recovered";
}

export function segmentPlaybackAt(segment: Pick<NvrSegment, "startedAt">, date: string): string {
  return new Date(Math.max(Date.parse(dayRange(date).from), Date.parse(segment.startedAt))).toISOString();
}

export function segmentPosition(segment: Pick<NvrSegment, "startedAt" | "endedAt">, date: string) {
  const range = dayRange(date);
  const start = Date.parse(range.from), end = Date.parse(range.to) + 1;
  const left = Math.max(start, Date.parse(segment.startedAt));
  const right = Math.min(end, Date.parse(segment.endedAt));
  if (!Number.isFinite(left) || !Number.isFinite(right) || right <= left) return null;
  return { left: (left - start) / (end - start) * 100, width: (right - left) / (end - start) * 100 };
}
