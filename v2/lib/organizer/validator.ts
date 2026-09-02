// Evidence Validator (§8, hard rules H1–H9). Fully deterministic — no model call. Failure always
// degrades the SAME decision (life_event_candidate → daily_trace → store_only); it never hands the
// window to a different decision maker. That single rule is what fixes the old ai.ts fallback bug.
import type { ContentType } from "@/lib/types";
import type { EvidenceWindow } from "./evidence/types";
import type { CoreFact, MemoryEditorVerdict, OrganizerOutcome, QuotableLine, SensitivityFlag } from "./contract";
import { CONTRACT_POLICY_VERSION } from "./contract";
import { computeWorthiness, route, type RouteDecision, type WorthinessInput, type WorthinessResult } from "./worthiness";

export const VALIDATOR_VERSION = "evidence-validator-v1";

// Routing is an explicit, injectable policy rather than a hard-wired call.
//
// This exists because of a real and costly mistake: routeV2/V3/V4 were computed BESIDE the pipeline
// while validate() went on calling the v1 route(), so several rounds of "positives rescued" numbers
// described a layer production never consulted. A policy object makes the router a visible
// dependency — and `expectedRoutingPolicyId` makes a silent fallback to v1 impossible to repeat.
export type RoutingPolicy = {
  id: string;
  decide(input: { window: EvidenceWindow; verdict: MemoryEditorVerdict; worthiness: WorthinessResult }): RouteDecision;
};

export const V1_ROUTING_POLICY: RoutingPolicy = {
  id: "worthiness-v1",
  decide: ({ verdict, worthiness }) => route(worthiness, verdict),
};

const HEDGE_WORDS = /可能|好像|听说|据说|大概|应该是|估计|似乎|我觉得/;
const MEDICAL_WORDS = /诊断|病因|治疗建议|用药建议|处方|药物剂量|确诊|痊愈|diagnos|treatment recommendation|prescription/i;
const PLANNED_WORDS = /明天|下周|打算|准备|约了|待会|下次|计划/;
const NEGATION_WORDS = /没去|取消|改天|没有去/;

export type ValidatorContext = {
  now: string;
  modelVersion: string;
  existingLifeEvents: Array<{ id: string; occurredAt: string; contentTypes: ContentType[]; visibility: string }>;
  recentSameTypeCount: number;
  otherChildDigests?: string[];
  /** Source ids of the prior observations the pipeline actually supplied to the editor. Only a
   *  baseline drawn from this list can support a transition claim (H8 path B). */
  supportedPriorSourceIds?: string[];
  /** Defaults to the production v1 router. Evaluation injects an alternative explicitly. */
  routingPolicy?: RoutingPolicy;
  /**
   * When set, validate() throws unless the active policy has this id. An evaluation that means to
   * measure v4 therefore cannot quietly measure v1 instead — it fails loudly at the boundary.
   */
  expectedRoutingPolicyId?: string;
};

export type ValidatorResult = { outcome: OrganizerOutcome; degradeReason?: string; reasonCodes: string[] };

function spanText(window: EvidenceWindow, ref: string): string {
  const [itemId, spanId] = ref.split("#");
  const item = window.items.find((candidate) => candidate.itemId === itemId);
  const span = item?.spans.find((candidate) => candidate.id === spanId);
  if (!item || !span) return "";
  return item.text.slice(span.start, span.end);
}

function evidenceText(window: EvidenceWindow, refs: string[]): string {
  return refs.map((ref) => spanText(window, ref)).join(" ");
}

// Checks 1–2, 6–7: every fact must be traceable and must not upgrade a hedge or an unsupported
// emotion/motive/causal claim into a raw_fact.
function sanitizeFacts(window: EvidenceWindow, facts: CoreFact[], reasons: string[]): CoreFact[] {
  const kept: CoreFact[] = [];
  for (const fact of facts) {
    const text = evidenceText(window, fact.evidenceRefs);
    if (!text.trim()) { reasons.push("unsupported_evidence_ref"); continue; }
    if (fact.assertionKind === "raw_fact" && HEDGE_WORDS.test(text)) { kept.push({ ...fact, assertionKind: "attributed_claim", claimant: fact.claimant ?? "来源" }); reasons.push("hedged_claim"); continue; }
    if (fact.assertionKind === "raw_fact" && MEDICAL_WORDS.test(fact.statement) && !MEDICAL_WORDS.test(text)) { reasons.push("health_inference"); continue; }
    kept.push(fact);
  }
  return kept;
}

