import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";
import {
  shanghaiCalendarDate,
  shanghaiDateSqlFromInstant,
  shanghaiMonthSqlFromInstant,
  shanghaiDateSqlFromWallClock,
  shanghaiActivityDateSqlFromInstant,
  SHANGHAI_LIFE_DATE_SQL,
} from "../lib/organizer/life-date.ts";
import { activityDateOf } from "../lib/organizer/evidence/window.ts";
import { calendarDayOf } from "../lib/timeline-dates.ts";

// Time Truth. Nianlife's life time is Asia/Shanghai calendar semantics derived from the real
// captured instant. The clock list below is the required coverage: it brackets both boundaries that
// can silently move a day — the UTC offset (Shanghai 00:00-07:59 renders as the PREVIOUS UTC day)
// and the 04:00 activity-day boundary.
const CLOCKS = ["00:30", "03:59", "04:00", "04:01", "15:59", "16:00", "19:59", "20:00", "23:30", "23:59"];
const DAY = "2025-10-17";

// Shanghai wall clock -> the UTC instant that same moment is.
function instantOf(day, hhmm) { return new Date(`${day}T${hhmm}:00+08:00`).toISOString(); }

test("calendar life date is the Shanghai day for every required clock, never shifted by a UTC round trip", () => {
  for (const hhmm of CLOCKS) {
    const iso = instantOf(DAY, hhmm);
    assert.equal(shanghaiCalendarDate(iso), DAY, `${hhmm} Shanghai must stay on ${DAY} (instant ${iso})`);
  }
});

test("the 04:00 activity-day boundary folds only the hours before it onto the previous day", () => {
  const expected = {
    "00:30": "2025-10-16", "03:59": "2025-10-16",
    "04:00": "2025-10-17", "04:01": "2025-10-17", "15:59": "2025-10-17", "16:00": "2025-10-17",
    "19:59": "2025-10-17", "20:00": "2025-10-17", "23:30": "2025-10-17", "23:59": "2025-10-17",
  };
  for (const hhmm of CLOCKS) {
    assert.equal(activityDateOf(instantOf(DAY, hhmm), "Asia/Shanghai"), expected[hhmm], `${hhmm} activity day`);
  }
});

// The exact trap: a Shanghai instant formatted as a UTC wall clock. 2025-10-17 21:59:13 +08:00 is
// 13:59:13Z — same day. But 2025-10-18 03:00 +08:00 is 2025-10-17 19:00Z — the PREVIOUS UTC day,
// which is the direction the production defect actually ran (150/8,689 messages, always -1 day).
test("regression: a UTC-rendered day is NOT the Shanghai day for 00:00-07:59, and that is the real defect direction", () => {
  const early = instantOf("2025-10-18", "03:00");
  assert.equal(early.slice(0, 10), "2025-10-17", "the instant really does fall on the previous UTC day");
  assert.equal(shanghaiCalendarDate(early), "2025-10-18", "the Shanghai life date must still be the 18th");

  const evening = instantOf("2025-10-17", "21:59");
  assert.equal(evening.slice(0, 10), "2025-10-17", "an evening Shanghai message shares its UTC day");
  assert.equal(shanghaiCalendarDate(evening), "2025-10-17");
});

test("calendarDayOf reads an offset-bearing value as an instant and an offset-free value as written", () => {
  assert.equal(calendarDayOf("2025-10-17T19:00:00+00:00"), "2025-10-18", "timestamptz string is converted into Shanghai");
  assert.equal(calendarDayOf("2025-10-17 19:00:00"), "2025-10-17", "tz-naive wall clock is read as written, never converted");
});

