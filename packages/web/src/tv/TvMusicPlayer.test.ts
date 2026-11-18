/**
 * [INPUT]: 依赖 React 静态渲染、国际化和音乐状态快照。
 * [OUTPUT]: 验证曲目信息、播放控件和原生播放边界。
 * [POS]: TV 全屏音乐页面的渲染契约测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n, i18n } from "../i18n/index.js";
import { TvMusicPlayer } from "./TvMusicPlayer.js";

const remote = vi.hoisted(() => ({ status: { queue: [{ id: "item", trackId: "track", title: "Long night", artist: "Artist", album: "Album", coverKey: null }], currentItemId: "item", state: "playing", volume: 60, positionSeconds: 30, durationSeconds: 120, shuffle: false, repeat: "off", error: null }, busy: false, error: null, execute: vi.fn() }));
vi.mock("../components/music/MusicProvider.js", () => ({ useMusicRemote: () => remote }));
beforeAll(async () => { await initI18n(); await i18n.changeLanguage("en"); });
describe("TV music page", () => {
  it("renders cover, title, artist, album, seek, transport and volume without output mutations", () => {
    const html = renderToStaticMarkup(createElement(TvMusicPlayer));
    for (const text of ["Long night", "Artist", "Album", "Pause", "Previous", "Next", "Queue", "0:30", "2:00"]) expect(html).toContain(text);
    expect(html).toContain('aria-label="Volume"');
    expect(html).not.toContain("OutputDeviceSelect");
    expect(html).not.toContain("<audio"); expect(html).not.toContain("<video");
    expect(remote.execute).not.toHaveBeenCalled();
  });
  it("keeps transport visible and offers resume for paused music", () => {
    remote.status.state = "paused";
    const html = renderToStaticMarkup(createElement(TvMusicPlayer));
    expect(html).toContain("Play"); expect(html).toContain("Long night");
  });
});
