// Claim Grounding / Attribution layer.
//
// Sits between Memory Editor output and worthiness/routing. Nothing may influence a worthiness
// signal until it has been individually verified: WHO the claim is about, WHAT speech act its
// supporting evidence performs, and WHETHER that evidence actually asserts the state.
//
// The failure this closes (HV2-N03): the window legitimately named 张年, so window-level Gate A
// returned `explicit` / `primary`, which authorised EVERY claim in the window as being about him.
// One of those claims was built from the interrogative 「会自己站了？」 plus the backchannel
// 「真的」, and it produced a STRONG `developmental_ability` signal. Two independent things were
// missing, and both are supplied here:
//
//   1. Speech act / factual status per claim — a question is not an assertion (speech-act.ts).
//   2. Subject resolution per claim — "张年 appears somewhere in this window" is not attribution.
//
// Design rule: no thresholds, no score tuning, no capability keywords. A claim earns the right to
// ground a signal by the grammar of its own evidence and by a resolvable subject, or it does not.
import type { EvidenceItem, EvidenceWindow } from "./evidence/types";
import type { CoreFact, MemoryEditorVerdict } from "./contract";
import type { IdentityRegistry } from "./identity";
import { resolveSpeaker } from "./identity";
import { analyzeSpan, normalizeSpanText, type Polarity, type SpeechAct, type SpanAnalysis } from "./speech-act";
import { resolveByConversationContinuity, type SubjectResolutionEvidence } from "./subject-continuity";
import type { WorthinessAxisV4 } from "./worthiness-v4";

export const CLAIM_GROUNDING_VERSION = "claim-grounding-v1";

export type ClaimSubjectBasis =
  | "explicit_in_span"
  | "antecedent_in_window"
  | "antecedent_in_neighbour"
  | "conversation_continuity"
  | "unresolved_no_reference"
  | "unresolved_competing_person"
  | "unresolved_no_antecedent";

export type AssertionStatus = "supported_assertion" | "question" | "plan_or_hypothetical" | "directive" | "unsupported";
export type ObservationMode = "observed_firsthand" | "reported" | "question" | "plan_or_hypothetical";

export type GroundedSpan = {
  ref: string;
  sourceId: string;
  itemId: string;
  text: string;
  speechAct: SpeechAct;
  polarity: Polarity;
  contentBearing: boolean;
  markers: string[];
  speakerDigest: string;
  speaker: { known: boolean; canonicalPersonId?: string; relationshipToSubject?: string };
};

export type ClaimSubject = {
  resolved: boolean;
  /** The profile id this claim is about, when resolved. Never defaulted to the target child. */
  subjectId?: string;
  basis: ClaimSubjectBasis;
  supportingSourceIds: string[];
  blockers: string[];
  /** Present only when the subject was resolved by bounded conversation continuity (subject-continuity.ts). */
  continuity?: SubjectResolutionEvidence;
};

export type GroundedClaim = {
  claimId: string;
  text: string;
  sourceIds: string[];
  evidenceRefs: string[];
  supportingSpans: GroundedSpan[];
  speakerDigests: string[];
  speakers: Array<{ digest: string; canonicalPersonId?: string; relationshipToSubject?: string }>;
  subject: ClaimSubject;
  assertionStatus: AssertionStatus;
  observationMode: ObservationMode;
  polarity: Polarity;
  /** May ground any worthiness signal: a supported assertion about a resolved subject. */
  mayContributeToWorthiness: boolean;
  /** Additionally requires affirmative polarity — a not-yet state is a fact, not an ability. */
  mayGroundDevelopmentalSignal: boolean;
  reasons: string[];
};

export type GroundingOptions = {
  registry?: IdentityRegistry;
  /** Raises the prior only; never resolves a claim by itself (same rule as the window resolver). */
  singleChildHousehold?: boolean;
};

// Anyone whose presence makes a pronoun genuinely ambiguous. Extends the window resolver's list
// with the generic other-child nouns real family chat actually uses, and with the COMPARATIVE
// construction 「比<name>大/小」, which by its grammar introduces a second referent distinct from
// the subject. Both are structural, not topical.
const COMPETING_PERSON = /其他小朋友|别的孩子|别的小朋友|另一个孩子|同学|哥哥|姐姐|弟弟|妹妹|双胞胎|同伴|小伙伴|表弟|表妹|堂弟|堂妹|小女孩|小男孩|别人家的孩子|人家的孩子|人家孩子|同龄|邻居家/;

