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
//        --out=<audit.json>

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
    pass: totalStoreOnlyInDisplay === 0 && missing.length === 0 && privateOnes.length === 0
      && everyDisplayedId.size > 0,
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
if (!result.pass) {
  console.error("\naudit FAILED");
  process.exit(1);
}
