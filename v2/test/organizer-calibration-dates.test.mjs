import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";
import { SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";

// Every calibration and holdout day must equal the Shanghai day its evidence actually falls on.
//
// This exists because Holdout 1 was wrong for months and nothing could tell. Its cases are
// identified by a date and (mostly) an anchor TEXT, with no anchorSourceId, so no check ever
// compared the recorded day against a real row. Every one of its days was a day early — built by the
// local-Date + .toISOString() route that life-date.ts was written to replace.
//
// The consequence was not cosmetic. These days are how "already spent" is excluded when a fresh
// corpus is drawn, so while they were wrong, exclusion removed an unrelated day and left the real
// spent day in the pool.
//
// DEVELOPMENT_SET and HOLDOUT_V2_SET were never wrong, and the reason is the whole lesson: they
// carry an anchorSourceId, so their day was always checkable against the row it came from.

const shifted = (day, days) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return days.includes(d.toISOString().slice(0, 10));
};

test("every holdout case is anchored to something checkable, not to a bare date", () => {
  for (const c of HOLDOUT_SET) {
    assert.ok(c.anchor || c.dayCorrectionBasis === "same_build_inferred",
      `${c.id}: a case with neither an anchor text nor a recorded correction basis cannot be verified`);
    assert.ok(c.dayAsOriginallyRecorded, `${c.id}: the pre-correction day must be preserved for audit`);
    assert.notEqual(c.day, c.dayAsOriginallyRecorded, `${c.id}: correction recorded but day unchanged`);
  }
  for (const c of DEVELOPMENT_SET) assert.ok(c.anchorSourceId, `${c.id}: development cases must carry an anchorSourceId`);
  for (const c of HOLDOUT_V2_SET) assert.ok(c.anchorSourceId, `${c.id}: Holdout V2 cases must carry an anchorSourceId`);
});

if (!CONTRACT_DATABASE_URL) {
  test("[postgres] calibration days match their evidence", { skip: SKIP_REASON }, () => {});
} else {
  test("[postgres] every anchorSourceId-bearing case sits on the day it records", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const [setName, set, dayKey] of [["DEVELOPMENT_SET", DEVELOPMENT_SET, "day"], ["HOLDOUT_V2_SET", HOLDOUT_V2_SET, "lifeDate"]]) {
        for (const c of set) {
          if (!c.anchorSourceId) continue;
          const { rows } = await client.query(
            `select ${SHANGHAI_LIFE_DATE_SQL} as d from raw_sources where id = $1`, [c.anchorSourceId]);
          assert.ok(rows[0], `${setName} ${c.id}: anchorSourceId no longer exists`);
          assert.equal(rows[0].d, c[dayKey], `${setName} ${c.id}: recorded day disagrees with the anchor's real Shanghai day`);
        }
      }
    } finally { await client.end(); }
  });

  test("[postgres] Holdout 1's corrected days are the days its anchor text really falls on", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      let verified = 0;
      for (const c of HOLDOUT_SET) {
        if (!c.anchor) continue;
        const { rows } = await client.query(
          `select distinct ${SHANGHAI_LIFE_DATE_SQL} as d from raw_sources
            where source_type='wechat' and deleted_at is null and text like $1`, [`%${c.anchor}%`]);
        const days = rows.map((r) => r.d);
        assert.ok(days.includes(c.day),
          `${c.id}: corrected day ${c.day} is not a day its anchor text occurs on (occurs on ${days.join(",") || "nothing"})`);
        assert.ok(!days.includes(c.dayAsOriginallyRecorded) || c.day === c.dayAsOriginallyRecorded,
          `${c.id}: the ORIGINAL day ${c.dayAsOriginallyRecorded} also matches — the correction may be wrong`);
        verified += 1;
      }
      assert.equal(verified, 7, "the 7 anchor-bearing Holdout 1 cases must all be verified");
    } finally { await client.end(); }
  });

  // Pins the defect itself, so a future rebuild that reintroduces the old date route fails here.
  test("[postgres] the original Holdout 1 days were uniformly one day early", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      for (const c of HOLDOUT_SET) {
        if (!c.anchor) continue;
        const { rows } = await client.query(
          `select distinct ${SHANGHAI_LIFE_DATE_SQL} as d from raw_sources
            where source_type='wechat' and deleted_at is null and text like $1`, [`%${c.anchor}%`]);
        assert.ok(shifted(c.dayAsOriginallyRecorded, rows.map((r) => r.d)),
          `${c.id}: the recorded correction should be exactly +1 day from the original`);
      }
    } finally { await client.end(); }
  });
}
