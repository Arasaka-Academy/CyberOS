import { Button, Notice } from "@cyberos/ui";
import { BrandLogo } from "../components/common/BrandLogo.js";
import { Bookmark, Clock3, Film, Home, Layers3, Palette, Search, Tv } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaCollection } from "@cyberos/shared";
import { usePlayback } from "../components/playback/PlaybackProvider.js";
import { useMusicRemote } from "../components/music/MusicProvider.js";
import { AppearanceDialog, useNativeAppearance } from "./AppearanceDialog.js";
import { getTvModeStatus } from "./api.js";
import { LibraryScreen } from "./LibraryScreen.js";
import { SearchOverlay } from "./SearchOverlay.js";
import { TitleDetail } from "./TitleDetail.js";
import { TvPlaybackDock } from "./TvPlaybackDock.js";
import type { TitleTarget, TvView } from "./library-model.js";
import { gamepadConnectionTransition, isActiveVodPlayback } from "./player-controls.js";
import { useRemoteNavigation } from "./remote-navigation.js";

const NAVIGATION = [{ id: "home", icon: Home }, { id: "movie", icon: Film }, { id: "series", icon: Tv }, { id: "collections", icon: Layers3 }, { id: "watchlist", icon: Bookmark }] as const;

export function TvLibrary() {
  const { t: translate, i18n } = useTranslation();
  const playback = usePlayback();
  const music = useMusicRemote();
  const nativeAppearance = useNativeAppearance(playback.nas?.serviceInstanceId);
  const [view, setView] = useState<TvView>("home");
  const [collection, setCollection] = useState<MediaCollection | null>(null);
  const [target, setTarget] = useState<TitleTarget | null>(() => { const id = new URL(window.location.href).searchParams.get("title"); return id ? { id } : null; });
  const [searchOpen, setSearchOpen] = useState(false);
  const [appearanceOpen, setAppearanceOpen] = useState(false);
  const [clock, setClock] = useState(new Date());
  const [notice, setNotice] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [progressVersion, setProgressVersion] = useState(0);
  const [busy, setBusy] = useState(false);
  const content = useRef<HTMLElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const returnScroll = useRef(0);
  const gamepad = useRef<"ready" | "degraded" | "unavailable" | null>(null);
  const nativeHome = useRef<{ instance: string; request: string | undefined } | null>(null);
  const transportBusy = useRef(false);

  useEffect(() => {
    document.querySelector<HTMLButtonElement>('[data-tv-nav="home"]')?.focus();
    const timer = setInterval(() => setClock(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);
  useEffect(() => {
    let live = true;
    const poll = () => void getTvModeStatus().then(status => {
      if (!live) return;
      const transition = gamepadConnectionTransition(gamepad.current, status.gamepad.state);
      gamepad.current = status.gamepad.state;
      if (transition) setNotice(translate(`tv.gamepad.${transition}`));
    }).catch(() => {});
    poll();
    const timer = setInterval(poll, 5000);
    return () => { live = false; clearInterval(timer); };
  }, [translate]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(null), 5000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    const events = new EventSource("/api/media/events");
    let libraryStamp = "";
    let progressStamp = "";
    events.addEventListener("snapshot", event => {
      try {
        const { progress, ...library } = JSON.parse((event as MessageEvent<string>).data) as Record<string, unknown>;
        const nextLibrary = JSON.stringify(library);
        const nextProgress = JSON.stringify(progress);
        if (nextLibrary !== libraryStamp) { libraryStamp = nextLibrary; setVersion(previous => previous + 1); }
        if (nextProgress !== progressStamp) { progressStamp = nextProgress; setProgressVersion(previous => previous + 1); }
      } catch { return; }
    });
    return () => events.close();
  }, []);

  const navigate = (next: TvView) => { setView(next); setCollection(null); if (content.current) content.current.scrollTop = 0; };
  const open = (next: TitleTarget) => {
    if (!next.fromSearch) {
      returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      returnScroll.current = content.current?.scrollTop ?? 0;
    }
    setTarget(next);
  };
  const closeDetail = useCallback(() => {
    if (busy) return;
    const search = target?.fromSearch;
    setTarget(null);
    if (search) setSearchOpen(true);
    else requestAnimationFrame(() => {
      if (content.current) content.current.scrollTop = returnScroll.current;
      const previous = returnFocus.current;
      if (previous?.isConnected && previous.getClientRects().length) previous.focus({ preventScroll: true });
      else document.querySelector<HTMLButtonElement>(`.tv-media-card, [data-tv-nav="${view}"]`)?.focus({ preventScroll: true });
    });
  }, [busy, target?.fromSearch, view]);
  const back = useCallback(() => {
    if (busy) return;
    if (target) closeDetail();
    else if (collection) setCollection(null);
    else { setView("home"); requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('[data-tv-nav="home"]')?.focus()); }
  }, [busy, target, collection, closeDetail]);
  const navigateHome = useCallback(() => {
    if (busy) return;
    setSearchOpen(false); setAppearanceOpen(false); setTarget(null); setCollection(null); setView("home");
    const url = new URL(window.location.href); url.searchParams.delete("title"); window.history.replaceState(null, "", url);
    requestAnimationFrame(() => { if (content.current) content.current.scrollTop = 0; document.querySelector<HTMLButtonElement>('[data-tv-nav="home"]')?.focus(); });
  }, [busy]);
  const home = useCallback(() => {
    if (busy) return;
    navigateHome();
    if (playback.nas?.owner === "video" && playback.nas.video.sessionId && isActiveVodPlayback(playback.nas.video)) void playback.control({ type: "stop", sessionId: playback.nas.video.sessionId }).catch(failure => setNotice(String(failure.message)));
  }, [busy, navigateHome, playback.nas, playback.control]);
  useEffect(() => {
    const status = playback.nas;
    if (!status) return;
    const previous = nativeHome.current;
    const request = status.video.tvHomeRequestId;
    nativeHome.current = { instance: status.serviceInstanceId, request };
    if (previous?.instance === status.serviceInstanceId && request && request !== previous.request) navigateHome();
  }, [playback.nas, navigateHome]);
  const transport = async (key: string) => {
    if (transportBusy.current) return;
    transportBusy.current = true;
    try {
      if (playback.target === "browser" && playback.browser) {
        if (key === "MediaStop") playback.stopBrowser();
        else if (key === "MediaPlayPause" || (key === "MediaPlay") !== playback.browser.playing) await playback.toggleBrowser();
      } else if (playback.nas?.owner === "video" && playback.nas.sessionId) {
        const playing = playback.nas.video.state === "playing";
        await playback.control({ type: key === "MediaStop" ? "stop" : key === "MediaPause" || (key === "MediaPlayPause" && playing) ? "pause" : "resume", sessionId: playback.nas.sessionId });
      } else if (music.status?.queue.length) {
        if (key === "MediaStop" && playback.nas?.sessionId) await playback.control({ type: "stop", sessionId: playback.nas.sessionId });
        else if (key !== "MediaStop") await music.execute({ type: key === "MediaPause" || (key === "MediaPlayPause" && music.status.state === "playing") ? "pause" : "resume" });
      }
    } catch (failure) { setNotice(failure instanceof Error ? failure.message : String(failure)); }
    finally { transportBusy.current = false; }
  };
  useRemoteNavigation({ onBack: back, onHome: home, onSearch: () => setSearchOpen(true), onTransport: key => void transport(key) });

  return <div className="tv-app tv-library-shell">
    <div className="tv-browse-shell" hidden={target !== null} inert={target !== null || searchOpen || appearanceOpen}>
      <aside className="tv-sidebar" aria-label={translate("video.library")}>
        <Button variant="ghost" className="tv-brand" aria-label="CyberOS" onClick={home}><BrandLogo /></Button>
        <nav className="tv-navigation" data-tv-region="sidebar">{NAVIGATION.map(({ id, icon: Icon }) => <Button variant="ghost" key={id} data-tv-nav={id} data-tv-focusable aria-current={view === id ? "page" : undefined} onClick={() => navigate(id)}><Icon /><span>{translate(`video.${id}`)}</span></Button>)}</nav>
        <div className="tv-sidebar-tools" data-tv-region="sidebar-tools"><Button variant="ghost" className="tv-search-button" data-tv-focusable onClick={() => setSearchOpen(true)}><Search /><span>{translate("tv.search")}</span></Button><Button variant="ghost" data-tv-focusable onClick={() => setAppearanceOpen(true)} aria-label={translate("settings.appearance.title")}><Palette /><span>{translate("settings.appearance.title")}</span></Button></div>
      </aside>
      <main className="tv-content" ref={content} key={view}>
        <header className="tv-topbar"><span>CyberOS <span className="tv-topbar-divider">/</span> {translate("tv.library")}</span><time className="tv-clock"><Clock3 />{new Intl.DateTimeFormat(i18n.resolvedLanguage ?? "zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(clock)}</time></header>
        <LibraryScreen view={view} collection={collection} onCollection={setCollection} onOpen={open} version={version} progressVersion={progressVersion} />
      </main>
      <TvPlaybackDock onError={setNotice} />
    </div>
    {target ? <TitleDetail key={target.id} target={target} version={version + progressVersion} onClose={closeDetail} onChanged={() => setVersion(previous => previous + 1)} onBusy={setBusy} /> : null}
    <SearchOverlay open={searchOpen} onClose={() => setSearchOpen(false)} onOpen={title => { setSearchOpen(false); open({ id: title.id, fromSearch: true }); }} />
    {appearanceOpen ? <AppearanceDialog onClose={() => setAppearanceOpen(false)} error={nativeAppearance.error} onRetry={nativeAppearance.retry} /> : null}
    {notice ? <Notice className="tv-notice" role="status">{notice}</Notice> : null}
  </div>;
}
