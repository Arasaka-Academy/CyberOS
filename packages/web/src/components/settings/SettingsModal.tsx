import { Button as UiButton, DialogHeader, Input, InputGroup, Notice } from "@cyberos/ui";
import { Component, Suspense, lazy, useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Activity, AudioLines, Bot, Bluetooth, BellRing, Database, Download, Folder, Film, HardDrive, Image as ImageIcon, Images, KeyRound, Network, MonitorCog, UserRound, ChartNoAxesCombined, ArchiveRestore, Package, Search, Server, Share2, ShieldCheck, Settings, Wifi, X } from "lucide-react";
import { ModalPortal } from "../common/ModalPortal.js";
import { BrandLogo } from "../common/BrandLogo.js";
import { useContentReveal } from "../common/useContentReveal.js";
import { MobileAppHeader, useAppHeadingFocus } from "../../mobile/MobileAppHeader.js";
import { useMobileBack, useMobileNavigation } from "../../mobile/MobileNavigation.js";
import { SETTINGS_SECTIONS, settingsGroupLabel, settingsSectionDescription, settingsSectionTitle, type SettingsSectionId } from "../../config/settings.js";
import { PanelContentSkeleton } from "../workspace/ManagementSkeleton.js";
import { SettingsAppearancePage, SettingsFilesPage } from "./SettingsLocalPages.js";
import { settingsSectionResources } from "./settings-resources.js";
import type { SettingsModalProps } from "./SettingsTypes.js";

const SettingsContent = lazy(() => import("./SettingsContent.js").then(module => ({ default: module.SettingsContent })));

