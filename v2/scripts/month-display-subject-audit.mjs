#!/usr/bin/env node
// Independent audit: does any media a page would render still carry a latest `store_only` subject
// check?
//
// Deliberately shares no code with the curation filter. It re-reads content_quality_reviews from the
// database, recomputes "latest decision wins" from scratch, and intersects that set with the display
// lists as they were written to disk. A filter that checks itself only proves it is consistent with
// itself — that is exactly how the first September run reported eleven green gates while 29
// store_only pictures sat in the reading lists.
//
// Read-only: no review decision, no visibility, no file is touched.
//
// Usage: node scripts/month-display-subject-audit.mjs --curation=<c.json> --month=2026-09
//        --out=<audit.json> [--allow-empty] [--content=<YYYY-MM.json month content file>]

import fs from "node:fs";
import path from "node:path";
import { openRds } from "../.data/night-rds.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const curationPath = arg("curation");
const month = arg("month");
const outPath = arg("out");
const allowEmpty = process.argv.includes("--allow-empty");
if (!curationPath || !month) {
  console.error("--curation=<curation.json> and --month=YYYY-MM are required");
  process.exit(1);
}

const curation = JSON.parse(fs.readFileSync(curationPath, "utf8"));

// the lists a page would actually render, taken from the file rather than recomputed
const displayLists = {
  monthPageFirstScreen: new Set(),
  monthPageExpanded: new Set(),
  eventSupplementary: new Set(),
  storyBoundSameDay: new Set(),
  selected: new Set(),
};
for (const day of curation.days) {
  for (const id of day.monthPageFirstScreen) displayLists.monthPageFirstScreen.add(id);
  for (const id of day.monthPageExpanded) displayLists.monthPageExpanded.add(id);
  for (const id of day.eventSupplementary) displayLists.eventSupplementary.add(id);
  for (const id of day.storyBoundSameDay) displayLists.storyBoundSameDay.add(id);
  for (const s of day.selected) displayLists.selected.add(s.mediaId);
}
// The page does not read the curation file; it reads the month content file built from it. When that
// file is given, its lists (and its cover) are audited too, so what ships is what was checked.
const contentPath = arg("content");
if (contentPath) {
  const content = JSON.parse(fs.readFileSync(contentPath, "utf8"));
  displayLists.contentFirstScreen = new Set(content.days.flatMap((day) => day.firstScreenMediaIds ?? []));
  displayLists.contentExpanded = new Set(content.days.flatMap((day) => day.expandedMediaIds ?? []));
  displayLists.contentStoryBound = new Set(content.days.flatMap((day) => day.storyBoundMediaIds ?? []));
  displayLists.contentCover = new Set(content.coverMediaId ? [content.coverMediaId] : []);
}
const everyDisplayedId = new Set([...Object.values(displayLists)].flatMap((s) => [...s]));

