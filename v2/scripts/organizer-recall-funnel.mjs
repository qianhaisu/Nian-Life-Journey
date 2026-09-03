#!/usr/bin/env node
// Retrospective recall funnel over every fresh window frozen V6 has already scored.
//
// "0 Memories out of 115 fresh windows" is a result, not a diagnosis. This script rebuilds the
// per-layer funnel from the run artifacts the earlier sessions produced, so the question becomes
// answerable: at which layer does a window stop being a Memory candidate?
//
// It makes NO model calls, touches no database and reads only the JSON produced by:
//   scripts/organizer-v6-shadow.mjs         (30 stratified fresh windows)
//   scripts/organizer-continuity-shadow.mjs (35 continuity-probe windows)
//   scripts/writer-v2-fresh-shadow.mjs      (45 fresh windows)
//   scripts/organizer-canary.mjs            ( 5 canary windows)
//
// Those artifacts carry family chat text and live outside the repository; pass their paths in.
//
//   node scripts/organizer-recall-funnel.mjs \
//     --v6=<path> --continuity=<path> --writer=<path> --canary=<path> [--out=<path>.json]
//
// LIMITS OF RETROSPECTION, stated up front because they bound every conclusion below: the runners
// recorded routing outcomes and grounding counts, but only the 30-window V6 set recorded a
// worthiness score, and NONE of them recorded the strong/medium signal lists or the per-dimension
// worthiness axis. So "no strong signal" is inferred here as a residual — a window that cleared
// every gate and still did not promote — which is sound (routeV5 promotes on a strong signal and
// nothing else) but cannot say WHICH dimension fell short. Closing that gap is what the labelled
// corpus run does, by recording the axis directly.
import { readFileSync, writeFileSync } from "node:fs";

const args = process.argv.slice(2);
const argOf = (n, d) => { const h = args.find((a) => a.startsWith(`--${n}=`)); return h ? h.slice(n.length + 3) : d; };
const OUT = argOf("out", null);

const load = (p) => (p ? JSON.parse(readFileSync(p, "utf8")) : null);
const v6Doc = load(argOf("v6", null));
const contDoc = load(argOf("continuity", null));
const writerDoc = load(argOf("writer", null));
const canaryDoc = load(argOf("canary", null));

// ---- Normalise the four runners into one record shape -----------------------------------------
// `promotable` is promotableGroundedFactCount: grounded, subject-resolved raw facts. It is the
// input to the `no_unhedged_fact` gate, so `promotable >= 1` is exactly "this window has at least
// one grounded occurred fact about 张年".
const records = [];
const push = (r) => records.push(r);

for (const r of v6Doc?.results ?? []) {
  push({
    set: "v6-stratified", windowId: r.windowId, fingerprint: r.fingerprint, day: r.activityDate,
    action: r.v6.action, score: r.v6.score, reasons: r.v6.reasons ?? [],
    claims: r.grounding?.claims ?? null, promotable: r.grounding?.promotable ?? null,
    traceEvidence: r.grounding?.traceEvidence ?? null,
    unresolvedSubjects: r.grounding?.unresolvedSubjects ?? null,
    questionClaims: r.grounding?.questionClaims ?? null, planClaims: r.grounding?.planClaims ?? null,
    negated: r.grounding?.negated ?? null, zeroed: r.grounding?.zeroedDimensions ?? [],
    groundingReasons: r.grounding?.reasonCodes ?? [], messages: r.stats?.messageCount ?? null,
  });
}
for (const r of contDoc?.results ?? []) {
  push({
    set: "continuity", windowId: r.windowId, fingerprint: r.fingerprint, day: r.lifeDate ?? r.activityDate,
    action: r.v6.action, score: null, reasons: r.v6.reasons ?? [],
    claims: r.v6.claims ?? null, promotable: r.v6.promotable ?? null, traceEvidence: r.v6.trace ?? null,
    unresolvedSubjects: r.v6.unresolved ?? null, questionClaims: null, planClaims: null, negated: null,
    zeroed: r.v6.zeroed ?? [], groundingReasons: [], messages: r.stats?.messageCount ?? null,
    gateALevel: r.gateA?.v6?.level ?? null, stratum: r.stratum,
  });
}
for (const r of writerDoc?.scored ?? []) {
  push({
    set: "writer-fresh", windowId: r.windowId, fingerprint: r.fingerprint, day: r.lifeDate,
    action: r.action, score: null, reasons: [],
    claims: r.claims ?? null, promotable: r.promotable ?? null, traceEvidence: null,
    unresolvedSubjects: null, questionClaims: null, planClaims: null, negated: null, zeroed: [],
    groundingReasons: r.reasonCodes ?? [], messages: null, shape: r.shape,
  });
}
for (const r of canaryDoc?.windows ?? []) {
  const j = r.judgment ?? {};
  push({
    set: "canary", windowId: r.windowId, fingerprint: r.fingerprint, day: r.lifeDate,
    action: j.action ?? j.v6?.action, score: j.worthinessScore ?? j.score ?? null,
    reasons: j.reasonCodes ?? j.reasons ?? [],
    claims: j.claims ?? j.grounding?.claims ?? null,
    promotable: j.promotable ?? j.grounding?.promotable ?? null,
    traceEvidence: j.traceEvidence ?? j.grounding?.traceEvidence ?? null,
    unresolvedSubjects: null, questionClaims: null, planClaims: null, negated: null, zeroed: [],
    groundingReasons: [], messages: null, subject: j.subject ?? null,
  });
}

