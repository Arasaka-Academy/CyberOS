import { useCallback, useEffect, useRef, useState } from "react";
import { createClientId } from "../../lib/client-id.js";

export interface VoiceDraft { blob: Blob; url: string; duration: number; key: string }
type RecorderError = "insecure" | "unsupported" | "permission" | "recordingFailed";
export function useVoiceRecorder(maxSeconds: number, acquireFocus: () => () => void, stopPlayback: () => void) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [energy, setEnergy] = useState(0);
  const [draft, setDraft] = useState<VoiceDraft | null>(null);
  const [error, setError] = useState<RecorderError | null>(null);
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const generation = useRef(0);
  const cleanup = useRef<(() => void) | null>(null);
  const alive = useRef(true);
  const stop = useCallback(() => {
    generation.current++;
    setRequesting(false);
    if (recorder.current?.state === "recording") recorder.current.stop();
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
    cleanup.current?.(); cleanup.current = null;
    setRecording(false); setEnergy(0);
  }, []);
  useEffect(() => () => { if (draft) URL.revokeObjectURL(draft.url); }, [draft]);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; stop(); };
  }, [stop]);
  const start = useCallback(async () => {
    stopPlayback(); stop(); recorder.current = null; setError(null);
    if (!window.isSecureContext) { setError("insecure"); return; }
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") { setError("unsupported"); return; }
    setDraft(null); setRequesting(true);
    const revision = ++generation.current;
    try {
      const input = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      if (!alive.current || revision !== generation.current) { input.getTracks().forEach((track) => track.stop()); return; }
      stream.current = input;
      const mimeType = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"].find((mime) => MediaRecorder.isTypeSupported(mime));
      if (!mimeType) throw new Error("Unsupported audio format");
      const capture = new MediaRecorder(input, { mimeType, audioBitsPerSecond: 64000 });
      recorder.current = capture;
      const chunks: Blob[] = [];
      const began = performance.now();
      const context = new AudioContext();
      cleanup.current = () => { void context.close().catch(() => {}); };
      const source = context.createMediaStreamSource(input);
      const analyser = context.createAnalyser(); analyser.fftSize = 256; source.connect(analyser);
      const releaseFocus = acquireFocus();
      void context.resume().catch(() => {});
      const samples = new Uint8Array(analyser.fftSize);
      let frame = 0;
      const meter = () => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length);
        setEnergy(Math.min(1, rms * 6)); frame = requestAnimationFrame(meter);
      };
      const timer = window.setInterval(() => {
        const duration = (performance.now() - began) / 1000;
        setElapsed(duration);
        // Leave room for the encoder's final packet within the server duration cap.
        if (duration >= Math.max(0.5, maxSeconds - 0.2)) stop();
      }, 100);
      cleanup.current = () => { clearInterval(timer); cancelAnimationFrame(frame); source.disconnect(); void context.close().catch(() => {}); releaseFocus(); };
      capture.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data); };
      capture.onstop = () => {
        const blob = new Blob(chunks, { type: capture.mimeType });
        if (recorder.current !== capture) return;
        recorder.current = null;
        cleanup.current?.(); cleanup.current = null;
        input.getTracks().forEach((track) => track.stop()); stream.current = null;
        setRecording(false); setEnergy(0);
        if (alive.current && blob.size) setDraft({ blob, url: URL.createObjectURL(blob), duration: Math.min(maxSeconds, (performance.now() - began) / 1000), key: createClientId() });
        else if (alive.current) setError("recordingFailed");
      };
      capture.onerror = () => { setError("recordingFailed"); stop(); };
      capture.start(250);
      setElapsed(0); setRecording(true); setRequesting(false); meter();
    } catch (failure) {
      if (revision !== generation.current) return;
      stop();
      if (alive.current) setError(failure instanceof DOMException && (failure.name === "NotAllowedError" || failure.name === "SecurityError") ? "permission" : "recordingFailed");
    }
  }, [acquireFocus, maxSeconds, stop, stopPlayback]);
  return { recording, requesting, elapsed, energy, draft, setDraft, error, setError, start, stop };
}
