// Shanghai life-date derivation — the one safe way to turn a moment into a calendar day for
// Nianlife's archive, for anything that isn't already inside the Evidence Builder.
//
// Time Truth requires Asia/Shanghai wall-clock semantics from the real captured moment. importedAt
// / createdAt must never substitute for it, and the day must never be derived by round-tripping a
// value through JS `Date` + `.toISOString()` — that reinterprets local midnight as UTC and can
// silently roll the calendar day back one, wherever the host process's default timezone sits ahead
// of UTC. That exact defect invalidated the first Holdout V2 attempt: candidate days were pulled
// from `captured_at::date` (a Postgres DATE), which `pg`'s default type parser turns into a JS Date
// built from LOCAL machine-timezone components; formatting that back out with `.toISOString()`
// silently rolled every date back by one. `activityDateOf` in evidence/window.ts was never affected
// — it formats straight from the real instant via `Intl.DateTimeFormat` and never touches a
// database DATE value — but nothing enforced that same care in ad hoc fixture-construction code, so
// this module exists to be the one shared, tested implementation for that use case.
//
// This is deliberately NOT `activityDateOf`: that function additionally applies a business rule (a
// configurable day-boundary hour, default 04:00, so a 23:40–00:30 exchange lands on one activity
// day). This module answers a narrower question — "what Shanghai calendar date does this instant
// fall on" — with no business-rule shift, which is what a fixture's frozen `lifeDate` field means.
export function shanghaiCalendarDate(instant: string | Date): string {
  const date = typeof instant === "string" ? new Date(instant) : instant;
  if (Number.isNaN(date.getTime())) throw new Error(`shanghaiCalendarDate: not a valid instant: ${String(instant)}`);
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * The SQL-side equivalent for querying a raw_sources-shaped table whose `captured_at` column is
 * TIMESTAMP WITHOUT TIME ZONE storing the literal Shanghai wall-clock digits (which is how the
 * WeChat importer writes it — see lib/ingest/wechat-markdown.ts). `to_char` on such a column is a
 * plain textual formatting of the stored digits: Postgres applies no timezone conversion to a
 * tz-naive column, so this is authoritative and requires no JS-side date arithmetic at all.
 *
 * Never use `captured_at::date` and then read the result back into JS: a DATE value round-tripped
 * through `pg`'s default type parser is exactly the trap this module exists to avoid. Select
 * `to_char(captured_at, 'YYYY-MM-DD') as life_date` as a plain string column instead.
 */
export const SHANGHAI_LIFE_DATE_SQL = `to_char(captured_at, 'YYYY-MM-DD')`;
