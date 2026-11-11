import { Button, DialogActions, DialogHeader, Field, Notice } from "@cyberos/ui";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { VideoFilterOptions, VideoQuery } from "@cyberos/shared";
import { CustomSelect } from "../components/common/CustomSelect.js";
import { ModalPortal } from "../components/common/ModalPortal.js";
import { useModalDialog } from "../components/workspace/useModalDialog.js";
import { getVideoFilterOptions } from "../lib/video-api.js";

export type TvFilters = Pick<VideoQuery, "genre" | "year" | "watched" | "sort">;
export const DEFAULT_TV_FILTERS: TvFilters = { sort: "added" };

export function FilterDialog({ value, onApply, onClose }: { value: TvFilters; onApply: (filters: TvFilters) => void; onClose: () => void }) {
  const { t: translate } = useTranslation();
  const ref = useModalDialog(onClose);
  const [draft, setDraft] = useState(value);
  const [options, setOptions] = useState<VideoFilterOptions>({ years: [], genres: [] });
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let live = true;
    setState("loading");
    void getVideoFilterOptions().then(next => { if (live) { setOptions(next); setState("ready"); } }).catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [retry]);
  const all = { value: "", label: translate("video.all") };
  const update = <FilterKey extends keyof TvFilters>(key: FilterKey, nextValue: TvFilters[FilterKey]) => setDraft(previous => {
    const next = { ...previous };
    if (nextValue === undefined) delete next[key];
    else Object.assign(next, { [key]: nextValue });
    return next;
  });
  return <ModalPortal className="tv-dialog-backdrop">
    <section ref={ref} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="tv-filters-title" className="tv-dialog tv-filter-dialog">
      <DialogHeader title={translate("video.filter")} headingId="tv-filters-title" />
      {state !== "ready" ? <Notice tone={state === "error" ? "danger" : "info"} actions={state === "error" ? <Button onClick={() => setRetry(previous => previous + 1)}>{translate("tv.retry")}</Button> : undefined}>{translate(state === "error" ? "tv.filtersFailed" : "tv.loadingFilters")}</Notice> : null}
      <div className="tv-filter-fields" data-tv-region="filters">
        <Field label={translate("video.year")}><CustomSelect ariaLabel={translate("video.year")} value={draft.year?.toString() ?? ""} disabled={state !== "ready"} options={[all, ...options.years.map(year => ({ value: String(year), label: String(year) }))]} onChange={year => update("year", year ? Number(year) : undefined)} /></Field>
        <Field label={translate("video.genre")}><CustomSelect ariaLabel={translate("video.genre")} value={draft.genre ?? ""} disabled={state !== "ready"} options={[all, ...options.genres.map(genre => ({ value: genre, label: genre }))]} onChange={genre => update("genre", genre || undefined)} /></Field>
        <Field label={translate("video.watched")}><CustomSelect ariaLabel={translate("video.watched")} value={draft.watched === undefined ? "" : String(draft.watched)} options={[all, { value: "false", label: translate("video.unwatched") }, { value: "true", label: translate("video.watched") }]} onChange={watched => update("watched", watched === "" ? undefined : watched === "true")} /></Field>
        <Field label={translate("video.sort")}><CustomSelect ariaLabel={translate("video.sort")} value={draft.sort ?? "added"} options={(["title", "year", "added", "rating", "recent"] as const).map(sort => ({ value: sort, label: translate(`video.sort_${sort}`) }))} onChange={sort => update("sort", sort as TvFilters["sort"])} /></Field>
      </div>
      <DialogActions><Button variant="ghost" onClick={() => setDraft(DEFAULT_TV_FILTERS)}>{translate("video.reset")}</Button><Button onClick={onClose}>{translate("common.actions.cancel")}</Button><Button variant="primary" onClick={() => { onApply(draft); onClose(); }}>{translate("tv.applyFilters")}</Button></DialogActions>
    </section>
  </ModalPortal>;
}
