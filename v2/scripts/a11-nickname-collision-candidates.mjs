#!/usr/bin/env node
// READ-ONLY. A-11 phase 1: scans life_events (approved + store_only) for the same failure mode
// that produced the 2025-10-01 cat-vet misjudgment — a generic nickname (崽崽/崽/宝宝/宝贝, which
// namesSubject() in lib/organizer/subject-gate.ts treats as naming 张年) appearing WITHOUT any of
// his specific names, alongside a pet/third-party signal keyword. Does not touch any table.
//
//   node --import tsx -r dotenv/config scripts/a11-nickname-collision-candidates.mjs \
//     --out=<path outside repo>.json dotenv_config_path=.env.local
import { writeFileSync } from "node:fs";
import { resolve, sep } from "node:path";
import pg from "pg";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);
const PROFILE_ID = "profile-zhangnian";
const REPO_ROOT = resolve(import.meta.dirname, "..", "..");
if (!OUT) { console.error("--out required"); process.exit(1); }
if (resolve(OUT) === REPO_ROOT || resolve(OUT).startsWith(REPO_ROOT + sep)) {
  console.error("--out must point outside the repository (the JSON carries real family text)."); process.exit(1);
}

const dbUrl = process.env.CONTRACT_DATABASE_URL || process.env.DATABASE_URL;
if (!dbUrl) { console.error("Need DATABASE_URL."); process.exit(1); }
const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();

// Mirrors lib/organizer/subject-gate.ts's SUBJECT_NAMES split into "specific" (uniquely him) and
// "generic" (shared with pets/other people/other babies — the actual risk).
const SPECIFIC_NAMES = ["张年", "张小年", "小年年", "小年", "年年"];
const GENERIC_NAMES = ["崽崽", "崽", "宝宝", "宝贝"];
// Signals that the sentence may be about someone/something else: pets, forwarded/third-party
// content, or another family's child.
const RISK_KEYWORDS = ["猫", "狗", "宠物", "兽医", "体检", "疫苗", "转发", "分享", "截图", "同事", "朋友", "别人家", "邻居"];

const nameOr = (names) => names.map((n) => `(coalesce(e.title,'') || ' ' || coalesce(e.story,'')) like '%${n}%'`).join(" or ");
const keywordOr = (words) => words.map((w) => `(coalesce(e.title,'') || ' ' || coalesce(e.story,'')) like '%${w}%'`).join(" or ");

const { rows } = await client.query(`
  select e.id, e.title, e.story, e.occurred_at, to_char(e.occurred_at, 'YYYY-MM') as month,
         r.decision
  from life_events e
  join lateral (
    select decision
    from content_quality_reviews
    where target_kind = 'life_event' and target_id = e.id and provider != 'cowork-a6'
    order by reviewed_at desc
    limit 1
  ) r on true
  where e.profile_id = $1
    and r.decision in ('approved', 'store_only')
    and (${nameOr(GENERIC_NAMES)})
    and not (${nameOr(SPECIFIC_NAMES)})
    and (${keywordOr(RISK_KEYWORDS)})
  order by e.occurred_at, e.id
`, [PROFILE_ID]);

await client.end();

writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date().toISOString(),
  total: rows.length,
  candidates: rows.map((r) => ({ id: r.id, title: r.title, story: r.story, month: r.month, decision: r.decision })),
}, null, 2), "utf8");

console.log(`candidates found: ${rows.length}`);
const byDecision = {};
for (const r of rows) byDecision[r.decision] = (byDecision[r.decision] ?? 0) + 1;
console.log("by decision:", byDecision);
console.log(`written to ${OUT}`);
