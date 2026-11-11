'use client';
import { useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState, type ComponentPropsWithRef, type KeyboardEvent, type RefObject } from 'react';
import { FocusScope, Overlay, useModalOverlay } from 'react-aria';
import { useControllableState, cx, type DOMProps } from './shared.js';
import { useCyberUI } from './provider.js';
import { Icon } from './icon.js';
import { addCalendarDays, addCalendarMonths, calendarDate, calendarDays, clampCalendarDate, parseCalendarDate, validCalendarValue } from './calendar-date.js';
import s from './date-picker.module.css';

export interface DatePickerProps extends DOMProps {
  label: string;
  value?: string | null;
  defaultValue?: string;
  onChange?: (date: string | null) => void;
  isDisabled?: boolean;
  isRequired?: boolean;
  name?: string;
  minValue?: string;
  maxValue?: string;
  includeTime?: boolean;
  hideLabel?: boolean;
  locale?: string;
  /** Host apps may keep overlays inside their current modal or fullscreen layer. */
  portalContainer?: HTMLElement | null | (() => HTMLElement | null);
  popoverZIndex?: number;
  onOpenChange?: (open: boolean) => void;
}

const COPY = {
  en: { open: 'Choose date', date: 'Select date', dateTime: 'Select date & time', time: 'Time', year: 'Year', hours: 'Hours', minutes: 'Minutes', today: 'Today', clear: 'Clear', previousMonth: 'Previous month', nextMonth: 'Next month', previousYear: 'Previous year', nextYear: 'Next year', chooseMonth: 'Choose month and year', invalid: 'Enter a valid date within the allowed range', done: 'Done' },
  zh: { open: '选择日期', date: '选择日期', dateTime: '选择日期与时间', time: '时间', year: '年份', hours: '时', minutes: '分', today: '今天', clear: '清除', previousMonth: '上个月', nextMonth: '下个月', previousYear: '上一年', nextYear: '下一年', chooseMonth: '选择月份与年份', invalid: '请输入有效且在允许范围内的日期', done: '完成' }
};
function dateCopy(locale: string) {
  const copy = locale.startsWith('zh') ? COPY.zh : COPY.en;
  return (path: string, values?: { month?: string; format?: string }) => {
    const key = path.split('.').at(-1) as keyof typeof COPY.en;
    if (key === 'chooseMonth') return `${values?.month} · ${copy.chooseMonth}`;
    if (key === 'invalid') return `${copy.invalid}: ${values?.format}.`;
    return copy[key];
  };
}
function isBackKey(event: { key: string; keyCode?: number }) {
  return ['Escape', 'BrowserBack', 'GoBack'].includes(event.key) || event.keyCode === 461;
}
function Button({ variant = 'ghost', iconOnly, className, ...props }: ComponentPropsWithRef<'button'> & { variant?: 'ghost' | 'secondary' | 'primary'; iconOnly?: boolean }) {
  return <button {...props} className={cx(s.command, className)} data-variant={variant} data-icon-only={iconOnly || undefined} />;
}

