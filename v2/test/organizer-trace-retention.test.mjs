import test from "node:test";
import assert from "node:assert/strict";
import { routeV4 } from "../lib/organizer/worthiness-v4.ts";
import { routeV5 } from "../lib/organizer/worthiness-v5.ts";
import { groundClaims } from "../lib/organizer/claim-grounding.ts";
import { createV6RoutingPolicy } from "../lib/organizer/routing-policies.ts";
import { validate } from "../lib/organizer/validator.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";

// Memory promotion and DailyTrace retention are two different questions, and Claim Grounding had
// accidentally welded them together: it correctly zeroed the grounded fact count for a window whose
// only "fact" came from a question, and because `no_unhedged_fact` is a gate whose failure returns
// store_only, the real ordinary day was discarded along with the Memory.
//
// "宁可少写" governs what becomes a Memory. It does not license deleting true traces of a life.

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "年年", "宝宝"] };
const OPTS = { registry: FAMILY_REGISTRY, singleChildHousehold: true };

let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  const id = `item:${String(seq).padStart(24, "0")}`;
  const parts = text.split(/(?<=[。！？!?\n])/u).filter((p) => p.trim());
  const spans = [];
  let cursor = 0;
  (parts.length ? parts : [text]).forEach((part, index) => {
    spans.push({ id: `span-${index}`, start: cursor, end: cursor + part.length });
    cursor += part.length;
  });
  return {
    itemId: id, sourceId: opts.sourceId ?? `src-${seq}`, sentAt: "2026-03-01T10:00:00.000Z",
    senderRole: opts.senderRole ?? "speaker-a", senderDigest: opts.senderDigest ?? "digest-a",
    text, contentTypes: ["daily"], mediaRefs: [], locator: { document: "d", recordOrdinal: seq },
    spans, tier: "firsthand_observation",
  };
}
function windowOf(items, neighbors = { before: [], after: [] }) {
  return {
    windowId: "window:test", conversationId: "conversation:test", profileId: "profile-zhangnian",
    activityDate: "2026-03-01", timeRange: { from: "2026-03-01T10:00:00.000Z", to: "2026-03-01T11:00:00.000Z" },
    items, mediaBindings: [], neighbors, priorContext: { dailyTraces: [], lifeEvents: [] },
    stats: { messageCount: items.length, imageCount: 0, senderCount: 1, droppedCount: 0 },
  };
}
const ref = (it, n = 0) => `${it.itemId}#span-${n}`;

const AXIS_ORDINARY = {
  developmentalTransition: { score: 0, basis: "unknown", evidenceRefs: [] },
  newCapabilityOrIndependence: { score: 0, kind: "none", evidenceRefs: [] },
  distinctiveFamilyMoment: { score: 0, evidenceRefs: [] },
  relationshipSignificance: { score: 0, evidenceRefs: [] },
  futureRecallValue: { score: 0, evidenceRefs: [] },
  noDistinctiveMemorySignal: false,
};

const BASE_INPUT = {
  worthiness: AXIS_ORDINARY,
  evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
  subjectRelevance: "primary",
  subjectResolution: "explicit",
  temporalStatus: "past",
  rawFactCount: 0,
};

// ---------------------------------------------------------------- frozen v4 / v5 are untouched

test("v4 and v5 are byte-identical when no trace evidence count is supplied (frozen behaviour)", () => {
  const v4 = routeV4({ ...BASE_INPUT });
  assert.equal(v4.action, "store_only", "without the new field, a failed gate still means store_only");
  assert.deepEqual(v4.blockedBy, ["no_unhedged_fact"]);
  assert.equal(v4.retainedDespitePromotionGate, undefined);

  const v5 = routeV5({ ...BASE_INPUT });
  assert.equal(v5.action, "store_only");
  assert.equal(v5.retainedDespitePromotionGate, undefined);
});

test("supplying traceEvidenceCount never changes a decision that was not gate-blocked", () => {
  const promotable = {
    ...BASE_INPUT,
    rawFactCount: 1,
    worthiness: { ...AXIS_ORDINARY, newCapabilityOrIndependence: { score: 3, kind: "developmental_ability", evidenceRefs: ["a#s"] } },
  };
  const without = routeV5(promotable);
  const with_ = routeV5({ ...promotable, traceEvidenceCount: 5 });
  assert.equal(without.action, "life_event_candidate");
  assert.deepEqual({ ...with_ }, { ...without }, "the field must be inert unless a promotion-only gate failed");
});

// ---------------------------------------------------------------- the split itself

test("a promotion-only gate failure keeps the day as a trace instead of deleting it", () => {
  const routed = routeV5({ ...BASE_INPUT, traceEvidenceCount: 1 });
  assert.equal(routed.action, "daily_trace", "no promotable fact must not mean no day");
  assert.equal(routed.retainedDespitePromotionGate, true);
  assert.deepEqual(routed.blockedBy, ["no_unhedged_fact"], "the gate still records that promotion was refused");
});

test("a promotion-only gate failure with NO trace evidence is still store_only", () => {
  const routed = routeV5({ ...BASE_INPUT, traceEvidenceCount: 0 });
  assert.equal(routed.action, "store_only");
});

