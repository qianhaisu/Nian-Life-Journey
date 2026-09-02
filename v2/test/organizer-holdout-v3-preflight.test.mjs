import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import pg from "pg";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { shanghaiCalendarDate, SHANGHAI_LIFE_DATE_SQL } from "../lib/organizer/life-date.ts";
import { HOLDOUT_V3_SET } from "../lib/organizer/calibration-sets-v3.ts";
import { DEVELOPMENT_SET, HOLDOUT_SET } from "../lib/organizer/calibration-sets.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";

// Holdout V3 preflight. ZERO model calls: raw_sources SELECT plus the real Evidence Builder, no
// Memory Editor, no route(), no Validator. Running this can never spend the holdout.
//
// It must be 100% green before the one-shot run, and it checks the things that were actually wrong
// before: that a case's authoritative Shanghai date agrees with the application's, that its anchor
// exists and resolves to exactly ONE window, that the window's membership has not drifted, and that
// nothing here overlaps material already spent.
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const PROFILE_ID = "profile-zhangnian";

const fingerprintOf = (w) => createHash("sha256")
  .update(`${w.conversationId}|${w.activityDate}|${w.items.map((i) => i.sourceId).slice().sort().join(",")}`)
  .digest("hex").slice(0, 32);

test("the frozen set has the composition it claims, and every case is fully anchored", () => {
  assert.equal(HOLDOUT_V3_SET.length, 15, "the frozen set must not grow or shrink silently");
  const by = (cls) => HOLDOUT_V3_SET.filter((c) => c.frozenLabel === cls).length;
  assert.equal(by("positive"), 2);
  assert.equal(by("borderline"), 6);
  assert.equal(by("negative"), 7);

  const ids = new Set();
  for (const c of HOLDOUT_V3_SET) {
    assert.ok(!ids.has(c.id), `duplicate case id ${c.id}`);
    ids.add(c.id);
    assert.match(c.anchorSourceId, /^wechat-message:canonical:[0-9a-f]{64}$/, `${c.id}: anchorSourceId must be a real canonical id`);
    assert.match(c.windowFingerprint, /^[0-9a-f]{32}$/, `${c.id}: windowFingerprint must be recorded`);
    assert.match(c.lifeDate, /^\d{4}-\d{2}-\d{2}$/, `${c.id}: lifeDate must be a calendar day`);
    assert.ok(c.rationale.length > 40, `${c.id}: a frozen label needs a real rationale`);
  }
});

test("no Holdout V3 case reuses material already spent", () => {
  const spentDays = new Set();
  for (const c of DEVELOPMENT_SET) spentDays.add(`${c.conversation}|${c.day}`);
  for (const c of HOLDOUT_V2_SET) spentDays.add(`${c.conversation}|${c.lifeDate}`);
  const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";
  for (const c of HOLDOUT_SET) {
    spentDays.add(`${MAIN}|${c.day}`);
    spentDays.add(`${MAIN}|${c.dayAsOriginallyRecorded}`);
  }
  const spentAnchors = new Set([
    ...DEVELOPMENT_SET.map((c) => c.anchorSourceId),
    ...HOLDOUT_V2_SET.map((c) => c.anchorSourceId),
  ].filter(Boolean));

  for (const c of HOLDOUT_V3_SET) {
    assert.ok(!spentDays.has(`${c.conversation}|${c.lifeDate}`), `${c.id}: ${c.lifeDate} is an already-spent day`);
    assert.ok(!spentAnchors.has(c.anchorSourceId), `${c.id}: anchor is already spent`);
  }
});

if (!CONTRACT_DATABASE_URL) {
  test("[postgres] Holdout V3 preflight", { skip: SKIP_REASON }, () => {});
} else {
  test("[postgres] every case: date agrees, anchor exists, exactly one window, fingerprint intact", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false }, keepAlive: true });
    await client.connect();
    try {
      // One load per conversation, reused across cases.
      const byConversation = new Map();
      for (const conversation of new Set(HOLDOUT_V3_SET.map((c) => c.conversation))) {
        const rows = [];
        const PAGE = 1000;
        for (let offset = 0; ; offset += PAGE) {
          const page = await client.query(
            `select ${COLS} from raw_sources
              where source_type='wechat' and deleted_at is null and profile_id=$1 and source_label=$2
              order by captured_at, id limit ${PAGE} offset ${offset}`, [PROFILE_ID, conversation]);
          rows.push(...page.rows);
          if (page.rows.length < PAGE) break;
        }
        const sources = rows.map((row) => ({
          id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types,
          contributorId: String(row.metadata?.senderDigest ?? row.contributor_id),
          capturedAt: row.captured_at instanceof Date ? row.captured_at.toISOString() : String(row.captured_at),
          text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility,
          metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined,
        }));
        byConversation.set(conversation, buildEvidenceWindows(conversation, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] }));
      }

      let valid = 0;
      for (const c of HOLDOUT_V3_SET) {
        // 1. The anchor exists, and SQL's authoritative Shanghai day matches the frozen lifeDate.
        const { rows } = await client.query(
          `select captured_at, ${SHANGHAI_LIFE_DATE_SQL} as d from raw_sources where id = $1`, [c.anchorSourceId]);
        assert.ok(rows[0], `${c.id}: anchorSourceId does not exist`);
        assert.equal(rows[0].d, c.lifeDate, `${c.id}: authoritative SQL date disagrees with the frozen lifeDate`);

        // 2. The application's own derivation agrees with SQL — the two must never diverge.
        const iso = rows[0].captured_at instanceof Date ? rows[0].captured_at.toISOString() : String(rows[0].captured_at);
        assert.equal(shanghaiCalendarDate(iso), c.lifeDate, `${c.id}: application date disagrees with SQL`);

        // 3. The anchor resolves to exactly one EvidenceWindow. Not zero, not two.
        const matching = byConversation.get(c.conversation).filter((w) => w.items.some((i) => i.sourceId === c.anchorSourceId));
        assert.equal(matching.length, 1, `${c.id}: anchor matched ${matching.length} windows, expected exactly 1`);

        // 4. Window membership has not drifted since freezing.
        assert.equal(fingerprintOf(matching[0]), c.windowFingerprint, `${c.id}: window membership changed since the fixture was frozen`);

        // 5. The window really sits on the frozen day.
        assert.equal(shanghaiCalendarDate(matching[0].timeRange.from), c.lifeDate, `${c.id}: window lifeDate disagrees with the fixture`);
        assert.ok(matching[0].stats.messageCount >= 3, `${c.id}: window is too small to exercise a judgement`);
        valid += 1;
      }
      assert.equal(valid, HOLDOUT_V3_SET.length, "every case must be VALID — 0 invalid, 0 ambiguous, 0 date mismatch");
    } finally { await client.end(); }
  });
}
