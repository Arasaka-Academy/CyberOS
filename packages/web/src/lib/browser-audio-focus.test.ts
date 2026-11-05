import { expect, it, vi } from "vitest";
import { acquireBrowserAudioFocus } from "./browser-audio-focus.js";

function fixture() {
  class Video extends EventTarget {
    paused = false; ended = false; currentSrc = "movie"; currentTime = 42;
    pause = vi.fn(() => { this.paused = true; });
    play = vi.fn(async () => { this.paused = false; this.dispatchEvent(new Event("play")); });
  }
  const video = new Video();
  const target = { video: video as unknown as HTMLMediaElement, sessionId: "original", revision: 0 };
  return { video, target, acquire: () => acquireBrowserAudioFocus(() => target) };
}
it("resumes the untouched original media exactly once", () => {
  const { video, acquire } = fixture(); const release = acquire();
  expect(video.paused).toBe(true); release(); release(); expect(video.play).toHaveBeenCalledOnce();
});
it.each(["play", "seeking", "volumechange", "ratechange", "emptied"])("does not override a later %s action", (event) => {
  const { video, acquire } = fixture(); const release = acquire(); video.dispatchEvent(new Event(event)); release();
  expect(video.play).not.toHaveBeenCalled();
});
it("does not resume a replaced session, user pause, or previously paused media", () => {
  for (const mutate of [(target: ReturnType<typeof fixture>["target"]) => { target.sessionId = "replacement"; },
    (target: ReturnType<typeof fixture>["target"]) => { target.revision++; }]) {
    const { video, target, acquire } = fixture(); const release = acquire(); mutate(target); release(); expect(video.play).not.toHaveBeenCalled();
  }
  const { video, acquire } = fixture(); video.paused = true; acquire()(); expect(video.play).not.toHaveBeenCalled();
});
