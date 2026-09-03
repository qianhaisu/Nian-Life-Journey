#!/usr/bin/env node
// Subject-continuity shadow (Phase A3, 2026-09-03). SHADOW ONLY: persist is hard-wired off — no
// LifeEvent, DailyTrace, MemoryCandidate or ledger row is written.
//
// The Memory Editor is called ONCE per window, on the plain window (no continuity context), so the
// model sees exactly what frozen V6 shows it. The same raw verdict is then judged twice:
//
//   arm "v6"          frozen Gate A + frozen claim grounding + V6 routing (production behaviour)
//   arm "continuity"  Gate A and claim grounding re-run on the same window with bounded
//                     same-conversation context attached (subject-continuity.ts); routing unchanged
//
// Every difference is therefore attributable to continuity resolution and to nothing else, and every
// changed claim is reported with its antecedent, distance, competing subjects and chain speakers.
import { readFileSync, writeFileSync } from "node:fs";
import { createDeepSeekMemoryEditor, coerceSubjectRelevance } from "../lib/organizer/deepseek-editor.ts";
import { createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { resolveSubjectBounded } from "../lib/organizer/subject-resolver.ts";
import { attachContinuityContext, SUBJECT_CONTINUITY_VERSION } from "../lib/organizer/subject-continuity.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const CORPUS = argOf("corpus", null);
const OUT = argOf("out", null);
const LIMIT = Number(argOf("limit", "0"));
if (!CORPUS) { console.error("--corpus=<path> is required"); process.exit(1); }

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };
const NOW = new Date().toISOString();

const { manifest, windows: allWindows, conversations } = JSON.parse(readFileSync(CORPUS, "utf8"));
const windows = LIMIT > 0 ? allWindows.slice(0, LIMIT) : allWindows;
const withContext = new Map();
for (const [conversation, list] of Object.entries(conversations)) for (const w of attachContinuityContext(list)) withContext.set(w.windowId, w);
console.log(`Corpus: ${CORPUS}\nWindows: ${windows.length}  continuity: ${SUBJECT_CONTINUITY_VERSION} bounds=${JSON.stringify(manifest.bounds)}`);

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, { variant: "v4", ...OPTS });
console.log(`Provider: ${editor.name}  model: ${editor.model}  promptVersion: ${editor.promptVersion}\npersist: FALSE (hard-wired)\n`);

const results = [];
let errors = 0;
const baseContext = { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] };

function judge(window, raw, bounded) {
  const verdict = validateMemoryEditorVerdict(raw, window);
  const axes = editor.axesByWindowId.get(window.windowId);
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, OPTS);
  let gatingDetail;
  const policy = createV6RoutingPolicy(() => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level, grounding }), (_id, detail) => { gatingDetail = detail; });
  const outcome = validate(window, verdictWithAxis, { ...baseContext, routingPolicy: policy, claimGrounding: grounding });
  return { verdict, grounding, outcome, zeroed: gatingDetail?.zeroed ?? [] };
}

