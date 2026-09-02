#!/usr/bin/env node
// Resolve an anchor (source id, or a literal text to search for) to the EvidenceWindow that
// contains it. READ-ONLY, zero model calls.
//
// This is how a holdout case is anchored properly: by a real source id and the window it actually
// falls in, never by a date typed from memory. Holdout 1 was identified by dates alone and every
// one of them was a day wrong for months, with nothing able to notice — see calibration-sets.ts.
import pg from "pg";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { SHANGHAI_LIFE_DATE_SQL, shanghaiCalendarDate } from "../lib/organizer/life-date.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const TEXT = argOf("text", null);
const SOURCE = argOf("source", null);
const PROFILE_ID = argOf("profile", "profile-zhangnian");
const SHOW = Number(argOf("show", "0"));
if (!TEXT && !SOURCE) { console.error("--text=<literal> or --source=<sourceId> required"); process.exit(1); }

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Set CONTRACT_DATABASE_URL or DATABASE_URL."); process.exit(1); }

const COLS = "id, profile_id, source_type, content_types, contributor_id, captured_at, text, media_ids, source_label, visibility, metadata";
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false }, keepAlive: true });
await client.connect();

const targets = SOURCE
  ? (await client.query(`select id, source_label, ${SHANGHAI_LIFE_DATE_SQL} d from raw_sources where id=$1`, [SOURCE])).rows
  : (await client.query(
      `select id, source_label, ${SHANGHAI_LIFE_DATE_SQL} d from raw_sources
        where source_type='wechat' and deleted_at is null and text like $1 order by captured_at`, [`%${TEXT}%`])).rows;

if (!targets.length) { console.error("no matching source"); await client.end(); process.exit(1); }
console.log(`${targets.length} matching source(s).`);

for (const target of targets) {
  const PAGE = 1000;
  const rows = [];
  for (let offset = 0; ; offset += PAGE) {
    const page = await client.query(
      `select ${COLS} from raw_sources
        where source_type='wechat' and deleted_at is null and profile_id=$1 and source_label=$2
        order by captured_at, id limit ${PAGE} offset ${offset}`, [PROFILE_ID, target.source_label]);
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
  const windows = buildEvidenceWindows(target.source_label, PROFILE_ID, sources, { dailyTraces: [], lifeEvents: [] });
  const matching = windows.filter((w) => w.items.some((i) => i.sourceId === target.id));

  console.log(`\n=== ${target.id}`);
  console.log(`    conversation=${target.source_label}  lifeDate=${target.d}  windows matched=${matching.length}`);
  for (const w of matching) {
    console.log(`    windowId=${w.windowId}`);
    console.log(`    activityDate=${w.activityDate}  lifeDate(window)=${shanghaiCalendarDate(w.timeRange.from)}`);
    console.log(`    n=${w.stats.messageCount} img=${w.stats.imageCount} senders=${w.stats.senderCount}`);
    console.log(`    anchorSourceId(first item)=${w.items[0].sourceId}`);
    if (SHOW) for (const i of w.items.slice(0, SHOW)) {
      const t = i.text.replace(/\s+/g, " ").trim();
      if (t) console.log(`      [${i.senderDigest.slice(0, 8)}] ${t.slice(0, 140)}`);
    }
  }
}
await client.end();
