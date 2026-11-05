interface BrowserAudioTarget { video: HTMLMediaElement | null; sessionId: string | null; revision: number }

/** A temporary pause may resume only the same, untouched local media session. */
export function acquireBrowserAudioFocus(read: () => BrowserAudioTarget): () => void {
  const { video, sessionId, revision } = read();
  if (!video || video.paused || !sessionId) return () => {};
  const source = video.currentSrc;
  const position = video.currentTime;
  let changed = false;
  let released = false;
  const invalidate = () => { changed = true; };
  const events = ["play", "seeking", "volumechange", "ratechange", "emptied"] as const;
  for (const event of events) video.addEventListener(event, invalidate);
  video.pause();
  return () => {
    if (released) return;
    released = true;
    for (const event of events) video.removeEventListener(event, invalidate);
    const current = read();
    if (!changed && revision === current.revision && current.video === video && current.sessionId === sessionId
      && video.currentSrc === source && video.paused && !video.ended && Math.abs(video.currentTime - position) < 0.2) void video.play().catch(() => {});
  };
}