function sanitizeQuotes(window: EvidenceWindow, quotes: QuotableLine[], reasons: string[]): QuotableLine[] {
  return quotes.filter((quote) => { const text = spanText(window, quote.evidenceRef); const ok = text.includes(quote.text) || quote.text.includes(text.trim()); if (!ok) reasons.push("unsupported_evidence_ref"); return ok; });
}

// H4: unbound/weakly-bound media (< 0.75) can never be cited as evidence for a fact.
function factsRelyOnWeakMedia(window: EvidenceWindow, facts: CoreFact[]): boolean {
  const weakItemIds = new Set(window.mediaBindings.filter((binding) => binding.confidence < 0.75 && binding.boundItemId).map((binding) => binding.boundItemId));
  return facts.some((fact) => fact.evidenceRefs.some((ref) => weakItemIds.has(ref.split("#")[0])));
}

function occurredDateOf(window: EvidenceWindow, verdict: MemoryEditorVerdict) { return (verdict.occurredAtProposal.value || window.timeRange.from).slice(0, 10); }

function isHealthWindow(window: EvidenceWindow) { return window.items.some((item) => item.contentTypes.includes("health") || item.tier === "authoritative_document"); }

function subjectUncertain(window: EvidenceWindow, verdict: MemoryEditorVerdict, otherChildDigests: string[] = []) {
  if (verdict.subjectRelevance === "ambiguous" || verdict.subjectRelevance === "unrelated") return true;
  const senders = new Set(window.items.map((item) => item.senderDigest));
  const multipleChildrenMentioned = otherChildDigests.some((digest) => senders.has(digest));
  return multipleChildrenMentioned && verdict.uncertainty.subject !== "low";
}