for (const [index, plain] of windows.entries()) {
  const meta = manifest.windows.find((w) => w.windowId === plain.windowId);
  const label = `[${index + 1}/${windows.length}] ${plain.windowId.slice(0, 24)} ${plain.activityDate} ${meta?.stratum} n=${plain.stats.messageCount}`;
  const contextual = withContext.get(plain.windowId);
  if (!contextual) { console.log(`${label}  ERROR window missing from conversation list`); errors += 1; continue; }
  let raw;
  try {
    raw = (await editor.organize(plain)).verdict;
  } catch (error) {
    errors += 1;
    console.log(`${label}  ERROR ${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 120)}`);
    results.push({ windowId: plain.windowId, stratum: meta?.stratum, error: String(error?.code ?? error?.message ?? error) });
    continue;
  }
  const boundedV6 = editor.subjectResolutionByWindowId.get(plain.windowId);

  // Continuity arm: same raw verdict, Gate A re-coerced from the model's own detail field.
  const boundedC = resolveSubjectBounded(contextual, SUBJECT, OPTS);
  const rawC = { ...raw, subjectIds: [...(raw.subjectIds ?? [])] };
  const gate = coerceSubjectRelevance(rawC, contextual, SUBJECT, boundedC);
  rawC.subjectRelevance = gate.subjectRelevance;
  if (gate.subjectRelevance !== "primary") rawC.subjectIds = [];
  const bareReason = String(raw.selectionReason ?? "").replace(/^gate_a_[a-z_]+: /, "");
  rawC.selectionReason = gate.gateAReason ? `${gate.gateAReason}: ${bareReason.slice(0, 100)}`.slice(0, 120) : bareReason;

  let v6, cont;
  try {
    v6 = judge(plain, raw, boundedV6);
    cont = judge(contextual, rawC, boundedC);
  } catch (error) {
    errors += 1;
    console.log(`${label}  ERROR judging: ${String(error?.message ?? error).slice(0, 160)}`);
    results.push({ windowId: plain.windowId, stratum: meta?.stratum, error: String(error?.message ?? error) });
    continue;
  }

  const claimDeltas = cont.grounding.claims.map((claim, i) => {
    const before = v6.grounding.claims[i];
    if (!before || before.subject.resolved === claim.subject.resolved) return undefined;
    return {
      claimId: claim.claimId, text: claim.text, direction: claim.subject.resolved ? "unresolved->resolved" : "resolved->unresolved",
      beforeBasis: before.subject.basis, afterBasis: claim.subject.basis, status: claim.assertionStatus, polarity: claim.polarity, observationMode: claim.observationMode,
      anchorSpans: claim.supportingSpans.map((s) => ({ ref: s.ref, text: s.text, speechAct: s.speechAct, speaker: s.speaker.relationshipToSubject ?? "unknown" })),
      continuity: claim.subject.continuity,
      antecedentText: claim.subject.continuity?.antecedentSpan ? textOfRef(contextual, claim.subject.continuity.antecedentSpan.ref) : undefined,
    };
  }).filter(Boolean);

  const row = {
    windowId: plain.windowId, fingerprint: meta?.fingerprint, stratum: meta?.stratum, activityDate: plain.activityDate, lifeDate: meta?.lifeDate,
    nearestNameDistance: meta?.nearestNameDistance, stats: plain.stats,
    gateA: { v6: { level: boundedV6.level, blockers: boundedV6.blockers, relevance: raw.subjectRelevance }, continuity: { level: boundedC.level, blockers: boundedC.blockers, relevance: rawC.subjectRelevance, evidence: boundedC.continuity } },
    v6: { action: v6.outcome.outcome.action, review: v6.outcome.outcome.reviewRequirement, reasons: v6.outcome.reasonCodes, promotable: v6.grounding.promotableGroundedFactCount, trace: v6.grounding.traceEvidenceCount, unresolved: v6.grounding.claims.filter((c) => !c.subject.resolved).length, claims: v6.grounding.claims.length, zeroed: v6.zeroed },
    continuity: { action: cont.outcome.outcome.action, review: cont.outcome.outcome.reviewRequirement, reasons: cont.outcome.reasonCodes, promotable: cont.grounding.promotableGroundedFactCount, trace: cont.grounding.traceEvidenceCount, unresolved: cont.grounding.claims.filter((c) => !c.subject.resolved).length, claims: cont.grounding.claims.length, zeroed: cont.zeroed, continuityBlockers: [...new Set(cont.grounding.claims.flatMap((c) => c.subject.continuity?.blockers ?? []))] },
    claimDeltas,
  };
  results.push(row);
  const delta = row.v6.action === row.continuity.action ? "same" : `${row.v6.action} -> ${row.continuity.action}`;
  console.log(`${label}  gateA ${boundedV6.level}->${boundedC.level}  v6=${row.v6.action} cont=${row.continuity.action}${delta === "same" ? "" : "  DELTA"}  claims=${row.v6.claims} unresolved ${row.v6.unresolved}->${row.continuity.unresolved}  ${claimDeltas.length ? `changed=${claimDeltas.length}` : ""}`);
}

function textOfRef(window, ref) {
  const [itemId, spanId] = ref.split("#");
  const pool = [...(window.continuity?.priorItems ?? []), ...window.neighbors.before, ...window.items];
  const item = pool.find((i) => i.itemId === itemId);
  const span = item?.spans.find((s) => s.id === spanId);
  return item && span ? item.text.slice(span.start, span.end) : undefined;
}

