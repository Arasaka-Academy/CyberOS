import type { MediaTitleSummary, VideoHome, VideoTitleDetail } from "@cyberos/shared";

export type TvView = "home" | "movie" | "series" | "collections" | "watchlist";
export interface TitleTarget { id: string; fileId?: string; autoplay?: boolean; fromSearch?: boolean }
export interface HomeItem { title: MediaTitleSummary; fileId?: string; seasonNumber?: number; episodeNumber?: number }
export interface HomeRow { id: "continue" | "upNext" | "recent" | "watchlist"; items: HomeItem[] }

export function uniqueTitles<T extends MediaTitleSummary>(titles: T[]): T[] {
  return [...new Map(titles.map(title => [title.id, title])).values()];
}

export function homeRows(home: VideoHome): HomeRow[] {
  const next = new Map(home.upNext.map(item => [item.title.id, item]));
  return [
    { id: "continue" as const, items: uniqueTitles(home.continueWatching).map(title => ({ title, ...(title.progress ? { fileId: title.progress.fileId } : {}) })) },
    { id: "upNext" as const, items: [...next.values()].map(({ title, fileId, seasonNumber, episodeNumber }) => ({ title, fileId, seasonNumber, episodeNumber })) },
    { id: "recent" as const, items: uniqueTitles(home.recentlyAdded).map(title => ({ title })) },
    { id: "watchlist" as const, items: uniqueTitles(home.watchlist).map(title => ({ title })) },
  ].filter(row => row.items.length > 0);
}

export function featuredTitle(home: VideoHome): MediaTitleSummary | null {
  return home.continueWatching[0] ?? home.recentlyAdded[0] ?? null;
}

export function titleFiles(detail: VideoTitleDetail) {
  return [...detail.files, ...detail.seasons.flatMap(season => season.episodes.flatMap(episode => episode.files))];
}

export function selectTitleFile(detail: VideoTitleDetail, preferred?: string) {
  const files = titleFiles(detail);
  return files.find(file => file.id === preferred) ?? files.find(file => file.id === detail.nextFileId)
    ?? files.find(file => file.id === detail.progress?.fileId) ?? files[0] ?? null;
}

export function resumePosition(detail: VideoTitleDetail, fileId: string): number {
  const progress = detail.fileProgress[fileId];
  return progress && !progress.completed && Number.isFinite(progress.positionSeconds) ? Math.max(0, progress.positionSeconds) : 0;
}
