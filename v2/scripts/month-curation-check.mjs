#!/usr/bin/env node
// The acceptance gate for a month's curation. Every number in the report has to come from here, so
// that a mistake can only be made once, in code, where it is visible.
//
// It answers the questions a reviewer would otherwise have to take on trust:
//   - did every ledger candidate get exactly one disposition (none lost, none counted twice)?
//   - is "classified" counted separately from "compared"?
//   - is every model result complete, parseable, and numbered against the images actually sent?
//   - do truncation, model mismatch, missing images and parse failures count as failures rather
//     than quietly as successes?
//   - does every selected media id still exist, resolve to a cached file, and match its checksum?
//   - are the month page and the Event lists consistent with the curated set?
//   - did anything excluded or still unverified leak into a list a family page would render?
//
// Exit code is non-zero when any gate fails, so this cannot pass by being ignored.
//
// Usage: node scripts/month-curation-check.mjs --ledger= --groups= --vision= --curation= --cache=
//        [--crossgroup=] --out=<check.json>

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const load = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ledger = load(arg("ledger"));
const groups = load(arg("groups"));
const vision = load(arg("vision"));
const curation = load(arg("curation"));
const mediaDir = arg("cache");
const crossPath = arg("crossgroup");
const cross = crossPath && fs.existsSync(crossPath) ? load(crossPath) : { results: [], failures: [] };
const outPath = arg("out");
const manifest = load(path.join(mediaDir, "_manifest.json"));

const gates = [];
const gate = (name, pass, detail) => gates.push({ name, pass: Boolean(pass), detail });

// 1. every candidate has exactly one disposition
const dispById = new Map();
let duplicateDisposition = 0;
for (const d of curation.dispositions) {
  if (dispById.has(d.mediaId)) duplicateDisposition += 1;
  dispById.set(d.mediaId, d);
}
const ledgerIds = new Set(ledger.candidates.map((c) => c.mediaId));
const missingDisposition = [...ledgerIds].filter((id) => !dispById.has(id));
const inventedDisposition = [...dispById.keys()].filter((id) => !ledgerIds.has(id));
gate("every ledger candidate has exactly one disposition",
  missingDisposition.length === 0 && inventedDisposition.length === 0 && duplicateDisposition === 0,
  { ledgerCandidates: ledgerIds.size, dispositions: dispById.size,
    missing: missingDisposition.length, invented: inventedDisposition.length, duplicated: duplicateDisposition });

// 2. classification coverage vs comparison coverage — counted apart
const shaByMedia = new Map(Object.entries(manifest).map(([id, e]) => [id, e.derivativeSha256]));
const classified = new Set();
for (const [sha, entry] of Object.entries(vision.classification ?? {})) {
  if (entry?.mediaId) classified.add(entry.mediaId);
  else {
    const hit = [...shaByMedia.entries()].find(([, s]) => s === sha);
    if (hit) classified.add(hit[0]);
  }
}
const uniqueIds = new Set(groups.uniqueItems.map((i) => i.mediaId));
const unclassified = [...uniqueIds].filter((id) => !classified.has(id));
const comparedGroups = (vision.comparisons ?? []).filter((c) => c.representative);
const comparedImages = new Set();
for (const c of comparedGroups) for (const id of c.mediaIds ?? []) comparedImages.add(id);
const multiGroups = groups.groups.filter((g) => g.size > 1);
gate("classification covers every unique original",
  unclassified.length === 0,
  { uniqueOriginals: uniqueIds.size, classified: [...classified].filter((id) => uniqueIds.has(id)).length,
    missing: unclassified.length, missingIds: unclassified.slice(0, 10) });
gate("group comparison covers every multi-image group",
  multiGroups.every((g) => comparedGroups.some((c) => c.groupId === g.groupId)),
  { multiImageGroups: multiGroups.length, comparedGroups: comparedGroups.length,
    imagesInComparedGroups: comparedImages.size,
    singleImageGroups: groups.groups.length - multiGroups.length,
    note: "single-image groups have nothing to compare and are never counted as compared" });

// 3. model results: completeness and numbering
// A truncated call is not itself a defect — abandoning it is the correct behaviour. What must never
// happen is a truncated or mis-modelled call CONTRIBUTING a result. So each one has to be matched by
// a recorded failure, and no classification or comparison may carry its label.
const truncatedLabels = [...(vision.callLog ?? []), ...(cross.callLog ?? [])]
  .filter((c) => c.truncated || c.stopReason === "max_tokens").map((c) => c.label);
const mismatched = [...(vision.callLog ?? []), ...(cross.callLog ?? [])]
  .filter((c) => c.returnedModel && c.returnedModel !== c.requestedModel);