export function validate(window: EvidenceWindow, verdict: MemoryEditorVerdict, context: ValidatorContext): ValidatorResult {
  const routingPolicy = context.routingPolicy ?? V1_ROUTING_POLICY;
  if (context.expectedRoutingPolicyId && routingPolicy.id !== context.expectedRoutingPolicyId) {
    throw new Error(`Routing policy mismatch: expected "${context.expectedRoutingPolicyId}", active policy is "${routingPolicy.id}". Refusing to route — this is the silent-fallback-to-v1 failure.`);
  }
  const reasons: string[] = [];
  const base = { sourceIds: window.items.map((item) => item.sourceId), windowId: window.windowId, policyVersion: CONTRACT_POLICY_VERSION, modelVersion: context.modelVersion };

  // H3 + §8.3: isolate health content instead of letting one health item swallow a mixed batch.
  const healthItems = window.items.filter((item) => item.contentTypes.includes("health"));
  if (healthItems.length > 0 && healthItems.length === window.items.length) {
    if (MEDICAL_WORDS.test(verdict.coreFacts.map((fact) => fact.statement).join(" "))) { reasons.push("health_inference"); return { outcome: { ...base, action: "store_only", selectionReason: "Rejected: medical inference attempted", worthinessScore: 0 }, degradeReason: "health_inference", reasonCodes: reasons }; }
    const facts = sanitizeFacts(window, verdict.coreFacts, reasons);
    const symptomsVerbatim = quotesToText(window, verdict.quotableLines);
    return { outcome: { ...base, action: "care_observation", observedAt: occurredDateOf(window, verdict), symptomsVerbatim, attributedClaims: facts, reviewRequirement: "needs_review", sensitivityFlags: ["health", ...verdict.sensitivityFlags.filter((flag) => flag !== "health")], selectionReason: "Health content is kept as facts only, never a diagnosis", worthinessScore: 0 }, reasonCodes: reasons };
  }

  // H1: planned content never becomes an event outcome; it becomes an inert plan marker.
  const text = window.items.map((item) => item.text).join("\n");
  if (verdict.temporalStatus === "planned" || (PLANNED_WORDS.test(text) && !NEGATION_WORDS.test(text) && Date.parse(occurredDateOf(window, verdict)) >= Date.parse(context.now.slice(0, 10)))) {
    reasons.push("planned_not_occurred");
    return { outcome: { ...base, action: "plan_marker", plannedFor: occurredDateOf(window, verdict), activityKeywords: extractKeywords(text), expiresAt: addDays(occurredDateOf(window, verdict), 3), selectionReason: "Planned activity is not yet confirmed", worthinessScore: 0 }, reasonCodes: reasons };
  }

  // Subject ambiguity (checks 4, H9): never default an unclear subject to the target child.
  if (subjectUncertain(window, verdict, context.otherChildDigests)) {
    reasons.push("subject_ambiguous");
    return { outcome: { ...base, action: "store_only", selectionReason: "Subject could not be confirmed", worthinessScore: 0 }, degradeReason: "subject_ambiguous", reasonCodes: reasons };
  }

  const facts = sanitizeFacts(window, verdict.coreFacts, reasons);
  const quotes = sanitizeQuotes(window, verdict.quotableLines, reasons);
  if (verdict.emotionalAnchor && !spanText(window, verdict.emotionalAnchor.evidenceRef).trim()) reasons.push("unsupported_evidence_ref");
  const emotionalAnchor = verdict.emotionalAnchor && spanText(window, verdict.emotionalAnchor.evidenceRef).trim() ? verdict.emotionalAnchor : undefined;

  // H8: a "first time" style milestone requires text evidence; a photo alone cannot carry it.
  const milestoneScore = verdict.worthinessDimensions.milestone?.score ?? 0;
  // A hedged claim ("好像是第一次") was already downgraded to attributed_claim above; it must not
  // count as text evidence for a milestone — only an unhedged raw_fact can (H2 + H8 combined).
  const milestoneHasText = facts.some((fact) => fact.assertionKind === "raw_fact" && /第一次|首次|first\s*time/i.test(fact.statement));
  // Path B (v3): a dated earlier baseline plus current-window evidence of the new state supports a
  // transition just as well as the literal word "第一次" — often better. It is accepted only when
  // the baseline is one the PIPELINE supplied: `supportedPriorSourceIds` comes from deterministic
  // retrieval, so a model that cites a baseline it was never shown fails this check. Without that
  // list nothing can qualify, which keeps the default behaviour exactly as strict as before.
  const supportedPriorIds = new Set(context.supportedPriorSourceIds ?? []);
  const support = verdict.transitionSupport;
  const citedPriorIds = support?.priorEvidence.map((entry) => entry.sourceId) ?? [];
  const milestoneHasLongitudinalSupport =
    support?.basis === "supported_by_prior_context" &&
    citedPriorIds.length > 0 &&
    citedPriorIds.every((sourceId) => supportedPriorIds.has(sourceId)) &&
    (support?.currentEvidenceRefs.length ?? 0) > 0 &&
    support.currentEvidenceRefs.every((ref) => spanText(window, ref).trim().length > 0);
  if (support?.basis === "supported_by_prior_context" && !milestoneHasLongitudinalSupport) reasons.push("unverified_prior_baseline");
  const milestoneSupported = milestoneHasText || milestoneHasLongitudinalSupport;
  const cappedVerdict: MemoryEditorVerdict = milestoneScore >= 2 && !milestoneSupported
    ? { ...verdict, worthinessDimensions: { ...verdict.worthinessDimensions, milestone: { score: 0, evidenceRefs: [] } } }
    : verdict;
  if (milestoneScore >= 2 && !milestoneSupported) reasons.push("media_binding_too_weak");

  if (facts.length === 0 && factsRelyOnWeakMedia(window, verdict.coreFacts)) reasons.push("media_binding_too_weak");

  const worthinessInput: WorthinessInput = { window, verdict: cappedVerdict, recentSameTypeCount: context.recentSameTypeCount, boundImageCount: window.mediaBindings.filter((binding) => binding.confidence >= 0.75).length };
  const worthiness = computeWorthiness(worthinessInput);

  // attach_existing: only when the target is a real, unique, non-private existing event.
  if (verdict.proposedAction === "attach_existing") {
    const target = verdict.proposedTargetId ? context.existingLifeEvents.find((event) => event.id === verdict.proposedTargetId) : undefined;
    if (!target || target.visibility === "private") { reasons.push("duplicate_candidate"); }
    else {
      return { outcome: { ...base, action: "attach_existing", targetLifeEventId: target.id, attachRole: facts.length > 0 ? "supporting" : "media_only", addedFacts: facts, similarity: verdict.duplicateCandidates.find((candidate) => candidate.targetId === target.id)?.similarity ?? 0, selectionReason: verdict.selectionReason, worthinessScore: worthiness.score }, reasonCodes: reasons };
    }
  }

  let routed = routingPolicy.decide({ window, verdict: cappedVerdict, worthiness });
  // "第一次/milestone" claims always get a human look, even if the rest of the window scores low —
  // this is a floor on review, never an automatic promotion to auto_accept (§4.2).
  if (milestoneScore >= 2 && milestoneSupported && routed.action !== "life_event_candidate") routed = { action: "life_event_candidate", reviewRequirement: "needs_review", toGlimmerPool: false };
  if (routed.action === "store_only") return { outcome: { ...base, action: "store_only", selectionReason: reasons.length ? reasons.join(",") : "Below worthiness threshold", worthinessScore: worthiness.score }, degradeReason: reasons.length ? reasons.join(",") : undefined, reasonCodes: reasons };

  if (routed.action === "daily_trace") {
    const traceLines = facts.length ? facts.slice(0, 2).map((fact) => ({ text: fact.statement, evidenceRefs: fact.evidenceRefs })) : [{ text: `${window.stats.messageCount} 条消息 · ${window.stats.imageCount} 张媒体`, evidenceRefs: [] }];
    return { outcome: { ...base, action: "daily_trace", occurredAt: occurredDateOf(window, verdict), scopes: ["family"], contentTypes: uniqueContentTypes(window), traceLines, evidenceStrength: worthiness.dimensions.evidenceStrength, selectionReason: routed.toGlimmerPool ? "everyday_glimmer_pool" : "ordinary_day", worthinessScore: worthiness.score }, reasonCodes: reasons };
  }

  // life_event_candidate: this round persists a candidate only — no LifeEvent, no narrative.
  return {
    outcome: {
      ...base, action: "life_event_candidate", occurredAt: occurredDateOf(window, verdict), eventType: milestoneScore >= 2 ? "milestone" : "moment", contentTypes: uniqueContentTypes(window),
      coreFacts: facts, quotableLines: quotes, emotionalAnchor, worthinessDimensions: worthiness.dimensions, uncertainty: verdict.uncertainty, sensitivityFlags: verdict.sensitivityFlags, prohibitedInferences: verdict.prohibitedInferences,
      reviewRequirement: routed.reviewRequirement === "auto_accept" ? "auto_accept" : "needs_review", confidence: verdict.confidence, selectionReason: verdict.selectionReason, worthinessScore: worthiness.score,
    },
    reasonCodes: reasons,
  };
}

function quotesToText(window: EvidenceWindow, quotes: QuotableLine[]) { return sanitizeQuotes(window, quotes, []).map((quote) => quote.text); }
function uniqueContentTypes(window: EvidenceWindow): ContentType[] { return [...new Set(window.items.flatMap((item) => item.contentTypes))]; }
function extractKeywords(text: string) { return [...new Set((text.match(/[一-龥]{2,4}/g) ?? []).slice(0, 5))]; }
function addDays(date: string, days: number) { const d = new Date(`${date}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
