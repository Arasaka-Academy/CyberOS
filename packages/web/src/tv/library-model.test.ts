import { describe, expect, it } from "vitest";
import type { MediaTitleSummary, VideoHome, VideoTitleDetail } from "@cyberos/shared";
import { homeRows, featuredTitle, selectTitleFile, resumePosition, uniqueTitles } from "./library-model.js";

const title = (id: string) => ({ id, title: id }) as MediaTitleSummary;
const home = (patch: Partial<VideoHome> = {}): VideoHome => ({
  continueWatching: [], recentlyAdded: [], movies: [], series: [], watchlist: [], upNext: [], collections: [], ...patch,
});
const detail = {
  ...title("show"), files: [], nextFileId: "episode-2-hd", progress: { fileId: "episode-1" },
  seasons: [{ seasonNumber: 1, episodes: [
    { id: "episode-1", files: [{ id: "episode-1", episodeId: "episode-1" }] },
    { id: "episode-2", files: [{ id: "episode-2-hd", episodeId: "episode-2" }, { id: "episode-2-4k", episodeId: "episode-2" }] },
  ] }],
  fileProgress: { "episode-1": { positionSeconds: 90, completed: true }, "episode-2-hd": { positionSeconds: 42, completed: false } },
} as unknown as VideoTitleDetail;

describe("TV library model", () => {
  it("groups home rows by title while preserving the next episode identity", () => {
    const first = { title: title("show"), fileId: "episode-2-4k", episodeId: "episode-2", seasonNumber: 1, episodeNumber: 2 };
    const rows = homeRows(home({ continueWatching: [title("show"), title("show")], upNext: [first, first] as VideoHome["upNext"], recentlyAdded: [title("movie")] }));
    expect(rows.map(row => row.id)).toEqual(["continue", "upNext", "recent"]);
    expect(rows[0]?.items).toHaveLength(1);
    expect(rows[1]?.items[0]).toMatchObject({ title: { id: "show" }, fileId: "episode-2-4k", seasonNumber: 1, episodeNumber: 2 });
  });

  it("prefers a resumable title then recent additions without inventing recommendations", () => {
    expect(featuredTitle(home({ continueWatching: [title("resume")], recentlyAdded: [title("new")] }))?.id).toBe("resume");
    expect(featuredTitle(home({ recentlyAdded: [title("new")] }))?.id).toBe("new");
    expect(featuredTitle(home())).toBeNull();
    expect(uniqueTitles([title("one"), title("one"), title("two")]).map(item => item.id)).toEqual(["one", "two"]);
  });

  it("selects an explicit next-episode version before automatic continuation", () => {
    expect(selectTitleFile(detail, "episode-2-4k")?.id).toBe("episode-2-4k");
    expect(selectTitleFile(detail)?.id).toBe("episode-2-hd");
    expect(selectTitleFile({ ...detail, nextFileId: "missing" })?.id).toBe("episode-1");
    expect(selectTitleFile({ ...detail, files: [], seasons: [] })).toBeNull();
  });

  it("restarts completed files and resumes only the chosen file", () => {
    expect(resumePosition(detail, "episode-1")).toBe(0);
    expect(resumePosition(detail, "episode-2-hd")).toBe(42);
    expect(resumePosition(detail, "episode-2-4k")).toBe(0);
  });
});
