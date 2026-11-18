/**
 * [INPUT]: 依赖共享播放快照和音乐页面选择函数。
 * [OUTPUT]: 验证 HDMI 进入、暂停保留、切曲和退出。
 * [POS]: TV 音乐页面切换规则的纯逻辑回归测试。
 * [PROTOCOL]: Update this header on change, then check AGENTS.md
 */
import { describe, expect, it } from "vitest";
import { nextMusicScreen, hdmiMusic } from "./music-screen.js";

describe("TV HDMI music screen", () => {
  it("requires an observed HDMI route and music ownership", () => {
    expect(hdmiMusic({ owner: "music", music: { state: "playing" }, actualAudioRoute: { kind: "hdmi" } })).toBe(true);
    expect(hdmiMusic({ owner: "music", music: { state: "playing" } })).toBe(false);
    expect(hdmiMusic({ owner: "video", music: { state: "playing" }, actualAudioRoute: { kind: "hdmi" } })).toBe(false);
  });
  it("opens on play, retains pause, and exits on output/owner/stop", () => {
    const snapshot = { owner: "music", music: { state: "playing" }, actualAudioRoute: { kind: "hdmi" } };
    expect(nextMusicScreen(false, snapshot)).toBe(true);
    expect(nextMusicScreen(true, { ...snapshot, music: { state: "paused" } })).toBe(true);
    expect(nextMusicScreen(false, { ...snapshot, music: { state: "paused" } })).toBe(false);
    expect(nextMusicScreen(true, { ...snapshot, music: { state: "idle" } })).toBe(false);
    expect(nextMusicScreen(true, { ...snapshot, actualAudioRoute: { kind: "bluetooth" } })).toBe(false);
  });
  it("retains an open page and focus across next-track startup with an unresolved route", () => {
    const transitions = [
      { owner: "music", music: { state: "playing" }, actualAudioRoute: { kind: "hdmi" } },
      { owner: "music", music: { state: "starting" }, actualAudioRoute: { kind: "unknown" } },
      { owner: "music", music: { state: "playing" }, actualAudioRoute: { kind: "unknown" } },
      { owner: "music", music: { state: "playing" }, actualAudioRoute: { kind: "hdmi" } },
    ];
    let open = false;
    for (const snapshot of transitions) {
      open = nextMusicScreen(open, snapshot);
      expect(open).toBe(true);
    }
    expect(nextMusicScreen(false, transitions[1]!)).toBe(false);
    for (const kind of ["local", "bluetooth", "unavailable"]) expect(nextMusicScreen(true, { owner: "music", music: { state: "starting" }, actualAudioRoute: { kind } })).toBe(false);
    expect(nextMusicScreen(true, { owner: "video", music: { state: "starting" }, actualAudioRoute: { kind: "unknown" } })).toBe(false);
    expect(nextMusicScreen(true, { owner: "music", music: { state: "stopped" }, actualAudioRoute: { kind: "unknown" } })).toBe(false);
  });
});
