// Canonical contract for the new evidence pipeline (§5.2, §7.2, §9). Single source of truth for
// what the Memory Editor may propose and what a finished OrganizerOutcome may contain — there is
// no second validator pass and no prompt-only field matrix that can drift from this file.
import type { ContentType } from "@/lib/types";

export const CONTRACT_POLICY_VERSION = "evidence-contract-v1";

export type TemporalStatus = "past" | "present" | "planned" | "uncertain";
export type SubjectRelevance = "primary" | "mentioned" | "unrelated" | "ambiguous";
export type SensitivityFlag = "health" | "other_child" | "third_party" | "location_precise";
export type ScoredDimension = "milestone" | "change" | "futureRecall" | "relationship" | "emotion" | "everydayTexture";
export type RuleDimension = "uniqueness" | "specificity" | "evidenceStrength" | "redundancy" | "uncertainty";

export type MemoryEditorProposedAction = "store_only" | "daily_trace" | "life_event_candidate" | "attach_existing" | "care_observation";
const MEMORY_EDITOR_ACTIONS = new Set<MemoryEditorProposedAction>(["store_only", "daily_trace", "life_event_candidate", "attach_existing", "care_observation"]);

export type CoreFact = { statement: string; assertionKind: "raw_fact" | "attributed_claim"; claimant?: string; claimantRole?: string; evidenceRefs: string[] };
export type QuotableLine = { text: string; speakerRole: string; evidenceRef: string };
export type DimensionScore = { score: 0 | 1 | 2 | 3; evidenceRefs: string[] };

export type MemoryEditorVerdict = {
  windowId: string;
  subjectRelevance: SubjectRelevance;
  subjectIds: string[];
  temporalStatus: TemporalStatus;
  occurredAtProposal: { value: string; basis: "sent_at" | "exif" | "explicit_text"; evidenceRefs: string[] };
  coreFacts: CoreFact[];
  quotableLines: QuotableLine[];
  emotionalAnchor?: { text: string; evidenceRef: string };
  worthinessDimensions: Partial<Record<ScoredDimension, DimensionScore>>;
  duplicateCandidates: Array<{ targetId: string; targetKind: "life_event" | "daily_trace"; similarity: number; basis: string[] }>;
  uncertainty: { time: "low" | "medium" | "high"; subject: "low" | "medium" | "high"; semantics: "low" | "medium" | "high" };
  sensitivityFlags: SensitivityFlag[];
  prohibitedInferences: string[];
  proposedAction: MemoryEditorProposedAction;
  proposedTargetId?: string;
  selectionReason: string;
  confidence: number;
};

const FORBIDDEN_NARRATIVE_KEYS = /^(title|story|shortStory|narrative|summary|growthSignals)$/i;

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectForbiddenKeys(value: unknown, path = "verdict"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) { const issue = rejectForbiddenKeys(value[index], `${path}[${index}]`); if (issue) return issue; }
    return undefined;
  }
  if (!isObject(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_NARRATIVE_KEYS.test(key)) return `${path}.${key} is not allowed: narrative fields are disabled for the Memory Editor contract`;
    const issue = rejectForbiddenKeys(child, `${path}.${key}`);
    if (issue) return issue;
  }
  return undefined;
}

function validSpanRefs(refs: unknown, window: { items: Array<{ itemId: string; spans: Array<{ id: string }> }> }): refs is string[] {
  if (!Array.isArray(refs) || refs.length === 0) return false;
  const valid = new Set(window.items.flatMap((item) => item.spans.map((span) => `${item.itemId}#${span.id}`)));
  return refs.every((ref) => typeof ref === "string" && valid.has(ref));
}

export type EvidenceRefWindow = { windowId: string; items: Array<{ itemId: string; spans: Array<{ id: string }> }> };

