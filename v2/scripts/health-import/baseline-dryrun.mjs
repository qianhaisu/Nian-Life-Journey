// File-level dry-run of the accepted HEALTH-01 baseline through the ledger. Reads inputs read-only
// (sha256 before/after), writes only under --out (outside the repo). No database, no network, no model.
//   node --import tsx scripts/health-import/baseline-dryrun.mjs --r4 DIR --r2 DIR --out DIR [--as-of YYYY-MM-DD]
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HealthFileStore } from "../../lib/health/file-store.ts";
import { runImport } from "../../lib/health/importer.ts";
import { adaptEpisodesR4, adaptHandoff, adaptHospitalR2, adaptWechatFactsR4 } from "../../lib/health/adapters.ts";
import { businessDigest } from "../../lib/health/model.ts";
import { confirmedFactIds, membership } from "../../lib/health/ledger.ts";
import { buildTimeline, diffTimelines, renderHtml, renderMarkdown } from "../../lib/health/timeline.ts";
import { assertLedgerOutsideRepo, parseArgs } from "./cli.mjs";

const args = parseArgs(process.argv.slice(2));
const r4 = String(args.r4), r2 = String(args.r2), out = String(args.out), asOf = String(args["as-of"] ?? "2026-09-21");
assertLedgerOutsideRepo(out);
const jsonl = (f) => readFileSync(f, "utf8").split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l));
const sha = (f) => createHash("sha256").update(readFileSync(f)).digest("hex");
const inputs = [`${r4}/wechat-facts-r4.jsonl`, `${r4}/episodes-r4.jsonl`, `${r2}/encounters.jsonl`, `${r2}/canonical-facts.jsonl`, `${r2}/source-manifest.jsonl`, `${r2}/handoff-reconciliation.jsonl`];
const before = Object.fromEntries(inputs.map((f) => [f, sha(f)]));

const facts = jsonl(inputs[0]), episodes = jsonl(inputs[1]);
const hosp = adaptHospitalR2({ encounters: jsonl(inputs[2]), canonicalFacts: jsonl(inputs[3]), manifest: jsonl(inputs[4]) }, "hospital");
const handoffRows = jsonl(inputs[5]);
const batches = (factRows, epRows) => [hosp.batch, adaptWechatFactsR4(factRows, "wechat"), adaptEpisodesR4(epRows, "episodes"), adaptHandoff(handoffRows, "handoff")];
const report = { generatedFor: "HEALTH-02 file-level dry-run", asOf, phases: {} };

async function runAll(store, bs, apply) {
  const rows = [];
  for (const b of bs) {
    try {
      const r = await runImport(store, b, { apply, now: () => `${asOf}T00:00:00Z` });
      rows.push({ batch: b.batchId, applied: r.applied, counts: r.counts, rejected: r.rejected, impactEpisodes: r.impact.episodes, rejections: r.items.filter((i) => i.action === "rejected").slice(0, 10), linkRejections: r.links.filter((l) => l.action === "rejected").slice(0, 10), conflicts: r.items.filter((i) => ["conflict", "ambiguous"].includes(i.action)).slice(0, 10), heldLinks: r.links.filter((l) => l.action === "held").length });
      if (r.rejected) break;
    } catch (e) {
      rows.push({ batch: b.batchId, applied: false, error: e.message, report: e.report ? { counts: e.report.counts, rejections: e.report.items.filter((i) => i.action === "rejected").slice(0, 10), linkRejections: e.report.links.filter((l) => l.action === "rejected").slice(0, 10) } : null });
      break;
    }
  }
  return rows;
}

mkdirSync(out, { recursive: true });
rmSync(path.join(out, "ledger-full"), { recursive: true, force: true });
rmSync(path.join(out, "ledger-incremental"), { recursive: true, force: true });

// Phase 1: dry-run against an empty ledger, then apply to a scratch ledger
const full = new HealthFileStore(path.join(out, "ledger-full"));
report.phases.dryRunEmpty = await runAll(full, batches(facts, episodes), false);
report.phases.applyFull = await runAll(full, batches(facts, episodes), true);
const fullLedger = await full.read();
report.phases.digestAfterFirstApply = businessDigest(fullLedger);
// Phase 2: replay unchanged
report.phases.replay = await runAll(full, batches(facts, episodes), true);
report.phases.digestAfterReplay = businessDigest(await full.read());
report.phases.replayBusinessUnchanged = report.phases.digestAfterFirstApply === report.phases.digestAfterReplay;

