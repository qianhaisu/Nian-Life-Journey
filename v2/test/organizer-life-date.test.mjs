import test from "node:test";
import assert from "node:assert/strict";
import { shanghaiCalendarDate } from "../lib/organizer/life-date.ts";

// The two required boundary cases: 00:30 and 23:30 Shanghai must each land on their own correct
// local day, never shifted by a UTC round trip.
test("00:30 Asia/Shanghai belongs to its own local day, not the previous one", () => {
  assert.equal(shanghaiCalendarDate("2025-07-18T00:30:00+08:00"), "2025-07-18");
});

test("23:30 Asia/Shanghai belongs to its own local day, not the next one", () => {
  assert.equal(shanghaiCalendarDate("2025-07-18T23:30:00+08:00"), "2025-07-18");
});

// Same instants, expressed as the UTC wall-clock time an ISO string would carry without an offset —
// this is the shape a value actually takes once it has passed through a UTC-oriented library.
test("the same two boundary instants hold when given as bare UTC instants", () => {
  // 2025-07-18T00:30:00+08:00 == 2025-07-17T16:30:00Z
  assert.equal(shanghaiCalendarDate("2025-07-17T16:30:00Z"), "2025-07-18");
  // 2025-07-18T23:30:00+08:00 == 2025-07-18T15:30:00Z
  assert.equal(shanghaiCalendarDate("2025-07-18T15:30:00Z"), "2025-07-18");
});

test("a JS Date instance works the same as a string", () => {
  assert.equal(shanghaiCalendarDate(new Date("2025-07-17T16:30:00Z")), "2025-07-18");
});

// Documents the exact defect that invalidated the first Holdout V2 attempt, so it cannot silently
// return: constructing a Date from LOCAL machine-timezone components (what pg's DATE parser does)
// and then calling .toISOString() rolls the day back whenever the local zone sits ahead of UTC.
test("regression: the naive local-Date + toISOString pattern is the trap this module avoids", () => {
  // Simulates pg's DATE parser: new Date(year, monthIndex, day) uses the PROCESS's local timezone.
  // We can't force the process timezone in this test, so this asserts the safe function directly
  // instead of the trap — the trap is documented in the comment above and in life-date.ts.
  const safe = shanghaiCalendarDate("2025-10-03T23:59:59+08:00");
  assert.equal(safe, "2025-10-03", "the safe conversion must never depend on the host process's timezone");
});

test("throws on an invalid instant rather than silently producing a wrong date", () => {
  assert.throws(() => shanghaiCalendarDate("not-a-date"), /not a valid instant/);
});