const PRONOUN = /他|她|娃|崽|宝/;

function namesSubject(text: string, names: string[]): boolean {
  return names.some((name) => name && text.includes(name));
}

function comparativeReferent(text: string, names: string[]): boolean {
  // 「比张小年大40多天」 — a comparison to the subject necessarily denotes someone who is not him.
  return names.some((name) => name && new RegExp(`比\\s*${name}[^\\n]{0,6}?[大小高矮]`).test(text));
}

/** Splits an evidenceRef into its item and resolves the span's exact text. */
function spanOf(window: EvidenceWindow, ref: string): { item?: EvidenceItem; text: string } {
  const [itemId, spanId] = String(ref).split("#");
  const item = window.items.find((candidate) => candidate.itemId === itemId);
  const span = item?.spans.find((candidate) => candidate.id === spanId);
  if (!item || !span) return { item: undefined, text: "" };
  return { item, text: item.text.slice(span.start, span.end) };
}

function groundSpan(window: EvidenceWindow, ref: string, options: GroundingOptions): GroundedSpan | undefined {
  const { item, text } = spanOf(window, ref);
  if (!item) return undefined;
  const analysis: SpanAnalysis = analyzeSpan(text);
  const speaker = resolveSpeaker(item.senderDigest, options.registry);
  return {
    ref, sourceId: item.sourceId, itemId: item.itemId, text,
    speechAct: analysis.speechAct, polarity: analysis.polarity, contentBearing: analysis.contentBearing,
    markers: analysis.markers, speakerDigest: item.senderDigest,
    speaker: { known: speaker.known, canonicalPersonId: speaker.canonicalPersonId, relationshipToSubject: speaker.relationshipToSubject },
  };
}

/**
 * Claim-level subject resolution over bounded evidence.
 *
 * Order matters. An explicit name inside the claim's OWN supporting span resolves it outright and
 * is checked first — that is why a competing person elsewhere in the window cannot block a claim
 * that says 「小年宝贝会走路了」. Only a pronoun-only claim has to earn its subject from context,
 * and there a competing person anywhere in scope fails it closed.
 */
export function resolveClaimSubject(
  window: EvidenceWindow,
  spans: GroundedSpan[],
  subject: { primaryName: string; aliases: string[]; profileId?: string },
  options: GroundingOptions = {},
): ClaimSubject {
  const names = [subject.primaryName, ...subject.aliases].filter(Boolean);
  const subjectId = subject.profileId ?? window.profileId;

  const named = spans.filter((span) => namesSubject(span.text, names) && !comparativeReferent(span.text, names));
  if (named.length > 0) {
    return { resolved: true, subjectId, basis: "explicit_in_span", supportingSourceIds: named.map((s) => s.sourceId), blockers: [] };
  }

  const claimText = spans.map((span) => span.text).join("\n");
  if (!PRONOUN.test(normalizeSpanText(claimText))) {
    return { resolved: false, basis: "unresolved_no_reference", supportingSourceIds: [], blockers: ["no_subject_reference"] };
  }

  // Competing-person check spans the whole window plus its neighbours, deliberately wider than the
  // antecedent search: a second child introduced anywhere in the conversation makes every bare
  // pronoun in it ambiguous, and ambiguity must fail closed before any positive signal is counted.
  const neighbours = [...window.neighbors.before, ...window.neighbors.after];
  const scopeText = [...window.items, ...neighbours].map((item) => item.text).join("\n");
  if (COMPETING_PERSON.test(scopeText) || comparativeReferent(scopeText, names)) {
    return { resolved: false, basis: "unresolved_competing_person", supportingSourceIds: [], blockers: ["competing_person_in_scope"] };
  }

  // Bounded antecedent: some message in this window must name the child.
  //
  // The WINDOW is the bound, and it is already a tight one — the Evidence Builder cuts a window at a
  // 45-minute gap, a 3-hour span or 40 messages, so a window is one conversational episode. Inside a
  // single episode a named antecedent is a real antecedent, and requiring the name to fall within an
  // extra ±N messages was a second, arbitrary bound on top of that: it refused 「我又把高度调高了，
  // 他现在离活得太吓人」 as unattributable in a window that names him. Ambiguity is guarded by the
  // competing-person check above, which runs at this same window scope — matching the two scopes is
  // what makes the rule coherent, not looser.
  const inWindow = window.items.filter((item) => namesSubject(item.text, names));
  if (inWindow.length > 0) {
    return { resolved: true, subjectId, basis: "antecedent_in_window", supportingSourceIds: inWindow.map((item) => item.sourceId), blockers: [] };
  }
  const inNeighbour = neighbours.filter((item) => namesSubject(item.text, names));
  if (inNeighbour.length > 0) {
    return { resolved: true, subjectId, basis: "antecedent_in_neighbour", supportingSourceIds: inNeighbour.map((item) => item.sourceId), blockers: [] };
  }

  // Last resort, and only when the caller attached bounded same-conversation context to the window
  // (attachContinuityContext). The frozen V6 path never does, so it is byte-for-byte unchanged here.
  // The anchor is the claim's own earliest pronoun-bearing message; the walk is backwards only.
  const anchorItem = spans
    .filter((span) => PRONOUN.test(normalizeSpanText(span.text)))
    .map((span) => window.items.find((item) => item.itemId === span.itemId))
    .filter((item): item is EvidenceItem => Boolean(item))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt))[0];
  if (anchorItem && "continuity" in window) {
    const continuity = resolveByConversationContinuity(window, anchorItem, subject, { registry: options.registry });
    if (continuity.basis === "conversation_continuity") {
      return { resolved: true, subjectId, basis: "conversation_continuity", supportingSourceIds: continuity.antecedentSourceIds, blockers: [], continuity };
    }
    if (continuity.competingSubjectIds.length > 0) {
      return { resolved: false, basis: "unresolved_competing_person", supportingSourceIds: [], blockers: ["competing_person_in_scope", ...continuity.blockers], continuity };
    }
    return { resolved: false, basis: "unresolved_no_antecedent", supportingSourceIds: [], blockers: ["no_explicit_antecedent", ...continuity.blockers], continuity };
  }
  return { resolved: false, basis: "unresolved_no_antecedent", supportingSourceIds: [], blockers: ["no_explicit_antecedent"] };
}