// Phase 3: incremental. Baseline = everything except the newest ~5% of facts.
const cut = Math.floor(facts.length * 0.95);
const heldBack = facts.slice(cut);
const factsOld = facts.slice(0, cut);
const oldIds = new Set(factsOld.map((f) => f.fact_id));
const episodesOld = episodes.map((e) => ({ ...e, wechat_fact_ids: (e.wechat_fact_ids ?? []).filter((i) => oldIds.has(i)), candidate_fact_ids: (e.candidate_fact_ids ?? []).filter((i) => oldIds.has(i)) }));
const inc = new HealthFileStore(path.join(out, "ledger-incremental"));
const seed = await runAll(inc, batches(factsOld, episodesOld), true);
const incBefore = await inc.read();
const tlBefore = buildTimeline(incBefore, { asOf });
report.phases.incrementalSeed = seed.map((s) => ({ batch: s.batch, counts: s.counts, error: s.error }));
report.phases.incrementalDryRun = await runAll(inc, batches(facts, episodes), false);
report.phases.incrementalApply = await runAll(inc, batches(facts, episodes), true);
const incAfter = await inc.read();
const tlAfter = buildTimeline(incAfter, { asOf, previous: tlBefore });
const diff = diffTimelines(tlBefore, tlAfter);
report.phases.incremental = { heldBackFacts: heldBack.length, timelineStats: tlAfter.stats, diff, finalDigestEqualsFull: businessDigest(incAfter) === report.phases.digestAfterFirstApply };

// Counts vs accepted baseline
const kinds = {};
for (const e of Object.values(fullLedger.entities)) kinds[e.kind] = (kinds[e.kind] ?? 0) + 1;
const candSet = (e) => new Set(e.candidate_fact_ids ?? []);
const cand = episodes.reduce((n, e) => n + candSet(e).size, 0);
const attachedExpected = episodes.reduce((n, e) => n + (e.wechat_fact_ids ?? []).filter((i) => !candSet(e).has(i)).length, 0);
const tl = buildTimeline(fullLedger, { asOf });
report.counts = {
  ledgerEntitiesByKind: kinds, wechatFactsInInput: facts.length, episodesInInput: episodes.length,
  candidateLinksExpected: cand, attachedLinksExpected: attachedExpected,
  candidateLinksInLedger: tl.blocks.reduce((n, b) => n + b.candidates.length, 0), attachedLinksInLedger: tl.blocks.reduce((n, b) => n + b.items.length, 0),
  unattachedObservations: tl.unattached.length, hospitalSkipped: hosp.skipped,
  perEpisode: episodes.map((e) => ({ id: e.id, expectedAttached: (e.wechat_fact_ids ?? []).filter((i) => !candSet(e).has(i)).length, ledgerAttached: confirmedFactIds(fullLedger, e.id).length, expectedCandidates: candSet(e).size, ledgerCandidates: membership(fullLedger, e.id).candidate.length, status: tl.blocks.find((b) => b.episodeId === e.id)?.derivedStatus })),
};
writeFileSync(path.join(out, "timeline.json"), JSON.stringify(tl, null, 1));
writeFileSync(path.join(out, "timeline.md"), renderMarkdown(tl));
writeFileSync(path.join(out, "timeline.html"), renderHtml(tl));
writeFileSync(path.join(out, "timeline-diff-incremental.json"), JSON.stringify(diff, null, 1));
const after = Object.fromEntries(inputs.map((f) => [f, sha(f)]));
report.inputsUnchanged = JSON.stringify(before) === JSON.stringify(after);
report.inputSha256 = before;
writeFileSync(path.join(out, "dryrun-report.json"), JSON.stringify(report, null, 1));
const brief = (rows) => rows.map((p) => ({ b: p.batch, counts: p.counts, err: p.error, rej: p.rejections?.length ?? p.report?.rejections?.length, linkRej: p.linkRejections?.length ?? p.report?.linkRejections?.length }));
console.log(JSON.stringify({ counts: report.counts, replayBusinessUnchanged: report.phases.replayBusinessUnchanged, applyFull: brief(report.phases.applyFull), replay: brief(report.phases.replay), incremental: { ...report.phases.incremental, diff: { ...diff, changedBlocks: diff.changedBlocks.map((c) => ({ ...c, addedItems: c.addedItems.length, changedItems: c.changedItems.length, removedItems: c.removedItems.length })) } }, inputsUnchanged: report.inputsUnchanged }, null, 1));
