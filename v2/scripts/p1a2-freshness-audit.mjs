#!/usr/bin/env node
// READ-ONLY freshness chain: what is the newest thing at every layer, and which layer stops the
// front page from reaching today. Prints dates and counts only.
import pg from "pg";

const PROFILE_ID = "profile-zhangnian";
const client = new pg.Client({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
await client.connect();
const one = async (label, sql, params = [PROFILE_ID]) => {
  const { rows } = await client.query(sql, params);
  console.log(`${label}: ${JSON.stringify(rows[0])}`);
};

await one("latest RawSource (any)", `select max(captured_at)::text as captured, count(*)::int as n from raw_sources where profile_id=$1 and deleted_at is null`);
await one("latest by sourceType", `select source_type, max(captured_at)::text as captured, count(*)::int as n from raw_sources where profile_id=$1 and deleted_at is null group by source_type order by max(captured_at) desc limit 1`);
const { rows: types } = await client.query(`select source_type, max(captured_at)::text as captured, count(*)::int as n from raw_sources where profile_id=$1 and deleted_at is null group by source_type order by 2 desc`, [PROFILE_ID]);
for (const t of types) console.log(`  ${t.source_type}: latest=${t.captured?.slice(0, 16)} n=${t.n}`);
await one("latest wechat textual (len>=4, not msg-N)", `select max(captured_at)::text as captured from raw_sources where profile_id=$1 and deleted_at is null and source_type='wechat' and length(trim(coalesce(text,''))) >= 4 and text !~ '^msg \\d+'`);
await one("latest RawSource imported_at", `select max(imported_at)::text as imported from raw_sources where profile_id=$1 and deleted_at is null`);
await one("latest DailyTrace", `select max(occurred_at)::text as day from daily_traces where profile_id=$1`);
await one("latest LifeEvent", `select max(occurred_at)::text as day from life_events where profile_id=$1`);
await one("latest media takenAt (family-visible)", `select max(taken_at)::text as day, count(*)::int as n from media where profile_id=$1 and visibility <> 'private'`);
await one("latest deliverable media (ready hot web/thumb)", `
  select max(m.taken_at)::text as day from media m
  join media_locations l on l.media_asset_id = m.media_asset_id and l.status='ready' and l.provider='hot' and l.variant in ('web','thumbnail')
  where m.profile_id=$1 and m.visibility <> 'private'`);
await one("September anything? raw", `select count(*)::int as n from raw_sources where profile_id=$1 and deleted_at is null and captured_at >= '2026-09-01'`);
await one("September media", `select count(*)::int as n from media where profile_id=$1 and taken_at >= '2026-09-01'`);
await one("September traces/events", `select (select count(*) from daily_traces where profile_id=$1 and occurred_at >= '2026-09-01')::int as traces, (select count(*) from life_events where profile_id=$1 and occurred_at >= '2026-09-01')::int as events`);
// connector state: when did ingestion last run at all?
const { rows: conn } = await client.query(`select provider, status, last_successful_sync::text, last_attempt_at::text, last_keyword from connector_states where profile_id=$1`, [PROFILE_ID]);
for (const c of conn) console.log(`connector ${c.provider}: status=${c.status} lastSync=${c.last_successful_sync?.slice(0, 16)} lastAttempt=${c.last_attempt_at?.slice(0, 16)}`);
const { rows: tasks } = await client.query(`select status, phase, completed_at::text from chat_import_tasks where profile_id=$1 order by created_at desc limit 3`, [PROFILE_ID]);
for (const t of tasks) console.log(`chat_import_task: ${t.status}/${t.phase} completed=${t.completed_at?.slice(0, 16)}`);
await client.end();
console.log("DONE (read-only).");