function assertionStatusOf(spans: GroundedSpan[]): { status: AssertionStatus; reasons: string[] } {
  const reasons: string[] = [];
  if (spans.length === 0) return { status: "unsupported", reasons: ["no_resolvable_span"] };

  // A claim is grounded by the spans that can actually SUPPLY a proposition: content-bearing ones.
  // Backchannels are dropped here rather than counted as assertions, because 「真的」 confirms
  // whatever preceded it — if the only content in scope was a question, nothing was asserted.
  const contentful = spans.filter((span) => span.contentBearing);
  if (contentful.length === 0) {
    reasons.push("only_backchannel_support");
    return { status: "unsupported", reasons };
  }
  const assertions = contentful.filter((span) => span.speechAct === "assertion");
  if (assertions.length > 0) return { status: "supported_assertion", reasons };

  if (contentful.some((span) => span.speechAct === "question")) { reasons.push("content_only_in_question"); return { status: "question", reasons }; }
  if (contentful.some((span) => span.speechAct === "plan_or_hypothetical")) { reasons.push("content_only_irrealis"); return { status: "plan_or_hypothetical", reasons }; }
  reasons.push("content_only_directive");
  return { status: "directive", reasons };
}

function observationModeOf(status: AssertionStatus, fact: CoreFact | undefined, spans: GroundedSpan[]): ObservationMode {
  if (status === "question") return "question";
  if (status === "plan_or_hypothetical" || status === "directive") return "plan_or_hypothetical";
  if (fact?.assertionKind === "attributed_claim") return "reported";
  // A verified caregiver speaking in the window is a firsthand observer (see evidence/tier.ts).
  return spans.some((span) => span.speaker.relationshipToSubject) ? "observed_firsthand" : "reported";
}

// 「看一下你有没有哄他」 reports that he CHECKS; whether you comforted him is left open. An embedded
// interrogative is therefore a genuine assertion (something is being reported) whose embedded
// proposition is unsettled — so it can support ordinary worthiness but must never be the evidence
// that establishes an ability.
const EMBEDDED_INTERROGATIVE = new Set(["embedded_a_not_a", "embedded_question_pronoun"]);
function settlesItsProposition(span: GroundedSpan): boolean {
  return !span.markers.some((marker) => EMBEDDED_INTERROGATIVE.has(marker));
}

