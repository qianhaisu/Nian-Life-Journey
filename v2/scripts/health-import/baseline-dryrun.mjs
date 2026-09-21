// File-level dry-run of the accepted HEALTH-01 baseline through the ledger (R1 adapters). Reads inputs read-only
// (sha256 before/after), writes only under --out (must be outside the repo). No database, no network, no model.
//   node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 DIR --r2 DIR --out DIR [--as-of YYYY-MM-DD] [--export-md FILE]
// --export-md: optional real WeFlow Markdown export, parsed READ-ONLY for a structure spot-check (counts only are reported).
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HealthFileStore } from "../../lib/health/file-store.ts";
import { runCorrection, runImport } from "../../lib/health/importer.ts";
import { adaptEpisodesR4, adaptHandoff, adaptHospitalR2, adaptWechatFactsR4 } from "../../lib/health/adapters.ts";
import { businessDigest } from "../../lib/health/model.ts";
import { confirmedFactIds, membership } from "../../lib/health/ledger.ts";
import { buildTimeline, diffTimelines, renderHtml, renderMarkdown, timelineContentHash, traceObservation } from "../../lib/health/timeline.ts";
import { adaptMessagesMarkdown } from "./message-adapters.mjs";
import { parseArgs } from "./cli.mjs";
import { assertOutsideRepo } from "./paths.mjs";

