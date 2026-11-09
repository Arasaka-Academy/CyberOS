import { Button, Input } from "@cyberos/ui";
import { ArrowDown, ArrowUp, ClipboardPaste, Copy, Maximize, Minimize, MoreHorizontal, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { usePopoverBack } from "../../common/ModalPortal.js";
import type { TerminalFeedback, TerminalViewState } from "../../../lib/terminal-workbench.js";

export function TerminalToolbar({ disabled, connected, hasSelection, searchOpen, fullscreen, fullscreenSupported, onSearch, onCopy, onPaste, onFullscreen }: {
  disabled: boolean;
  connected: boolean;
  hasSelection: boolean;
  searchOpen: boolean;
  fullscreen: boolean;
  fullscreenSupported: boolean;
  onSearch: () => void;
  onCopy: () => void;
  onPaste: () => void;
  onFullscreen: () => void;
}) {
  const { t } = useTranslation();
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const closeMore = () => { setMoreOpen(false); triggerRef.current?.focus(); };
  usePopoverBack(moreOpen, closeMore);
  useEffect(() => {
    if (!moreOpen) return;
    menuRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !moreRef.current?.contains(event.target)) setMoreOpen(false);
    };
    const resized = () => setMoreOpen(false);
    document.addEventListener("pointerdown", outside);
    window.addEventListener("resize", resized);
    return () => { document.removeEventListener("pointerdown", outside); window.removeEventListener("resize", resized); };
  }, [moreOpen]);
  const actions = [
    { key: "copy", label: t("workspace.terminal.copy"), icon: <Copy size={16} />, disabled: disabled || !hasSelection, run: onCopy },
    { key: "paste", label: t("workspace.terminal.paste"), icon: <ClipboardPaste size={16} />, disabled: disabled || !connected, run: onPaste },
    { key: "fullscreen", label: t(`workspace.terminal.${fullscreen ? "exitFullscreen" : "fullscreen"}`), icon: fullscreen ? <Minimize size={16} /> : <Maximize size={16} />, disabled: !fullscreenSupported, run: onFullscreen }
  ];
  return <div className="terminal-toolbar" role="group" aria-label={t("workspace.terminal.tools")}>
    <Button iconOnly variant="ghost" type="button" className="terminal-tool" disabled={disabled} aria-label={t("workspace.terminal.search")} data-tooltip={t("workspace.terminal.search")} aria-pressed={searchOpen} onClick={onSearch}><Search size={16} /></Button>
    <div className="terminal-desktop-tools">{actions.map(action => <Button key={action.key} iconOnly variant="ghost" type="button" className="terminal-tool" aria-label={action.label} data-tooltip={action.key === "fullscreen" && !fullscreenSupported ? t("workspace.terminal.fullscreenUnsupported") : action.label} disabled={action.disabled} onClick={action.run}>{action.icon}</Button>)}</div>
    <div ref={moreRef} className="terminal-mobile-tools" onBlur={event => { if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setMoreOpen(false); }} onKeyDown={event => { if (moreOpen && event.key === "Escape") { event.preventDefault(); event.stopPropagation(); closeMore(); } }}>
      <Button ref={triggerRef} iconOnly variant="ghost" type="button" className="terminal-tool" aria-label={t("workspace.terminal.more")} data-tooltip={t("workspace.terminal.more")} aria-expanded={moreOpen} aria-controls={menuId} onClick={() => setMoreOpen(current => !current)}><MoreHorizontal size={17} /></Button>
      {moreOpen ? <div ref={menuRef} id={menuId} className="terminal-more-menu" role="group" aria-label={t("workspace.terminal.more")}>{actions.map(action => <Button key={action.key} variant="plain" type="button" disabled={action.disabled} data-tooltip={action.key === "fullscreen" && !fullscreenSupported ? t("workspace.terminal.fullscreenUnsupported") : undefined} onClick={() => { setMoreOpen(false); action.run(); }}>{action.icon}<span>{action.label}</span></Button>)}</div> : null}
    </div>
  </div>;
}

export function TerminalSearchBar({ query, found, onSearch, onClose }: { query: string; found: boolean; onSearch: (query: string, previous?: boolean) => void; onClose: () => void }) {
  const { t } = useTranslation();
  return <div className="terminal-search" role="search" onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); } }}>
    <Search size={15} aria-hidden="true" />
    <Input autoFocus value={query} aria-label={t("workspace.terminal.searchInput")} placeholder={t("workspace.terminal.searchInput")} onChange={event => onSearch(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); onSearch(query, event.shiftKey); } }} />
    <span className="terminal-search-result" role="status">{query && !found ? t("workspace.terminal.noMatches") : ""}</span>
    <Button iconOnly variant="ghost" className="terminal-tool" type="button" disabled={!query} aria-label={t("workspace.terminal.previousMatch")} data-tooltip={t("workspace.terminal.previousMatch")} onClick={() => onSearch(query, true)}><ArrowUp size={16} /></Button>
    <Button iconOnly variant="ghost" className="terminal-tool" type="button" disabled={!query} aria-label={t("workspace.terminal.nextMatch")} data-tooltip={t("workspace.terminal.nextMatch")} onClick={() => onSearch(query)}><ArrowDown size={16} /></Button>
    <Button iconOnly variant="ghost" className="terminal-tool" type="button" aria-label={t("workspace.terminal.closeSearch")} data-tooltip={t("workspace.terminal.closeSearch")} onClick={onClose}><X size={16} /></Button>
  </div>;
}

export function TerminalStatusBar({ state, feedback }: { state: TerminalViewState | null; feedback: TerminalFeedback | null }) {
  const { t } = useTranslation();
  const status = state ? t(`workspace.terminal.status.${state.status}`) : t("workspace.terminal.idle");
  const detail = feedback ? t(`workspace.terminal.${feedback}`) : state?.diagnostic;
  return <footer className="terminal-statusbar" data-status={state?.status ?? "idle"}>
    <span className="terminal-connection" role="status"><i aria-hidden="true" />{status}</span>
    <span className="terminal-status-detail" role="status" data-tooltip={detail ?? undefined}>{detail}</span>
    {state?.cols && state.rows ? <span className="terminal-dimensions" aria-label={t("workspace.terminal.dimensions", { cols: state.cols, rows: state.rows })}>{state.cols} × {state.rows}</span> : null}
    <span className="terminal-encoding">UTF-8</span>
  </footer>;
}
