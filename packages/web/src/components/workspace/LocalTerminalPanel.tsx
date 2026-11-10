import { Button as UiButton, DialogActions, DialogHeader, Field, Input } from "@cyberos/ui";
import { ModalPortal } from "../common/ModalPortal.js";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { useTranslation } from "react-i18next";
import { LoaderCircle, Pencil, Plus, RefreshCw, TerminalSquare, X } from "lucide-react";
import {
  activateTerminalTab,
  createTerminalTab,
  deleteTerminalTab,
  getTerminalTabs,
  initializeTerminalTabs,
  renameTerminalTab,
  restartTerminalTab,
  type TerminalTab,
  type TerminalTabState
} from "../../api.js";
import {
  shouldInitializeTerminalTabs,
  terminalTabLabel,
  terminalTabNavigationTarget,
  type TerminalTabNavigationKey
} from "../../lib/terminal-tabs.js";
import type { TerminalViewState } from "../../lib/terminal-workbench.js";
import { TerminalSessionView } from "./terminal/TerminalSessionView.js";
import { TerminalToolbar, TerminalSearchBar, TerminalStatusBar } from "./terminal/TerminalControls.js";
import { TerminalClipboardDialog } from "./terminal/TerminalClipboardDialog.js";
import { useTerminalWorkbench } from "./terminal/useTerminalWorkbench.js";
export { terminalReconnectDelay } from "../../lib/terminal-workbench.js";
import { TerminalContentSkeleton, TerminalTabsSkeleton } from "./PanelLoadingSkeletons.js";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "./PanelHeader.js";