export function SettingsModal(props: SettingsModalProps) {
  const { activeSection, onClose, onSectionChange, onSectionVisible } = props;
  const { t } = useTranslation();
  const compact = useMobileNavigation()?.compact ?? false;
  const headingRef = useAppHeadingFocus();
  const [mobileDetail, setMobileDetail] = useState(activeSection !== "overview");
  useMobileBack(() => { if (!mobileDetail) return false; setMobileDetail(false); window.requestAnimationFrame(() => activeSectionButtonRef.current?.focus()); return true; }, 10);
  useEffect(() => { if (activeSection !== "overview") setMobileDetail(true); }, [activeSection]);
  useEffect(() => {
    onSectionVisible?.(!compact || mobileDetail ? activeSection : null);
    return () => onSectionVisible?.(null);
  }, [activeSection, compact, mobileDetail, onSectionVisible]);
  const [settingsSearch, setSettingsSearch] = useState("");
  const dialogRef = useRef<HTMLElement | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useContentReveal(bodyRef, { enabled: !compact || mobileDetail, transitionKey: activeSection });
  const activeSectionButtonRef = useRef<HTMLButtonElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const currentSection = SETTINGS_SECTIONS.find((section) => section.id === activeSection) ?? SETTINGS_SECTIONS[0]!;
  const normalizedSearch = settingsSearch.trim().toLowerCase();
  const visibleSections = normalizedSearch
    ? SETTINGS_SECTIONS.filter((section) =>
        [
          settingsSectionTitle(section, t),
          settingsSectionDescription(section, t),
          settingsGroupLabel(section.group, t)
        ].some((value) => value.toLowerCase().includes(normalizedSearch))
      )
    : SETTINGS_SECTIONS;
  const groups = [...new Set(visibleSections.map((section) => section.group))];

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      if (compact) headingRef.current?.focus({ preventScroll: true });
      else searchInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(frame);
      const previousFocus = previousFocusRef.current;
      if (previousFocus?.isConnected) {
        window.requestAnimationFrame(() => previousFocus.focus());
      }
    };
  }, [compact, headingRef]);

  useEffect(() => {
    const revealActiveSection = () => {
      activeSectionButtonRef.current?.scrollIntoView({ block: "nearest", inline: "start" });
    };
    const frame = window.requestAnimationFrame(revealActiveSection);
    window.addEventListener("resize", revealActiveSection);

    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("resize", revealActiveSection);
    };
  }, [activeSection, normalizedSearch]);

  function handleDialogKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (compact) return;
    const topmostDialog = [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]')]
      .filter((dialog) => dialog.isConnected && !dialog.hidden).at(-1);
    if (topmostDialog && topmostDialog !== event.currentTarget) return;
    if (event.target instanceof Node && !event.currentTarget.contains(event.target)) return;
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
      return;
    }

    if (event.key !== "Tab") {
      return;
    }

    const focusable = [...(dialogRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
    ) ?? [])].filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (!first || !last) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  const content = (
      <section
        ref={dialogRef}
        className={`settings-modal settings-center${compact ? " mobile-settings-page" : ""}`}
        data-settings-view={mobileDetail ? "detail" : "list"}
        role={compact ? undefined : "dialog"}
        aria-modal={compact ? undefined : "true"}
        aria-labelledby="settings-title"
        tabIndex={-1}
        onKeyDown={handleDialogKeyDown}
        onMouseDown={(event) => event.stopPropagation()}
      >
        {compact ? <MobileAppHeader
          className="mobile-settings-header"
          icon={mobileDetail ? settingsSectionIcon(currentSection.id) : <Settings size={20} />}
          title={mobileDetail ? settingsSectionTitle(currentSection, t) : t("common.actions.systemSettings")}
          subtitle={mobileDetail ? settingsSectionDescription(currentSection, t) : t("mobile.settingsDescription")}
          headingRef={headingRef}
          titleId="settings-title"
        /> : null}
        <aside className="settings-rail" aria-label={t("settings.sectionsLabel")}>
          <div className="settings-rail-brand">
            <BrandLogo className="settings-brand-logo" alt={t("common.appName")} />
          </div>

          <InputGroup className="settings-search" leading={<Search aria-hidden="true" size={15} />}>

            <Input
              ref={searchInputRef}
              value={settingsSearch}
              onChange={(event) => setSettingsSearch(event.target.value)}
              placeholder={t("settings.searchPlaceholder")}
              aria-label={t("settings.searchPlaceholder")}
            />
          </InputGroup>

          <nav className="settings-nav">
            {groups.map((group) => (
              <section key={group}>
                <h3>{settingsGroupLabel(group, t)}</h3>
                {visibleSections.filter((section) => section.group === group).map((section) => (
                  <UiButton variant="ghost"
                    ref={section.id === activeSection ? activeSectionButtonRef : undefined}
                    key={section.id}
                    type="button"
                    className={section.id === activeSection ? "is-active" : ""}
                    aria-current={section.id === activeSection ? "page" : undefined}
                    onClick={() => { onSectionChange(section.id); setMobileDetail(true); }}
                  >
                    {settingsSectionIcon(section.id)}
                    <strong>{settingsSectionTitle(section, t)}</strong>
                  </UiButton>
                ))}
              </section>
            ))}
            {visibleSections.length === 0 ? (
              <p className="settings-empty-search">{t("settings.searchEmpty")}</p>
            ) : null}
          </nav>

          <div className="settings-rail-footer">
            <ShieldCheck aria-hidden="true" size={15} />
            <span>{t("settings.localProfile")}</span>
          </div>
        </aside>

        {!compact || mobileDetail ? <section className="settings-content" data-settings-section={activeSection}>
          {!compact ? <DialogHeader className="settings-content-header" icon={settingsSectionIcon(currentSection.id)} title={settingsSectionTitle(currentSection, t)} description={settingsSectionDescription(currentSection, t)} headingId="settings-title" actions={<><UiButton iconOnly variant="ghost"
              type="button"
              onClick={onClose}
              data-tooltip={t("common.actions.closeSettings")}
              aria-label={t("common.actions.closeSettings")}
            >
              <X aria-hidden="true" size={18} />
            </UiButton></>} /> : null}

          <div ref={bodyRef} className="settings-detail"><SettingsBody {...props} /></div>

        </section> : null}
      </section>
  );
  return compact ? content : <ModalPortal className="settings-backdrop" role="presentation" onMouseDown={onClose} onRequestClose={onClose}>{content}</ModalPortal>;
}

