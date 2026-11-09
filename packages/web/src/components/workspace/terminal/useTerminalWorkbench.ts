import { useCallback, useEffect, useRef, useState } from "react";
import {
  TERMINAL_INPUT_LIMIT_BYTES,
  terminalPasteNeedsConfirmation,
  terminalPasteSize,
  terminalPasteTargetMatches,
  type TerminalFeedback,
  type TerminalPasteTarget,
  type TerminalSessionHandle,
  type TerminalViewState
} from "../../../lib/terminal-workbench.js";

export type TerminalClipboardState =
  | { kind: "copy"; tabId: string; text: string }
  | { kind: "paste" | "confirm"; target: TerminalPasteTarget; text: string };

interface WorkbenchContext {
  active: boolean;
  tabId: string | null;
  busy: boolean;
  viewState: TerminalViewState | null;
}

export function useTerminalWorkbench(context: WorkbenchContext) {
  const panelRef = useRef<HTMLElement>(null);
  const controllers = useRef(new Map<string, TerminalSessionHandle>());
  const contextRef = useRef(context);
  contextRef.current = context;
  const [clipboard, setClipboard] = useState<TerminalClipboardState | null>(null);
  const [feedback, setFeedback] = useState<TerminalFeedback | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [found, setFound] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);

  const currentController = useCallback(() => {
    const current = contextRef.current;
    return current.tabId ? controllers.current.get(current.tabId) : undefined;
  }, []);
  const isCurrent = useCallback((target: TerminalPasteTarget) => {
    const current = contextRef.current;
    return current.active && !current.busy && current.tabId === target.tabId
      && terminalPasteTargetMatches(target, currentController()?.target() ?? null);
  }, [currentController]);
  const onController = useCallback((tabId: string, controller: TerminalSessionHandle | null) => {
    if (controller) controllers.current.set(tabId, controller);
    else controllers.current.delete(tabId);
  }, []);
  const onInputError = useCallback((error: "unavailable" | "tooLarge") => setFeedback(error), []);
  const deliverPaste = useCallback((target: TerminalPasteTarget, text: string) => {
    if (!isCurrent(target)) { setFeedback("unavailable"); return; }
    const result = currentController()!.paste(target, text);
    if (result !== "sent") setFeedback(result);
  }, [currentController, isCurrent]);
  const onPaste = useCallback((target: TerminalPasteTarget, text: string) => {
    if (!isCurrent(target)) { setFeedback("unavailable"); return; }
    setFeedback(null);
    if (terminalPasteSize(text, false) > TERMINAL_INPUT_LIMIT_BYTES) { setFeedback("tooLarge"); return; }
    if (terminalPasteNeedsConfirmation(text)) setClipboard({ kind: "confirm", target, text });
    else deliverPaste(target, text);
  }, [deliverPaste, isCurrent]);

  const copy = useCallback(async () => {
    const tabId = contextRef.current.tabId;
    const text = currentController()?.selection();
    if (!tabId || !text) return;
    setFeedback(null);
    try {
      await navigator.clipboard.writeText(text);
      if (contextRef.current.tabId === tabId && contextRef.current.active) setFeedback("copied");
    } catch {
      if (contextRef.current.tabId === tabId && contextRef.current.active) setClipboard({ kind: "copy", tabId, text });
    }
  }, [currentController]);

  const pasteFromClipboard = useCallback(async () => {
    const target = currentController()?.target();
    if (!target) return;
    setFeedback(null);
    try {
      const text = await navigator.clipboard.readText();
      onPaste(target, text);
    } catch {
      if (isCurrent(target)) setClipboard({ kind: "paste", target, text: "" });
    }
  }, [currentController, isCurrent, onPaste]);

  const closeClipboard = useCallback(() => {
    setClipboard(null);
    currentController()?.focus();
  }, [currentController]);
  const submitClipboard = (text: string) => {
    if (!clipboard) return;
    setClipboard(null);
    if (clipboard.kind === "confirm") deliverPaste(clipboard.target, clipboard.text);
    else if (clipboard.kind === "paste") onPaste(clipboard.target, text);
    else currentController()?.focus();
  };

  const closeSearch = useCallback(() => {
    setSearchOpen(false);
    setQuery("");
    setFound(true);
    currentController()?.clearSearch();
    currentController()?.focus();
  }, [currentController]);
  const openSearch = useCallback(() => setSearchOpen(true), []);
  const search = (next: string, previous = false) => {
    setQuery(next);
    setFound(currentController()?.search(next, previous) ?? false);
  };
  const onShortcut = useCallback((action: "copy" | "search") => {
    if (action === "copy") void copy();
    else openSearch();
  }, [copy, openSearch]);

  useEffect(() => {
    setFullscreenSupported(Boolean(document.fullscreenEnabled && panelRef.current?.requestFullscreen));
    let frame: number | null = null;
    const update = () => {
      setFullscreen(document.fullscreenElement === panelRef.current);
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(() => { currentController()?.fit(); currentController()?.focus(); });
    };
    document.addEventListener("fullscreenchange", update);
    return () => {
      document.removeEventListener("fullscreenchange", update);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [currentController]);

  const toggleFullscreen = async () => {
    try {
      if (document.fullscreenElement === panelRef.current) await document.exitFullscreen();
      else await panelRef.current?.requestFullscreen();
    } catch {
      setFeedback("fullscreenFailed");
    }
  };

  useEffect(() => {
    if (!clipboard) return;
    const valid = clipboard.kind === "copy"
      ? context.active && clipboard.tabId === context.tabId
      : isCurrent(clipboard.target);
    if (!valid) {
      setClipboard(null);
      if (clipboard.kind !== "copy") setFeedback("unavailable");
    }
  }, [clipboard, context.active, context.busy, context.tabId, context.viewState, isCurrent]);

  useEffect(() => {
    setSearchOpen(false);
    setQuery("");
    setFound(true);
    setFeedback(null);
    const controller = context.tabId ? controllers.current.get(context.tabId) : undefined;
    return () => controller?.clearSearch();
  }, [context.active, context.tabId]);

  useEffect(() => {
    if (!context.active && document.fullscreenElement === panelRef.current) void document.exitFullscreen().catch(() => {});
  }, [context.active]);

  return {
    panelRef, onController, onInputError, onPaste, onShortcut,
    clipboard, closeClipboard, submitClipboard, feedback,
    searchOpen, query, found, openSearch, closeSearch, search,
    copy, pasteFromClipboard, fullscreen, fullscreenSupported, toggleFullscreen
  };
}
