#!/usr/bin/env node
// Turns the ledger, the local grouping and the model's visual results into one curated reading list
// per day — the single list the month card, the month page and an Event page all read from.
//
// Every candidate that entered the ledger leaves this step with exactly one disposition, including
// the ones nobody will see. A day whose every candidate is excluded still appears here with its
// reason, because "the page has no photos that day" and "that day does not exist" are different
// facts and only one of them is true.
//
// Nothing here deletes a file, changes a review decision, or widens visibility. "not selected"
// means "stays in the archive, not chosen for this reading order".
//
// Usage: node scripts/month-curate.mjs --ledger=<l.json> --groups=<g.json> --vision=<v.json>
//        --crossgroup=<x.json> --cache=<media dir> --out=<curation.json> [--first-screen=3]

import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ledgerPath = arg("ledger");
const groupsPath = arg("groups");
const visionPath = arg("vision");
const crossPath = arg("crossgroup");
const mediaDir = arg("cache");
const outPath = arg("out");
const firstScreenPerDay = Number(arg("first-screen", "3"));
if (!ledgerPath || !groupsPath || !visionPath || !mediaDir || !outPath) {
  console.error("--ledger, --groups, --vision, --cache and --out are required");
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));
const vision = JSON.parse(fs.readFileSync(visionPath, "utf8"));
const cross = crossPath && fs.existsSync(crossPath) ? JSON.parse(fs.readFileSync(crossPath, "utf8")) : { results: [] };
const manifest = JSON.parse(fs.readFileSync(path.join(mediaDir, "_manifest.json"), "utf8"));

const classification = vision.classification ?? {};
// Set by month-local-grouping.mjs --admitted-only: every unique original already carries its
// admission verdict, and only the admitted ones were grouped and analysed.
const admissionFirst = groups.admittedOnly === true;
const visualOf = (mediaId) => classification[manifest[mediaId]?.derivativeSha256] ?? null;
const ledgerById = new Map(ledger.candidates.map((c) => [c.mediaId, c]));
const uniqueById = new Map(groups.uniqueItems.map((i) => [i.mediaId, i]));
const groupOf = new Map();
for (const g of groups.groups) for (const id of g.mediaIds) groupOf.set(id, g);

// group verdicts from the model
const repOfGroup = new Map();
const distinctOfGroup = new Map();
const reasonOfGroup = new Map();
for (const c of vision.comparisons ?? []) {
  if (c.representative) repOfGroup.set(c.groupId, c.representative);
  distinctOfGroup.set(c.groupId, new Set(c.distinct ?? []));
  if (c.reason) reasonOfGroup.set(c.groupId, c.reason);
}
for (const c of vision.chunkComparisons ?? []) {
  if (!repOfGroup.has(c.groupId) && c.representative) repOfGroup.set(c.groupId, c.representative);
  const set = distinctOfGroup.get(c.groupId) ?? new Set();
  for (const id of c.distinct ?? []) set.add(id);
  distinctOfGroup.set(c.groupId, set);
  if (!reasonOfGroup.has(c.groupId) && c.reason) reasonOfGroup.set(c.groupId, c.reason);
}
for (const g of groups.groups) if (g.size === 1) repOfGroup.set(g.groupId, g.mediaIds[0]);

// cross-group redundancy: the earliest member of a redundant cluster keeps the reading slot
const demotedByCrossGroup = new Map();
for (const r of cross.results ?? []) {
  for (const cluster of r.redundantClusters ?? []) {
    const ordered = cluster.slice().sort((a, b) =>
      (uniqueById.get(a)?.takenAtWallClock ?? "").localeCompare(uniqueById.get(b)?.takenAtWallClock ?? ""));
    for (const id of ordered.slice(1)) demotedByCrossGroup.set(id, ordered[0]);
  }
}

const dispositions = new Map();
const setDisposition = (mediaId, disposition, reason, extra = {}) =>
  dispositions.set(mediaId, { mediaId, disposition, reason, ...extra });

// A media id may be substituted for another only when it earns admission on its own. An `approved`
// row is such a decision; "nobody has looked at this one yet" is not, and using an unreviewed twin
// to carry bytes a reviewer rejected under a sibling id would launder that rejection. September has
// two clusters of exactly that shape (both duplicate video rows), and neither is substituted.
const latestDecision = (mediaId) => ledgerById.get(mediaId)?.subjectCheck?.decision ?? null;
const admissibleOnItsOwn = (mediaId) => {
  const led = ledgerById.get(mediaId);
  return Boolean(led && led.publishable && led.privileged && latestDecision(mediaId) === "approved");
};
const substitutions = [];
const substituteFor = new Map();

