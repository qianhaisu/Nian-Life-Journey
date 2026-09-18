// Formatting a time for a family that lives in Shanghai.
//
// The archive holds two different things that both look like a time, and they must not be
// formatted the same way:
//
//   - a real instant, stored as `timestamptz` — `raw_sources.captured_at`, `life_events.occurred_at`,
//     `media_assets.taken_at`. Postgres keeps these in UTC; what a reader should see is that instant
//     rendered in Asia/Shanghai.
//   - a wall clock with no zone, stored as plain `timestamp` — `media.taken_at`. Its digits ARE the
//     Shanghai wall clock already (lib/timeline-dates.ts wallClockOf wrote them that way). Sending
//     them through a timezone conversion moves them; adding eight hours moves them twice.
//
// So: convert the first kind, read the second kind at face value. Never add eight hours by hand —
// that is how 6,738 media rows ended up eight hours early, and it is also what the old
// EvidenceList did in reverse, formatting a real instant with no `timeZone` at all so a Vercel
// server in UTC printed 02:00 for a message sent at 10:00.

export const PROFILE_TIME_ZONE = "Asia/Shanghai";

const clock = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit", minute: "2-digit", hour12: false, timeZone: PROFILE_TIME_ZONE,
});
const dayStamp = new Intl.DateTimeFormat("en-CA", {
  year: "numeric", month: "2-digit", day: "2-digit", timeZone: PROFILE_TIME_ZONE,
});

/** HH:MM in Shanghai for a real instant (a timestamptz value). */
export function shanghaiClock(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return "";
  return clock.format(at);
}

/**
 * The Shanghai calendar day (YYYY-MM-DD) a real instant falls on.
 *
 * This is the one that decides whether a message belongs to 9 月 13 日 or 9 月 14 日, and it is the
 * case the old code could not get right: 2026-09-13T16:30:00Z is 00:30 on the 14th in Shanghai, so
 * a UTC-based date would file it under the wrong day AND print the wrong hour.
 */
export function shanghaiDay(instant: string): string {
  const at = new Date(instant);
  if (Number.isNaN(at.getTime())) return "";
  return dayStamp.format(at);
}

/**
 * HH:MM from a zone-less wall clock that is already Shanghai local ("2026-09-13 23:45:00").
 * Read, not converted — passing this through a timezone would move it.
 */
export function wallClockTime(value: string): string {
  const match = /\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/.exec(value);
  return match ? `${match[1]}:${match[2]}` : "";
}
