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
 * SQL-side Shanghai date derivation.
 *
 * There is no single correct expression, because the archive stores BOTH timestamp shapes and the
 * right SQL depends on which one a column is (verified against information_schema on the live
 * database, 2026-09-03):
 *
 *   timestamp WITH time zone (a real instant)
 *     raw_sources.captured_at / imported_at / created_at / updated_at / deleted_at
 *     life_events.occurred_at / created_at
 *     media_assets.taken_at / archive_verified_at / created_at
 *     organizer_runs.processed_at, profiles.created_at, media_locations.*, connector_states.*
 *
 *   timestamp WITHOUT time zone (Shanghai wall-clock digits)
 *     daily_traces.occurred_at / created_at / updated_at
 *     growth_records.observed_at, media.taken_at, content_quality_reviews.reviewed_at,
 *     organizer_jobs.*, monthly_snapshot.created_at, monthly_focus_goals.*
 *
 * The defect this replaces: `to_char(captured_at, 'YYYY-MM-DD')` was documented as the
 * authoritative Shanghai life date on the claim that captured_at was tz-naive Shanghai wall clock.
 * It is not — it is timestamptz, and Postgres renders a timestamptz through the SESSION TimeZone,
 * which on this Neon database is GMT. So that expression returned the UTC date. Measured across all
 * 8,689 WeChat messages it disagreed with the true Shanghai date on 150 of them — every message
 * sent between Shanghai 00:00 and 07:59 — and always by rolling the day BACK by one, across 34
 * distinct days in 2025-05 .. 2025-11. The stored instants themselves are correct: the importer
 * tags every WeChat sentAt with an explicit +08:00 (see lib/ingest/wechat-markdown.ts), so this is
 * purely a read-interpretation bug and no stored value needs migrating.
 *
 * Both helpers below are independent of the session TimeZone, which is what makes them safe to run
 * from a script, a test, a Vercel function or a psql prompt and get the same answer.
 */

/** For a `timestamp WITH time zone` column: convert the instant into Shanghai, then read the day. */
export function shanghaiDateSqlFromInstant(column: string): string {
  return `to_char(${column} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')`;
}

/** Month bucket ("YYYY-MM") for a `timestamp WITH time zone` column. */
export function shanghaiMonthSqlFromInstant(column: string): string {
  return `to_char(${column} AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')`;
}

/**
 * For a `timestamp WITHOUT time zone` column that already holds Shanghai wall-clock digits, the
 * digits ARE the answer and no conversion may be applied. Applying `AT TIME ZONE 'Asia/Shanghai'`
 * to such a column does the opposite of what it looks like — it reinterprets the naive value as
 * Shanghai and produces a timestamptz — so the two families must never be swapped.
 */
export function shanghaiDateSqlFromWallClock(column: string): string {
  return `to_char(${column}, 'YYYY-MM-DD')`;
}

/**
 * The activity-day equivalent of evidence/window.ts's `activityDateOf`: the same configurable
 * day-boundary hour (default 04:00), so a 23:40–00:30 exchange lands on one activity day.
 * Subtracting the boundary from the Shanghai wall clock before taking the date is exactly that
 * rule: Shanghai 03:59 falls back to the previous day, 04:00 stays.
 */
export function shanghaiActivityDateSqlFromInstant(column: string, dayBoundaryHour = 4): string {
  if (!Number.isInteger(dayBoundaryHour) || dayBoundaryHour < 0 || dayBoundaryHour > 23) {
    throw new Error(`shanghaiActivityDateSqlFromInstant: dayBoundaryHour must be an integer 0-23, got ${dayBoundaryHour}`);
  }
  return `to_char((${column} AT TIME ZONE 'Asia/Shanghai') - interval '${dayBoundaryHour} hours', 'YYYY-MM-DD')`;
}

/**
 * The authoritative Shanghai life date for a raw_sources-shaped query. Kept as a named constant
 * because holdout preflight and calibration tooling treat it as THE definition of a fixture's
 * `lifeDate`; it must stay in agreement with `shanghaiCalendarDate()` on the same row.
 */
export const SHANGHAI_LIFE_DATE_SQL = shanghaiDateSqlFromInstant("captured_at");