// 1) duplicate rows folded into their representative — recorded, never dropped
for (const cluster of groups.exactDuplicateClusters) {
  let kept = uniqueById.has(cluster.representative) ? cluster.representative
    : cluster.mediaIds.find((id) => uniqueById.has(id)) ?? cluster.representative;
  if (latestDecision(kept) === "store_only") {
    const substitute = cluster.mediaIds.find((id) => id !== kept && admissibleOnItsOwn(id));
    substitutions.push({
      checksum: cluster.checksum, excludedRepresentative: kept,
      substitute: substitute ?? null,
      clusterDecisions: cluster.mediaIds.map((id) => ({ mediaId: id, latestDecision: latestDecision(id) })),
      outcome: substitute
        ? "replaced by a cluster member holding its own approved subject check"
        : "no cluster member holds its own approved subject check, so the whole cluster stays out of every display list",
    });
    if (substitute) {
      substituteFor.set(kept, substitute);
      kept = substitute;
    }
  }
  for (const id of cluster.mediaIds) {
    if (id === kept) continue;
    // the vetoed representative is excluded by name in the pass below, not folded away as a duplicate
    if (substituteFor.has(id)) continue;
    setDisposition(id, "duplicate-row", "byte-identical original already represented by another row",
      { identity: "original checksum", checksum: cluster.checksum, representedBy: kept });
  }
}