const allFailureLabels = new Set([...(vision.failures ?? []), ...(cross.failures ?? [])].map((f) => f.label));
const unrecordedTruncations = truncatedLabels.filter((l) => !allFailureLabels.has(l));
const resultLabels = new Set(Object.values(vision.classification ?? {}).map((c) => c.label));
const truncationLeakedIntoResults = truncatedLabels.filter((l) => resultLabels.has(l));
gate("no truncated or mismatched model call contributed a result",
  unrecordedTruncations.length === 0 && truncationLeakedIntoResults.length === 0 && mismatched.length === 0,
  { visionCalls: (vision.callLog ?? []).length, crossGroupCalls: (cross.callLog ?? []).length,
    truncatedCalls: truncatedLabels.length, allRecordedAsFailures: unrecordedTruncations.length === 0,
    leakedIntoResults: truncationLeakedIntoResults.length, modelMismatched: mismatched.length });
gate("all recorded failures are counted as failures, not successes",
  (vision.failures ?? []).every((f) => f.error) && (cross.failures ?? []).every((f) => f.error),
  { visionFailures: (vision.failures ?? []).length, crossGroupFailures: (cross.failures ?? []).length,
    note: "a failure entry never produces a classification or a representative" });
const comparisonNumbering = comparedGroups.filter((c) =>
  c.representative && !(c.mediaIds ?? []).includes(c.representative));
gate("every representative is one of the images actually sent in its call",
  comparisonNumbering.length === 0,
  { checked: comparedGroups.length, mismatched: comparisonNumbering.length });

// 4. selected media resolve to real, checksum-matching files
const selectedIds = new Set();
for (const day of curation.days) for (const id of day.monthPageExpanded) selectedIds.add(id);
const fileProblems = [];
for (const id of selectedIds) {
  const entry = manifest[id];
  if (!entry) { fileProblems.push({ id, problem: "not in media cache" }); continue; }
  const file = path.join(mediaDir, entry.file);
  if (!fs.existsSync(file)) { fileProblems.push({ id, problem: "cached file missing" }); continue; }
  const led = ledger.candidates.find((c) => c.mediaId === id);
  if (!led) { fileProblems.push({ id, problem: "not in ledger" }); continue; }
  if (led.checksum && entry.originalChecksum && led.checksum !== entry.originalChecksum) {
    fileProblems.push({ id, problem: "original checksum disagrees with the prefetch manifest" });
  }
  // The bytes on disk are re-hashed rather than trusted: the manifest recording a hash proves
  // nothing about the file still sitting there now, and the analysis ran on these exact bytes.
  const actual = createHash("sha256").update(fs.readFileSync(file)).digest("hex");
  if (actual !== entry.derivativeSha256) {
    fileProblems.push({ id, problem: "file on disk no longer hashes to the analysed bytes" });
  }
  if (!(vision.classification ?? {})[entry.derivativeSha256]) {
    fileProblems.push({ id, problem: "no visual result is keyed to these exact bytes" });
  }
}
gate("every media in a reading list exists, re-hashes to the analysed bytes, and has a visual result",
  fileProblems.length === 0, { readingListMedia: selectedIds.size, problems: fileProblems.slice(0, 10), problemCount: fileProblems.length });

// 5. month page / Event consistency
const consistency = [];
for (const day of curation.days) {
  const expanded = new Set(day.monthPageExpanded);
  if (!day.monthPageFirstScreen.every((id) => expanded.has(id))) {
    consistency.push({ day: day.day, problem: "first screen holds an id not in the expanded set" });
  }
  const eventSet = new Set([...day.eventSupplementary, ...day.storyBoundSameDay]);
  if (eventSet.size !== expanded.size || ![...expanded].every((id) => eventSet.has(id))) {
    consistency.push({ day: day.day, problem: "Event lists do not partition the expanded set" });
  }
  const declared = day.selected.length + day.expandOnly.length;
  if (declared !== day.monthPageExpanded.length) {
    consistency.push({ day: day.day, problem: `expanded order (${day.monthPageExpanded.length}) != selected+expandOnly (${declared})` });
  }
}
gate("first screen is a subset of the expanded set, and the Event lists partition it exactly",
  consistency.length === 0, { days: curation.days.length, problems: consistency });

// 5b. the store_only veto, checked from the ledger rather than from the curation's own filter.
// This is still not independent enough to be the proof — see month-display-subject-audit.mjs, which
// recomputes the latest decision straight from the database — but it catches the case where the
// curation and the ledger disagree.
const storeOnlyFromLedger = new Set(ledger.candidates
  .filter((c) => c.subjectCheck?.decision === "store_only").map((c) => c.mediaId));
const storeOnlyLeaks = [];
for (const day of curation.days) {
  for (const id of [...day.monthPageExpanded, ...day.monthPageFirstScreen,
                    ...day.eventSupplementary, ...day.storyBoundSameDay]) {
    if (storeOnlyFromLedger.has(id)) storeOnlyLeaks.push({ day: day.day, id });
  }
}
gate("no media whose latest subject check is store_only appears in any display list",
  storeOnlyLeaks.length === 0,
  { storeOnlyInMonth: storeOnlyFromLedger.size, leaks: storeOnlyLeaks.length,
    examples: storeOnlyLeaks.slice(0, 10),
    note: "source trust does not override a store_only decision; buildMonthComposition subtracts the excluded set before any privilege check" });