function polarityOf(spans: GroundedSpan[]): Polarity {
  const contentful = spans.filter((span) => span.contentBearing);
  const deciding = contentful.filter((span) => span.speechAct === "assertion");
  const pool = deciding.length > 0 ? deciding : contentful;
  return pool.some((span) => span.polarity === "negated") ? "negated" : "affirmative";
}

export type GroundingResult = {
  version: string;
  claims: GroundedClaim[];
  /** Grounding for every ref cited by a worthiness dimension, keyed by ref. */
  refGrounding: Map<string, { span: GroundedSpan; subject: ClaimSubject; status: AssertionStatus; polarity: Polarity; mayContributeToWorthiness: boolean; mayGroundDevelopmentalSignal: boolean }>;
  /**
   * raw_facts that survived grounding and may therefore drive a MEMORY PROMOTION. Replaces
   * routeV4's ungrounded rawFactCount.
   */
  promotableGroundedFactCount: number;
  /**
   * Evidence that may keep the window as a DailyTrace. Deliberately a WEAKER test than promotion:
   * the subject must still resolve — an ordinary day belonging to another child is not 张年's trace
   * — but the speech act does not have to be an assertion. A window whose only claim came from
   * 「会自己站了？」 is not a Memory and never will be, yet the family really did spend that day
   * wondering, and that is a true thing about the day.
   */
  traceEvidenceCount: number;
  reasonCodes: string[];
};

export function groundClaims(
  window: EvidenceWindow,
  verdict: MemoryEditorVerdict,
  subject: { primaryName: string; aliases: string[]; profileId?: string },
  options: GroundingOptions = {},
): GroundingResult {
  const reasonCodes: string[] = [];
  const claims: GroundedClaim[] = [];

  verdict.coreFacts.forEach((fact, index) => {
    const spans = (fact.evidenceRefs ?? []).map((ref) => groundSpan(window, ref, options)).filter((s): s is GroundedSpan => Boolean(s));
    const { status, reasons } = assertionStatusOf(spans);
    const claimSubject = resolveClaimSubject(window, spans, subject, options);
    const polarity = polarityOf(spans);
    const mayContributeToWorthiness = status === "supported_assertion" && claimSubject.resolved;
    const mayGroundDevelopmentalSignal = mayContributeToWorthiness && polarity === "affirmative"
      && spans.some((span) => span.contentBearing && span.speechAct === "assertion" && settlesItsProposition(span));
    if (status === "question") reasonCodes.push("claim_is_question");
    if (status === "plan_or_hypothetical") reasonCodes.push("claim_is_plan_or_hypothetical");
    if (status === "unsupported") reasonCodes.push("claim_unsupported_by_span");
    if (!claimSubject.resolved) reasonCodes.push(`claim_subject_${claimSubject.basis}`);
    if (polarity === "negated") reasonCodes.push("claim_negated_state");

    claims.push({
      claimId: `claim-${index}`,
      text: fact.statement,
      sourceIds: [...new Set(spans.map((span) => span.sourceId))],
      evidenceRefs: fact.evidenceRefs ?? [],
      supportingSpans: spans,
      speakerDigests: [...new Set(spans.map((span) => span.speakerDigest))],
      speakers: [...new Map(spans.map((span) => [span.speakerDigest, { digest: span.speakerDigest, canonicalPersonId: span.speaker.canonicalPersonId, relationshipToSubject: span.speaker.relationshipToSubject }])).values()],
      subject: claimSubject,
      assertionStatus: status,
      observationMode: observationModeOf(status, fact, spans),
      polarity,
      mayContributeToWorthiness,
      mayGroundDevelopmentalSignal,
      reasons,
    });
  });

  // Dimensions cite spans directly, not coreFacts — that is the path HV2-N03's capability score
  // actually travelled, so every dimension ref is grounded independently of the fact list.
  const refGrounding: GroundingResult["refGrounding"] = new Map();
  const axis = (verdict as { worthinessAxis?: WorthinessAxisV4 }).worthinessAxis;
  const dimensionRefs = new Set<string>([
    ...Object.values(verdict.worthinessDimensions ?? {}).flatMap((dim) => dim?.evidenceRefs ?? []),
    ...(axis ? Object.values(axis).flatMap((dim) => (dim && typeof dim === "object" && "evidenceRefs" in dim ? (dim as { evidenceRefs: string[] }).evidenceRefs ?? [] : [])) : []),
  ]);
  for (const ref of dimensionRefs) {
    const span = groundSpan(window, ref, options);
    if (!span) continue;
    const { status } = assertionStatusOf([span]);
    const refSubject = resolveClaimSubject(window, [span], subject, options);
    const polarity = polarityOf([span]);
    const mayContributeToWorthiness = status === "supported_assertion" && refSubject.resolved;
    refGrounding.set(ref, { span, subject: refSubject, status, polarity, mayContributeToWorthiness, mayGroundDevelopmentalSignal: mayContributeToWorthiness && polarity === "affirmative" && settlesItsProposition(span) });
  }

  const promotableGroundedFactCount = claims.filter((claim, index) => verdict.coreFacts[index]?.assertionKind === "raw_fact" && claim.mayContributeToWorthiness).length;
  // Subject resolved + something that actually carries content. A backchannel-only claim supplies
  // no proposition of its own (see assertionStatusOf) and so cannot evidence a trace either.
  const traceEvidenceCount = claims.filter((claim) => claim.subject.resolved && claim.supportingSpans.some((span) => span.contentBearing)).length;

  return { version: CLAIM_GROUNDING_VERSION, claims, refGrounding, promotableGroundedFactCount, traceEvidenceCount, reasonCodes: [...new Set(reasonCodes)] };
}