// 2) every unique original
for (const item of groups.uniqueItems) {
  if (dispositions.has(item.mediaId)) continue;
  // When a cluster's representative was vetoed and a sibling earned admission on its own, the
  // sibling carries the (identical) bytes from here on: same group, same visual result, its own
  // review record. The vetoed id is recorded as excluded rather than quietly folded away.
  const substitute = substituteFor.get(item.mediaId);
  if (substitute) {
    setDisposition(item.mediaId, "excluded:subject-store-only",
      "the latest media_subject_check for this media id says store_only; these bytes stay in the lists under a sibling id that holds its own approved check", {
        day: item.day, takenAt: item.takenAtWallClock, groupId: groupOf.get(item.mediaId)?.groupId ?? null,
        subjectCheck: ledgerById.get(item.mediaId)?.subjectCheck ?? null, substitutedBy: substitute,
      });
  }
  const emitId = substitute ?? item.mediaId;
  const led = ledgerById.get(emitId);
  const visual = visualOf(emitId);
  const group = groupOf.get(item.mediaId);
  const base = {
    day: item.day, takenAt: item.takenAtWallClock, groupId: group?.groupId ?? null,
    mediaKind: visual?.mediaKind ?? null, description: visual?.description ?? null,
    visionSource: visual?.source ?? null,
    duplicateRowsFolded: item.duplicateRowCount ? item.duplicateRowCount - 1 : 0,
  };
  if (admissionFirst && !item.admitted) {
    // Decided before any model was asked (month-admission.mjs), so there is no visual result here
    // and none is needed: a picture that fails a gate can never reach a page, whatever it shows.
    const gate = item.admissionGate;
    if (gate === "not-publishable") {
      setDisposition(emitId, "excluded:not-publishable", "no deliverable derivative, or visibility is private", base);
    } else if (gate === "store-only") {
      setDisposition(emitId, "excluded:subject-store-only", led?.subjectCheck?.decision === "store_only"
        ? "the latest media_subject_check for this media id says store_only; a trusted source does not override a reviewer who looked at the file"
        : "a byte-identical row carrying these bytes is store_only, and no row holds its own approved subject check; an unreviewed twin may not carry bytes a reviewer withdrew", {
        ...base, subjectCheck: led?.subjectCheck ?? null, byteVeto: Boolean(item.byteVeto),
      });
    } else if (gate === "subject-unverified") {
      setDisposition(emitId, "pending:subject-unverified",
        "source is not on the trusted list and media_subject_check has never approved this picture; not sent for visual analysis because the admission gate comes first", {
          ...base, subjectCheck: led?.subjectCheck ?? null, topicScore: led?.topicReview?.worthinessScore ?? null, visuallyAnalysed: false,
        });
    } else {
      setDisposition(emitId, "pending:not-analysed", `not admitted (${gate}); no visual result`, base);
    }
    continue;
  }
  if (!visual) {
    setDisposition(emitId, "pending:not-analysed", "no visual result available for these bytes", base);
    continue;
  }
  if (!led?.publishable) {
    setDisposition(emitId, "excluded:not-publishable",
      "no deliverable derivative, or visibility is private", base);
    continue;
  }
  // A reviewer's latest `store_only` is a veto, and it is applied BEFORE anything about the source.
  // This mirrors buildMonthComposition(), where the excluded set (excludedPhotoIdsFrom) is subtracted
  // at the top, before isPrivileged is asked anywhere below it. Source trust says who took a picture,
  // never what is in it, so it cannot answer a reviewer who opened the file and said "not a life
  // photo of this child". Getting this order wrong put 29 store_only pictures into September's
  // reading lists, all 29 of them admitted purely by source trust.
  if (led.subjectCheck?.decision === "store_only") {
    setDisposition(emitId, "excluded:subject-store-only",
      "the latest media_subject_check for this media id says store_only; a trusted source does not override a reviewer who looked at the file", {
        ...base, subjectCheck: led.subjectCheck, trustedSource: led.trustedSource,
      });
    continue;
  }
  if (visual.mediaKind && visual.mediaKind !== "photo" && visual.mediaKind !== "video_frame") {
    setDisposition(emitId, `excluded:${visual.mediaKind}`,
      `the vision model classified these bytes as ${visual.mediaKind}, not a life photograph; the file stays in the source material`, base);
    continue;
  }
  if (!led.privileged) {
    setDisposition(emitId, "pending:subject-unverified",
      "source is not on the trusted list and media_subject_check has never approved this picture; a topic score, a high resolution or a particular group is not a subject approval", {
        ...base, subjectCheck: led.subjectCheck, topicScore: led.topicReview?.worthinessScore ?? null,
      });
    continue;
  }
  const rep = group ? repOfGroup.get(group.groupId) : emitId;
  const distinct = group ? (distinctOfGroup.get(group.groupId) ?? new Set()) : new Set();
  if (group && group.size > 1 && rep && rep !== item.mediaId && !distinct.has(item.mediaId)) {
    setDisposition(emitId, "not-selected:same-burst",
      "the vision model judged this frame to repeat the same action as the group's representative",
      { ...base, representedBy: rep, groupReason: reasonOfGroup.get(group.groupId) ?? null });
    continue;
  }
  if (demotedByCrossGroup.has(item.mediaId)) {
    setDisposition(emitId, "expand-only:cross-group-redundant",
      "the vision model judged this segment to repeat an earlier segment of the same day; kept for the expanded view",
      { ...base, representedBy: demotedByCrossGroup.get(item.mediaId) });
    continue;
  }
  if (group && group.size > 1 && rep !== item.mediaId) {
    // Distinct means the model saw information the lead does not carry, so this picture belongs in
    // the curated set — it is simply not the group's lead. This matters because a WeChat batch sent
    // in one second lands in one time-proximity group while holding entirely different scenes; only
    // the model's comparison separates "another angle of the same second" from "a different moment".
    setDisposition(emitId, "selected:distinct",
      "the vision model judged this frame to carry information the group's lead does not",
      { ...base, groupLead: rep });
    continue;
  }
  setDisposition(emitId, group && group.size > 1 ? "selected:lead" : "selected:only-frame",
    group && group.size > 1
      ? "the vision model's representative for this group" : "the only frame of this moment",
    { ...base, groupReason: reasonOfGroup.get(group?.groupId) ?? null });
}

// 3) per day
const storyBoundIds = new Set();
for (const c of ledger.candidates) {
  if ((c.storyBindings ?? []).some((b) => b.decision === "approved")) storyBoundIds.add(c.mediaId);
}

