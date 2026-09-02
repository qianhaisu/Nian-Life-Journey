import test from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { CONTRACT_DATABASE_URL, SKIP_REASON } from "./fixtures/contract-database.mjs";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { shanghaiCalendarDate } from "../lib/organizer/life-date.ts";
import { HOLDOUT_V2_SET } from "../lib/organizer/calibration-sets-v2.ts";

// Guards Holdout V2's one property that can silently rot as data or migrations change: each frozen
// (conversation, lifeDate, anchorSourceId) still resolves to exactly one real EvidenceWindow, on the
// correct Shanghai calendar day. READ-ONLY: raw_sources SELECT only, no DeepSeek call, no Memory
// Editor, no route(), no Validator — running this test can never spend the holdout.
const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";

if (!CONTRACT_DATABASE_URL) {
  test("[postgres] Holdout V2 fixtures still resolve to one window each", { skip: SKIP_REASON }, () => {});
} else {
  test("[postgres] Holdout V2 fixtures still resolve to one window each", async () => {
    const client = new pg.Client({ connectionString: CONTRACT_DATABASE_URL, ssl: { rejectUnauthorized: false } });
    await client.connect();
    try {
      assert.equal(HOLDOUT_V2_SET.length, 19, "the frozen set must not grow or shrink silently");
      for (const tc of HOLDOUT_V2_SET) {
        const anchorRow = (await client.query(`select captured_at, to_char(captured_at,'YYYY-MM-DD') d from raw_sources where id=$1`, [tc.anchorSourceId])).rows[0];
        assert.ok(anchorRow, `${tc.id}: anchorSourceId no longer exists`);
        assert.equal(anchorRow.d, tc.lifeDate, `${tc.id}: to_char life date drifted from the frozen fixture`);
        assert.equal(shanghaiCalendarDate(anchorRow.captured_at.toISOString()), tc.lifeDate, `${tc.id}: JS-side Shanghai date disagrees with to_char`);

        const { rows } = await client.query(
          `select ${COLS} from raw_sources where source_type='wechat' and deleted_at is null
             and source_label=$1 and to_char(captured_at,'YYYY-MM-DD')=$2 order by captured_at limit 400`,
          [tc.conversation, tc.lifeDate]);
        assert.ok(rows.length > 0, `${tc.id}: no sources on the frozen life date`);

        const sources = rows.map((row) => {
          const senderDigest = String(row.metadata?.senderDigest ?? row.contributor_id);
          return { id: row.id, profileId: row.profile_id, sourceType: row.source_type, contentTypes: row.content_types, contributorId: senderDigest, capturedAt: row.captured_at.toISOString(), text: row.text ?? "", mediaIds: row.media_ids ?? [], visibility: row.visibility, metadata: row.metadata, sourceLabel: row.source_label, contributorRole: undefined };
        });
        const windows = buildEvidenceWindows(tc.conversation, "profile-zhangnian", sources, { dailyTraces: [], lifeEvents: [] });
        const matching = windows.filter((w) => w.items.some((item) => item.sourceId === tc.anchorSourceId));
        assert.equal(matching.length, 1, `${tc.id}: anchor matched ${matching.length} windows, expected exactly 1`);
      }
    } finally {
      await client.end();
    }
  });
}