test("an unresolved subject blocks the trace too — another child's day is not 张年's day", () => {
  for (const blocking of [
    { subjectResolution: "unresolved", gate: "subject_unresolved" },
    { subjectRelevance: "ambiguous", gate: "subject_not_primary" },
    { temporalStatus: "planned", gate: "not_observed" },
    { evidence: { evidenceConfidence: "low", evidenceRefs: [] }, gate: "low_evidence_confidence" },
  ]) {
    const { gate, ...override } = blocking;
    const routed = routeV5({ ...BASE_INPUT, rawFactCount: 1, traceEvidenceCount: 9, ...override });
    assert.equal(routed.action, "store_only", `${gate} must block retention as well as promotion`);
    assert.ok(routed.blockedBy.includes(gate), `${gate} should be recorded, saw ${routed.blockedBy.join(",")}`);
  }
});

test("a retention blocker alongside a promotion-only blocker still blocks retention", () => {
  const routed = routeV5({ ...BASE_INPUT, subjectResolution: "unresolved", traceEvidenceCount: 9 });
  assert.equal(routed.action, "store_only");
  assert.deepEqual(routed.blockedBy.sort(), ["no_unhedged_fact", "subject_unresolved"]);
});

// ---------------------------------------------------------------- end to end through grounding

function questionWindow() {
  const asked = item("小年会自己站了？");
  const reply = item("真的", { senderDigest: "digest-b" });
  return { window: windowOf([asked, reply]), asked, reply };
}

function verdictOf(coreFacts, axis) {
  return {
    windowId: "window:test", subjectRelevance: "primary", subjectIds: [], temporalStatus: "past",
    occurredAtProposal: { value: "2026-03-01", basis: "sent_at", evidenceRefs: [] },
    coreFacts, quotableLines: [], worthinessDimensions: {}, duplicateCandidates: [],
    uncertainty: { time: "low", subject: "low", semantics: "low" }, sensitivityFlags: [],
    prohibitedInferences: [], proposedAction: "life_event_candidate", selectionReason: "t", confidence: 0.9,
    worthinessAxis: axis ?? AXIS_ORDINARY,
  };
}

test("the HV2-N03 shape: no Memory, but the day survives as an evidence-grounded trace", () => {
  const { window, asked } = questionWindow();
  const verdict = verdictOf([{ statement: "家人说张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(asked)] }]);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  assert.equal(grounding.promotableGroundedFactCount, 0, "a question can never supply a promotable fact");
  assert.ok(grounding.traceEvidenceCount >= 1, "but it is still real evidence that the day happened");

  const policy = createV6RoutingPolicy(() => ({
    worthiness: AXIS_ORDINARY, evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
    subjectResolution: "explicit", grounding,
  }));
  const routed = policy.decide({ window, verdict });
  assert.equal(routed.action, "daily_trace", "the day must be kept");
});

test("the trace records that it was discussed, verbatim, and never states it as fact", () => {
  const { window, asked } = questionWindow();
  const verdict = verdictOf([{ statement: "家人说张小年会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(asked)] }]);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);

  const policy = createV6RoutingPolicy(() => ({
    worthiness: AXIS_ORDINARY, evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
    subjectResolution: "explicit", grounding,
  }));
  const result = validate(window, verdict, {
    now: "2026-03-02T00:00:00.000Z", existingLifeEvents: [], recentSameTypeCount: 0,
    routingPolicy: policy, claimGrounding: grounding,
  });

  assert.equal(result.outcome.action, "daily_trace");
  const lines = result.outcome.traceLines;
  assert.ok(lines.length > 0);
  const joined = lines.map((l) => l.text).join(" | ");

  assert.ok(joined.includes("家里聊到"), `expected a discussion framing, got: ${joined}`);
  assert.ok(joined.includes("会自己站了？"), "the evidence span must be quoted verbatim, question mark included");
  assert.ok(!joined.includes("家人说张小年会自己站了"), "the factualized model statement must never reach the trace");
  assert.ok(!/条消息|张媒体/.test(joined), "the count-string fallback is a Media-First violation and must not be the outcome here");
  for (const line of lines) assert.ok(line.evidenceRefs.length > 0, "every trace line must cite its span");
});

test("a resolved-subject assertion still produces a plain factual trace line, unchanged", () => {
  const stated = item("小年今天自己吃完了一整碗面。");
  const window = windowOf([stated]);
  const verdict = verdictOf([{ statement: "小年自己吃完了一整碗面", assertionKind: "raw_fact", evidenceRefs: [ref(stated)] }]);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);
  assert.equal(grounding.promotableGroundedFactCount, 1);

  const policy = createV6RoutingPolicy(() => ({
    worthiness: AXIS_ORDINARY, evidence: { evidenceConfidence: "medium", evidenceRefs: [] },
    subjectResolution: "explicit", grounding,
  }));
  const result = validate(window, verdict, {
    now: "2026-03-02T00:00:00.000Z", existingLifeEvents: [], recentSameTypeCount: 0,
    routingPolicy: policy, claimGrounding: grounding,
  });
  assert.equal(result.outcome.action, "daily_trace");
  assert.equal(result.outcome.traceLines[0].text, "小年自己吃完了一整碗面", "a grounded fact is stated, not framed as talk");
});

test("discussion lines are never built for a claim whose subject did not resolve", () => {
  const other = item("表姐家的小女孩会自己站了？");
  const window = windowOf([other]);
  const verdict = verdictOf([{ statement: "会自己站了", assertionKind: "raw_fact", evidenceRefs: [ref(other)] }]);
  const grounding = groundClaims(window, verdict, SUBJECT, OPTS);
  assert.equal(grounding.traceEvidenceCount, 0, "a competing person means this day is not attributable to 张年");
});