const days = [];
const allDays = [...new Set(ledger.candidates.map((c) => c.day))].sort();
for (const day of allDays) {
  const dayCandidates = ledger.candidates.filter((c) => c.day === day);
  const dayDisp = dayCandidates.map((c) => dispositions.get(c.mediaId)).filter(Boolean);
  const byTime = (a, b) => (a.takenAt ?? "").localeCompare(b.takenAt ?? "");
  const selected = dayDisp.filter((d) => d.disposition.startsWith("selected")).sort(byTime);
  const leads = selected.filter((d) => d.disposition !== "selected:distinct").sort(byTime);
  const expandOnly = dayDisp.filter((d) => d.disposition.startsWith("expand-only")).sort(byTime);
  const pending = dayDisp.filter((d) => d.disposition.startsWith("pending")).sort(byTime);
  const excluded = dayDisp.filter((d) => d.disposition.startsWith("excluded") || d.disposition.startsWith("not-selected")).sort(byTime);
  const folded = dayDisp.filter((d) => d.disposition === "duplicate-row");
  const expandedOrder = [...selected, ...expandOnly].sort(byTime).map((d) => d.mediaId);
  days.push({
    day,
    ledgerCandidates: dayCandidates.length,
    uniqueOriginals: dayDisp.filter((d) => d.disposition !== "duplicate-row").length,
    // the month page's first screen is a SUBSET of the curated set, never a cap on what an Event may show
    // the first screen shows group leads, so a burst never occupies two slots before the reader
    // has asked for more; it is a subset of the curated set, never a cap on an Event page
    monthPageFirstScreen: (leads.length ? leads : selected).slice(0, firstScreenPerDay).map((d) => d.mediaId),
    monthPageExpanded: expandedOrder,
    eventSupplementary: expandedOrder.filter((id) => !storyBoundIds.has(id)),
    storyBoundSameDay: expandedOrder.filter((id) => storyBoundIds.has(id)),
    selected: selected.map((d) => ({ mediaId: d.mediaId, takenAt: d.takenAt, role: d.disposition, reason: d.reason, description: d.description })),
    groupLeads: leads.map((d) => d.mediaId),
    expandOnly: expandOnly.map((d) => ({ mediaId: d.mediaId, takenAt: d.takenAt, disposition: d.disposition, reason: d.reason, representedBy: d.representedBy ?? null })),
    pendingVerification: pending.map((d) => ({ mediaId: d.mediaId, takenAt: d.takenAt, disposition: d.disposition, reason: d.reason, mediaKind: d.mediaKind, description: d.description, topicScore: d.topicScore ?? null })),
    excluded: excluded.map((d) => ({ mediaId: d.mediaId, takenAt: d.takenAt, disposition: d.disposition, reason: d.reason, representedBy: d.representedBy ?? null })),
    duplicateRowsFolded: folded.length,
    descriptionCandidates: selected.map((d) => ({ mediaId: d.mediaId, takenAt: d.takenAt, visibleFacts: d.description, source: d.visionSource })),
    dayNote: selected.length === 0
      ? (pending.length ? "every candidate is still waiting on subject verification" :
         excluded.length ? "candidates exist but none is a life photograph that passed the gates" : "no candidate")
      : null,
  });
}

const counts = {};
for (const d of dispositions.values()) counts[d.disposition] = (counts[d.disposition] ?? 0) + 1;

const result = {
  generatedAt: new Date().toISOString(),
  month: ledger.month,
  dataCutoff: ledger.generatedAt,
  firstScreenPerDay,
  rules: {
    selectable: "NOT vetoed by a latest media_subject_check of store_only, AND publishable, AND privileged (trusted source or media_subject_check approved), AND classified as a photograph",
    storeOnlyVeto: "a latest store_only decision removes the media id from every display list and cannot be overridden by source trust; this matches buildMonthComposition(), which subtracts excludedPhotoIdsFrom() before any privilege check",
    unreviewed: "no subject check, or a latest needs_human_review, is NOT an exclusion — production deliberately keeps unreviewed pictures where they are rather than narrowing the album to the reviewed set",
    burst: "the vision model names each group's lead and says which other frames carry information the lead does not; those stay in the curated set, the rest map to the lead and are not selected",
    grouping: "time proximity opens a group, so a batch of photos sent to WeChat in the same second starts as one group even when the scenes differ; the model's comparison, not the clock, decides what is actually a repeat",
    crossGroup: "segments the vision model calls redundant keep the earliest and demote the rest to the expanded view",
    firstScreen: "the month page's first screen is a subset of the curated set; it never caps what an Event page may show",
    notSelected: "stays in the archive; no file, review decision or visibility is changed",
    ...(admissionFirst ? {
      admissionFirst: "admission gates ran before grouping and vision: only admitted unique originals were grouped, compared and described; a store_only on any byte-identical row vetoes the bytes unless the displayed row holds its own approved check",
    } : {}),
  },
  counts: { ...counts, ledgerCandidates: ledger.candidates.length, uniqueOriginals: groups.uniqueItems.length, days: days.length },
  duplicateClusterSubstitutions: substitutions,
  days,
  dispositions: [...dispositions.values()],
};
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.counts, null, 1));
for (const d of days) {
  console.log(`${d.day}  cand ${String(d.ledgerCandidates).padStart(3)} | uniq ${String(d.uniqueOriginals).padStart(3)} | ` +
    `selected ${String(d.selected.length).padStart(2)} | expand ${String(d.expandOnly.length).padStart(2)} | ` +
    `pending ${String(d.pendingVerification.length).padStart(2)} | excluded ${String(d.excluded.length).padStart(3)}` +
    (d.dayNote ? `  <- ${d.dayNote}` : ""));
}
