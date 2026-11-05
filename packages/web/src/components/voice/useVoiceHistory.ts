import { useCallback, useEffect, useRef, useState } from "react";
import type { VoiceHistorySnapshot, VoiceHistoryTurn } from "@cyberos/shared";

export function mergeVoiceHistory(current: VoiceHistoryTurn[], incoming: VoiceHistoryTurn[]): VoiceHistoryTurn[] {
  const records = new Map(current.map((turn) => [turn.recordingId, turn]));
  for (const turn of incoming) {
    const previous = records.get(turn.recordingId);
    if (!previous || turn.revision >= previous.revision) records.set(turn.recordingId, turn);
  }
  return [...records.values()].sort((a, b) => a.sequence - b.sequence);
}
export function voiceState(snapshot: VoiceHistorySnapshot | null) {
  if (!snapshot) return "connecting";
  if (!snapshot.enabled) return "disabled";
  if (!snapshot.configured) return "unconfigured";
  if (snapshot.status.awaitingApproval) return "approval";
  if (snapshot.status.turns.some((turn) => !["completed", "failed", "interrupted"].includes(turn.status))) return "processing";
  if (!snapshot.status.daemon.available || !snapshot.status.daemon.connected) return "offline";
  return "ready";
}
async function page(before?: string): Promise<VoiceHistorySnapshot> {
  const response = await fetch(`/api/audio/history${before ? `?before=${encodeURIComponent(before)}` : ""}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Voice history unavailable");
  return response.json() as Promise<VoiceHistorySnapshot>;
}
export function useVoiceHistory(open: boolean) {
  const [snapshot, setSnapshot] = useState<VoiceHistorySnapshot | null>(null);
  const [items, setItems] = useState<VoiceHistoryTurn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState(false);
  const [unread, setUnread] = useState(false);
  const openRef = useRef(open); openRef.current = open;
  const initialized = useRef(false);
  const latest = useRef("");
  const oldest = useRef<number | null>(null);
  const latestSequence = useRef(0);
  const eventRevision = useRef(0);
  const accept = useCallback((next: VoiceHistorySnapshot) => {
    const stamp = next.items.map((turn) => `${turn.recordingId}:${turn.assistantText}:${turn.awaitingApproval}`).join("|");
    if (initialized.current && stamp !== latest.current && !openRef.current && next.items.some((turn) => turn.assistantText || turn.awaitingApproval)) setUnread(true);
    latest.current = stamp;
    setSnapshot(next);
    setItems((previous) => mergeVoiceHistory(previous, next.items));
    const first = next.items[0]?.sequence;
    const gap = first !== undefined && initialized.current && first > latestSequence.current + 1;
    if (!initialized.current || gap || (first !== undefined && (oldest.current === null || first < oldest.current))) {
      if (first !== undefined) oldest.current = Math.min(oldest.current ?? first, first);
      setCursor(next.nextCursor);
    }
    latestSequence.current = Math.max(latestSequence.current, next.items.at(-1)?.sequence ?? 0);
    initialized.current = true;
    setLoading(false); setError(false);
  }, []);
  const refresh = useCallback(async () => {
    const revision = eventRevision.current;
    try { const next = await page(); if (revision === eventRevision.current) accept(next); }
    catch { setLoading(false); setError(true); }
  }, [accept]);
  useEffect(() => {
    let live = true;
    const revision = eventRevision.current;
    void page().then((next) => { if (live && revision === eventRevision.current) accept(next); }).catch(() => { if (live) { setError(true); setLoading(false); } });
    const events = new EventSource("/api/audio/history/events");
    events.addEventListener("history", (event) => {
      if (!live) return;
      try { eventRevision.current++; accept(JSON.parse((event as MessageEvent<string>).data) as VoiceHistorySnapshot); }
      catch { setError(true); }
    });
    events.onerror = () => { if (live) setError(true); };
    // Every connection starts with a fresh recent page, including after reconnect.
    return () => { live = false; events.close(); };
  }, [accept]);
  useEffect(() => { if (open) { setUnread(false); void refresh(); } }, [open, refresh]);
  const loadOlder = useCallback(async () => {
    if (!cursor || olderLoading) return;
    setOlderLoading(true);
    try {
      const next = await page(cursor);
      setItems((previous) => mergeVoiceHistory(previous, next.items));
      const first = next.items[0]?.sequence;
      if (first !== undefined) oldest.current = Math.min(oldest.current ?? first, first);
      setCursor(next.nextCursor); setError(false);
      return true;
    } catch { setError(true); return false; }
    finally { setOlderLoading(false); }
  }, [cursor, olderLoading]);
  return { snapshot, items, cursor, loading, olderLoading, error, unread, refresh, loadOlder };
}