test("the SQL builders emit timezone-explicit expressions and reject a bad boundary hour", () => {
  assert.equal(shanghaiDateSqlFromInstant("captured_at"), "to_char(captured_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM-DD')");
  assert.equal(shanghaiMonthSqlFromInstant("captured_at"), "to_char(captured_at AT TIME ZONE 'Asia/Shanghai', 'YYYY-MM')");
  assert.equal(shanghaiDateSqlFromWallClock("occurred_at"), "to_char(occurred_at, 'YYYY-MM-DD')");
  assert.match(shanghaiActivityDateSqlFromInstant("captured_at"), /interval '4 hours'/);
  assert.equal(SHANGHAI_LIFE_DATE_SQL, shanghaiDateSqlFromInstant("captured_at"));
  assert.throws(() => shanghaiActivityDateSqlFromInstant("captured_at", 24), /integer 0-23/);
  assert.throws(() => shanghaiActivityDateSqlFromInstant("captured_at", 1.5), /integer 0-23/);
});

// Everything above is deterministic. The checks below need the real database, because the whole
// defect was a mismatch between what the code BELIEVED a column was and what it actually is.
if (!CONTRACT_DATABASE_URL) {
  test("[postgres] SQL date truth agrees with JS date truth", { skip: SKIP_REASON }, () => {});
} else {
  test("[postgres] the audited columns still have the storage semantics the helpers assume", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const { rows } = await client.query(`
        select table_name, column_name, data_type from information_schema.columns
        where table_schema='public' and (data_type like 'timestamp%')`);
      const type = (t, c) => rows.find((r) => r.table_name === t && r.column_name === c)?.data_type;

      // If either of these ever flips, the helper chosen at the call site becomes the wrong one and
      // days move silently. Fail loudly here instead.
      assert.equal(type("raw_sources", "captured_at"), "timestamp with time zone",
        "raw_sources.captured_at must stay timestamptz — shanghaiDateSqlFromInstant depends on it");
      assert.equal(type("daily_traces", "occurred_at"), "timestamp without time zone",
        "daily_traces.occurred_at must stay tz-naive Shanghai wall clock — it must NOT be converted");
      assert.equal(type("life_events", "occurred_at"), "timestamp with time zone");
    } finally { await client.end(); }
  });

  test("[postgres] authoritative SQL life date equals JS life date for every WeChat message", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const { rows } = await client.query(
        `select captured_at, ${SHANGHAI_LIFE_DATE_SQL} as sql_life,
                ${shanghaiActivityDateSqlFromInstant("captured_at")} as sql_activity
         from raw_sources where source_type='wechat' and deleted_at is null`);
      assert.ok(rows.length > 8000, `expected the full corpus, got ${rows.length}`);

      let checked = 0;
      for (const row of rows) {
        const iso = row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at);
        assert.equal(row.sql_life, shanghaiCalendarDate(iso), `SQL life date disagrees with JS for instant ${iso}`);
        assert.equal(row.sql_activity, activityDateOf(iso, "Asia/Shanghai"), `SQL activity date disagrees with activityDateOf for instant ${iso}`);
        checked += 1;
      }
      assert.equal(checked, rows.length);
    } finally { await client.end(); }
  });

  // Pins the measured blast radius of the old expression so the fix cannot be quietly reverted.
  test("[postgres] the OLD bare to_char expression is still demonstrably wrong, in one direction only", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      const { rows } = await client.query(`
        select count(*)::int as differing,
               count(*) filter (where to_char(captured_at,'YYYY-MM-DD') > ${SHANGHAI_LIFE_DATE_SQL})::int as ahead,
               min(to_char(captured_at at time zone 'Asia/Shanghai','HH24'))::int as min_hour,
               max(to_char(captured_at at time zone 'Asia/Shanghai','HH24'))::int as max_hour
        from raw_sources
        where source_type='wechat' and deleted_at is null
          and to_char(captured_at,'YYYY-MM-DD') <> ${SHANGHAI_LIFE_DATE_SQL}`);
      const r = rows[0];
      assert.ok(r.differing > 0, "the old expression must still be observably wrong, or this test has lost its subject");
      assert.equal(r.ahead, 0, "every disagreement must be the old expression rolling the day BACK, never forward");
      assert.ok(r.min_hour >= 0 && r.max_hour < 8,
        `disagreements must be confined to Shanghai 00:00-07:59, saw ${r.min_hour}..${r.max_hour}`);
    } finally { await client.end(); }
  });
}