function SettingsBody(props: SettingsModalProps) {
  const { activeSection, resourceStates, onResourceRetry } = props;
  const { t } = useTranslation();
  if (activeSection === "appearance") return <SettingsAppearancePage languagePreference={props.languagePreference} onLanguagePreferenceChange={props.onLanguagePreferenceChange} />;
  if (activeSection === "files") return <SettingsFilesPage previewFileSizeLimitBytes={props.previewFileSizeLimitBytes} locale={props.resolvedLocale} onPreviewFileSizeLimitChange={props.onPreviewFileSizeLimitChange} />;
  const resources = settingsSectionResources(activeSection);
  const errors = resources.filter(key => resourceStates?.[key].status === "error");
  return <>
    {props.saveError ? <div className="settings-content-body settings-resource-errors"><Notice tone="danger" role="alert">{props.saveError}</Notice></div> : null}
    {errors.length ? <div className="settings-content-body settings-resource-errors">{errors.map(key => <Notice key={key} className="settings-inline-alert" tone="danger" role="alert" data-settings-resource={key}>
      <span>{t(`settings.loading.resources.${key}`)}: {resourceStates?.[key].error}</span>
      <UiButton variant="secondary" type="button" onClick={() => onResourceRetry?.(key)}>{t("settings.loading.retry")}</UiButton>
    </Notice>)}</div> : null}
    <SettingsDetailBoundary fallback={<div className="settings-content-body"><Notice tone="danger" role="alert">{t("settings.loading.moduleFailed")}</Notice><UiButton variant="secondary" type="button" onClick={() => window.location.reload()}>{t("settings.loading.reloadPage")}</UiButton></div>}>
      <Suspense fallback={<SettingsBodySkeleton />}>
        <SettingsContent {...props} />
      </Suspense>
    </SettingsDetailBoundary>
  </>;
}

function SettingsBodySkeleton() {
  return <div className="settings-content-body" aria-busy="true"><PanelContentSkeleton /></div>;
}

class SettingsDetailBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

function settingsSectionIcon(section: SettingsSectionId) {
  switch (section) {
    case "overview":
      return <HardDrive aria-hidden="true" size={16} />;
    case "system-profile":
      return <UserRound aria-hidden="true" size={16} />;
    case "version":
      return <Package aria-hidden="true" size={16} />;
    case "model-providers":
      return <KeyRound aria-hidden="true" size={16} />;
    case "pi-agent":
      return <Bot aria-hidden="true" size={16} />;
    case "audio":
      return <AudioLines aria-hidden="true" size={16} />;
    case "mcp":
      return <Server aria-hidden="true" size={16} />;
    case "skills":
      return <Package aria-hidden="true" size={16} />;
    case "wireless":
      return <Wifi aria-hidden="true" size={16} />;
    case "proxy":
    case "tailscale":
      return <Network aria-hidden="true" size={16} />;
    case "bluetooth":
      return <Bluetooth aria-hidden="true" size={16} />;
    case "docker":
      return <Server aria-hidden="true" size={16} />;
    case "virtual-machines":
      return <MonitorCog aria-hidden="true" size={16} />;
    case "shares":
      return <Share2 aria-hidden="true" size={16} />;
    case "files":
      return <Folder aria-hidden="true" size={16} />;
    case "indexer":
      return <Database aria-hidden="true" size={16} />;
    case "operations":
      return <Activity aria-hidden="true" size={16} />;
    case "monitoring":
      return <ChartNoAxesCombined aria-hidden="true" size={16} />;
    case "backup":
      return <ArchiveRestore aria-hidden="true" size={16} />;
    case "alerts":
      return <BellRing aria-hidden="true" size={16} />;
    case "photos":
      return <Images aria-hidden="true" size={16} />;
    case "media":
      return <Film aria-hidden="true" size={16} />;
    case "downloads":
      return <Download aria-hidden="true" size={16} />;
    case "appearance":
      return <ImageIcon aria-hidden="true" size={16} />;
  }
}
