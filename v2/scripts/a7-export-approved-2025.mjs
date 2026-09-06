#!/usr/bin/env node
// READ-ONLY. Dumps all 2025 approved (published) life_events plus the raw_sources text each one
// links to, so every claim in the title/story can be checked against its own evidence. Does not
// touch life_events, content_quality_reviews, or any other table.
//
//   node --import tsx -r dotenv/config scripts/a7-export-approved-2025.mjs --out=<path outside repo>.json \
//     dotenv_config_path=.env.local
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

// Approved = latest real T20-C review says 'approved' (mirrors a6's own export query pattern;
// excludes this session's own life_event_trace marker rows via provider != 'cowork-a6').
const { rows: events } = await client.query(`
  select e.id, e.title, e.story, e.story_sections, e.occurred_at, e.people, e.tags, e.event_type,
         e.memory_weight, e.source_ids, e.organizer_version,
         to_char(e.occurred_at, 'YYYY-MM') as month
  from life_events e
  join lateral (
    select decision
    from content_quality_reviews
    where target_kind = 'life_event' and target_id = e.id and provider != 'cowork-a6'
    order by reviewed_at desc
    limit 1
  ) r on true
  where e.profile_id = $1
    and e.occurred_at >= '2025-01-01' and e.occurred_at < '2026-01-01'
    and r.decision = 'approved'
  order by e.occurred_at, e.id
`, [PROFILE_ID]);

const allSourceIds = [...new Set(events.flatMap((e) => (Array.isArray(e.source_ids) ? e.source_ids : JSON.parse(e.source_ids ?? "[]"))))];

const { rows: links } = await client.query(`
  select l.life_event_id, l.raw_source_id, l.role, s.captured_at, s.text, s.source_type, s.source_label, s.media_ids
  from source_memory_links l join raw_sources s on s.id = l.raw_source_id
  where l.life_event_id = any($1::text[])
  order by s.captured_at
`, [events.map((e) => e.id)]);

await client.end();

const linksByEvent = new Map();
for (const l of links) {
  if (!linksByEvent.has(l.life_event_id)) linksByEvent.set(l.life_event_id, []);
  linksByEvent.get(l.life_event_id).push({
    role: l.role,
    capturedAt: l.captured_at,
    text: l.text,
    sourceType: l.source_type,
    sourceLabel: l.source_label,
    mediaCount: Array.isArray(l.media_ids) ? l.media_ids.length : 0,
  });
}

const byMonth = {};
for (const e of events) {
  (byMonth[e.month] ??= []).push({
    id: e.id,
    title: e.title,
    story: e.story,
    storySections: e.story_sections,
    occurredAt: e.occurred_at,
    people: e.people,
    tags: e.tags,
    eventType: e.event_type,
    memoryWeight: e.memory_weight,
    organizerVersion: e.organizer_version,
    sources: linksByEvent.get(e.id) ?? [],
  });
}

writeFileSync(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), total: events.length, byMonth }, null, 2), "utf8");
console.log(`approved 2025 life_events: ${events.length}`);
for (const m of Object.keys(byMonth).sort()) console.log(`  ${m}: ${byMonth[m].length}`);
console.log(`written to ${OUT}`);
