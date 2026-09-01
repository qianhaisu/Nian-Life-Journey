// Calendar grouping for the timeline. One place decides which year and month a record belongs to,
// because the archive stores three different date shapes and getting this wrong silently files a
// 2025 memory under 2026:
//
//   life_events.occurred_at   timestamptz   "2025-08-11 00:00:00+00"  a calendar date at UTC midnight
//   daily_traces.occurred_at  timestamp     "2026-08-28 00:00:00"     a local wall-clock day
//   raw_sources.captured_at   timestamptz   "2026-08-31 01:25:00+00"  a real instant (WeChat sentAt)
//
// A value carrying an offset is an instant and is converted into the profile's timezone; a value
// without one is already local and is read as written. Never derive a display year from createdAt,
// importedAt or the current system year — those are 2026 for records that happened in 2025.
export const PROFILE_TIMEZONE = "Asia/Shanghai";

const HAS_OFFSET = /(?:Z|[+-]\d{2}:?\d{2})$/;
const DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

// Returns "YYYY-MM-DD" for the day this record belongs to, or undefined when the value carries no
// usable date. Undefined must be treated as undated and kept out of every year/month bucket — it is
// never a licence to guess the current year.
export function calendarDayOf(value: string | undefined | null, timeZone: string = PROFILE_TIMEZONE): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!DATE_PREFIX.test(trimmed)) return undefined;
  if (!HAS_OFFSET.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = new Date(trimmed.includes("T") ? trimmed : trimmed.replace(" ", "T"));
  if (Number.isNaN(parsed.getTime())) return trimmed.slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(parsed);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  const [year, month, day] = [get("year"), get("month"), get("day")];
  return year && month && day ? `${year}-${month}-${day}` : trimmed.slice(0, 10);
}

export function calendarYearOf(value: string | undefined | null, timeZone?: string): string | undefined {
  return calendarDayOf(value, timeZone)?.slice(0, 4);
}

export function calendarMonthOf(value: string | undefined | null, timeZone?: string): string | undefined {
  return calendarDayOf(value, timeZone)?.slice(0, 7);
}

export function dayOfMonth(value: string | undefined | null, timeZone?: string): string {
  return calendarDayOf(value, timeZone)?.slice(8, 10) ?? "";
}

const MONTH_NAMES = ["一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月", "十二月"];

// Accepts "YYYY-MM" or "MM".
export function monthLabel(month: string): string {
  const index = Number.parseInt(month.length > 2 ? month.slice(5, 7) : month, 10) - 1;
  return MONTH_NAMES[index] ?? month;
}

export type Dated = { occurredAt?: string };

// Years present in the data, newest first. Navigation is built from this — never from a hardcoded
// year — so a year appears exactly when something real happened in it.
export function availableYears(groups: Array<Array<Dated>>, timeZone?: string): string[] {
  const years = new Set<string>();
  for (const group of groups) for (const item of group) { const year = calendarYearOf(item.occurredAt, timeZone); if (year) years.add(year); }
  return [...years].sort((a, b) => b.localeCompare(a));
}

export function availableMonths(groups: Array<Array<Dated>>, year: string, timeZone?: string): string[] {
  const months = new Set<string>();
  for (const group of groups) for (const item of group) {
    const month = calendarMonthOf(item.occurredAt, timeZone);
    if (month && month.startsWith(`${year}-`)) months.add(month);
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

export function inYear<T extends Dated>(items: T[], year: string, timeZone?: string): T[] {
  return items.filter((item) => calendarYearOf(item.occurredAt, timeZone) === year);
}

export function inMonth<T extends Dated>(items: T[], month: string, timeZone?: string): T[] {
  return items.filter((item) => calendarMonthOf(item.occurredAt, timeZone) === month);
}