const args = parseArgs(process.argv.slice(2));
const r4 = String(args.r4), r2 = String(args.r2), asOf = String(args["as-of"] ?? "2026-09-21");
const out = assertOutsideRepo(String(args.out), "--out");
const jsonl = (f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const inputs = {
  facts: `${r4}/wechat-facts-r4.jsonl`, episodes: `${r4}/episodes-r4.jsonl`, groups: `${r4}/episode-groups-r4.jsonl`, association: `${r4}/episode-association-review.jsonl`,
  enc: `${r2}/encounters.jsonl`, cf: `${r2}/canonical-facts.jsonl`, manifest: `${r2}/source-manifest.jsonl`, corrections: `${r2}/corrections.jsonl`, handoff: `${r2}/handoff-reconciliation.jsonl`,
};
const before = Object.fromEntries(Object.values(inputs).map((f) => [f, sha(f)]));

const facts = jsonl(inputs.facts), episodes = jsonl(inputs.episodes), groups = jsonl(inputs.groups), association = jsonl(inputs.association);
const manifestRows = jsonl(inputs.manifest), cfRows = jsonl(inputs.cf), encRows = jsonl(inputs.enc), corrRows = jsonl(inputs.corrections);
const hosp = adaptHospitalR2({ encounters: encRows, canonicalFacts: cfRows, manifest: manifestRows, corrections: corrRows }, "hospital");
const handoffRows = jsonl(inputs.handoff);
const batches = (factRows, epRows) => [hosp.batch, adaptWechatFactsR4(factRows, "wechat"), adaptHandoff(handoffRows, "handoff"), adaptEpisodesR4(epRows, "episodes", { groups, association })];
const report = { generatedFor: "HEALTH-02-R1 file-level dry-run", asOf, phases: {} };

async function runAll(store, bs, apply) {
  const rows = [];
  for (const b of bs) {
    try {
      const r = await runImport(store, b, { apply, now: () => `${asOf}T00:00:00Z` });
      rows.push({ batch: b.batchId, applied: r.applied, counts: r.counts, rejected: r.rejected, needsReview: r.needsReview, impactEpisodes: r.impact.episodes, rejections: r.items.filter((i) => i.action === "rejected").slice(0, 10).map((i) => ({ ref: i.ref, reason: i.reason })), linkRejections: r.links.filter((l) => l.action === "rejected").slice(0, 10), conflicts: r.items.filter((i) => ["conflict", "ambiguous"].includes(i.action)).slice(0, 10).map((i) => ({ ref: i.ref, reason: i.reason })), heldLinks: r.links.filter((l) => l.action === "held").length });
      if (r.rejected) break;
    } catch (e) {
      rows.push({ batch: b.batchId, applied: false, error: e.message, report: e.report ? { counts: e.report.counts, rejections: e.report.items.filter((i) => i.action === "rejected").slice(0, 10).map((i) => ({ ref: i.ref, reason: i.reason })), linkRejections: e.report.links.filter((l) => l.action === "rejected").slice(0, 10) } : null });
      break;
    }
  }
  return rows;
}

mkdirSync(out, { recursive: true });
rmSync(path.join(out, "ledger-full"), { recursive: true, force: true });
rmSync(path.join(out, "ledger-incremental"), { recursive: true, force: true });

// Phase 1: dry-run against an empty ledger, apply to a scratch ledger, replay
const full = new HealthFileStore(path.join(out, "ledger-full"));
report.phases.dryRunEmpty = await runAll(full, batches(facts, episodes), false);
report.phases.applyFull = await runAll(full, batches(facts, episodes), true);
const fullLedger = await full.read();
report.phases.digestAfterFirstApply = businessDigest(fullLedger);
report.phases.replay = await runAll(full, batches(facts, episodes), true);
report.phases.replayBusinessUnchanged = report.phases.digestAfterFirstApply === businessDigest(await full.read());

// Phase 2: incremental. Baseline = everything except the newest ~5% of facts.
const cut = Math.floor(facts.length * 0.95);
const factsOld = facts.slice(0, cut), heldBack = facts.slice(cut);
const oldIds = new Set(factsOld.map((f) => f.fact_id));
const episodesOld = episodes.map((e) => ({ ...e, wechat_fact_ids: (e.wechat_fact_ids ?? []).filter((i) => oldIds.has(i)), candidate_fact_ids: (e.candidate_fact_ids ?? []).filter((i) => oldIds.has(i)) }));
const inc = new HealthFileStore(path.join(out, "ledger-incremental"));
await runAll(inc, batches(factsOld, episodesOld), true);
const tlBefore = buildTimeline(await inc.read(), { asOf });
report.phases.incrementalApply = await runAll(inc, batches(facts, episodes), true);
const incAfter = await inc.read();
const tlCached = buildTimeline(incAfter, { asOf, previous: tlBefore });
const tlFresh = buildTimeline(incAfter, { asOf });
const diff = diffTimelines(tlBefore, tlCached);
report.phases.incremental = { heldBackFacts: heldBack.length, cacheStats: tlCached.stats, cachedEqualsFresh: timelineContentHash(tlCached) === timelineContentHash(tlFresh), diff, finalDigestEqualsFull: businessDigest(incAfter) === report.phases.digestAfterFirstApply };

// Counts and the R1 checklist
const kinds = {};
for (const e of Object.values(fullLedger.entities)) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const candSet = (e) => new Set(e.candidate_fact_ids ?? []);
const tl = buildTimeline(fullLedger, { asOf });
const patientFacts = cfRows.filter((f) => !f.encounter_id || encRows.some((e) => e.id === f.encounter_id && !e.excluded && e.kind));
const docLinks = Object.values(fullLedger.links).filter((l) => l.role === "documented_in" && l.from.kind === "canonical_fact");
const docGroups = new Map();
for (const m of manifestRows) if (m.document_id) docGroups.set(m.document_id, (docGroups.get(m.document_id) ?? 0) + 1);
const handoffRefsExpected = episodes.reduce((n, e) => n + (e.handoff_refs ?? []).length, 0);
const handoffLinks = Object.values(fullLedger.links).filter((l) => l.from.kind === "observation" && l.from.id.startsWith("HR-") && l.to.kind === "episode");
report.counts = {
  ledgerEntitiesByKind: kinds,
  wechatFactsInInput: facts.length, episodesInInput: episodes.length,
  attachedExpected: episodes.reduce((n, e) => n + (e.wechat_fact_ids ?? []).filter((i) => !candSet(e).has(i)).length, 0),
  attachedInLedger: tl.blocks.reduce((n, b) => n + b.items.filter((i) => !i.observationId.startsWith("HR-")).length, 0),
  candidateExpected: episodes.reduce((n, e) => n + candSet(e).size, 0),
  candidateInLedger: tl.blocks.reduce((n, b) => n + b.candidates.filter((i) => !i.observationId.startsWith("HR-")).length, 0),
  canonicalFactsInInput: cfRows.length, canonicalFactsPatientExpected: patientFacts.length, canonicalFactsInLedger: kinds.canonical_fact ?? 0,
  unattachedCanonicalFacts: tl.unattachedFacts.length, unattachedCanonicalFactIds: tl.unattachedFacts.map((f) => f.id),
  encountersInLedger: kinds.encounter ?? 0, unattachedEncounters: tl.unattachedEncounters.map((e) => `${e.id}:${e.kind}`),
  manifestRows: manifestRows.length, sourcesFromManifest: Object.values(fullLedger.entities).filter((e) => e.kind === "source" && e.versions[0].content.layer === "hospital_document").length,
  documentIdsWithMultipleOriginals: [...docGroups].filter(([, n]) => n > 1).length,
  factToDocumentLinks: docLinks.length,
  historicalCorrectionsInInput: corrRows.length, historicalCorrectionsInLedger: fullLedger.corrections.filter((c) => c.type === "historical").length,
  historicalCorrectionsWithTargets: fullLedger.corrections.filter((c) => c.type === "historical" && c.targets.length).length,
  handoffRefsExpected, handoffEpisodeLinksInLedger: handoffLinks.length, handoffRolesInLinks: Object.fromEntries(["candidate", "background", "attached"].map((r) => [r, handoffLinks.filter((l) => (fullLedger.links[l.id].role === r)).length])),
  handoffObservations: Object.values(fullLedger.entities).filter((e) => e.kind === "observation" && e.id.startsWith("HR-")).length,
  unattachedObservationsTotal: tl.unattached.length, timelineMdLines: renderMarkdown(tl).split("\n").length,
  hospitalSkipped: hosp.skipped,
  perEpisode: episodes.map((e) => ({ id: e.id, expectedAttached: (e.wechat_fact_ids ?? []).filter((i) => !candSet(e).has(i)).length, ledgerAttached: confirmedFactIds(fullLedger, e.id).length, expectedCandidates: candSet(e).size, ledgerCandidates: membership(fullLedger, e.id).candidate.filter((i) => !i.startsWith("HR-")).length, expectedEncounters: (e.enc ?? []).length, ledgerEncounters: tl.blocks.find((b) => b.episodeId === e.id)?.encounters.length, status: tl.blocks.find((b) => b.episodeId === e.id)?.derivedStatus })),
};
// Structured-field display: every canonical fact that carries structured fields must show them; a correction on the SCRATCH ledger
// (never the inputs) must change the displayed effective value and produce a diff, while the cached timeline still equals a fresh one.
{
  const allFacts = [...tl.blocks.flatMap((b) => b.encounters.flatMap((e) => e.facts)), ...tl.unattachedFacts];
  const withStructured = [...new Map(allFacts.filter((f) => f.structured).map((f) => [f.id, f])).values()]; // an encounter can appear under several episodes: count facts once
  const byType = {};
  for (const f of withStructured) byType[f.type] = (byType[f.type] ?? 0) + 1;
  report.structured = { canonicalFactsWithStructuredInInput: cfRows.filter((f) => f.structured).length, shownInTimeline: withStructured.length, byType, allShowStructuredText: withStructured.every((f) => f.structuredText) };
  const target = allFacts.find((f) => f.type === "medication_prescribed" && f.structured) ?? withStructured[0];
  if (target) {
    rmSync(path.join(out, "ledger-probe"), { recursive: true, force: true });
    const probe = new HealthFileStore(path.join(out, "ledger-probe"));
    await runAll(probe, batches(facts, episodes), true);
    const base = buildTimeline(await probe.read(), { asOf });
    await runCorrection(probe, { id: "probe-1", type: "field", ref: { kind: "canonical_fact", id: target.id }, field: "structured.note", after: "probe: structured correction on scratch ledger", author: "dry-run probe", at: asOf, reason: "verify structured correction display" }, { apply: true });
    const cached = buildTimeline(await probe.read(), { asOf, previous: base }), fresh = buildTimeline(await probe.read(), { asOf });
    const shown = [...cached.blocks.flatMap((b) => b.encounters.flatMap((e) => e.facts)), ...cached.unattachedFacts].find((f) => f.id === target.id);
    const d = diffTimelines(base, cached);
    report.structured.probe = { factType: target.type, displayedAfterCorrection: shown.valueTextSuperseded && /probe: structured correction/.test(shown.displayValue), originalTextKept: shown.value === target.value, diffChangedBlocks: d.changedBlocks.length, diffUnattachedFactsChanged: d.unattachedFacts.changed.length, cachedEqualsFresh: timelineContentHash(cached) === timelineContentHash(fresh), cacheStats: cached.stats };
    // Binding probe (scratch ledger only): give one observation a NEW version that adds an extra source, then a pending binding; the old version must not show the new source.
    {
      const led = await probe.read();
      const o = Object.values(led.entities).find((e) => e.kind === "observation" && e.versions.length === 1 && Object.values(led.links).some((l) => l.from.id === e.id && l.role === "from_source"));
      const oldSources = traceObservation(led, o.id).observation.versions[0].sources.map((x) => x.source);
      const fs0 = Object.values(led.links).find((l) => l.from.id === o.id && l.role === "from_source");
      const extra = { kind: "source", id: "probe:extra-source", content: { layer: "probe", recordedAt: `${asOf} 00:00:00` } };
      await runImport(probe, { batchId: "probe-extra", items: [extra, { kind: "observation", id: o.id, content: { ...o.versions[0].content, text: `${o.versions[0].content.text} (probe revision)` }, links: [{ role: "supports", to: { kind: "source", id: extra.id } }] }] }, { apply: true, now: () => `${asOf}T00:00:00Z` });
      await runImport(probe, { batchId: "probe-src-rev", items: [{ kind: "source", id: fs0.to.id, content: { ...led.entities[`source:${fs0.to.id}`].versions[0].content, probeRevision: true } }] }, { apply: true, now: () => `${asOf}T00:00:00Z` });
      const r3 = await runImport(probe, { batchId: "probe-v3", items: [{ kind: "observation", id: o.id, content: { ...o.versions[0].content, text: `${o.versions[0].content.text} (probe revision 2)` }, links: [{ role: "from_source", to: { kind: "source", id: fs0.to.id } }] }] }, { apply: true, now: () => `${asOf}T00:00:00Z` });
      const led2 = await probe.read();
      const tr = traceObservation(led2, o.id);
      const replay = await runImport(probe, { batchId: "probe-v3", items: [{ kind: "observation", id: o.id, content: { ...o.versions[0].content, text: `${o.versions[0].content.text} (probe revision 2)` }, links: [{ role: "from_source", to: { kind: "source", id: fs0.to.id } }] }] }, { apply: false });
      const conf = await runImport(probe, { batchId: "probe-confirm", items: [], links: [{ from: { kind: "observation", id: o.id }, role: "from_source", to: { kind: "source", id: fs0.to.id }, toVersion: 2, confirmation: { by: "dry-run probe", reason: "verify confirmation on scratch ledger" } }] }, { apply: true, now: () => `${asOf}T00:00:00Z` });
      const led3 = await probe.read();
      const tr3 = traceObservation(led3, o.id);
      report.bindingProbe = { oldVersionSourcesBefore: oldSources.length, oldVersionSourcesAfter: tr.observation.versions[0].sources.map((x) => x.source).length, oldVersionShowsExtra: tr.observation.versions[0].sources.some((x) => x.source === extra.id), currentShowsExtra: tr.sources.some((x) => x.source === extra.id), pendingRecorded: r3.needsReview && led2.bindingEvents.some((e) => e.type === "pending"), replayStillNeedsReview: replay.needsReview, confirmed: conf.counts.links_confirm === 1, versionsAfterConfirm: led3.entities[`observation:${o.id}`].versions.length, versionsBeforeConfirm: led2.entities[`observation:${o.id}`].versions.length, boundVersionsAfterConfirm: tr3.observation.versions.map((v) => v.sources.find((x) => x.source === fs0.to.id)?.boundVersion ?? null), pendingAfterConfirm: buildTimeline(led3, { asOf }).pendingBindings.length };
    }
  }
}
// Optional read-only structure spot-check of a real WeFlow export (counts only)
if (args["export-md"]) {
  const file = String(args["export-md"]);
  const text = readFileSync(file, "utf8");
  const before2 = sha(file);
  try {
    const r = adaptMessagesMarkdown(text, { batchId: "spot" });
    report.exportSpotCheck = { ok: true, messages: r.messages, warnings: r.warnings, weakIdentities: r.batch.items.filter((i) => i.identity === "weak").length, sourceOnly: r.batch.items.every((i) => i.kind === "source"), unchanged: sha(file) === before2 };
  } catch (e) { report.exportSpotCheck = { ok: false, error: e.message }; }
}
writeFileSync(path.join(out, "timeline.json"), JSON.stringify(tl, null, 1));
writeFileSync(path.join(out, "timeline.md"), renderMarkdown(tl));
writeFileSync(path.join(out, "timeline.html"), renderHtml(tl));
writeFileSync(path.join(out, "timeline-diff-incremental.json"), JSON.stringify(diff, null, 1));
report.inputsUnchanged = JSON.stringify(before) === JSON.stringify(Object.fromEntries(Object.values(inputs).map((f) => [f, sha(f)])));
report.inputSha256 = before;
writeFileSync(path.join(out, "dryrun-report.json"), JSON.stringify(report, null, 1));
const brief = (rows) => rows.map((p) => ({ b: p.batch, counts: p.counts, err: p.error, rej: p.rejections?.length ?? p.report?.rejections?.length, linkRej: p.linkRejections?.length ?? p.report?.linkRejections?.length }));
console.log(JSON.stringify({ counts: { ...report.counts, perEpisode: undefined, hospitalSkipped: report.counts.hospitalSkipped.length }, perEpisode: report.counts.perEpisode, replayBusinessUnchanged: report.phases.replayBusinessUnchanged, applyFull: brief(report.phases.applyFull), incremental: { ...report.phases.incremental, diff: { ...diff, changedBlocks: diff.changedBlocks.map((c) => ({ ...c, addedItems: c.addedItems.length, changedItems: c.changedItems.length, removedItems: c.removedItems.length })) } }, structured: report.structured, bindingProbe: report.bindingProbe, exportSpotCheck: report.exportSpotCheck, inputsUnchanged: report.inputsUnchanged }, null, 1));
