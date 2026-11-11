import { Button as UiButton, EmptyState, Input, Notice } from "@cyberos/ui";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, ChevronLeft, ChevronRight, Delete, Languages, Search, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { createPinyinEngine, PinyinIMEController, type CandidateItem, type PinyinEngine } from "pinyin-ime";
import type { MediaTitleSummary } from "@cyberos/shared";
import { useModalDialog } from "../components/workspace/useModalDialog.js";
import { isBackKey } from "../lib/remote-keys.js";
import { searchMedia } from "./api.js";
import { MediaCard } from "./MediaCard.js";
import { uniqueTitles } from "./library-model.js";

const KEYS = ["1234567890", "qwertyuiop", "asdfghjkl", "zxcvbnm"];

export function SearchOverlay({ open, onClose, onOpen }: {
  open: boolean;
  onClose: () => void;
  onOpen: (title: MediaTitleSummary) => void;
}) {
  const { t } = useTranslation();
  const dialogRef = useModalDialog(onClose, false, open);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLElement>(null);
  const engine = useRef<PinyinEngine | null>(null);
  const value = useRef("");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MediaTitleSummary[]>([]);
  const [state, setState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [retry, setRetry] = useState(0);
  const [dictionary, setDictionary] = useState<"loading" | "ready" | "error">("loading");
  const [dictionaryRetry, retryDictionary] = useState(0);
  const resultFocus = useRef<string | null>(null);
  const completedSearch = useRef<{ query: string; retry: number } | null>(null);
  const scroll = useRef(0);
  const lastKey = useRef<HTMLButtonElement | null>(null);
  const change = useCallback((next: string) => {
    if (value.current !== next) resultFocus.current = null;
    value.current = next;
    if (inputRef.current) inputRef.current.value = next;
    setQuery(next);
  }, []);
  const [controller] = useState(() => new PinyinIMEController<HTMLInputElement>({
    getValue: () => value.current,
    onValueChange: change,
    getElement: () => inputRef.current,
    getEngine: () => engine.current,
    pageSize: 7,
  }));
  const subscribe = useCallback((listener: () => void) => controller.subscribe(listener), [controller]);
  const snapshot = useSyncExternalStore(subscribe, () => controller.getSnapshot());
  const cancelComposition = () => controller.handleKeyDown(new KeyboardEvent("keydown", { key: "Escape", cancelable: true }));

  useEffect(() => {
    if (!open || engine.current) return;
    let live = true;
    setDictionary("loading");
    void import("pinyin-ime/dictionary/google_pinyin_dict").then(({ dict }) => {
      if (!live) return;
      engine.current = createPinyinEngine(dict);
      controller.setOptions({ getEngine: () => engine.current });
      setDictionary("ready");
    }).catch(() => { if (live) setDictionary("error"); });
    return () => { live = false; };
  }, [controller, dictionaryRetry, open]);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const result = [...(dialogRef.current?.querySelectorAll<HTMLButtonElement>("[data-tv-search-title]") ?? [])].find(element => element.dataset.tvSearchTitle === resultFocus.current);
      const active = document.activeElement;
      if (result || !active || active === dialogRef.current || !dialogRef.current?.contains(active)) (result ?? dialogRef.current?.querySelector<HTMLButtonElement>('[data-tv-key="q"]'))?.focus({ preventScroll: true });
      if (resultsRef.current) resultsRef.current.scrollTop = scroll.current;
    });
    return () => cancelAnimationFrame(frame);
  }, [open, dialogRef]);

  useEffect(() => {
    if (!open) return;
    if (!query.trim()) { setState("idle"); return; }
    if (completedSearch.current?.query === query && completedSearch.current.retry === retry) { setState("ready"); return; }
    const abort = new AbortController();
    setState("loading");
    const timer = setTimeout(() => {
      void searchMedia(query, abort.signal).then(page => {
        if (abort.signal.aborted) return;
        setResults(uniqueTitles(page.titles));
        completedSearch.current = { query, retry };
        setState("ready");
      }).catch(() => { if (!abort.signal.aborted) setState("error"); });
    }, 240);
    return () => { clearTimeout(timer); abort.abort(); };
  }, [query, open, retry]);

  function keepKeyboardFocus(target: HTMLElement | null, caret?: number, imeCommit = false) {
    const activeAtRequest = document.activeElement;
    const valueAtRequest = value.current;
    requestAnimationFrame(() => {
      // Restore the caret after controlled input updates even if focus moved
      // to another virtual key. A newer input edit owns its own caret.
      if (caret !== undefined && value.current === valueAtRequest && document.activeElement !== inputRef.current) inputRef.current?.setSelectionRange(caret, caret);
      // IME commits focus the input themselves; other focus changes belong to
      // a later navigation intent and must take priority over this restoration.
      const active = document.activeElement;
      if (active !== activeAtRequest && dialogRef.current?.contains(active) && !(imeCommit && active === inputRef.current)) return;
      const next = target?.isConnected ? target : lastKey.current?.isConnected ? lastKey.current : inputRef.current;
      next?.focus({ preventScroll: true });
    });
  }
  function choose(item: CandidateItem, target: HTMLElement | null) {
    controller.selectCandidate(item);
    keepKeyboardFocus(target, undefined, true);
  }
  function sendKey(key: string, target: HTMLButtonElement) {
    lastKey.current = target;
    let caret: number | undefined;
    let imeCommit = false;
    if (snapshot.hasActiveComposition || (snapshot.chineseMode && /^[a-z']$/i.test(key))) {
      controller.handleKeyDown(new KeyboardEvent("keydown", { key, cancelable: true }));
      imeCommit = snapshot.hasActiveComposition && !controller.getSnapshot().hasActiveComposition;
    } else {
      const input = inputRef.current;
      if (!input) return;
      const start = input.selectionStart ?? value.current.length;
      const end = input.selectionEnd ?? start;
      const from = key === "Backspace" && start === end ? Math.max(0, start - 1) : start;
      const text = key === "Backspace" ? "" : key;
      change(value.current.slice(0, from) + text + value.current.slice(end));
      caret = from + text.length;
    }
    keepKeyboardFocus(target, caret, imeCommit);
  }
  function toggleLanguage(target: HTMLButtonElement) {
    cancelComposition();
    controller.handleKeyDown(new KeyboardEvent("keydown", { key: "Shift" }));
    controller.handleKeyUp(new KeyboardEvent("keyup", { key: "Shift" }));
    keepKeyboardFocus(target);
  }

  if (!open) return null;
  return <section ref={dialogRef} tabIndex={-1} className="tv-search" role="dialog" aria-modal="true" aria-label={t("tv.search")}
    onKeyDown={event => {
      if (isBackKey(event) && controller.getSnapshot().hasActiveComposition) {
        event.preventDefault(); event.stopPropagation(); cancelComposition();
        keepKeyboardFocus(lastKey.current);
      } else if (event.target !== inputRef.current && !event.ctrlKey && !event.metaKey && !event.altKey) {
        if (/^[a-z0-9' ]$/i.test(event.key) || event.key === "Backspace") {
          const target = document.activeElement instanceof HTMLButtonElement ? document.activeElement : lastKey.current;
          if (target) { event.preventDefault(); event.stopPropagation(); sendKey(event.key.toLowerCase() === "backspace" ? "Backspace" : event.key.toLowerCase(), target); }
        } else if (event.key === "Shift") controller.handleKeyDown(event.nativeEvent);
      }
    }} onKeyUp={event => { if (event.target !== inputRef.current && event.key === "Shift") controller.handleKeyUp(event.nativeEvent); }}>
    <div className="tv-search-entry">
      <header className="tv-search-title"><div><span className="tv-eyebrow">CyberOS / {t("tv.library")}</span><h1><Search aria-hidden="true" />{t("tv.search")}</h1></div><UiButton variant="ghost" iconOnly className="tv-icon-button" data-tv-focusable onClick={onClose} aria-label={t("tv.closeSearch")}><ArrowLeft /></UiButton></header>
      <div className="tv-search-header" data-tv-region="search-header">
      <Input ref={inputRef} className="tv-search-input" data-tv-focusable data-tv-text-input data-tv-composing={snapshot.hasActiveComposition}
        value={query} aria-label={t("tv.searchPlaceholder")} data-tooltip={t("tv.keyboardLanguage")} placeholder={t("tv.searchPlaceholder")}
        onChange={event => { resultFocus.current = null; change(event.target.value); }}
        onKeyDown={event => {
          const snap = controller.getSnapshot();
          if (event.key === "Enter" && snap.hasActiveComposition && snap.candidates.length) {
            event.preventDefault(); event.stopPropagation();
            const candidate = snap.candidates[snap.highlightedCandidateIndex ?? snap.page * snap.pageSize];
            if (candidate) choose(candidate, inputRef.current);
          } else controller.handleKeyDown(event.nativeEvent);
        }}
        onBeforeInput={event => controller.handleBeforeInput(event.nativeEvent as InputEvent)}
        onKeyUp={event => controller.handleKeyUp(event.nativeEvent)}
        onBlur={() => controller.resetShiftGestureState()}
      />
    </div>
    <section className="tv-ime" aria-label={t("tv.candidates")}>
      <div className="tv-ime-composition" role="status">{snapshot.hasActiveComposition ? snapshot.pinyinInput : t(snapshot.chineseMode ? "tv.pinyinHint" : "tv.englishHint")}</div>
      {snapshot.chineseMode && dictionary === "loading" ? <p role="status">{t("tv.loadingInput")}</p> : snapshot.chineseMode && dictionary === "error" ? <Notice tone="danger" actions={<UiButton variant="secondary" onClick={() => retryDictionary(v => v + 1)}>{t("tv.retry")}</UiButton>}>{t("tv.inputFailed")}</Notice> : snapshot.hasActiveComposition ?
        <div className="tv-ime-candidates" data-tv-region="candidates">
          <UiButton iconOnly variant="ghost" disabled={snapshot.page === 0} aria-label={t("tv.previousCandidates")} onClick={() => controller.addPage(-1)}><ChevronLeft /></UiButton>
          {snapshot.displayCandidates.map(item => <UiButton variant="ghost" key={item.word} data-tv-candidate data-tv-focusable onClick={() => choose(item, lastKey.current)}>{item.word}</UiButton>)}
          <UiButton iconOnly variant="ghost" disabled={(snapshot.page + 1) * snapshot.pageSize >= snapshot.candidates.length} aria-label={t("tv.nextCandidates")} onClick={() => controller.addPage(1)}><ChevronRight /></UiButton>
        </div> : <div className="tv-ime-idle" aria-hidden="true">{t("tv.keyboardHint")}</div>}
    </section>
    <div className="tv-keyboard" aria-label={t("tv.keyboard")}>
      {KEYS.map(row => <div className="tv-keyboard-row" data-tv-region="keyboard-row" key={row}>
        {[...row].map(letter => <UiButton variant="secondary" data-tv-focusable data-tv-key={letter} key={letter} onClick={event => sendKey(letter, event.currentTarget)}>{letter.toUpperCase()}</UiButton>)}
      </div>)}
      <div className="tv-keyboard-row tv-keyboard-tools" data-tv-region="keyboard-row">
        <UiButton variant="secondary" data-tv-focusable aria-pressed={snapshot.chineseMode} onClick={event => toggleLanguage(event.currentTarget)}><Languages />{t(snapshot.chineseMode ? "tv.chineseInput" : "tv.englishInput")}</UiButton>
        <UiButton variant="secondary" data-tv-focusable onClick={event => sendKey(" ", event.currentTarget)}>{t(snapshot.hasActiveComposition ? "tv.keyboardSpace" : "tv.space")}</UiButton>
        <UiButton variant="secondary" data-tv-focusable onClick={event => sendKey("Backspace", event.currentTarget)} aria-label={t("tv.keyboardDelete")}><Delete /></UiButton>
        <UiButton variant="secondary" data-tv-focusable aria-label={t("tv.clearSearch")} onClick={event => { cancelComposition(); change(""); keepKeyboardFocus(event.currentTarget, 0); }}><X /></UiButton>
      </div>
    </div>
    </div>
    <section ref={resultsRef} className="tv-search-results" aria-label={t("tv.searchResults")} aria-busy={state === "loading"} onScroll={event => { scroll.current = event.currentTarget.scrollTop; }}>
      <header><span className="tv-eyebrow">{t("tv.movies")} / {t("tv.series")}</span><h2>{t("tv.searchResults")}</h2></header>
      {!query.trim() ? <EmptyState className="tv-search-empty" icon={<Search />} title={t("tv.searchPlaceholder")} description={t("tv.searchHint")} /> : <>
      {state === "loading" ? <p role="status">{t("tv.searching")}</p> : state === "error" ? <Notice className="tv-search-error" tone="danger" actions={<UiButton variant="secondary" onClick={() => setRetry(v => v + 1)}>{t("tv.retry")}</UiButton>}>{t("tv.searchFailed")}</Notice> :
        results.length ? <div className="tv-search-grid" data-tv-region="search-results">{results.map(title => <MediaCard search key={title.id} item={{ title }} onOpen={() => { resultFocus.current = title.id; onOpen(title); }} />)}</div> : state === "ready" ? <EmptyState className="tv-search-empty" title={t("tv.noResults")} /> : null}
      </>}
    </section>
  </section>;
}