const { client, close } = await openRds({ readOnly: true });
let result;
try {
  // Latest decision wins, ties broken on id — the rule lib/media/story-binding.ts applies, restated
  // here in SQL rather than imported, so the two can actually disagree if one of them is wrong.
  const { rows } = await client.query(
    `select distinct on (target_id)
            target_id as media_id, decision, reviewed_at::text as reviewed_at, id
       from content_quality_reviews
      where target_kind = 'media_subject_check'
        and position('|' in target_id) = 0
      order by target_id, reviewed_at desc, id desc`,
  );
  const latestByMedia = new Map(rows.map((r) => [r.media_id, r]));
  const storeOnlyEverywhere = new Set([...latestByMedia.entries()]
    .filter(([, r]) => r.decision === "store_only").map(([id]) => id));

  const intersections = {};
  for (const [listName, ids] of Object.entries(displayLists)) {
    const hits = [...ids].filter((id) => storeOnlyEverywhere.has(id));
    intersections[listName] = {
      listSize: ids.size,
      storeOnlyInList: hits.length,
      offenders: hits.slice(0, 20).map((id) => ({ mediaId: id, reviewedAt: latestByMedia.get(id)?.reviewed_at })),
    };
  }

  // an offender's absence must not be an artefact of the list being empty
  const monthRows = await client.query(
    `select count(*)::int as n from media where taken_at >= $1::timestamp and taken_at < $2::timestamp`,
    [`${month}-01`, nextMonthOf(month)],
  );

  // every displayed id must still exist as a media row, and none may be private
  const existence = await client.query(
    `select id, visibility from media where id = any($1)`, [[...everyDisplayedId]]);
  const foundIds = new Set(existence.rows.map((r) => r.id));
  const missing = [...everyDisplayedId].filter((id) => !foundIds.has(id));
  const privateOnes = existence.rows.filter((r) => r.visibility === "private").map((r) => r.id);

  // The same veto at the level of bytes. A store_only on one media id is a statement about a
  // photograph; a byte-identical row under another id shows the reader that same photograph. Such a
  // row may appear only if it holds its own approved check. Recomputed here from media_assets
  // checksums, not taken from the grouping's cluster verdicts.
  const twins = await client.query(
    `select shown.id as shown_id, other.id as twin_id
       from media shown
       join media_assets sa on sa.id = shown.media_asset_id
       join media_assets oa on oa.checksum = sa.checksum and oa.id <> sa.id
       join media other on other.media_asset_id = oa.id
      where shown.id = any($1) and sa.checksum is not null
     union
     select shown.id, other.id
       from media shown
       join media other on other.media_asset_id = shown.media_asset_id and other.id <> shown.id
      where shown.id = any($1)`,
    [[...everyDisplayedId]]);
  const byteVetoOffenders = [];
  for (const row of twins.rows) {
    if (!storeOnlyEverywhere.has(row.twin_id)) continue;
    if (latestByMedia.get(row.shown_id)?.decision === "approved") continue;
    byteVetoOffenders.push({ mediaId: row.shown_id, withdrawnTwin: row.twin_id,
      ownDecision: latestByMedia.get(row.shown_id)?.decision ?? "never" });
  }

  const totalStoreOnlyInDisplay = Object.values(intersections).reduce((n, v) => n + v.storeOnlyInList, 0);
  result = {
    generatedAt: new Date().toISOString(),
    month,
    method: "latest media_subject_check per media id recomputed in SQL; display lists read from the curation file; no curation code reused",
    databaseFacts: {
      subjectCheckedMediaIds: latestByMedia.size,
      storeOnlyMediaIdsWholeDatabase: storeOnlyEverywhere.size,
      mediaRowsInMonth: monthRows.rows[0].n,
    },
    displayLists: intersections,
    distinctDisplayedIds: everyDisplayedId.size,
    missingFromMediaTable: missing,
    privateVisibilityInDisplay: privateOnes,
    byteIdenticalTwinsChecked: twins.rows.length,
    byteVetoOffenders,
    // an empty display list proves nothing, so it fails unless the caller says the month is
    // expected to show no pictures at all (--allow-empty)
    pass: totalStoreOnlyInDisplay === 0 && missing.length === 0 && privateOnes.length === 0
      && byteVetoOffenders.length === 0 && (everyDisplayedId.size > 0 || allowEmpty),
    totalStoreOnlyInDisplay,
  };
} finally {
  await close();
}

function nextMonthOf(m) {
  const [y, mo] = m.split("-").map(Number);
  return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
}

if (outPath) {
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
}
console.log(JSON.stringify({ ...result, displayLists: undefined }, null, 1));
for (const [name, v] of Object.entries(result.displayLists)) {
  console.log(`${v.storeOnlyInList === 0 ? "PASS" : "FAIL"}  ${name}: ${v.listSize} ids, ${v.storeOnlyInList} with a latest store_only`);
}
console.log(`${result.byteVetoOffenders.length === 0 ? "PASS" : "FAIL"}  byte-identical twins: ` +
  `${result.byteIdenticalTwinsChecked} twin rows checked, ${result.byteVetoOffenders.length} shown without their own approval`);
if (!result.pass) {
  console.error("\naudit FAILED");
  process.exit(1);
}
