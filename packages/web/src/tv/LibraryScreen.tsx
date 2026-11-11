import { Button, EmptyState, Notice, Skeleton } from "@cyberos/ui";
import { ArrowLeft, Film, Layers3, Play, SlidersHorizontal } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import type { MediaCollection, MediaTitleSummary, VideoHome, VideoPage, VideoQuery } from "@cyberos/shared";
import { getCollections, getVideoHome, getVideoPage } from "../lib/video-api.js";
import { DEFAULT_TV_FILTERS, FilterDialog, type TvFilters } from "./FilterDialog.js";
import { MediaArtwork, MediaCard, TitleMetadata } from "./MediaCard.js";
import { featuredTitle, homeRows, uniqueTitles, type TitleTarget, type TvView } from "./library-model.js";

export function LibraryScreen({ view, collection, onCollection, onOpen, version, progressVersion }: {
  view: TvView; collection: MediaCollection | null; onCollection: (collection: MediaCollection | null) => void;
  onOpen: (target: TitleTarget) => void; version: number; progressVersion: number;
}) {
  const { t: translate } = useTranslation();
  const [home, setHome] = useState<VideoHome | null>(null);
  const [homeState, setHomeState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const [collections, setCollections] = useState<MediaCollection[]>([]);
  const [page, setPage] = useState<VideoPage>({ titles: [], nextCursor: null });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<TvFilters>(DEFAULT_TV_FILTERS);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const moreBusy = useRef(false);
  const sequence = useRef(0);
  const loadedScope = useRef<VideoQuery | null>(null);
  const collectionFocus = useRef<{ id: string; scrollTop: number } | null>(null);
  const collectionGrid = useRef<HTMLDivElement>(null);
  const scope = useMemo<VideoQuery>(() => ({ ...filters, ...(view === "movie" || view === "series" ? { kind: view } : {}), ...(view === "watchlist" ? { watchlist: true } : {}), ...(collection ? { collectionId: collection.id } : {}), limit: 48 }), [view, collection, filters]);
  const listing = view !== "home" && (view !== "collections" || collection !== null);

  useEffect(() => {
    let live = true;
    setHomeState("loading");
    void getVideoHome().then(next => { if (live) { setHome(next); setHomeState("ready"); } }).catch(() => { if (live) setHomeState("error"); });
    return () => { live = false; };
  }, [version, progressVersion, retry]);
  useEffect(() => {
    if (view !== "collections" || collection) return;
    let live = true;
    setLoading(true);
    setError(null);
    void getCollections().then(next => { if (live) setCollections(next); }).catch(failure => { if (live) setError(String(failure.message)); }).finally(() => {
      if (live) {
        setLoading(false);
        requestAnimationFrame(() => {
          const previous = collectionFocus.current;
          if (!previous) return;
          const button = [...(collectionGrid.current?.querySelectorAll<HTMLButtonElement>("[data-tv-collection]") ?? [])].find(candidate => candidate.dataset.tvCollection === previous.id);
          const content = collectionGrid.current?.closest(".tv-content");
          if (content) content.scrollTop = previous.scrollTop;
          button?.focus({ preventScroll: true });
        });
      }
    });
    return () => { live = false; };
  }, [view, collection, version, retry]);
  useEffect(() => {
    const request = ++sequence.current;
    if (!listing) return;
    const abort = new AbortController();
    setLoading(true);
    setError(null);
    if (loadedScope.current !== scope) { loadedScope.current = scope; setPage({ titles: [], nextCursor: null }); }
    void getVideoPage(scope, abort.signal).then(next => { if (request === sequence.current) setPage({ ...next, titles: uniqueTitles(next.titles) }); })
      .catch(failure => { if (!abort.signal.aborted) setError(String(failure.message)); })
      .finally(() => { if (request === sequence.current) setLoading(false); });
    return () => { abort.abort(); };
  }, [scope, listing, version, retry]);

  const more = async () => {
    if (!page.nextCursor || moreBusy.current) return;
    const request = sequence.current;
    moreBusy.current = true;
    setLoading(true);
    setError(null);
    try {
      const next = await getVideoPage({ ...scope, cursor: page.nextCursor });
      if (request === sequence.current) setPage(previous => ({ ...next, titles: uniqueTitles([...previous.titles, ...next.titles]) }));
    } catch (failure) { if (request === sequence.current) setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { moreBusy.current = false; if (request === sequence.current) setLoading(false); }
  };
  const open = (title: MediaTitleSummary, fileId?: string, autoplay = false) => onOpen({ id: title.id, ...(fileId ? { fileId } : {}), autoplay });
  const featured = home ? featuredTitle(home) : null;
  const rows = home ? homeRows(home) : [];
  const empty = <EmptyState className="tv-empty" icon={<Film />} title={translate("tv.emptyTitle")} description={translate("tv.emptyBody")} />;

  return <>
    {view === "home" ? <>
      {homeState === "loading" && !home ? <LibrarySkeleton /> : null}
      {homeState === "error" ? <Notice className="tv-load-error" tone="danger" actions={<Button onClick={() => setRetry(previous => previous + 1)}>{translate("tv.retry")}</Button>}>{translate("tv.unavailableBody")}</Notice> : null}
      {featured ? <section className="tv-hero" aria-label={featured.title}>
        <MediaArtwork title={featured} kind="backdrop" />
        <div className="tv-hero-copy"><span className="tv-eyebrow">{translate(featured.progress && !featured.progress.completed ? "video.continue" : "video.recent")}</span>
          <h1>{featured.title}</h1><TitleMetadata title={featured} /><p className="tv-synopsis">{featured.overview || translate("video.noOverview")}</p>
          <div className="tv-actions" data-tv-region="hero"><Button variant="primary" data-tv-focusable onClick={() => open(featured, featured.progress?.fileId, true)}><Play />{translate(featured.progress && !featured.progress.completed ? "tv.resume" : "tv.play")}</Button>
            <Button data-tv-focusable onClick={() => open(featured)}>{translate("tv.viewDetails")}</Button></div>
        </div>
      </section> : homeState === "ready" ? empty : null}
      <div className="tv-home-rows">{rows.map(row => <section className="tv-home-row" key={row.id} data-tv-row-id={row.id}>
        <h2>{translate(`video.${row.id}`)}</h2><div className="tv-home-rail" data-tv-region="rail" data-tv-region-id={row.id}>
          {row.items.map(item => <MediaCard key={item.title.id} item={item} onOpen={() => open(item.title, item.fileId)} />)}
        </div>
      </section>)}</div>
    </> : <>
      <header className="tv-page-heading"><div><span className="tv-eyebrow">{translate("tv.library")}</span><h1>{collection?.name ?? translate(`video.${view}`)}</h1></div>
        <div className="tv-actions" data-tv-region="page-actions">{collection ? <Button variant="ghost" onClick={() => onCollection(null)}><ArrowLeft />{translate("video.collections")}</Button> : null}
          {listing ? <Button onClick={() => setFiltersOpen(true)} data-tv-focusable><SlidersHorizontal />{translate("video.filter")}</Button> : null}</div>
      </header>
      {error ? <Notice tone="danger" actions={<Button onClick={() => setRetry(previous => previous + 1)}>{translate("tv.retry")}</Button>}>{error}</Notice> : null}
      {view === "collections" && !collection ? <div ref={collectionGrid} className="tv-collection-grid" data-tv-region="grid">
        {collections.map(item => <Button variant="ghost" className="tv-collection-card" key={item.id} data-tv-collection={item.id} onClick={event => {
          const content = event.currentTarget.closest(".tv-content");
          collectionFocus.current = { id: item.id, scrollTop: content?.scrollTop ?? 0 };
          if (content) content.scrollTop = 0;
          onCollection(item);
        }}><Layers3 /><strong>{item.name}</strong><small>{translate("tv.titleCount", { count: item.titleIds.length })}</small></Button>)}
        {!loading && !error && !collections.length ? empty : null}
      </div> : <>
        <div className="tv-poster-grid" data-tv-region="grid">{page.titles.map(title => <MediaCard key={title.id} item={{ title }} onOpen={() => open(title)} />)}</div>
        {!loading && !error && !page.titles.length ? <EmptyState className="tv-empty" title={translate("video.empty")} /> : null}
        {page.nextCursor ? <Button className="tv-load-more" busy={loading} onClick={() => void more()}>{translate("video.loadMore")}</Button> : null}
      </>}
      {loading && !page.nextCursor ? <LibrarySkeleton /> : null}
    </>}
    {filtersOpen ? <FilterDialog value={filters} onApply={setFilters} onClose={() => setFiltersOpen(false)} /> : null}
  </>;
}

function LibrarySkeleton() {
  const { t: translate } = useTranslation();
  return <div className="tv-library-loading" role="status" aria-label={translate("tv.loading")}><Skeleton className="tv-hero-skeleton" /><div className="tv-skeleton-row">{Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="tv-card-skeleton" />)}</div></div>;
}
