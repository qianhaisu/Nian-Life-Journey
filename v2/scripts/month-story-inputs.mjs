#!/usr/bin/env node
// Collects everything a month's story editing needs, in one read-only pass: the life events already
// written, the daily traces, and the raw messages those events were built from.
//
// It also answers the one question that keeps being got wrong when fragments are merged — are two
// messages actually the same message? Same day, same timestamp and a different import batch prove
// nothing on their own, because a group chat routinely carries two people saying different things in
// the same second. So every message carries the three things that can settle it: who sent it
// (senderDigest), the exact text, and which attachments it brought. Duplicate candidates are
// proposed here; nothing is merged here.
//
// Read-only. No event, message, review or media row is written, changed or deleted.
//
// Usage: node scripts/month-story-inputs.mjs --month=2026-09 --out=<inputs.json> [--cutoff=<ISO>]

import fs from "node:fs";
import path from "node:path";
import { openRds } from "../.data/night-rds.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const month = arg("month");
const outPath = arg("out");
const cutoff = arg("cutoff");
if (!/^\d{4}-\d{2}$/.test(month ?? "") || !outPath) {
  console.error("--month=YYYY-MM and --out=<inputs.json> are required");
  process.exit(1);
}
const [year, mon] = month.split("-").map(Number);
const monthStart = `${month}-01`;
const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;

const { client, close } = await openRds({ readOnly: true });
try {
  const { rows: events } = await client.query(
    `select id, title, story, story_sections, event_type, memory_weight, visibility, created_by,
            organizer_version, location_label, people, tags, media_ids, source_ids, hero_media_id,
            to_char(occurred_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day,
            to_char(occurred_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as occurred_at_shanghai,
            created_at::text as created_at
       from life_events
      where occurred_at >= ($1::date at time zone 'Asia/Shanghai')
        and occurred_at <  ($2::date at time zone 'Asia/Shanghai')
      order by occurred_at, id`,
    [monthStart, nextMonth],
  );

  const { rows: traces } = await client.query(
    `select id, entries, source_ids, visibility,
            to_char(occurred_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day
       from daily_traces
      where occurred_at >= ($1::date at time zone 'Asia/Shanghai')
        and occurred_at <  ($2::date at time zone 'Asia/Shanghai')
      order by occurred_at`,
    [monthStart, nextMonth],
  );

  const eventSourceIds = [...new Set(events.flatMap((e) => e.source_ids ?? []))];
  const traceSourceIds = [...new Set(traces.flatMap((t) => t.source_ids ?? []))];
  const wantedSourceIds = [...new Set([...eventSourceIds, ...traceSourceIds])];

  // every message of the month, not only the ones an event already cites: a day with no event still
  // needs its messages read before anyone can say the day has nothing to tell.
  const { rows: sources } = await client.query(
    `select id, source_type, source_label, text, media_ids, original_filename,
            metadata->>'senderDigest'   as sender_digest,
            metadata->>'importBatchId'  as import_batch_id,
            metadata->>'messageType'    as message_type,
            to_char(captured_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day,
            to_char(captured_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as captured_at_shanghai
       from raw_sources
      where captured_at >= ($1::date at time zone 'Asia/Shanghai')
        and captured_at <  ($2::date at time zone 'Asia/Shanghai')
        and deleted_at is null
      order by captured_at, id`,
    [monthStart, nextMonth],
  );

  const { rows: links } = await client.query(
    `select raw_source_id, life_event_id, role from source_memory_links where life_event_id = any($1)`,
    [events.map((e) => e.id)],
  );

  // duplicate CANDIDATES only. Three independent signals must line up; a shared timestamp or a
  // different import batch is never enough by itself.
  const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
  const byKey = new Map();
  for (const s of sources) {
    const key = [s.captured_at_shanghai, s.sender_digest ?? "", norm(s.text),
      JSON.stringify(s.media_ids ?? [])].join("||");
    const bucket = byKey.get(key) ?? [];
    bucket.push(s);
    byKey.set(key, bucket);
  }
  const duplicateCandidates = [...byKey.values()].filter((b) => b.length > 1).map((bucket) => ({
    day: bucket[0].day,
    capturedAt: bucket[0].captured_at_shanghai,
    senderDigest: bucket[0].sender_digest,
    textLength: norm(bucket[0].text).length,
    attachments: bucket[0].media_ids ?? [],
    sourceIds: bucket.map((s) => s.id),
    importBatchIds: bucket.map((s) => s.import_batch_id),
    basis: "identical sender digest AND identical normalised text AND identical attachment list AND identical timestamp",
    caveat: "a differing importBatchId alone would not have been enough; it is recorded, not relied on",
  }));

  // same timestamp + same batch difference but NOT the same message — kept visible so the editor can
  // see what the stricter rule refused to merge
  const nearMisses = [];
  const byTime = new Map();
  for (const s of sources) {
    const bucket = byTime.get(s.captured_at_shanghai) ?? [];
    bucket.push(s);
    byTime.set(s.captured_at_shanghai, bucket);
  }
  for (const [time, bucket] of byTime) {
    if (bucket.length < 2) continue;
    const distinct = new Set(bucket.map((s) => `${s.sender_digest}||${norm(s.text)}||${JSON.stringify(s.media_ids ?? [])}`));
    if (distinct.size > 1) {
      nearMisses.push({ capturedAt: time, messages: bucket.length, distinctContents: distinct.size,
        sourceIds: bucket.map((s) => s.id),
        note: "same second, different sender/text/attachments — NOT duplicates" });
    }
  }

  const days = [...new Set([...events.map((e) => e.day), ...traces.map((t) => t.day), ...sources.map((s) => s.day)])].sort();

  const result = {
    generatedAt: new Date().toISOString(),
    month,
    cutoff: cutoff ?? null,
    counts: {
      lifeEvents: events.length,
      dailyTraces: traces.length,
      rawSources: sources.length,
      sourcesCitedByEvents: eventSourceIds.length,
      duplicateCandidateGroups: duplicateCandidates.length,
      duplicateCandidateMessages: duplicateCandidates.reduce((n, d) => n + d.sourceIds.length, 0),
      sameSecondButDifferent: nearMisses.length,
      days: days.length,
    },
    days,
    events,
    traces,
    links,
    sources,
    duplicateCandidates,
    nearMisses,
  };
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
  console.log(JSON.stringify(result.counts, null, 1));
} finally {
  await close();
}
