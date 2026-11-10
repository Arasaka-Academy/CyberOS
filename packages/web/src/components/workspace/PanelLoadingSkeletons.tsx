import { Button, EmptyState, SectionHeader } from "@cyberos/ui";
import { LoaderCircle, Plus, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SkeletonBlock } from "./ManagementSkeleton.js";

// Keep module and data loading on the same presentation without importing panels.
export function PhotoQuerySkeleton() {
  return (
    <div className="photo-query-panel photo-query-panel-skeleton" aria-hidden="true">
      <div className="photo-query-toolbar photo-query-toolbar-skeleton">
        <SkeletonBlock className="photo-skeleton-search" />
        <SkeletonBlock className="photo-skeleton-view" />
        <SkeletonBlock className="photo-skeleton-sort" />
        <SkeletonBlock className="photo-skeleton-advanced" />
      </div>
      <div className="photo-query-summary photo-query-summary-skeleton">
        <SkeletonBlock width="72px" />
      </div>
    </div>
  );
}

export function PhotoTimelineSkeleton() {
  return (
    <div className="photo-timeline photo-timeline-skeleton" aria-hidden="true">
      {Array.from({ length: 2 }, (_, groupIndex) => (
        <section className="photo-day" key={groupIndex}>
          <header>
            <SkeletonBlock width={groupIndex === 0 ? "128px" : "104px"} />
            <SkeletonBlock width="24px" />
          </header>
          <div className="photo-wall photo-skeleton-wall">
            {Array.from({ length: groupIndex === 0 ? 10 : 6 }, (_, tileIndex) => (
              <SkeletonBlock className="photo-skeleton-tile" key={tileIndex} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

export function DownloadsInitialSkeleton() {
  const { t } = useTranslation();
  return (
    <>
      <span className="visually-hidden" role="status">{t("common.states.loading")}</span>
      <div className="downloads-toolbar downloads-toolbar-skeleton" aria-hidden="true">
        <div className="downloads-filters downloads-filters-skeleton">
          {[52, 58, 76, 54].map((width) => <SkeletonBlock key={width} width={`${width}px`} />)}
        </div>
        <div className="downloads-summary downloads-summary-skeleton">
          {Array.from({ length: 4 }, (_, index) => (
            <div className="download-header-stat" key={index}>
              <SkeletonBlock width={index === 2 ? "56px" : "32px"} />
              <SkeletonBlock width={index === 3 ? "48px" : "38px"} />
            </div>
          ))}
        </div>
      </div>
      <div className="downloads-list downloads-list-skeleton" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => (
          <article className="download-task-row download-task-row-skeleton" key={index}>
            <div className="download-task-main">
              <div className="download-task-heading">
                <SkeletonBlock className="download-skeleton-icon" />
                <div>
                  <SkeletonBlock width={index % 2 ? "58%" : "72%"} />
                  <SkeletonBlock width={index % 2 ? "34%" : "42%"} />
                </div>
                <SkeletonBlock className="download-skeleton-status" />
              </div>
              <SkeletonBlock width={index % 2 ? "68%" : "82%"} />
              <SkeletonBlock className="download-skeleton-progress" />
              <div className="download-skeleton-meta">
                <SkeletonBlock width="76px" />
                <SkeletonBlock width="48px" />
                <SkeletonBlock width="58px" />
              </div>
            </div>
            <div className="download-task-actions">
              {Array.from({ length: 3 }, (_, actionIndex) => (
                <SkeletonBlock className="download-skeleton-action" key={actionIndex} />
              ))}
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

export function TerminalTabsSkeleton() {
  return (
    <div className="workspace-terminal-tabs-skeleton" aria-hidden="true">
      <SkeletonBlock className="workspace-terminal-tab-skeleton" />
      <SkeletonBlock className="workspace-terminal-tab-skeleton is-short" />
      <SkeletonBlock className="workspace-terminal-new-tab-skeleton" />
    </div>
  );
}

export function TerminalContentSkeleton() {
  return (
    <div className="workspace-terminal-skeleton" aria-hidden="true">
      <SkeletonBlock width="38%" />
      <SkeletonBlock width="64%" />
      <SkeletonBlock width="52%" />
    </div>
  );
}

export function IscsiInitialSkeleton() {
  const { t } = useTranslation();
  return <section className="management-section iscsi-card" aria-label={t("workspace.management.storage.iscsi.title")} aria-busy="true">
    <SectionHeader className="management-section-header"
      title={t("workspace.management.storage.iscsi.title")}
      description={t("workspace.management.storage.iscsi.description")}
      icon={<Server aria-hidden="true" size={16} />}
      actions={<div className="iscsi-actions">
        <Button variant="ghost" iconOnly type="button" className="icon-button" aria-label={t("workspace.management.storage.iscsi.refresh")} data-tooltip={t("workspace.management.storage.iscsi.refresh")} disabled aria-busy="true"><LoaderCircle className="is-spinning" size={16} aria-hidden="true" /></Button>
        <Button variant="primary" type="button" className="primary-button" disabled><Plus size={15} aria-hidden="true" />{t("workspace.management.storage.iscsi.createTarget")}</Button>
      </div>}
    />
    <div className="iscsi-card-body"><EmptyState className="management-empty" role="status">{t("workspace.management.storage.iscsi.loading")}</EmptyState></div>
  </section>;
}