// The canary drew its five windows FROM the writer-fresh scored pool (organizer-canary-2026-09-03.md
// §1), so they are re-runs of windows already counted, not new material. The handoff figure of "115
// fresh windows" double-counts them; the true fresh population is 110. Deduplicate by fingerprint,
// keeping the first (original) scoring, and report what was collapsed.
const seen = new Map();
const duplicates = [];
const deduped = [];
for (const r of records) {
  const prior = seen.get(r.fingerprint);
  if (prior) { duplicates.push({ fingerprint: r.fingerprint, keptFrom: prior.set, alsoIn: r.set }); continue; }
  seen.set(r.fingerprint, r);
  deduped.push(r);
}
records.length = 0;
records.push(...deduped);

// ---- The funnel -------------------------------------------------------------------------------
// Layers are evaluated in pipeline order; each counts the windows still alive entering it.
const has = (r, code) => (r.reasons ?? []).some((x) => String(x).includes(code)) || (r.groundingReasons ?? []).some((x) => String(x).includes(code));

const subjectResolved = (r) => {
  if (r.gateALevel) return r.gateALevel !== "unresolved";
  if (has(r, "subject_ambiguous") || has(r, "subject_unresolved")) return false;
  // A window with a promotable grounded fact necessarily resolved a subject for that claim.
  if (r.promotable !== null && r.promotable >= 1) return true;
  if (r.unresolvedSubjects !== null && r.claims !== null) return r.unresolvedSubjects < r.claims;
  return true;
};
const temporalOk = (r) => r.action !== "plan_marker" && !has(r, "not_observed") && !has(r, "planned_not_occurred");
const groundedFact = (r) => (r.promotable ?? 0) >= 1;
const promoted = (r) => r.action === "life_event_candidate";

const total = records.length;
const layers = [];
let alive = records;
const layer = (name, pred, note) => {
  const kept = alive.filter(pred);
  const lost = alive.filter((r) => !pred(r));
  layers.push({ layer: name, entering: alive.length, surviving: kept.length, lost: lost.length, note });
  alive = kept;
  return lost;
};

const lostSubject = layer("subject resolved", subjectResolved, "Gate A / claim-level subject resolution");
const lostTemporal = layer("temporal eligibility (occurred, not planned)", temporalOk, "temporalStatus past|present");
const lostGrounded = layer("≥1 grounded occurred fact about 张年", groundedFact, "promotableGroundedFactCount ≥ 1 — the no_unhedged_fact gate");
// Everything still alive here cleared every routing gate. routeV5 promotes if and only if a strong
// signal survives grounding, so the remaining loss is entirely the worthiness axis.
const lostSignal = layer("strong worthiness signal survives grounding", promoted, "transition ≥2, qualifying capability ≥2, or distinctiveness ≥3");
const memories = alive.length;

// ---- Miss taxonomy ----------------------------------------------------------------------------
// One bucket per window, assigned by the first layer it failed. This is a structural attribution,
// not a judgement about whether the window deserved to be a Memory.
const taxonomy = {
  B_subject_unresolved: lostSubject.length,
  C_planned_or_hypothetical: lostTemporal.length,
  D_no_grounded_occurred_fact: lostGrounded.length,
  EF_cleared_gates_no_strong_signal: lostSignal.length,
  memory: memories,
};
// D splits further where the runner recorded why grounding refused the claims.
const dReasons = {};
for (const r of lostGrounded) {
  const codes = [...new Set([...(r.reasons ?? []), ...(r.groundingReasons ?? [])].map(String))];
  const key = codes.length ? codes.sort().join(" + ") : "(no reason code recorded)";
  dReasons[key] = (dReasons[key] ?? 0) + 1;
}
// The windows that cleared everything and still failed: how close were they, and where did they land?
const signalLoss = {
  byAction: {},
  byPromotableCount: {},
  withZeroedDimensions: lostSignal.filter((r) => (r.zeroed ?? []).length > 0).length,
  zeroedDimensionCounts: {},
  scored: lostSignal.filter((r) => r.score !== null).map((r) => r.score).sort((a, b) => b - a),
};
for (const r of lostSignal) {
  signalLoss.byAction[r.action] = (signalLoss.byAction[r.action] ?? 0) + 1;
  const k = String(r.promotable);
  signalLoss.byPromotableCount[k] = (signalLoss.byPromotableCount[k] ?? 0) + 1;
  for (const d of r.zeroed ?? []) signalLoss.zeroedDimensionCounts[d] = (signalLoss.zeroedDimensionCounts[d] ?? 0) + 1;
}

const bySet = {};
for (const r of records) {
  const s = (bySet[r.set] ??= { n: 0, actions: {}, subjectLost: 0, groundedLost: 0, clearedNoSignal: 0 });
  s.n += 1;
  s.actions[r.action] = (s.actions[r.action] ?? 0) + 1;
  if (!subjectResolved(r)) s.subjectLost += 1;
  else if (temporalOk(r) && !groundedFact(r)) s.groundedLost += 1;
  else if (temporalOk(r) && groundedFact(r) && !promoted(r)) s.clearedNoSignal += 1;
}

const report = {
  generatedAt: new Date().toISOString(),
  totalWindows: total,
  duplicatesCollapsed: duplicates.length,
  duplicates,
  funnel: layers,
  memories,
  taxonomy,
  groundingRefusalReasons: dReasons,
  clearedGatesButNoStrongSignal: signalLoss,
  bySet,
};

console.log(JSON.stringify(report, null, 2));
if (OUT) { writeFileSync(OUT, JSON.stringify({ ...report, records }, null, 2)); console.log(`\nPer-window records → ${OUT}`); }