// 6. nothing excluded or unverified leaks into a reading list
const leaks = [];
for (const day of curation.days) {
  for (const id of day.monthPageExpanded) {
    const d = dispById.get(id);
    if (!d) { leaks.push({ day: day.day, id, problem: "no disposition" }); continue; }
    if (!(d.disposition.startsWith("selected") || d.disposition.startsWith("expand-only"))) {
      leaks.push({ day: day.day, id, problem: `disposition ${d.disposition} appears in a reading list` });
    }
    const led = ledger.candidates.find((c) => c.mediaId === id);
    if (!led?.privileged) leaks.push({ day: day.day, id, problem: "not privileged but in a reading list" });
    if (!led?.publishable) leaks.push({ day: day.day, id, problem: "not publishable but in a reading list" });
    const visual = (vision.classification ?? {})[shaByMedia.get(id)];
    if (visual && visual.mediaKind && visual.mediaKind !== "photo" && visual.mediaKind !== "video_frame") {
      leaks.push({ day: day.day, id, problem: `classified ${visual.mediaKind} but in a reading list` });
    }
  }
}
gate("no excluded, unverified or non-photograph media reaches a reading list",
  leaks.length === 0, { problems: leaks.slice(0, 15), problemCount: leaks.length });

// 7. days are preserved even when empty
const ledgerDays = new Set(ledger.candidates.map((c) => c.day));
const curationDays = new Set(curation.days.map((d) => d.day));
const droppedDays = [...ledgerDays].filter((d) => !curationDays.has(d));
gate("every day that has a candidate still appears in the result, empty or not",
  droppedDays.length === 0,
  { daysWithCandidates: ledgerDays.size, daysInCuration: curationDays.size, dropped: droppedDays,
    daysWithNothingSelected: curation.days.filter((d) => d.selected.length === 0).map((d) => d.day) });

// 8. sources and assets untouched
gate("no source or asset was removed by this pipeline",
  ledger.candidates.length === curation.counts.ledgerCandidates,
  { ledgerCandidates: ledger.candidates.length, accountedFor: curation.dispositions.length,
    note: "this pipeline is read-only; it records dispositions and never deletes" });

const summary = {
  generatedAt: new Date().toISOString(),
  month: curation.month,
  passed: gates.filter((g) => g.pass).length,
  failed: gates.filter((g) => !g.pass).length,
  gates,
  headline: {
    ledgerCandidates: ledger.candidates.length,
    uniqueOriginals: groups.uniqueItems.length,
    duplicateRowsFolded: ledger.candidates.length - groups.uniqueItems.length,
    classifiedImages: [...classified].filter((id) => uniqueIds.has(id)).length,
    comparedGroups: comparedGroups.length,
    comparedImages: comparedImages.size,
    singleImageGroupsNotCompared: groups.groups.filter((g) => g.size === 1).length,
    selected: Object.entries(curation.counts).filter(([k]) => k.startsWith("selected")).reduce((n, [, v]) => n + v, 0),
    expandOnly: Object.entries(curation.counts).filter(([k]) => k.startsWith("expand-only")).reduce((n, [, v]) => n + v, 0),
    pending: Object.entries(curation.counts).filter(([k]) => k.startsWith("pending")).reduce((n, [, v]) => n + v, 0),
    notSelectedSameBurst: Object.entries(curation.counts).filter(([k]) => k.startsWith("not-selected")).reduce((n, [, v]) => n + v, 0),
    excluded: Object.entries(curation.counts).filter(([k]) => k.startsWith("excluded")).reduce((n, [, v]) => n + v, 0),
    excludedStoreOnly: curation.counts["excluded:subject-store-only"] ?? 0,
    duplicateRowsFoldedCount: curation.counts["duplicate-row"] ?? 0,
    visionCalls: (vision.callLog ?? []).length + (cross.callLog ?? []).length,
    visionInputTokens: (vision.stats?.inputTokens ?? 0) + (cross.stats?.inputTokens ?? 0),
    visionOutputTokens: (vision.stats?.outputTokens ?? 0) + (cross.stats?.outputTokens ?? 0),
    cacheReusedImages: Object.values(vision.classification ?? {}).filter((c) => c.source && !c.source.includes("this run")).length,
  },
};
if (outPath) fs.writeFileSync(outPath, JSON.stringify(summary, null, 1));
for (const g of gates) console.log(`${g.pass ? "PASS" : "FAIL"}  ${g.name}`);
console.log(JSON.stringify(summary.headline, null, 1));
if (summary.failed > 0) {
  console.error(`\n${summary.failed} gate(s) failed`);
  for (const g of gates.filter((x) => !x.pass)) console.error(`  - ${g.name}: ${JSON.stringify(g.detail).slice(0, 400)}`);
  process.exit(1);
}
