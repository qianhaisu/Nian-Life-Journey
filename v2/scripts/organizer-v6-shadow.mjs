#!/usr/bin/env node
// V6 shadow runner. SHADOW ONLY: persist is hard-wired off, no LifeEvent, no DailyTrace, no
// MemoryCandidate, no publication ledger. It reads a corpus produced by
// organizer-fresh-shadow-corpus.mjs and reports what Claim Grounding changes.
//
// The Memory Editor is called ONCE per window and the resulting verdict is routed twice — through
// frozen v5 and through grounded v6 — so every difference in the report is attributable to
// grounding and to nothing else. Calling the model twice would let ordinary model variance show up
// as a "grounding effect".
import { readFileSync, writeFileSync } from "node:fs";
import { createDeepSeekMemoryEditor } from "../lib/organizer/deepseek-editor.ts";
import { createV5RoutingPolicy, createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { validateMemoryEditorVerdict } from "../lib/organizer/contract.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";

const args = process.argv.slice(2);
const argOf = (name, fallback) => { const hit = args.find((a) => a.startsWith(`--${name}=`)); return hit ? hit.slice(name.length + 3) : fallback; };
const CORPUS = argOf("corpus", null);
const OUT = argOf("out", null);
const LIMIT = Number(argOf("limit", "0"));
if (!CORPUS) { console.error("--corpus=<path> is required"); process.exit(1); }

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const NOW = new Date().toISOString();

const { manifest, windows: allWindows } = JSON.parse(readFileSync(CORPUS, "utf8"));
const windows = LIMIT > 0 ? allWindows.slice(0, LIMIT) : allWindows;
console.log(`Corpus: ${CORPUS}`);
console.log(`Windows: ${windows.length}${LIMIT ? ` (limited from ${allWindows.length})` : ""}\n`);

const editor = createDeepSeekMemoryEditor(process.env, SUBJECT, {
  variant: "v4", registry: FAMILY_REGISTRY, singleChildHousehold: true,
});
console.log(`Provider: ${editor.name}  model: ${editor.model}  promptVersion: ${editor.promptVersion}  variant: ${editor.variant}`);
console.log(`persist: FALSE (hard-wired)\n`);

const results = [];
let errors = 0;

for (const [index, window] of windows.entries()) {
  const label = `[${index + 1}/${windows.length}] ${window.windowId.slice(0, 24)} ${window.activityDate} n=${window.stats.messageCount}`;
  let verdict;
  try {
    const response = await editor.organize(window);
    verdict = validateMemoryEditorVerdict(response.verdict, window);
  } catch (error) {
    errors += 1;
    console.log(`${label}  ERROR ${error?.code ?? ""} ${String(error?.message ?? error).slice(0, 120)}`);
    results.push({ windowId: window.windowId, activityDate: window.activityDate, error: String(error?.code ?? error?.message ?? error) });
    continue;
  }

  const axes = editor.axesByWindowId.get(window.windowId);
  const bounded = editor.subjectResolutionByWindowId.get(window.windowId);
  if (!axes || !bounded) {
    errors += 1;
    console.log(`${label}  ERROR missing axes/subject resolution (v4 contract not honoured)`);
    results.push({ windowId: window.windowId, activityDate: window.activityDate, error: "missing_axes" });
    continue;
  }

  // The v4 axes ride alongside the v1 contract; grounding needs them to reach dimension refs.
  const verdictWithAxis = { ...verdict, worthinessAxis: axes.worthinessAxis };
  const grounding = groundClaims(window, verdictWithAxis, SUBJECT, { registry: FAMILY_REGISTRY, singleChildHousehold: true });

  const lookupV5 = () => ({ worthiness: axes.worthinessAxis, evidence: axes.evidenceAxis, subjectResolution: bounded.level });
  const lookupV6 = () => ({ ...lookupV5(), grounding });

  let gatingDetail;
  const v5Policy = createV5RoutingPolicy(lookupV5);
  const v6Policy = createV6RoutingPolicy(lookupV6, (_id, detail) => { gatingDetail = detail; });

  const baseContext = { now: NOW, existingLifeEvents: [], recentSameTypeCount: 0, otherChildDigests: [] };
  const v5 = validate(window, verdictWithAxis, { ...baseContext, routingPolicy: v5Policy });
  const v6 = validate(window, verdictWithAxis, { ...baseContext, routingPolicy: v6Policy, claimGrounding: grounding });

  const row = {
    windowId: window.windowId,
    fingerprint: manifest.windows.find((w) => w.windowId === window.windowId)?.fingerprint,
    conversationId: window.conversationId,
    activityDate: window.activityDate,
    stratum: manifest.windows.find((w) => w.windowId === window.windowId)?.stratum,
    stats: window.stats,
    v5: { action: v5.outcome.action, review: v5.outcome.reviewRequirement, score: v5.outcome.worthinessScore, facts: v5.outcome.coreFacts?.length ?? 0, reasons: v5.reasonCodes },
    v6: { action: v6.outcome.action, review: v6.outcome.reviewRequirement, score: v6.outcome.worthinessScore, facts: v6.outcome.coreFacts?.length ?? 0, reasons: v6.reasonCodes },
    grounding: {
      claims: grounding.claims.length,
      promotable: grounding.promotableGroundedFactCount,
      traceEvidence: grounding.traceEvidenceCount,
      reasonCodes: grounding.reasonCodes,
      zeroedDimensions: gatingDetail?.zeroed ?? [],
      questionClaims: grounding.claims.filter((c) => c.assertionStatus === "question").length,
      planClaims: grounding.claims.filter((c) => c.assertionStatus === "plan_or_hypothetical").length,
      unsupportedClaims: grounding.claims.filter((c) => c.assertionStatus === "unsupported").length,
      unresolvedSubjects: grounding.claims.filter((c) => !c.subject.resolved).length,
      antecedentResolutions: grounding.claims.filter((c) => c.subject.basis === "antecedent_in_window" || c.subject.basis === "antecedent_in_neighbour").length,
      negated: grounding.claims.filter((c) => c.polarity === "negated").length,
    },
    // Evidence for any divergence, so a reviewer can check the call rather than trust a percentage.
    divergenceEvidence: v5.outcome.action === v6.outcome.action ? undefined : grounding.claims.map((c) => ({
      claimId: c.claimId, text: c.text, status: c.assertionStatus, polarity: c.polarity,
      subjectBasis: c.subject.basis, resolved: c.subject.resolved,
      spans: c.supportingSpans.map((s) => ({ ref: s.ref, text: s.text, speechAct: s.speechAct, markers: s.markers })),
      reasons: c.reasons,
    })),
  };
  results.push(row);

  const delta = v5.outcome.action === v6.outcome.action ? "same" : `${v5.outcome.action} -> ${v6.outcome.action}`;
  console.log(`${label}  v5=${v5.outcome.action} v6=${v6.outcome.action}  ${delta === "same" ? "" : "DELTA "}claims=${grounding.claims.length} promotable=${grounding.promotableGroundedFactCount} trace=${grounding.traceEvidenceCount}`);
}

// ---------------------------------------------------------------- report

const ok = results.filter((r) => !r.error);
const rank = (a) => (a === "life_event_candidate" ? 2 : a === "daily_trace" ? 1 : 0);
const same = ok.filter((r) => r.v5.action === r.v6.action);
const demotions = ok.filter((r) => rank(r.v6.action) < rank(r.v5.action));
const promotions = ok.filter((r) => rank(r.v6.action) > rank(r.v5.action));
const memoryPromotions = ok.filter((r) => r.v6.action === "life_event_candidate" && r.v5.action !== "life_event_candidate");

const count = (fn) => ok.reduce((n, r) => n + (fn(r) ? 1 : 0), 0);
const sum = (fn) => ok.reduce((n, r) => n + fn(r), 0);

console.log(`\n${"=".repeat(70)}\nV6 SHADOW REPORT\n${"=".repeat(70)}`);
console.log(`windows attempted     : ${results.length}`);
console.log(`pipeline errors       : ${errors}  (fail-closed: an errored window creates nothing)`);
console.log(`scored                : ${ok.length}`);
console.log(`\n-- routing delta (same verdict, v5 vs v6) --`);
console.log(`same                  : ${same.length}`);
console.log(`demotions             : ${demotions.length}`);
console.log(`promotions (any rank) : ${promotions.length}`);
console.log(`NEW Memory promotions : ${memoryPromotions.length}   <-- must be 0`);
console.log(`\n-- memory / trace counts --`);
console.log(`v5 life_event_candidate: ${count((r) => r.v5.action === "life_event_candidate")}`);
console.log(`v6 life_event_candidate: ${count((r) => r.v6.action === "life_event_candidate")}`);
console.log(`v5 daily_trace         : ${count((r) => r.v5.action === "daily_trace")}`);
console.log(`v6 daily_trace         : ${count((r) => r.v6.action === "daily_trace")}`);
console.log(`v5 store_only          : ${count((r) => r.v5.action === "store_only")}`);
console.log(`v6 store_only          : ${count((r) => r.v6.action === "store_only")}`);
console.log(`\n-- what grounding found --`);
console.log(`total claims           : ${sum((r) => r.grounding.claims)}`);
console.log(`question-derived claims: ${sum((r) => r.grounding.questionClaims)}`);
console.log(`plan/hypothetical      : ${sum((r) => r.grounding.planClaims)}`);
console.log(`unsupported by span    : ${sum((r) => r.grounding.unsupportedClaims)}`);
console.log(`unresolved subjects    : ${sum((r) => r.grounding.unresolvedSubjects)}`);
console.log(`antecedent resolutions : ${sum((r) => r.grounding.antecedentResolutions)}`);
console.log(`negated claims         : ${sum((r) => r.grounding.negated)}`);
console.log(`dimensions zeroed      : ${sum((r) => r.grounding.zeroedDimensions.length)}`);

const stats = editor.stats;
const okCalls = stats.filter((s) => s.ok);
const lat = okCalls.map((s) => s.latencyMs).sort((a, b) => a - b);
console.log(`\n-- model run --`);
console.log(`provider/model         : ${editor.name} / ${editor.model}`);
console.log(`promptVersion/variant  : ${editor.promptVersion} / ${editor.variant}`);
console.log(`calls                  : ${stats.length}  ok=${okCalls.length}  failed=${stats.length - okCalls.length}`);
console.log(`retries                : ${stats.reduce((n, s) => n + s.retries, 0)}`);
console.log(`input tokens           : ${stats.reduce((n, s) => n + (s.inputTokens || 0), 0)}`);
console.log(`output tokens          : ${stats.reduce((n, s) => n + (s.outputTokens || 0), 0)}`);
if (lat.length) console.log(`latency ms             : min=${lat[0]} p50=${lat[Math.floor(lat.length / 2)]} max=${lat[lat.length - 1]}`);
console.log(`persist                : false`);

if (demotions.length) {
  console.log(`\n-- every demotion, with its evidence --`);
  for (const r of demotions) {
    console.log(`\n  ${r.activityDate} ${r.windowId.slice(0, 24)}  ${r.v5.action} -> ${r.v6.action}`);
    console.log(`    zeroed: ${r.grounding.zeroedDimensions.join(",") || "(none)"}  reasons: ${r.grounding.reasonCodes.join(",") || "(none)"}`);
    for (const c of r.divergenceEvidence ?? []) {
      console.log(`    claim "${c.text}"  status=${c.status} polarity=${c.polarity} subject=${c.subjectBasis}`);
      for (const s of c.spans) console.log(`      span [${s.speechAct}${s.markers.length ? " " + s.markers.join("/") : ""}] ${JSON.stringify(s.text.slice(0, 90))}`);
    }
  }
}
if (promotions.length) {
  console.log(`\n-- every promotion, with its evidence --`);
  for (const r of promotions) {
    console.log(`\n  ${r.activityDate} ${r.windowId.slice(0, 24)}  ${r.v5.action} -> ${r.v6.action}`);
    console.log(`    trace evidence: ${r.grounding.traceEvidence}  promotable: ${r.grounding.promotable}  reasons: ${r.grounding.reasonCodes.join(",") || "(none)"}`);
    for (const c of r.divergenceEvidence ?? []) {
      console.log(`    claim "${c.text}"  status=${c.status} subject=${c.subjectBasis}`);
      for (const s of c.spans) console.log(`      span [${s.speechAct}] ${JSON.stringify(s.text.slice(0, 90))}`);
    }
  }
}

if (OUT) {
  writeFileSync(OUT, JSON.stringify({
    generatedAt: NOW, corpus: CORPUS, corpusManifest: manifest,
    provider: { name: editor.name, model: editor.model, promptVersion: editor.promptVersion, variant: editor.variant },
    persist: false, modelStats: stats, results,
  }, null, 2), "utf8");
  console.log(`\nFull results written to ${OUT}`);
}

console.log(`\nVERDICT: ${memoryPromotions.length === 0 ? "no new Memory promotions (invariant held)" : `INVARIANT VIOLATED — ${memoryPromotions.length} new Memory promotions`}`);