// Validates a raw Memory Editor response against the canonical contract. Anything invalid throws;
// callers must treat a throw as a safe-degrade trigger, never as "try a different decision maker".
export function validateMemoryEditorVerdict(raw: unknown, window: EvidenceRefWindow): MemoryEditorVerdict {
  const forbidden = rejectForbiddenKeys(raw);
  if (forbidden) throw new Error(`Invalid memory editor verdict: ${forbidden}`);
  if (!isObject(raw)) throw new Error("Invalid memory editor verdict: expected an object");
  const value = raw;
  if (value.windowId !== window.windowId) throw new Error("Invalid memory editor verdict: windowId mismatch");
  const subjectRelevance = value.subjectRelevance;
  if (subjectRelevance !== "primary" && subjectRelevance !== "mentioned" && subjectRelevance !== "unrelated" && subjectRelevance !== "ambiguous") throw new Error("Invalid memory editor verdict: subjectRelevance");
  const temporalStatus = value.temporalStatus;
  if (temporalStatus !== "past" && temporalStatus !== "present" && temporalStatus !== "planned" && temporalStatus !== "uncertain") throw new Error("Invalid memory editor verdict: temporalStatus");
  if (!Array.isArray(value.coreFacts)) throw new Error("Invalid memory editor verdict: coreFacts");
  const coreFacts: CoreFact[] = value.coreFacts.map((fact, index) => {
    if (!isObject(fact)) throw new Error(`Invalid memory editor verdict: coreFacts[${index}]`);
    if (typeof fact.statement !== "string" || fact.statement.length === 0 || fact.statement.length > 60) throw new Error(`Invalid memory editor verdict: coreFacts[${index}].statement`);
    if (fact.assertionKind !== "raw_fact" && fact.assertionKind !== "attributed_claim") throw new Error(`Invalid memory editor verdict: coreFacts[${index}].assertionKind`);
    if (fact.assertionKind === "attributed_claim" && typeof fact.claimant !== "string") throw new Error(`Invalid memory editor verdict: coreFacts[${index}].claimant is required for attributed_claim`);
    if (!validSpanRefs(fact.evidenceRefs, window)) throw new Error(`Invalid memory editor verdict: coreFacts[${index}].evidenceRefs`);
    return { statement: fact.statement, assertionKind: fact.assertionKind, claimant: fact.claimant as string | undefined, claimantRole: fact.claimantRole as string | undefined, evidenceRefs: fact.evidenceRefs as string[] };
  });
  if (!Array.isArray(value.quotableLines)) throw new Error("Invalid memory editor verdict: quotableLines");
  const quotableLines: QuotableLine[] = value.quotableLines.map((line, index) => {
    if (!isObject(line) || typeof line.text !== "string" || typeof line.speakerRole !== "string" || !validSpanRefs([line.evidenceRef], window)) throw new Error(`Invalid memory editor verdict: quotableLines[${index}]`);
    return { text: line.text, speakerRole: line.speakerRole, evidenceRef: line.evidenceRef as string };
  });
  let emotionalAnchor: MemoryEditorVerdict["emotionalAnchor"];
  if (value.emotionalAnchor !== undefined && value.emotionalAnchor !== null) {
    const anchor = value.emotionalAnchor;
    if (!isObject(anchor) || typeof anchor.text !== "string" || !validSpanRefs([anchor.evidenceRef], window)) throw new Error("Invalid memory editor verdict: emotionalAnchor");
    emotionalAnchor = { text: anchor.text, evidenceRef: anchor.evidenceRef as string };
  }
  if (!isObject(value.worthinessDimensions)) throw new Error("Invalid memory editor verdict: worthinessDimensions");
  const scoredKeys: ScoredDimension[] = ["milestone", "change", "futureRecall", "relationship", "emotion", "everydayTexture"];
  const worthinessDimensions: MemoryEditorVerdict["worthinessDimensions"] = {};
  for (const key of scoredKeys) {
    const raw = value.worthinessDimensions[key];
    if (raw === undefined) continue;
    if (!isObject(raw) || ![0, 1, 2, 3].includes(raw.score as number)) throw new Error(`Invalid memory editor verdict: worthinessDimensions.${key}.score`);
    const refs = raw.score === 0 ? (Array.isArray(raw.evidenceRefs) ? raw.evidenceRefs : []) : raw.evidenceRefs;
    if (raw.score !== 0 && !validSpanRefs(refs, window)) throw new Error(`Invalid memory editor verdict: worthinessDimensions.${key}.evidenceRefs required for a nonzero score`);
    worthinessDimensions[key] = { score: raw.score as 0 | 1 | 2 | 3, evidenceRefs: (refs as string[]) ?? [] };
  }
  if (!Array.isArray(value.duplicateCandidates)) throw new Error("Invalid memory editor verdict: duplicateCandidates");
  const uncertainty = value.uncertainty;
  if (!isObject(uncertainty) || !["low", "medium", "high"].includes(uncertainty.time as string) || !["low", "medium", "high"].includes(uncertainty.subject as string) || !["low", "medium", "high"].includes(uncertainty.semantics as string)) throw new Error("Invalid memory editor verdict: uncertainty");
  if (!Array.isArray(value.sensitivityFlags)) throw new Error("Invalid memory editor verdict: sensitivityFlags");
  if (!Array.isArray(value.prohibitedInferences)) throw new Error("Invalid memory editor verdict: prohibitedInferences");
  if (typeof value.proposedAction !== "string" || !MEMORY_EDITOR_ACTIONS.has(value.proposedAction as MemoryEditorProposedAction)) throw new Error("Invalid memory editor verdict: proposedAction");
  if (value.proposedAction === "attach_existing" && typeof value.proposedTargetId !== "string") throw new Error("Invalid memory editor verdict: proposedTargetId is required for attach_existing");
  if (typeof value.selectionReason !== "string" || value.selectionReason.length > 120) throw new Error("Invalid memory editor verdict: selectionReason");
  if (typeof value.confidence !== "number" || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid memory editor verdict: confidence");
  const occurredAtProposal = value.occurredAtProposal;
  if (!isObject(occurredAtProposal) || typeof occurredAtProposal.value !== "string" || !["sent_at", "exif", "explicit_text"].includes(occurredAtProposal.basis as string) || !validSpanRefs(occurredAtProposal.evidenceRefs, window)) throw new Error("Invalid memory editor verdict: occurredAtProposal");
  const subjectIds = Array.isArray(value.subjectIds) ? value.subjectIds.filter((id): id is string => typeof id === "string") : [];
  if (subjectRelevance === "ambiguous" && subjectIds.length > 0) throw new Error("Invalid memory editor verdict: subjectIds must be empty when subjectRelevance is ambiguous");

  return {
    windowId: window.windowId,
    subjectRelevance,
    subjectIds,
    temporalStatus,
    occurredAtProposal: { value: occurredAtProposal.value, basis: occurredAtProposal.basis as "sent_at" | "exif" | "explicit_text", evidenceRefs: occurredAtProposal.evidenceRefs as string[] },
    coreFacts,
    quotableLines,
    emotionalAnchor,
    worthinessDimensions,
    duplicateCandidates: value.duplicateCandidates as MemoryEditorVerdict["duplicateCandidates"],
    uncertainty: { time: uncertainty.time as "low" | "medium" | "high", subject: uncertainty.subject as "low" | "medium" | "high", semantics: uncertainty.semantics as "low" | "medium" | "high" },
    sensitivityFlags: value.sensitivityFlags as SensitivityFlag[],
    prohibitedInferences: value.prohibitedInferences as string[],
    proposedAction: value.proposedAction as MemoryEditorProposedAction,
    proposedTargetId: value.proposedTargetId as string | undefined,
    selectionReason: value.selectionReason,
    confidence: value.confidence,
  };
}

// ---- OrganizerOutcome: a discriminated union, one schema per action (§9.3). No action carries
// narrative fields in this stage — Family Writer is explicitly out of scope for this round.
export type OrganizerOutcomeBase = { sourceIds: string[]; windowId: string; policyVersion: string; modelVersion: string; selectionReason: string; worthinessScore: number; degradeReason?: string };

export type OrganizerOutcome =
  | (OrganizerOutcomeBase & { action: "store_only" })
  | (OrganizerOutcomeBase & { action: "daily_trace"; occurredAt: string; scopes: string[]; contentTypes: ContentType[]; traceLines: Array<{ text: string; evidenceRefs: string[] }>; evidenceStrength: number })
  | (OrganizerOutcomeBase & { action: "life_event_candidate"; occurredAt: string; eventType: string; contentTypes: ContentType[]; coreFacts: CoreFact[]; quotableLines: QuotableLine[]; emotionalAnchor?: MemoryEditorVerdict["emotionalAnchor"]; worthinessDimensions: MemoryEditorVerdict["worthinessDimensions"]; uncertainty: MemoryEditorVerdict["uncertainty"]; sensitivityFlags: SensitivityFlag[]; prohibitedInferences: string[]; reviewRequirement: "auto_accept" | "needs_review"; confidence: number })
  | (OrganizerOutcomeBase & { action: "attach_existing"; targetLifeEventId: string; attachRole: "supporting" | "media_only"; addedFacts: CoreFact[]; similarity: number })
  | (OrganizerOutcomeBase & { action: "care_observation"; observedAt: string; symptomsVerbatim: string[]; attributedClaims: CoreFact[]; reviewRequirement: "needs_review"; sensitivityFlags: SensitivityFlag[] })
  | (OrganizerOutcomeBase & { action: "plan_marker"; plannedFor: string; activityKeywords: string[]; expiresAt: string })
  | (OrganizerOutcomeBase & { action: "failed"; degradeReason: string });

export function isNarrativeFree(outcome: OrganizerOutcome): boolean {
  const record = outcome as unknown as Record<string, unknown>;
  return !("title" in record) && !("story" in record) && !("shortStory" in record) && !("narrative" in record) && !("summary" in record);
}