// ---------------------------------------------------------------- report
const ok = results.filter((r) => !r.error);
const byStratum = {};
for (const r of ok) {
  const s = (byStratum[r.stratum] ??= { windows: 0, gateAChanged: 0, actionChanged: 0, up: 0, down: 0, resolvedGained: 0, resolvedLost: 0 });
  s.windows += 1;
  if (r.gateA.v6.level !== r.gateA.continuity.level) s.gateAChanged += 1;
  if (r.v6.action !== r.continuity.action) s.actionChanged += 1;
  s.up += r.claimDeltas.filter((d) => d.direction === "unresolved->resolved").length;
  s.down += r.claimDeltas.filter((d) => d.direction === "resolved->unresolved").length;
  s.resolvedGained += r.continuity.claims - r.continuity.unresolved - (r.v6.claims - r.v6.unresolved);
}
const rank = (a) => (a === "life_event_candidate" ? 2 : a === "daily_trace" ? 1 : 0);
console.log(`\n${"=".repeat(70)}\nSUBJECT CONTINUITY SHADOW REPORT\n${"=".repeat(70)}`);
console.log(`windows attempted: ${results.length}   errors: ${errors}   scored: ${ok.length}`);
console.log(`\n-- per stratum --`);
for (const [stratum, s] of Object.entries(byStratum)) console.log(`${stratum.padEnd(28)} windows=${s.windows} gateA-changed=${s.gateAChanged} action-changed=${s.actionChanged} claims unresolved->resolved=${s.up} resolved->unresolved=${s.down}`);
console.log(`\n-- totals --`);
console.log(`claims unresolved->resolved : ${ok.reduce((n, r) => n + r.claimDeltas.filter((d) => d.direction === "unresolved->resolved").length, 0)}`);
console.log(`claims resolved->unresolved : ${ok.reduce((n, r) => n + r.claimDeltas.filter((d) => d.direction === "resolved->unresolved").length, 0)}   <-- must be 0`);
console.log(`v6  life_event_candidate/daily_trace/store_only : ${["life_event_candidate", "daily_trace", "store_only"].map((a) => ok.filter((r) => r.v6.action === a).length).join("/")}`);
console.log(`cont life_event_candidate/daily_trace/store_only: ${["life_event_candidate", "daily_trace", "store_only"].map((a) => ok.filter((r) => r.continuity.action === a).length).join("/")}`);
console.log(`promotions: ${ok.filter((r) => rank(r.continuity.action) > rank(r.v6.action)).length}   demotions: ${ok.filter((r) => rank(r.continuity.action) < rank(r.v6.action)).length}`);
console.log(`leakage check — continuity resolutions inside competing_child / adult_ambiguity / logistics / stale_antecedent strata: ${ok.filter((r) => ["competing_child", "adult_ambiguity", "logistics", "stale_antecedent"].includes(r.stratum) && r.claimDeltas.some((d) => d.direction === "unresolved->resolved")).length}   <-- must be 0`);
console.log(`\n-- every changed claim, with its evidence --`);
for (const r of ok) for (const d of r.claimDeltas) {
  console.log(`\n  ${r.activityDate} ${r.windowId.slice(0, 24)} [${r.stratum}] ${d.direction}  ${d.beforeBasis} -> ${d.afterBasis}  status=${d.status} mode=${d.observationMode}`);
  console.log(`    claim: ${JSON.stringify(d.text)}`);
  for (const s of d.anchorSpans) console.log(`    anchor [${s.speaker}/${s.speechAct}] ${JSON.stringify(s.text.slice(0, 80))}`);
  if (d.continuity) console.log(`    antecedent ${JSON.stringify(d.continuity.antecedentSourceIds.map((id) => id.slice(-12)))} span=${d.continuity.antecedentSpan?.ref.slice(0, 20)} dist=${JSON.stringify(d.continuity.antecedentDistance)} reason=${d.continuity.continuityReason} competing=${JSON.stringify(d.continuity.competingSubjectIds)} chain=${JSON.stringify(d.continuity.chainSpeakerIds)}`);
  if (d.antecedentText) console.log(`    antecedent text: ${JSON.stringify(d.antecedentText.slice(0, 80))}`);
}
console.log(`\n-- continuity blockers seen (windows) --`);
const blockerTally = {};
for (const r of ok) for (const b of r.continuity.continuityBlockers) blockerTally[b] = (blockerTally[b] ?? 0) + 1;
console.log(JSON.stringify(blockerTally));

const stats = editor.stats;
const okCalls = stats.filter((s) => s.ok);
const lat = okCalls.map((s) => s.latencyMs).sort((a, b) => a - b);
console.log(`\n-- model run --  calls=${stats.length} ok=${okCalls.length} retries=${stats.reduce((n, s) => n + s.retries, 0)} in=${stats.reduce((n, s) => n + (s.inputTokens || 0), 0)} out=${stats.reduce((n, s) => n + (s.outputTokens || 0), 0)} latency p50=${lat[Math.floor(lat.length / 2)] ?? "-"} max=${lat.at(-1) ?? "-"}  persist=false`);

if (OUT) {
  writeFileSync(OUT, JSON.stringify({ generatedAt: NOW, corpus: CORPUS, corpusManifest: manifest, continuityVersion: SUBJECT_CONTINUITY_VERSION, provider: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion }, persist: false, modelStats: stats, results }, null, 2), "utf8");
  console.log(`Full results written to ${OUT}`);
}