export function LocalTerminalPanel({
  active
}: {
  active: boolean;
}) {
  const { t } = useTranslation();
  const requestVersionRef = useRef(0);
  const actionVersionRef = useRef(0);
  const [tabState, setTabState] = useState<TerminalTabState | null>(null);
  const [loading, setLoading] = useState(false);
  const [settled, setSettled] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [visitedTabIds, setVisitedTabIds] = useState<Set<string>>(() => new Set());
  const [viewStates, setViewStates] = useState<Record<string, TerminalViewState>>({});
  const [connectionVersions, setConnectionVersions] = useState<Record<string, number>>({});
  const [renameCandidate, setRenameCandidate] = useState<TerminalTab | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [closeCandidate, setCloseCandidate] = useState<TerminalTab | null>(null);

  const applyState = useCallback((nextState: TerminalTabState) => {
    setTabState(nextState);
    if (nextState.activeTabId) {
      setVisitedTabIds((current) => addToSet(current, nextState.activeTabId!));
    }
  }, []);

  const refreshTabs = useCallback(async (showLoading: boolean) => {
    const requestVersion = ++requestVersionRef.current;
    if (showLoading) {
      setLoading(true);
    }
    try {
      let nextState = await getTerminalTabs();
      if (shouldInitializeTerminalTabs(nextState)) {
        nextState = await initializeTerminalTabs();
      }
      if (requestVersion === requestVersionRef.current) {
        applyState(nextState);
        setLoadError(null);
        setSettled(true);
      }
    } catch (error) {
      if (requestVersion === requestVersionRef.current) {
        setLoadError(errorMessage(error));
        setSettled(true);
      }
    } finally {
      if (requestVersion === requestVersionRef.current) {
        setLoading(false);
      }
    }
  }, [applyState]);

  useEffect(() => {
    requestVersionRef.current += 1;
    actionVersionRef.current += 1;
    setTabState(null);
    setLoading(false);
    setSettled(false);
    setLoadError(null);
    setActionError(null);
    setPendingAction(null);
    setVisitedTabIds(new Set());
    setViewStates({});
    setConnectionVersions({});
    setRenameCandidate(null);
    setCloseCandidate(null);
  }, []);

  useEffect(() => {
    if (active) {
      void refreshTabs(true);
    }
  }, [active, refreshTabs]);

  useEffect(() => {
    const handleFocus = () => {
      if (active) {
        void refreshTabs(false);
      }
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [active, refreshTabs]);

  const updateViewState = useCallback((tabId: string, nextState: TerminalViewState) => {
    setViewStates((current) => {
      const previous = current[tabId];
      if (previous?.status === nextState.status && previous.diagnostic === nextState.diagnostic
        && previous.cols === nextState.cols && previous.rows === nextState.rows
        && previous.hasSelection === nextState.hasSelection && previous.connectionId === nextState.connectionId) {
        return current;
      }
      return { ...current, [tabId]: nextState };
    });
  }, []);

  async function selectTab(tabId: string) {
    if (!tabState || tabState.activeTabId === tabId || pendingAction) {
      return;
    }
    const previousState = tabState;
    const actionVersion = ++actionVersionRef.current;
    applyState({ ...tabState, activeTabId: tabId });
    setActionError(null);
    setPendingAction(`activate:${tabId}`);
    try {
      const nextState = await activateTerminalTab(tabId);
      if (actionVersion === actionVersionRef.current) {
        requestVersionRef.current += 1;
        applyState(nextState);
      }
    } catch (error) {
      if (actionVersion === actionVersionRef.current) {
        setTabState(previousState);
        setActionError(errorMessage(error));
      }
    } finally {
      if (actionVersion === actionVersionRef.current) {
        setPendingAction(null);
      }
    }
  }

  async function createTab() {
    if (pendingAction) {
      return;
    }
    setActionError(null);
    const actionVersion = ++actionVersionRef.current;
    setPendingAction("create");
    try {
      const nextState = await createTerminalTab();
      if (actionVersion === actionVersionRef.current) {
        requestVersionRef.current += 1;
        applyState(nextState);
      }
    } catch (error) {
      if (actionVersion === actionVersionRef.current) {
        setActionError(
          errorMessage(error) === "Terminal session limit reached"
            ? String(t("workspace.terminal.limitReached", { count: tabState?.maxSessions ?? 32 }))
            : errorMessage(error)
        );
      }
    } finally {
      if (actionVersion === actionVersionRef.current) {
        setPendingAction(null);
      }
    }
  }

  function openRenameDialog(tab: TerminalTab) {
    setRenameCandidate(tab);
    setRenameValue(tab.customTitle ?? "");
    setActionError(null);
  }

  async function submitRename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!renameCandidate || pendingAction) {
      return;
    }
    const customTitle = renameValue.trim() || null;
    const actionVersion = ++actionVersionRef.current;
    setActionError(null);
    setPendingAction("rename");
    try {
      const nextState = await renameTerminalTab(renameCandidate.id, customTitle);
      if (actionVersion === actionVersionRef.current) {
        requestVersionRef.current += 1;
        applyState(nextState);
        setRenameCandidate(null);
      }
    } catch (error) {
      if (actionVersion === actionVersionRef.current) {
        setActionError(errorMessage(error));
      }
    } finally {
      if (actionVersion === actionVersionRef.current) {
        setPendingAction(null);
      }
    }
  }

  async function restartTab(tabId: string) {
    if (pendingAction) {
      return;
    }
    const actionVersion = ++actionVersionRef.current;
    setActionError(null);
    setPendingAction("restart");
    try {
      const nextState = await restartTerminalTab(tabId);
      if (actionVersion === actionVersionRef.current) {
        requestVersionRef.current += 1;
        applyState(nextState);
        setConnectionVersions((current) => ({ ...current, [tabId]: (current[tabId] ?? 0) + 1 }));
        updateViewState(tabId, { status: "connecting", diagnostic: null });
      }
    } catch (error) {
      if (actionVersion === actionVersionRef.current) {
        setActionError(errorMessage(error));
      }
    } finally {
      if (actionVersion === actionVersionRef.current) {
        setPendingAction(null);
      }
    }
  }

  async function closeTab() {
    if (!closeCandidate || pendingAction) {
      return;
    }
    const tabId = closeCandidate.id;
    const actionVersion = ++actionVersionRef.current;
    setActionError(null);
    setPendingAction("close");
    try {
      const nextState = await deleteTerminalTab(tabId);
      if (actionVersion === actionVersionRef.current) {
        requestVersionRef.current += 1;
        applyState(nextState);
        setVisitedTabIds((current) => removeFromSet(current, tabId));
        setViewStates((current) => omitKey(current, tabId));
        setConnectionVersions((current) => omitKey(current, tabId));
        setCloseCandidate(null);
      }
    } catch (error) {
      if (actionVersion === actionVersionRef.current) {
        setActionError(errorMessage(error));
      }
    } finally {
      if (actionVersion === actionVersionRef.current) {
        setPendingAction(null);
      }
    }
  }

  function reconnect(tabId: string) {
    setConnectionVersions((current) => ({ ...current, [tabId]: (current[tabId] ?? 0) + 1 }));
    updateViewState(tabId, { status: "connecting", diagnostic: null });
  }

  const initialLoading = !settled;
  const tabs = initialLoading ? [] : tabState?.tabs ?? [];
  const activeTab = tabs.find((tab) => tab.id === tabState?.activeTabId) ?? null;
  const activeViewState = activeTab
    ? viewStates[activeTab.id] ?? { status: "connecting" as const, diagnostic: null }
    : null;
  const atLocalLimit = Boolean(tabState && tabs.length >= tabState.maxSessions);
  const visibleTabs = tabs.filter((tab) => visitedTabIds.has(tab.id));
  const currentLoadError = loadError;
  const workbench = useTerminalWorkbench({ active, tabId: activeTab?.id ?? null, busy: Boolean(pendingAction), viewState: activeViewState });

  return (
    <section
      ref={workbench.panelRef}
      className="workspace-terminal-panel"
      hidden={!active}
      aria-hidden={!active}
      aria-label={t("workspace.terminal.title")}
      aria-busy={initialLoading || loading || undefined}
    >
      <PanelHeader
        className="workspace-terminal-overview"
        icon={<TerminalSquare aria-hidden="true" size={20} />}
        title={t("workspace.terminal.title")}
        subtitle={t("workspace.terminal.description")}
        actions={<PanelHeaderActions label={t("workspace.terminal.actionsLabel")} className="workspace-terminal-actions">
          <PanelHeaderAction
            label={t("workspace.terminal.rename")}
            type="button"
            onClick={() => activeTab && openRenameDialog(activeTab)}
            disabled={initialLoading || !activeTab || Boolean(pendingAction)}
          >
            <Pencil aria-hidden="true" size={16} />
          </PanelHeaderAction>
          <PanelHeaderAction
            label={t("workspace.terminal.restart")}
            type="button"
            onClick={() => activeTab && void restartTab(activeTab.id)}
            disabled={initialLoading || !activeTab || Boolean(pendingAction)}
          >
            <RefreshCw aria-hidden="true" size={16} />
          </PanelHeaderAction>
          <PanelHeaderAction
            label={t("workspace.terminal.close")}
            type="button"
            className="is-danger"
            onClick={() => {
              setActionError(null);
              if (activeTab) setCloseCandidate(activeTab);
            }}
            disabled={initialLoading || !activeTab || Boolean(pendingAction)}
          >
            <X aria-hidden="true" size={17} />
          </PanelHeaderAction>
        </PanelHeaderActions>}
      />

      <div className={`workspace-terminal-frame${workbench.searchOpen ? " has-search" : ""}`}>
        <div className="workspace-terminal-header">
          {initialLoading ? (
            <TerminalTabsSkeleton />
          ) : tabState ? (
            <TerminalTabBar
              tabs={tabs}
              activeTabId={tabState.activeTabId}
              maxSessions={tabState.maxSessions}
              createDisabled={Boolean(pendingAction) || atLocalLimit}
              onSelect={(tabId) => void selectTab(tabId)}
              onCreate={() => void createTab()}
              onRename={openRenameDialog}
            />
          ) : (
            <div className="workspace-terminal-tabs-placeholder" aria-hidden="true" />
          )}
          <TerminalToolbar
            disabled={initialLoading || !activeTab || Boolean(pendingAction)}
            connected={activeViewState?.status === "connected"}
            hasSelection={Boolean(activeViewState?.hasSelection)}
            searchOpen={workbench.searchOpen}
            fullscreen={workbench.fullscreen}
            fullscreenSupported={workbench.fullscreenSupported}
            onSearch={workbench.searchOpen ? workbench.closeSearch : workbench.openSearch}
            onCopy={() => void workbench.copy()}
            onPaste={() => void workbench.pasteFromClipboard()}
            onFullscreen={() => void workbench.toggleFullscreen()}
          />
        </div>
        {workbench.searchOpen ? <TerminalSearchBar query={workbench.query} found={workbench.found} onSearch={workbench.search} onClose={workbench.closeSearch} /> : null}

        <div className="workspace-terminal-stage">
          {initialLoading ? <span className="visually-hidden" role="status">{t("common.states.loading")}</span> : null}
          {initialLoading ? (
            <TerminalContentSkeleton />
          ) : currentLoadError && !tabState ? (
            <TerminalEmptyState
              title={t("workspace.terminal.loadFailed")}
              detail={currentLoadError}
              actionLabel={t("workspace.terminal.retry")}
              onAction={() => void refreshTabs(true)}
            />
          ) : tabState && tabs.length === 0 ? (
            <TerminalEmptyState
              title={t("workspace.terminal.emptyTitle")}
              detail={t("workspace.terminal.emptyBody")}
              actionLabel={t("workspace.terminal.newTab")}
              onAction={() => void createTab()}
              disabled={Boolean(pendingAction)}
            />
          ) : null}

          {visibleTabs.map((tab) => (
            <TerminalSessionView
              key={tab.id}
              tabId={tab.id}
              inputEnabled={!pendingAction}
              label={terminalTabLabel(tab, t)}
              active={active && tab.id === tabState?.activeTabId}
              connectionVersion={connectionVersions[tab.id] ?? 0}
              connectionError={String(t("workspace.terminal.connectionError"))}
              disconnectedError={String(t("workspace.terminal.disconnectedError"))}
              onStateChange={updateViewState}
              onController={workbench.onController}
              onPaste={workbench.onPaste}
              onShortcut={workbench.onShortcut}
              onInputError={workbench.onInputError}
            />
          ))}

          {activeTab && activeViewState?.status === "takenOver" ? (
            <div className="workspace-terminal-notice" role="status">
              <strong>{t("workspace.terminal.takenOverTitle")}</strong>
              <span>{t("workspace.terminal.takenOverBody")}</span>
              <UiButton variant="secondary" type="button" className="secondary-button" onClick={() => reconnect(activeTab.id)}>
                <RefreshCw aria-hidden="true" size={14} />
                <span>{t("workspace.terminal.takeOver")}</span>
              </UiButton>
            </div>
          ) : activeTab && activeViewState?.status === "exited" ? (
            <div className="workspace-terminal-notice" role="status">
              <strong>{t("workspace.terminal.exitedTitle")}</strong>
              <span>{t("workspace.terminal.exitedBody")}</span>
              <UiButton variant="secondary" type="button" className="secondary-button" onClick={() => void restartTab(activeTab.id)} disabled={Boolean(pendingAction)}>
                <RefreshCw aria-hidden="true" size={14} />
                <span>{t("workspace.terminal.restart")}</span>
              </UiButton>
            </div>
          ) : null}

          {actionError ? (
            <div className="workspace-terminal-error" role="alert">
              <span>{actionError}</span>
              <UiButton iconOnly variant="ghost" type="button" onClick={() => setActionError(null)} aria-label={t("common.actions.close")} data-tooltip={t("common.actions.close")}>
                <X aria-hidden="true" size={14} />
              </UiButton>
            </div>
          ) : null}
        </div>
        <TerminalStatusBar state={activeViewState} feedback={workbench.feedback} />
      </div>
      {workbench.clipboard ? <TerminalClipboardDialog key={workbench.clipboard.kind} state={workbench.clipboard} onClose={workbench.closeClipboard} onSubmit={workbench.submitClipboard} /> : null}

      {renameCandidate ? (
        <ModalPortal className="file-action-backdrop" role="presentation" onRequestClose={() => setRenameCandidate(null)} closeDisabled={Boolean(pendingAction)} onMouseDown={(event) => event.currentTarget === event.target && setRenameCandidate(null)}>
          <form className="file-action-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-rename-title" onSubmit={(event) => void submitRename(event)}>
            <DialogHeader title={terminalTabLabel(renameCandidate, t)} eyebrow={<>{t("workspace.terminal.rename")}</>} headingId="terminal-rename-title" />
            <Field className="file-action-field" label={t("workspace.terminal.tabName")}>

              <Input
                autoFocus
                value={renameValue}
                maxLength={64}
                onChange={(event) => setRenameValue(event.target.value)}
                aria-describedby="terminal-rename-hint"
              />
            </Field>
            <p id="terminal-rename-hint" className="file-action-hint">{t("workspace.terminal.renameHint")}</p>
            {actionError ? <p className="file-action-error" role="alert">{actionError}</p> : null}
            <DialogActions>
              <UiButton variant="secondary" type="button" className="secondary-button" onClick={() => setRenameCandidate(null)} disabled={Boolean(pendingAction)}>{t("common.actions.cancel")}</UiButton>
              <UiButton variant="primary" type="submit" className="primary-button" disabled={Boolean(pendingAction)} aria-busy={pendingAction === "rename" || undefined}>
                {pendingAction === "rename" ? t("common.actions.saving") : t("workspace.terminal.saveName")}
              </UiButton>
            </DialogActions>
          </form>
        </ModalPortal>
      ) : null}

      {closeCandidate ? (
        <ModalPortal className="file-action-backdrop" role="presentation" onRequestClose={() => setCloseCandidate(null)} closeDisabled={Boolean(pendingAction)}>
          <section className="file-action-dialog" role="dialog" aria-modal="true" aria-labelledby="terminal-close-title">
            <DialogHeader title={terminalTabLabel(closeCandidate, t)} eyebrow={<>{t("workspace.terminal.close")}</>} headingId="terminal-close-title" />
            <p className="file-action-copy">{t("workspace.terminal.closeConfirm")}</p>
            {actionError ? <p className="file-action-error" role="alert">{actionError}</p> : null}
            <DialogActions>
              <UiButton variant="secondary" type="button" className="secondary-button" onClick={() => setCloseCandidate(null)} disabled={Boolean(pendingAction)}>{t("common.actions.cancel")}</UiButton>
              <UiButton variant="danger" type="button" className="danger-button" onClick={() => void closeTab()} disabled={Boolean(pendingAction)} aria-busy={pendingAction === "close" || undefined}>
                {pendingAction === "close" ? t("workspace.terminal.closing") : t("workspace.terminal.closeAndStop")}
              </UiButton>
            </DialogActions>
          </section>
        </ModalPortal>
      ) : null}
    </section>
  );
}

