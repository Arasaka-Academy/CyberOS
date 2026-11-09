import { useCallback, useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { APPEARANCE_EVENT } from "@cyberos/shared/appearance";
import "@xterm/xterm/css/xterm.css";
import { applyTerminalOptions, terminalOptions } from "../../../lib/terminal-theme.js";
import {
  TERMINAL_INPUT_LIMIT_BYTES,
  terminalPasteSize,
  terminalPasteTargetMatches,
  terminalReconnectDelay,
  terminalWorkbenchShortcut,
  type TerminalPasteTarget,
  type TerminalSessionHandle,
  type TerminalViewState
} from "../../../lib/terminal-workbench.js";

interface TerminalMessage {
  type: "ready" | "output" | "exit" | "error" | "taken_over";
  data?: string;
  error?: string;
}

interface TerminalSessionProps {
  tabId: string;
  label: string;
  active: boolean;
  inputEnabled: boolean;
  connectionVersion: number;
  connectionError: string;
  disconnectedError: string;
  onStateChange: (tabId: string, state: TerminalViewState) => void;
  onController: (tabId: string, controller: TerminalSessionHandle | null) => void;
  onPaste: (target: TerminalPasteTarget, text: string) => void;
  onShortcut: (action: "copy" | "search") => void;
  onInputError: (error: "unavailable" | "tooLarge") => void;
}

export function TerminalSessionView(props: TerminalSessionProps) {
  const { tabId, label, active, connectionVersion, onStateChange, onController } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const controllerRef = useRef<TerminalSessionHandle | null>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const readyRef = useRef(false);
  const connectionIdRef = useRef(0);
  const propsRef = useRef(props);
  const stateRef = useRef<TerminalViewState>({ status: "connecting", diagnostic: null });
  propsRef.current = props;

  const report = useCallback((patch: Partial<TerminalViewState>) => {
    stateRef.current = { ...stateRef.current, ...patch };
    onStateChange(tabId, stateRef.current);
  }, [onStateChange, tabId]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let searchQuery = "";
    let fitFrame: number | null = null;
    let searchFrame: number | null = null;
    const terminal = new Terminal({ cursorBlink: true, convertEol: true, scrollback: 2_000, ...terminalOptions(host) });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(host);
    terminalRef.current = terminal;

    const target = (): TerminalPasteTarget | null => {
      if (!propsRef.current.active || !propsRef.current.inputEnabled || !readyRef.current || socketRef.current?.readyState !== WebSocket.OPEN) return null;
      return { tabId, connectionId: connectionIdRef.current };
    };
    const fit = () => {
      if (disposed || !propsRef.current.active || host.clientWidth === 0 || host.clientHeight === 0) return;
      const previousCols = terminal.cols;
      const previousRows = terminal.rows;
      fitAddon.fit();
      if (searchQuery && (terminal.cols !== previousCols || terminal.rows !== previousRows)) {
        if (searchFrame !== null) window.cancelAnimationFrame(searchFrame);
        searchFrame = window.requestAnimationFrame(() => {
          searchFrame = null;
          if (!disposed && searchQuery && !terminal.hasSelection()) {
            searchAddon.findNext(searchQuery);
            report({ hasSelection: terminal.hasSelection() });
          }
        });
      }
      report({ cols: terminal.cols, rows: terminal.rows });
      if (socketRef.current?.readyState === WebSocket.OPEN) {
        socketRef.current.send(JSON.stringify({ type: "resize", cols: terminal.cols, rows: terminal.rows }));
      }
    };
    const scheduleFit = () => {
      if (disposed || fitFrame !== null) return;
      fitFrame = window.requestAnimationFrame(() => { fitFrame = null; fit(); });
    };
    const controller: TerminalSessionHandle = {
      target,
      focus: () => { if (!disposed && propsRef.current.active) terminal.focus(); },
      fit,
      selection: () => disposed ? "" : terminal.getSelection(),
      paste: (expected, text) => {
        if (!terminalPasteTargetMatches(expected, target())) return "unavailable";
        const bracketed = terminal.modes.bracketedPasteMode && !terminal.options.ignoreBracketedPasteMode;
        if (terminalPasteSize(text, bracketed) > TERMINAL_INPUT_LIMIT_BYTES) return "tooLarge";
        terminal.paste(text);
        terminal.focus();
        return "sent";
      },
      search: (query, previous = false) => {
        if (disposed) return false;
        searchQuery = query;
        if (!query) { searchAddon.clearDecorations(); terminal.clearSelection(); report({ hasSelection: false }); return true; }
        const found = previous ? searchAddon.findPrevious(query) : searchAddon.findNext(query);
        report({ hasSelection: terminal.hasSelection() });
        return found;
      },
      clearSearch: () => {
        if (disposed) return;
        searchQuery = "";
        searchAddon.clearDecorations();
        terminal.clearSelection();
        report({ hasSelection: false });
      }
    };
    controllerRef.current = controller;
    onController(tabId, controller);
    const resizeObserver = new ResizeObserver(scheduleFit);
    resizeObserver.observe(host);
    const renderDisposable = terminal.onRender(() => {
      const dimensions = fitAddon.proposeDimensions();
      if (dimensions && (dimensions.cols !== terminal.cols || dimensions.rows !== terminal.rows)) scheduleFit();
    });
    const selectionDisposable = terminal.onSelectionChange(() => report({ hasSelection: terminal.hasSelection() }));
    const dataDisposable = terminal.onData(data => {
      if (!target()) return;
      if (new TextEncoder().encode(data).byteLength > TERMINAL_INPUT_LIMIT_BYTES) {
        propsRef.current.onInputError("tooLarge");
        return;
      }
      socketRef.current!.send(JSON.stringify({ type: "input", data }));
    });
    const handlePaste = (event: ClipboardEvent) => {
      event.preventDefault();
      event.stopImmediatePropagation();
      const current = target();
      if (current && event.clipboardData) propsRef.current.onPaste(current, event.clipboardData.getData("text/plain"));
    };
    host.addEventListener("paste", handlePaste, true);
    terminal.attachCustomKeyEventHandler(event => {
      if (event.type !== "keydown") return true;
      const action = terminalWorkbenchShortcut(event);
      if (!action) return true;
      event.preventDefault();
      propsRef.current.onShortcut(action);
      return false;
    });
    const updateAppearance = () => { applyTerminalOptions(terminal, host); scheduleFit(); };
    window.addEventListener(APPEARANCE_EVENT, updateAppearance);
    void document.fonts.ready.then(scheduleFit);
    document.fonts.addEventListener("loadingdone", scheduleFit);
    return () => {
      disposed = true;
      readyRef.current = false;
      controllerRef.current = null;
      onController(tabId, null);
      host.removeEventListener("paste", handlePaste, true);
      window.removeEventListener(APPEARANCE_EVENT, updateAppearance);
      document.fonts.removeEventListener("loadingdone", scheduleFit);
      if (fitFrame !== null) window.cancelAnimationFrame(fitFrame);
      if (searchFrame !== null) window.cancelAnimationFrame(searchFrame);
      resizeObserver.disconnect();
      selectionDisposable.dispose();
      renderDisposable.dispose();
      dataDisposable.dispose();
      terminalRef.current = null;
      terminal.dispose();
    };
  }, [onController, report, tabId]);

  useEffect(() => {
    if (!active) return;
    const frame = window.requestAnimationFrame(() => {
      controllerRef.current?.fit();
      controllerRef.current?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (!active) return;
    let disposed = false;
    let stopped = false;
    let retryTimer: number | null = null;
    let retryAttempt = 0;
    const scheduleReconnect = () => {
      if (disposed || stopped || retryTimer !== null) return;
      retryTimer = window.setTimeout(() => {
        retryTimer = null;
        connect();
      }, terminalReconnectDelay(retryAttempt++));
    };
    const connect = () => {
      if (disposed || stopped) return;
      const url = new URL("/api/terminal", window.location.href);
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(url, ["cyberos-terminal-v1", `cyberos-session.${tabId}`]);
      socketRef.current = socket;
      readyRef.current = false;
      connectionIdRef.current += 1;
      report({ status: "connecting", diagnostic: null, connectionId: connectionIdRef.current });
      const current = () => !disposed && socketRef.current === socket;
      socket.addEventListener("open", () => { if (current()) controllerRef.current?.fit(); });
      socket.addEventListener("message", event => {
        if (!current()) return;
        const message = parseTerminalMessage(event.data);
        if (!message) return;
        if (message.type === "ready") {
          retryAttempt = 0;
          readyRef.current = true;
          report({ status: "connected", diagnostic: null });
          controllerRef.current?.fit();
        } else if (message.type === "output" && message.data) {
          terminalRef.current?.write(message.data);
        } else if (message.type === "error") {
          readyRef.current = false;
          report({ status: "error", diagnostic: message.error ?? propsRef.current.connectionError });
        } else if (message.type === "exit" || message.type === "taken_over") {
          stopped = true;
          readyRef.current = false;
          report({ status: message.type === "exit" ? "exited" : "takenOver", diagnostic: null });
        }
      });
      socket.addEventListener("error", () => {
        if (current() && !stopped) {
          readyRef.current = false;
          report({ status: "error", diagnostic: propsRef.current.connectionError });
        }
      });
      socket.addEventListener("close", () => {
        if (socketRef.current !== socket) return;
        socketRef.current = null;
        readyRef.current = false;
        if (disposed || stopped) return;
        report({ status: "disconnected", diagnostic: propsRef.current.disconnectedError });
        scheduleReconnect();
      });
    };
    connect();
    return () => {
      disposed = true;
      readyRef.current = false;
      if (retryTimer !== null) window.clearTimeout(retryTimer);
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    };
  }, [active, connectionVersion, report, tabId]);

  return <div ref={hostRef} id={`terminal-panel-${tabId}`} className="workspace-terminal" role="tabpanel" aria-label={label} hidden={!active} />;
}

function parseTerminalMessage(raw: unknown): TerminalMessage | null {
  try {
    const parsed = JSON.parse(String(raw)) as TerminalMessage | null;
    if (!parsed || !["ready", "output", "exit", "error", "taken_over"].includes(parsed.type)) return null;
    return parsed;
  } catch {
    return null;
  }
}
