import { useCallback, useEffect, useRef, useState } from "react";

export interface VoiceClip { url: string; duration: number }
export interface VoicePlaybackState { key: string; playing: boolean; position: number; blocked: boolean; error: boolean }
const empty: VoicePlaybackState = { key: "", playing: false, position: 0, blocked: false, error: false };

export function locateVoiceSegment(clips: VoiceClip[], position: number): { index: number; offset: number } {
  let offset = Math.max(0, position);
  for (let index = 0; index < clips.length; index++) {
    if (offset < clips[index]!.duration || index === clips.length - 1) return { index, offset: Math.min(offset, clips[index]!.duration) };
    offset -= clips[index]!.duration;
  }
  return { index: 0, offset: 0 };
}

export function useVoicePlayback(acquireFocus: () => () => void) {
  const [state, setState] = useState<VoicePlaybackState>(empty);
  const audio = useRef<HTMLAudioElement | null>(null);
  const current = useRef<{ key: string; clips: VoiceClip[]; index: number } | null>(null);
  const release = useRef<(() => void) | null>(null);
  const epoch = useRef(0);
  const releaseFocus = useCallback(() => { release.current?.(); release.current = null; }, []);
  const stop = useCallback(() => {
    epoch.current++;
    if (audio.current) { audio.current.pause(); audio.current.removeAttribute("src"); audio.current.load(); }
    current.current = null; releaseFocus(); setState(empty);
  }, [releaseFocus]);
  const play = useCallback(async (key: string, clips: VoiceClip[], position = 0, shouldPlay = true) => {
    if (!clips.length) return;
    stop();
    const generation = epoch.current;
    const element = audio.current ?? new Audio(); audio.current = element;
    const location = locateVoiceSegment(clips, position);
    current.current = { key, clips, index: location.index };
    if (shouldPlay) release.current = acquireFocus();
    const update = () => {
      const active = current.current;
      if (!active || epoch.current !== generation) return;
      const elapsed = active.clips.slice(0, active.index).reduce((sum, clip) => sum + clip.duration, 0) + element.currentTime;
      setState({ key, playing: !element.paused, position: elapsed, blocked: false, error: false });
    };
    const failed = (failure?: unknown) => {
      if (epoch.current !== generation) return;
      element.pause(); releaseFocus();
      const blocked = failure instanceof DOMException && failure.name === "NotAllowedError";
      setState((previous) => ({ ...previous, key, playing: false, blocked, error: !blocked }));
    };
    const startSegment = async (index: number, offset = 0) => {
      if (epoch.current !== generation || !current.current) return;
      current.current.index = index;
      element.src = clips[index]!.url;
      element.onloadedmetadata = () => { if (epoch.current === generation && offset > 0) element.currentTime = offset; };
      if (!shouldPlay) { element.load(); return; }
      try { await element.play(); if (epoch.current === generation) update(); }
      catch (failure) { failed(failure); }
    };
    element.ontimeupdate = update;
    element.onplay = update;
    element.onpause = update;
    element.onerror = () => failed();
    element.onended = () => {
      const active = current.current;
      if (!active || epoch.current !== generation) return;
      if (active.index + 1 < clips.length) void startSegment(active.index + 1);
      else {
        releaseFocus();
        setState({ key, playing: false, position: clips.reduce((sum, clip) => sum + clip.duration, 0), blocked: false, error: false });
      }
    };
    setState({ key, playing: false, position, blocked: false, error: false });
    await startSegment(location.index, location.offset);
  }, [acquireFocus, releaseFocus, stop]);
  const toggle = useCallback((key: string, clips: VoiceClip[]) => {
    const active = current.current;
    const element = audio.current;
    if (active?.key === key && element && !element.paused) {
      element.pause(); releaseFocus();
      return;
    }
    const total = clips.reduce((sum, clip) => sum + clip.duration, 0);
    const position = state.key === key && state.position < total - 0.05 ? state.position : 0;
    void play(key, clips, position);
  }, [play, releaseFocus, state]);
  const seek = useCallback((key: string, clips: VoiceClip[], position: number) => {
    const active = current.current;
    const element = audio.current;
    const location = locateVoiceSegment(clips, position);
    if (active?.key === key && element && active.index === location.index && element.readyState >= 1) {
      element.currentTime = location.offset;
      setState((previous) => ({ ...previous, position }));
    } else void play(key, clips, position, Boolean(active?.key === key && element && !element.paused));
  }, [play]);
  useEffect(() => () => { stop(); }, [stop]);
  return { state, play, toggle, seek, stop };
}