export function DatePicker({ label, value, defaultValue, onChange, minValue: min, maxValue: max, isRequired: required, isDisabled: disabled, includeTime = false, hideLabel = false, locale: requestedLocale, portalContainer, popoverZIndex = 1000, onOpenChange, name, id: suppliedId, className, ref, ...props }: DatePickerProps) {
  const context = useCyberUI();
  const locale = requestedLocale ?? context.locale;
  const t = dateCopy(locale);
  const generated = useId();
  const id = suppliedId ?? generated;
  const [current, setCurrent] = useControllableState<string | null>(value, defaultValue ?? null, onChange);
  const resolved = current ?? '';
  const rootRef = useRef<HTMLDivElement>(null);
  useImperativeHandle(ref, () => rootRef.current!);
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const lastEmitted = useRef(resolved);
  const restoreFrame = useRef<number | null>(null);
  const [draft, setDraft] = useState(resolved);
  const [open, setOpen] = useState(false);
  const [point, setPoint] = useState<Parameters<typeof useModalOverlay>[1]['point']>(null);
  const invalid = Boolean(draft && !validCalendarValue(draft, includeTime, min, max));
  const error = invalid ? t('common.datePicker.invalid', { format: includeTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD' }) : '';
  const openCallback = useRef(onOpenChange);
  openCallback.current = onOpenChange;
  useEffect(() => { openCallback.current?.(open); }, [open]);
  useEffect(() => () => { if (restoreFrame.current !== null) window.cancelAnimationFrame(restoreFrame.current); }, []);
  useEffect(() => {
    if (resolved !== lastEmitted.current) setDraft(resolved);
    lastEmitted.current = resolved;
  }, [resolved]);
  useEffect(() => { inputRef.current?.setCustomValidity(error); }, [error]);
  useEffect(() => { if (disabled) setOpen(false); }, [disabled]);
  useEffect(() => {
    const form = inputRef.current?.form;
    function reset() {
      const next = defaultValue ?? '';
      setDraft(next); lastEmitted.current = next; setCurrent(next || null); setOpen(false);
    }
    form?.addEventListener('reset', reset);
    return () => form?.removeEventListener('reset', reset);
  }, [defaultValue, setCurrent]);

  function update(next: string) {
    setDraft(next);
    const accepted = !next || validCalendarValue(next, includeTime, min, max) ? next : '';
    lastEmitted.current = accepted;
    setCurrent(accepted || null);
  }
  function close(restoreFocus = true) {
    setOpen(false);
    if (!restoreFocus) return;
    restoreFrame.current = window.requestAnimationFrame(() => {
      const focused = document.activeElement;
      if (focused === document.body || focused === triggerRef.current || !focused?.isConnected) triggerRef.current?.focus();
    });
  }
  const suppliedHost = typeof portalContainer === 'function' ? portalContainer() : portalContainer;
  const host = typeof document === 'undefined' ? null : suppliedHost ?? context.portal ?? document.fullscreenElement ?? document.body;
  return <div {...props} ref={rootRef} data-cyber-date-picker="" data-open={open || undefined} data-invalid={invalid || undefined}
    className={cx(s['date-picker'], className)} onKeyDownCapture={event => {
      props.onKeyDownCapture?.(event);
      if (open && !event.defaultPrevented && isBackKey(event)) { event.preventDefault(); event.stopPropagation(); close(); }
    }}>
    {!hideLabel ? <label className={s.label} htmlFor={id}>{label}</label> : null}
    <input id={id} ref={inputRef} className={s['date-picker-input']} type="text"
      aria-label={props['aria-label'] ?? (hideLabel && label ? label : undefined)}
      aria-invalid={invalid || props['aria-invalid'] || undefined}
      aria-describedby={[props['aria-describedby'], invalid ? `${id}-date-error` : ''].filter(Boolean).join(' ') || undefined}
      value={includeTime ? draft.replace('T', ' ') : draft} placeholder={includeTime ? 'YYYY-MM-DD HH:mm' : 'YYYY-MM-DD'}
      autoComplete="off" spellCheck={false} required={required} disabled={disabled}
      onChange={event => update(event.target.value.replace(' ', 'T'))}
      onKeyDown={event => { if (event.key === 'ArrowDown' && event.altKey) { event.preventDefault(); setOpen(true); } }}
    />
    {name ? <input type="hidden" name={name} value={resolved} disabled={disabled} /> : null}
    <Button ref={triggerRef} type="button" variant="ghost" iconOnly className={s['date-picker-trigger']} disabled={disabled}
      aria-label={t('common.datePicker.open')} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? `${id}-calendar` : undefined}
      onClick={() => setOpen(current => !current)}><Icon name="calendar" aria-hidden="true" /></Button>
    {invalid ? <span className={s['date-picker-error']} id={`${id}-date-error`}>{error}</span> : null}
    {open && !disabled && host ? <Overlay portalContainer={host} disableFocusManagement><FocusScope contain><CalendarPanel id={`${id}-calendar`} anchorRef={rootRef} locale={locale} zIndex={popoverZIndex}
      value={validCalendarValue(draft, includeTime, min, max) ? draft : resolved} min={min} max={max} required={required} includeTime={includeTime}
      state={{ isOpen: open, setOpen, point, setPoint, open: () => setOpen(true), close: () => close(false), toggle: () => setOpen(current => !current) }}
      onClose={close} onSelect={next => { update(next); close(); }} /></FocusScope></Overlay> : null}
  </div>;
}

export type NativeDateInputProps = ComponentPropsWithRef<'input'>;

interface CalendarPanelProps {
  id: string;
  anchorRef: RefObject<HTMLDivElement | null>;
  value: string;
  min?: string | undefined;
  max?: string | undefined;
  required?: boolean | undefined;
  includeTime: boolean;
  onSelect: (value: string) => void;
  onClose: (restoreFocus?: boolean) => void;
  locale: string;
  zIndex: number;
  state: Parameters<typeof useModalOverlay>[1];
}

function CalendarPanel({ id, anchorRef, value, min, max, required, includeTime, onSelect, onClose, locale, zIndex, state }: CalendarPanelProps) {
  const t = dateCopy(locale);
  const today = calendarDate(new Date());
  const initial = clampCalendarDate(parseCalendarDate(value.slice(0, 10)) ? value.slice(0, 10) : today, min, max);
  const [active, setActive] = useState(initial);
  const [month, setMonth] = useState(initial.slice(0, 7));
  const [yearDraft, setYearDraft] = useState(initial.slice(0, 4));
  const [monthsOpen, setMonthsOpen] = useState(false);
  const [hours, setHours] = useState(value.slice(11, 13) || "00");
  const [minutes, setMinutes] = useState(value.slice(14, 16) || "00");
  const [layout, setLayout] = useState({ left: 0, top: 0, maxHeight: 0 });
  const dialogRef = useRef<HTMLDivElement>(null);
  // Register the child overlay so a parent CyberUI dialog preserves its focus and dismissal boundary.
  const { modalProps } = useModalOverlay({ isDismissable: true, isKeyboardDismissDisabled: true, shouldCloseOnInteractOutside: target => !anchorRef.current?.contains(target) }, state, dialogRef);
  const focusDate = useRef(true);
  const pendingFocus = useRef<string | null>(null);
  const selected = value.slice(0, 10);
  const monthDate = parseCalendarDate(`${month}-01`)!;
  const fullDate = new Intl.DateTimeFormat(locale, { dateStyle: "full" });
  const monthLabel = new Intl.DateTimeFormat(locale, { year: "numeric", month: "long" }).format(monthDate);
  const weekdays = Array.from({ length: 7 }, (_, day) => new Intl.DateTimeFormat(locale, { weekday: "short" }).format(new Date(2026, 10, 1 + day)));
  const days = calendarDays(`${month}-01`);

  useLayoutEffect(() => {
    function position() {
      const panel = dialogRef.current;
      const anchor = anchorRef.current;
      if (!panel || !anchor) return;
      const viewport = window.visualViewport;
      const width = viewport?.width ?? window.innerWidth;
      const height = viewport?.height ?? window.innerHeight;
      const offsetTop = viewport?.offsetTop ?? 0;
      const offsetLeft = viewport?.offsetLeft ?? 0;
      const margin = width < 340 ? 4 : 8;
      const rect = anchor.getBoundingClientRect();
      const panelHeight = Math.min(panel.scrollHeight + 2, height - margin * 2);
      const below = rect.bottom + 6;
      const above = rect.top - panelHeight - 6;
      const top = Math.max(offsetTop + margin, Math.min(below + panelHeight <= offsetTop + height - margin ? below : above, offsetTop + height - panelHeight - margin));
      setLayout({ left: Math.max(offsetLeft + margin, Math.min(rect.left, offsetLeft + width - panel.offsetWidth - margin)), top, maxHeight: height - margin * 2 });
    }
    position();
    const viewport = window.visualViewport;
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    document.addEventListener("scroll", position, true);
    return () => {
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
      document.removeEventListener("scroll", position, true);
    };
  }, [anchorRef, dialogRef, monthsOpen, includeTime]);

  useEffect(() => {
    if (!focusDate.current || monthsOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const panel = dialogRef.current;
      const focused = document.activeElement;
      if (focused === document.body || focused === panel || !panel?.contains(focused)) panel?.querySelector<HTMLButtonElement>(`[data-date="${active}"]`)?.focus({ preventScroll: true });
      focusDate.current = false;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [active, month, monthsOpen, dialogRef]);

  useLayoutEffect(() => {
    if (!pendingFocus.current || monthsOpen) return;
    const target = dialogRef.current?.querySelector<HTMLButtonElement>(`[data-date="${pendingFocus.current}"]`);
    if (target) { pendingFocus.current = null; target.focus({ preventScroll: true }); }
  }, [active, month, monthsOpen]);

  function available(day: string) { return Boolean(day) && clampCalendarDate(day, min, max) === day; }
  function move(next: string) {
    const day = clampCalendarDate(next, min, max);
    pendingFocus.current = day;
    setActive(day);
    setMonth(day.slice(0, 7));
    // Same-month and bounded moves can focus immediately; month changes focus after the new grid commits.
    if (!monthsOpen && day.slice(0, 7) === month) {
      pendingFocus.current = null;
      dialogRef.current?.querySelector<HTMLButtonElement>(`[data-date="${day}"]`)?.focus({ preventScroll: true });
    }
  }
  function navigate(event: KeyboardEvent<HTMLButtonElement>, day: string) {
    let next: string;
    switch (event.key) {
      case "ArrowLeft": next = addCalendarDays(day, -1); break;
      case "ArrowRight": next = addCalendarDays(day, 1); break;
      case "ArrowUp": next = addCalendarDays(day, -7); break;
      case "ArrowDown": next = addCalendarDays(day, 7); break;
      case "Home": next = addCalendarDays(day, -parseCalendarDate(day)!.getDay()); break;
      case "End": next = addCalendarDays(day, 6 - parseCalendarDate(day)!.getDay()); break;
      case "PageUp": next = addCalendarMonths(day, event.shiftKey ? -12 : -1); break;
      case "PageDown": next = addCalendarMonths(day, event.shiftKey ? 12 : 1); break;
      default: return;
    }
    event.preventDefault(); event.stopPropagation(); move(next);
  }
  function choose(day: string) {
    if (!available(day)) return;
    if (includeTime) { move(day); return; }
    onSelect(day);
  }
  const validTime = /^\d{1,2}$/.test(hours) && Number(hours) < 24 && /^\d{1,2}$/.test(minutes) && Number(minutes) < 60;
  const candidate = `${active}T${hours.padStart(2, "0")}:${minutes.padStart(2, "0")}`;
  const previous = addCalendarMonths(`${month}-01`, monthsOpen ? -12 : -1).slice(0, 7);
  const next = addCalendarMonths(`${month}-01`, monthsOpen ? 12 : 1).slice(0, 7);
  function monthAvailable(target: string) {
    const date = parseCalendarDate(`${target}-01`)!;
    date.setMonth(date.getMonth() + 1, 0);
    const end = calendarDate(date);
    return !(max && `${target}-01` > max.slice(0, 10)) && !(min && end < min.slice(0, 10));
  }
  function navigationAvailable(target: string) {
    if (!monthsOpen) return monthAvailable(target);
    const year = target.slice(0, 4);
    return !(max && `${year}-01-01` > max.slice(0, 10)) && !(min && `${year}-12-31` < min.slice(0, 10));
  }
  function viewMonth(target: string) {
    setMonth(target);
    setYearDraft(target.slice(0, 4));
    setActive(clampCalendarDate(`${target}-01`, min, max));
  }
  return <div {...modalProps} ref={dialogRef} id={id} data-cyber-date-picker-panel="" role="dialog" aria-modal="true" aria-label={t("common.datePicker.open")} tabIndex={-1}
    className={s["date-picker-panel"]} style={{ left: layout.left, top: layout.top, maxHeight: layout.maxHeight || undefined, zIndex }}
    onPointerDown={event => event.stopPropagation()} onClick={event => event.stopPropagation()}
    onKeyDownCapture={event => {
      if (isBackKey(event)) { event.preventDefault(); event.stopPropagation(); onClose(); return; }
    }}>
    <div className={s["date-picker-heading"]}><Icon name="calendar" aria-hidden="true" /><span>{t(includeTime ? "common.datePicker.dateTime" : "common.datePicker.date")}</span></div>
    <div className={s["date-picker-navigation"]}>
      <Button variant="ghost" iconOnly type="button" aria-label={t(monthsOpen ? "common.datePicker.previousYear" : "common.datePicker.previousMonth")} disabled={previous === month || !navigationAvailable(previous)} onClick={() => viewMonth(previous)}><Icon name="back" aria-hidden="true" /></Button>
      {monthsOpen ? <label className={s["date-picker-year"]}><span>{t("common.datePicker.year")}</span><input className={s.textInput} aria-label={t("common.datePicker.year")} type="number" min={1} max={9999} value={yearDraft} onChange={event => {
        const draft = event.target.value;
        setYearDraft(draft);
        if (/^\d{1,4}$/.test(draft) && Number(draft) >= 1) setMonth(`${draft.padStart(4, "0")}${month.slice(4)}`);
      }} onBlur={() => setYearDraft(month.slice(0, 4))} /></label>
        : <Button type="button" variant="ghost" className={s["date-picker-month-title"]} aria-label={t("common.datePicker.chooseMonth", { month: monthLabel })} onClick={() => { setYearDraft(month.slice(0, 4)); setMonthsOpen(true); }}>{monthLabel}</Button>}
      <Button variant="ghost" iconOnly type="button" aria-label={t(monthsOpen ? "common.datePicker.nextYear" : "common.datePicker.nextMonth")} disabled={next === month || !navigationAvailable(next)} onClick={() => viewMonth(next)}><Icon name="forward" aria-hidden="true" /></Button>
    </div>
    <div className={s["date-picker-announcement"]} aria-live="polite">{monthLabel}</div>
    {monthsOpen ? <div className={s["date-picker-months"]}>{Array.from({ length: 12 }, (_, index) => {
      const target = `${month.slice(0, 4)}-${String(index + 1).padStart(2, "0")}`;
      return <Button key={target} type="button" variant="ghost" disabled={!monthAvailable(target)} aria-pressed={target === selected.slice(0, 7)} onClick={() => { setMonthsOpen(false); move(clampCalendarDate(`${target}-01`, min, max)); }}>{new Intl.DateTimeFormat(locale, { month: "short" }).format(parseCalendarDate(`${target}-01`)!)}</Button>;
    })}</div> : <div role="grid" aria-label={monthLabel} className={s["date-picker-grid"]}>
      <div role="row" className={s["date-picker-weekdays"]}>{weekdays.map((day, index) => <span role="columnheader" key={index}>{day}</span>)}</div>
      {Array.from({ length: 6 }, (_, week) => <div role="row" className={s["date-picker-week"]} key={week}>{days.slice(week * 7, week * 7 + 7).map((day, index) => <div role="gridcell" aria-selected={Boolean(day) && day === (includeTime ? active : selected)} key={day || index}>
        {day ? <Button type="button" variant="ghost" className={s["date-picker-day"]} data-adjacent={day.slice(0, 7) !== month || undefined} data-date={day} data-today={day === today || undefined}
          aria-current={day === today ? "date" : undefined} aria-label={fullDate.format(parseCalendarDate(day)!)} disabled={!available(day)} tabIndex={day === active ? 0 : -1}
          onFocus={() => setActive(day)} onClick={() => choose(day)} onKeyDown={event => navigate(event, day)}>{Number(day.slice(-2))}</Button> : null}
      </div>)}</div>)}
    </div>}
    {includeTime ? <div className={s["date-picker-time"]}><span>{t("common.datePicker.time")}</span><div>
      <input className={s.textInput} aria-label={t("common.datePicker.hours")} type="number" min={0} max={23} value={hours} onChange={event => setHours(event.target.value)} onBlur={() => { if (/^\d{1,2}$/.test(hours) && Number(hours) < 24) setHours(hours.padStart(2, "0")); }} />
      <span aria-hidden="true">:</span><input className={s.textInput} aria-label={t("common.datePicker.minutes")} type="number" min={0} max={59} value={minutes} onChange={event => setMinutes(event.target.value)} onBlur={() => { if (/^\d{1,2}$/.test(minutes) && Number(minutes) < 60) setMinutes(minutes.padStart(2, "0")); }} />
    </div></div> : null}
    <div className={s["date-picker-footer"]}>
      <Button type="button" variant="ghost" disabled={required || !value} onClick={() => onSelect("")}>{t("common.datePicker.clear")}</Button>
      <Button type="button" variant="secondary" disabled={!available(today)} onClick={() => includeTime ? move(today) : onSelect(today)}>{t("common.datePicker.today")}</Button>
      {includeTime ? <Button type="button" variant="primary" disabled={!validTime || !validCalendarValue(candidate, true, min, max)} onClick={() => onSelect(candidate)}>{t("common.actions.done")}</Button> : null}
    </div>
  </div>;
}