export function TerminalTabBar({
  tabs,
  activeTabId,
  maxSessions,
  createDisabled,
  onSelect,
  onCreate,
  onRename
}: {
  tabs: TerminalTab[];
  activeTabId: string | null;
  maxSessions: number;
  createDisabled: boolean;
  onSelect: (tabId: string) => void;
  onCreate: () => void;
  onRename?: (tab: TerminalTab) => void;
}) {
  const { t } = useTranslation();
  const tabRefs = useRef(new Map<string, HTMLButtonElement>());

  useEffect(() => {
    if (activeTabId) {
      tabRefs.current.get(activeTabId)?.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [activeTabId, tabs]);

  function handleKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>, tabId: string) {
    if (!isTerminalNavigationKey(event.key)) {
      return;
    }
    event.preventDefault();
    const targetId = terminalTabNavigationTarget(tabs, tabId, event.key);
    if (!targetId) {
      return;
    }
    onSelect(targetId);
    window.setTimeout(() => tabRefs.current.get(targetId)?.focus(), 0);
  }

  return (
    <div className="workspace-terminal-tabbar">
      <div className="workspace-terminal-tabs" role="tablist" aria-label={t("workspace.terminal.tabsLabel")}>
        {tabs.map((tab) => {
          const selected = tab.id === activeTabId;
          return (
            <UiButton variant="ghost"
              key={tab.id}
              ref={(element) => {
                if (element) tabRefs.current.set(tab.id, element);
                else tabRefs.current.delete(tab.id);
              }}
              type="button"
              role="tab"
              className={`workspace-terminal-tab${selected ? " is-active" : ""}`}
              aria-selected={selected}
              aria-controls={`terminal-panel-${tab.id}`}
              tabIndex={selected ? 0 : -1}
              data-tooltip={terminalTabLabel(tab, t)}
              onClick={() => onSelect(tab.id)}
              onDoubleClick={() => onRename?.(tab)}
              onKeyDown={(event) => handleKeyDown(event, tab.id)}
            >
              <TerminalSquare aria-hidden="true" size={14} />
              <span>{terminalTabLabel(tab, t)}</span>
            </UiButton>
          );
        })}
      </div>
      <UiButton iconOnly variant="ghost"
        type="button"
        className="workspace-terminal-new-tab"
        onClick={onCreate}
        disabled={createDisabled}
        data-tooltip={createDisabled && tabs.length >= maxSessions ? t("workspace.terminal.limitReached", { count: maxSessions }) : t("workspace.terminal.newTab")}
        aria-label={t("workspace.terminal.newTab")}
      >
        <Plus aria-hidden="true" size={15} />
      </UiButton>
    </div>
  );
}

export function terminalInitialLoadPending(terminalScope: string | undefined, settledScope: string | null): boolean {
  return Boolean(terminalScope && terminalScope !== settledScope);
}

function TerminalEmptyState({
  title,
  detail,
  actionLabel,
  onAction,
  disabled = false
}: {
  title: string;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  disabled?: boolean;
}) {
  return (
    <div className="workspace-terminal-empty">
      <TerminalSquare aria-hidden="true" size={24} />
      <strong>{title}</strong>
      {detail ? <span>{detail}</span> : null}
      {actionLabel && onAction ? (
        <UiButton variant="secondary" type="button" className="secondary-button" onClick={onAction} disabled={disabled} aria-busy={disabled || undefined}>
          {disabled ? <LoaderCircle className="is-spinning" aria-hidden="true" size={14} /> : <Plus aria-hidden="true" size={14} />}
          <span>{actionLabel}</span>
        </UiButton>
      ) : null}
    </div>
  );
}

function isTerminalNavigationKey(key: string): key is TerminalTabNavigationKey {
  return key === "ArrowLeft" || key === "ArrowRight" || key === "Home" || key === "End";
}

function addToSet(current: Set<string>, value: string): Set<string> {
  if (current.has(value)) {
    return current;
  }
  const next = new Set(current);
  next.add(value);
  return next;
}

function removeFromSet(current: Set<string>, value: string): Set<string> {
  const next = new Set(current);
  next.delete(value);
  return next;
}

function omitKey<T>(current: Record<string, T>, key: string): Record<string, T> {
  const { [key]: _removed, ...next } = current;
  return next;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
