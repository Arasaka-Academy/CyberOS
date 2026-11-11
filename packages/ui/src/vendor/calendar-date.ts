/** Local Gregorian dates: never parse a date-only value as UTC. */
export function parseCalendarDate(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (year < 1 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(0);
  date.setHours(12, 0, 0, 0);
  date.setFullYear(year, month - 1, day);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day ? date : null;
}

export function calendarDate(date: Date): string {
  return `${String(date.getFullYear()).padStart(4, "0")}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addCalendarDays(value: string, amount: number): string {
  const date = parseCalendarDate(value)!;
  date.setDate(date.getDate() + amount);
  return date.getFullYear() < 1 ? "0001-01-01" : date.getFullYear() > 9999 ? "9999-12-31" : calendarDate(date);
}

export function addCalendarMonths(value: string, amount: number): string {
  const date = parseCalendarDate(value)!;
  const day = date.getDate();
  date.setDate(1);
  date.setMonth(date.getMonth() + amount);
  if (date.getFullYear() < 1) return "0001-01-01";
  if (date.getFullYear() > 9999) return "9999-12-31";
  const end = new Date(date);
  end.setMonth(end.getMonth() + 1, 0);
  date.setDate(Math.min(day, end.getDate()));
  return calendarDate(date);
}

export function clampCalendarDate(value: string, min?: string, max?: string): string {
  const lower = min?.slice(0, 10);
  const upper = max?.slice(0, 10);
  return lower && value < lower ? lower : upper && value > upper ? upper : value;
}

export function calendarDays(month: string): string[] {
  const date = parseCalendarDate(`${month.slice(0, 7)}-01`)!;
  date.setDate(1 - date.getDay());
  return Array.from({ length: 42 }, () => {
    const value = date.getFullYear() < 1 || date.getFullYear() > 9999 ? "" : calendarDate(date);
    date.setDate(date.getDate() + 1);
    return value;
  });
}

export function validCalendarValue(value: string, includeTime: boolean, min?: string, max?: string): boolean {
  if (!parseCalendarDate(value.slice(0, 10))) return false;
  if (includeTime ? !/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/.test(value) : value.length !== 10) return false;
  return !(min && value < min) && !(max && value > max);
}