export type AxisGatingResult = { axis: WorthinessAxisV4; zeroed: string[]; reasonCodes: string[] };

/**
 * Zeroes any worthiness dimension whose cited evidence is not a grounded assertion about the
 * subject. The developmental dimensions additionally require affirmative polarity.
 *
 * A dimension is NOT reduced to a lower number — it is zeroed. There is no threshold here to tune:
 * either the evidence establishes the thing about this child, or it contributes nothing.
 */
export function applyGroundingToAxis(axis: WorthinessAxisV4, grounding: GroundingResult): AxisGatingResult {
  const zeroed: string[] = [];
  const reasonCodes: string[] = [];
  const supported = (refs: string[] | undefined, developmental: boolean): boolean => {
    if (!refs || refs.length === 0) return false;
    return refs.some((ref) => {
      const g = grounding.refGrounding.get(ref);
      if (!g) return false;
      return developmental ? g.mayGroundDevelopmentalSignal : g.mayContributeToWorthiness;
    });
  };

  const next: WorthinessAxisV4 = { ...axis };

  if (axis.developmentalTransition.score > 0 && !supported(axis.developmentalTransition.evidenceRefs, true)) {
    next.developmentalTransition = { ...axis.developmentalTransition, score: 0, evidenceRefs: [] };
    zeroed.push("developmentalTransition"); reasonCodes.push("ungrounded_transition");
  }
  if (axis.newCapabilityOrIndependence.score > 0 && !supported(axis.newCapabilityOrIndependence.evidenceRefs, true)) {
    next.newCapabilityOrIndependence = { ...axis.newCapabilityOrIndependence, score: 0, evidenceRefs: [] };
    zeroed.push("newCapabilityOrIndependence"); reasonCodes.push("ungrounded_capability");
  }
  if (axis.distinctiveFamilyMoment.score > 0 && !supported(axis.distinctiveFamilyMoment.evidenceRefs, false)) {
    next.distinctiveFamilyMoment = { ...axis.distinctiveFamilyMoment, score: 0, evidenceRefs: [] };
    zeroed.push("distinctiveFamilyMoment"); reasonCodes.push("ungrounded_distinctive_moment");
  }
  if (axis.relationshipSignificance.score > 0 && !supported(axis.relationshipSignificance.evidenceRefs, false)) {
    next.relationshipSignificance = { ...axis.relationshipSignificance, score: 0, evidenceRefs: [] };
    zeroed.push("relationshipSignificance"); reasonCodes.push("ungrounded_relationship");
  }
  if (axis.futureRecallValue.score > 0 && !supported(axis.futureRecallValue.evidenceRefs, false)) {
    next.futureRecallValue = { ...axis.futureRecallValue, score: 0, evidenceRefs: [] };
    zeroed.push("futureRecallValue"); reasonCodes.push("ungrounded_future_recall");
  }

  return { axis: next, zeroed, reasonCodes: [...new Set(reasonCodes)] };
}
