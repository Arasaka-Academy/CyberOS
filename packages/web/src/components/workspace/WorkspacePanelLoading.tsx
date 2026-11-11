import { Button, Input, InputGroup } from "@cyberos/ui";
import { Clock3, Database, LoaderCircle, Search, SlidersHorizontal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { APP_REGISTRY } from "../../mobile/apps.js";
import { useMobileNavigation } from "../../mobile/MobileNavigation.js";
import { MusicLibrarySkeleton, type MusicDetail, type MusicLibraryView } from "../music/MusicLibrarySkeleton.js";
import type { WorkspacePanelId } from "../../lib/workspace-panel-settings.js";
import { managementDashboardWidgetDefinitions, type ManagementDashboardId } from "../../lib/management-dashboard-layout.js";
import { ManagementDashboardGrid, useManagementDashboard } from "./ManagementDashboard.js";
import { PanelContentSkeleton } from "./ManagementSkeleton.js";
import { PanelHeader, PanelHeaderAction, PanelHeaderActions } from "./PanelHeader.js";
import { DownloadsInitialSkeleton, IscsiInitialSkeleton, PhotoQuerySkeleton, PhotoTimelineSkeleton, TerminalContentSkeleton, TerminalTabsSkeleton } from "./PanelLoadingSkeletons.js";
import { TerminalStatusBar, TerminalToolbar } from "./terminal/TerminalControls.js";
import "../nvr/nvr.css";

const PANEL_LOADING_COPY = {
  files: ["workspace.files", "workspace.filesManagementDescription"],
  photos: ["workspace.photos.title", "workspace.photos.description"],
  video: ["video.title", "video.subtitle"],
  music: ["workspace.panels.music", "music.subtitle"],
  terminal: ["workspace.terminal.title", "workspace.terminal.description"],
  downloads: ["workspace.downloads.title", "workspace.downloads.description"],
  monitoring: ["workspace.monitoring.title", "workspace.monitoring.description"],
  nvr: ["nvr.title", "nvr.subtitle"],
  docker: ["workspace.management.docker.title", "workspace.management.docker.description"],
  virtualMachines: ["workspace.management.virtualMachines.title", "workspace.management.virtualMachines.description"],
  network: ["workspace.management.network.title", "workspace.management.network.description"],
  storage: ["workspace.management.storage.title", "workspace.management.storage.description"],
  shares: ["workspace.management.shares.title", "workspace.management.shares.description"]
} as const satisfies Record<WorkspacePanelId, readonly [string, string]>;

export function WorkspacePanelLoading({ panel }: { panel: WorkspacePanelId }) {
  const { t } = useTranslation();
  const views = useMobileNavigation()?.views;
  const musicView = views?.get<MusicLibraryView>("music.view", "home") ?? "home";
  const musicDetail = views?.get<MusicDetail | null>("music.detail", null) ?? null;
  const definition = APP_REGISTRY.find((item) => item.id === panel)!;
  const Icon = panel === "storage" ? Database : definition.Icon;
  const [titleKey, subtitleKey] = PANEL_LOADING_COPY[panel];
  const header = <PanelHeader
    className={panel === "photos" ? "photo-library-header" : panel === "downloads" ? "downloads-header" : panel === "terminal" ? "workspace-terminal-overview" : ""}
    icon={<Icon size={20} aria-hidden="true" />}
    title={panel === "music" ? "Music" : t(titleKey)}
    subtitle={t(subtitleKey)}
    actions={<PanelHeaderActions label={t("workspace.management.actions.label")}>
      <PanelHeaderAction type="button" label={t("status.loading")} disabled aria-busy="true" mobilePrimary>
        <LoaderCircle className="is-spinning" size={17} aria-hidden="true" />
      </PanelHeaderAction>
    </PanelHeaderActions>}
  />;
  const loadingStatus = <span className="visually-hidden" role="status">{t("common.states.loading")}</span>;

  switch (panel) {
    case "photos":
      return <section className="workspace-panel-loading photo-library" data-panel-loading={panel} aria-busy="true">
        {header}{loadingStatus}
        <PhotoQuerySkeleton />
        <div className="photo-library-content"><PhotoTimelineSkeleton /></div>
      </section>;
    case "downloads":
      return <section className="workspace-panel-loading workspace-management http-downloader-panel" data-panel-loading={panel} aria-busy="true">
        {header}<DownloadsInitialSkeleton />
      </section>;
    case "terminal":
      return <section className="workspace-panel-loading workspace-terminal-panel" data-panel-loading={panel} aria-busy="true">
        {header}
        <div className="workspace-terminal-frame">
          <div className="workspace-terminal-header">
            <TerminalTabsSkeleton />
            <TerminalToolbar disabled connected={false} hasSelection={false} searchOpen={false} fullscreen={false} fullscreenSupported={false}
              onSearch={() => {}} onCopy={() => {}} onPaste={() => {}} onFullscreen={() => {}} />
          </div>
          <div className="workspace-terminal-stage">{loadingStatus}<TerminalContentSkeleton /></div>
          <TerminalStatusBar state={null} feedback={null} />
        </div>
      </section>;
    case "music":
      return <section className="workspace-panel-loading music-panel" data-panel-loading={panel} aria-busy="true">
        {header}{loadingStatus}
        <LibraryLoadingControls panel="music" active={musicDetail ? null : musicView} query={views?.get("music.query", "") ?? ""} />
        <div className="music-content"><MusicLibrarySkeleton view={musicView} detail={musicDetail} /></div>
      </section>;
    case "video":
      return <section className={`workspace-panel-loading ${panel}-panel`} data-panel-loading={panel} aria-busy="true">
        {header}
        <LibraryLoadingControls panel={panel} />
        <div className={`${panel}-content`}><PanelContentSkeleton /></div>
      </section>;
    case "nvr":
      return <section className="workspace-panel-loading nvr-panel" data-panel-loading={panel} aria-busy="true">
        <div className="nvr-panel-content">
          {header}
          <div className="view-tabs nvr-tabs" role="tablist" aria-label={t("nvr.title")}>
            {(["live", "playback", "events", "devices"] as const).map((tab) => <Button key={tab} variant="ghost" role="tab" aria-selected={tab === "live"} disabled>{t(`nvr.${tab}`)}</Button>)}
          </div>
          <div className="nvr-scroll"><PanelContentSkeleton /></div>
        </div>
      </section>;
    case "monitoring":
      return <section className="workspace-panel-loading workspace-management monitoring-panel" data-panel-loading={panel} aria-busy="true">
        {header}
        <nav className="view-tabs monitoring-view-tabs" role="tablist" aria-label={t("workspace.monitoring.tabs.label")}>
          {(["overview", "rules", "incidents"] as const).map((tab) => <Button key={tab} variant="ghost" type="button" role="tab" aria-selected={tab === "overview"} disabled>{t(`workspace.monitoring.tabs.${tab}`)}</Button>)}
        </nav>
        <div className="monitoring-overview-stage">
          <div className="monitoring-toolbar" role="toolbar" aria-label={t("workspace.monitoring.range.label")}>
            <div className="monitoring-toolbar-context"><div className="monitoring-toolbar-selection">
              <Clock3 aria-hidden="true" size={15} /><span>{t("workspace.monitoring.range.label")}</span><strong>{t("workspace.monitoring.range.1h")}</strong>
            </div></div>
            <div className="monitoring-range-wrap"><div className="monitoring-range" role="group" aria-label={t("workspace.monitoring.range.label")}>
              {(["1h", "6h", "24h", "7d", "30d", "1y"] as const).map((range) => <Button key={range} variant="ghost" type="button" className={range === "1h" ? "is-active" : undefined} aria-pressed={range === "1h"} disabled>{t(`workspace.monitoring.range.${range}`)}</Button>)}
            </div></div>
          </div>
          <div className="management-body monitoring-body"><DashboardLoading panel={panel} /></div>
        </div>
      </section>;
    case "docker":
    case "virtualMachines":
    case "network":
    case "storage":
    case "shares":
      return <section className={`workspace-panel-loading workspace-management${panel === "shares" ? " workspace-share-management" : ""}`} data-panel-loading={panel} aria-busy="true">
        {header}
        <div className={`management-body${panel === "shares" ? " share-management-body" : ""}`}><DashboardLoading panel={panel} /></div>
      </section>;
    case "files":
      // Files are eager; retain a complete shell if another child suspends.
      return <section className="workspace-panel-loading workspace-management" data-panel-loading={panel} aria-busy="true">
        {header}<PanelContentSkeleton />
      </section>;
  }
}

function DashboardLoading({ panel }: { panel: ManagementDashboardId }) {
  const { t } = useTranslation();
  const dashboard = useManagementDashboard(panel);
  const items = managementDashboardWidgetDefinitions(panel)
    // The legacy VM resources entry is retained in saved layouts but has no card.
    .filter(({ id }) => panel !== "virtualMachines" || id !== "resources")
    .map(({ id }) => ({
      id,
      title: t("common.states.loading"),
      ...(panel === "storage" && id === "iscsi" ? { loading: false, content: <IscsiInitialSkeleton /> } : { content: null })
    }));
  return <ManagementDashboardGrid dashboard={dashboard} items={items} loading />;
}

function LibraryLoadingControls({ panel, active = "home", query = "" }: { panel: "music" | "video"; active?: string | null; query?: string }) {
  const { t } = useTranslation();
  const tabs = panel === "music"
    ? (["home", "albums", "artists", "tracks", "playlists"] as const).map((tab) => ({ id: tab, label: t(`music.views.${tab}`) }))
    : (["home", "movie", "series", "collections", "watchlist"] as const).map((tab) => ({ id: tab, label: t(`video.${tab}`) }));
  const searchLabel = t(panel === "music" ? "music.searchPlaceholder" : "video.search");
  return <>
    <div className="library-search-toolbar">
      <form className="search"><InputGroup leading={<Search size={17} aria-hidden="true" />}>
        <Input type="search" disabled value={query} placeholder={searchLabel} aria-label={searchLabel} />
      </InputGroup></form>
      <div className="workspace-search-filter"><Button iconOnly variant="ghost" type="button" className="workspace-search-filter-trigger" disabled aria-label={t(panel === "music" ? "music.filters" : "video.filter")}><SlidersHorizontal aria-hidden="true" size={16} /></Button></div>
    </div>
    <nav className={`${panel === "music" ? "music-tabs" : "video-navigation"} view-tabs`} aria-label={t(panel === "music" ? "music.navigation" : "video.library")}>
      {tabs.map(({ id, label }) => <Button key={id} variant="ghost" type="button" disabled className={`plain-button${panel === "music" && id === active ? " is-active" : ""}`} aria-current={id === active ? "page" : undefined} aria-pressed={panel === "video" ? id === active : undefined}>{label}</Button>)}
    </nav>
  </>;
}
