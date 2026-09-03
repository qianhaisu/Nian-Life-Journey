// Writer v2 — the VerifiedMemoryEvidencePackage and the Writer's output contract.
//
// The Writer does not receive a pile of group chat and improvise. It receives editorial material
// that V6 has already verified, and it may use nothing else. Two rules shape everything here:
//
//   1. V6 is the only selection authority. The Writer has no second vote on whether something
//      deserves to be a Memory. Writer v1's script filtered candidates by its own worthinessScore
//      floor (>= 30); that is exactly the second vote this contract removes.
//   2. Context may be understood, but only verified content may be written. The package therefore
//      carries MORE than the Writer may assert — prior baselines, neighbouring talk — each marked
//      with whether it is assertable or only background.
//
// Nothing in this module calls a model. It defines what the model is given and what it must give
// back, so that "why was this sentence written?" always has an answer.
import type { Polarity } from "./speech-act";
import type { AssertionStatus, GroundedClaim, GroundingResult, ObservationMode } from "./claim-grounding";
import type { EvidenceWindow } from "./evidence/types";

export const EVIDENCE_PACKAGE_VERSION = "verified-memory-evidence-package-v1";
export const WRITER_V2_CONTRACT_VERSION = "writer-v2-output-contract-v1";

// ---------------------------------------------------------------------------- media

/**
 * How firmly a media asset is tied to THIS event. The distinction is a product rule, not a
 * technicality: a photo the family sent inside the very exchange being written about illustrates
 * the story; a photo that merely shares its calendar day does not, and no layout or sentence may
 * imply otherwise.
 *
 * Same-day is never enough. That is the whole point of separating `day_level` from the two tiers
 * above it.
 */
export type MediaBindingTier = "confirmed" | "strong_contextual" | "day_level" | "month_level" | "unbound";

/** The only tiers a Writer may treat as "the photo of this story". */
export const STORY_MEDIA_TIERS: ReadonlySet<MediaBindingTier> = new Set(["confirmed", "strong_contextual"]);

export function mayIllustrateStory(tier: MediaBindingTier): boolean {
  return STORY_MEDIA_TIERS.has(tier);
}

export type MediaEvidence = {
  mediaId: string;
  tier: MediaBindingTier;
  /** Binding confidence from the evidence builder, kept for audit. */
  confidence: number;
  /** The item this media arrived with, when it arrived with one. */
  boundItemId?: string;
  boundSourceId?: string;
  /**
   * Deliberately absent: any description of what the image shows. Nothing in the pipeline has
   * looked at the pixels, so the Writer must never be handed — or invent — image content.
   */
  contentDescribed: false;
};

// ---------------------------------------------------------------------------- identity

export type NarrativePerson = {
  speakerDigest: string;
  known: boolean;
  canonicalPersonId?: string;
  /** 爸爸 / 妈妈 / 雪姨. Absent when the speaker is not a verified family member. */
  narrativeLabel?: string;
  relationshipToSubject?: string;
};

export type PackageIdentity = {
  profileId: string;
  subject: { primaryName: string; aliases: string[]; narrativeLabel: string };
  /** Everyone who speaks in the window. An unknown speaker stays unknown — never "家人" by default. */
  people: NarrativePerson[];
};

// ---------------------------------------------------------------------------- time

export type PackageTime = {
  /** Asia/Shanghai calendar date of the evidence. Life time, never ingestion time. */
  lifeDate: string;
  /** The activity day (04:00 boundary), which is what groups an evening into one episode. */
  activityDate: string;
  occurredWindow: { from: string; to: string };
  /** Age at the event, when the profile's birth date is known. Two clocks, always both. */
  ageAtEvent?: string;
  /**
   * The latest life date of any prior-baseline material in this package. Everything after it is
   * the current event. A later observation can never change what was true on lifeDate.
   */
  priorEvidenceThrough?: string;
};

// ---------------------------------------------------------------------------- claims and quotes

export type VerifiedClaim = {
  claimId: string;
  /** The claim as grounding normalized it. */
  text: string;
  assertionStatus: AssertionStatus;
  polarity: Polarity;
  observationMode: ObservationMode;
  subjectResolved: boolean;
  subjectBasis: string;
  /** Who the claim is about, when resolved. Assertable only when it is this profile. */
  subjectId?: string;
  speakers: NarrativePerson[];
  sourceIds: string[];
  evidenceRefs: string[];
  /** The exact source text behind the claim. The Writer may quote only from `quotes`, not from here. */
  spans: Array<{ ref: string; text: string }>;
  /**
   * Whether the Writer may state this as something that happened. False for a question, a plan, a
   * hypothetical or an unresolved subject — those may inform understanding and nothing else.
   */
  assertable: boolean;
};

export type VerifiedQuote = {
  quoteId: string;
  /** Must be reproduced character for character if used. */
  text: string;
  speaker: NarrativePerson;
  sourceId: string;
  evidenceRef: string;
};

/**
 * Bounded, relevant, verified background. It exists so the Writer can understand continuity — that
 * standing was already established, that he had not been sleeping through — without having to guess.
 * `assertable` is false for everything here by construction: background explains, it does not get
 * written as an event of this day.
 */
export type LongitudinalContextEntry = {
  contextId: string;
  kind: "earlier_capability_baseline" | "previous_state" | "recent_continuity" | "preceding_observation";
  text: string;
  lifeDate: string;
  sourceIds: string[];
  assertable: false;
};

export type VerifiedMemoryEvidencePackage = {
  packageVersion: typeof EVIDENCE_PACKAGE_VERSION;
  windowId: string;
  windowFingerprint: string;
  /** The routing decision that authorised writing at all. The Writer never re-decides this. */
  selectedBy: { policyId: string; action: string; worthinessScore: number };
  identity: PackageIdentity;
  time: PackageTime;
  claims: VerifiedClaim[];
  quotes: VerifiedQuote[];
  longitudinal: LongitudinalContextEntry[];
  media: MediaEvidence[];
};

// ---------------------------------------------------------------------------- output contract

export type NarrativeClaim = {
  /** One factual sentence (or clause) from the story. */
  text: string;
  supportedByClaimIds: string[];
  supportedBySourceIds: string[];
  supportedByQuoteIds?: string[];
  supportedByMediaIds?: string[];
};

export type WriterV2Output = {
  contractVersion: typeof WRITER_V2_CONTRACT_VERSION;
  /** The honest outcome when the verified material cannot carry a page. Publishing nothing wins. */
  insufficient: boolean;
  title?: string;
  story?: string;
  narrativeClaims: NarrativeClaim[];
  usedClaimIds: string[];
  usedQuoteIds: string[];
  usedMediaIds: string[];
  /** Free-text notes for the editorial reviewer. Never shown to the family. */
  editorialNotes?: string;
};

// ---------------------------------------------------------------------------- package construction

const AGE_UNKNOWN = undefined;

/** Shanghai-calendar age, expressed the way a family says it: "1 岁 7 个月" / "8 个月". */
export function ageAt(birthDate: string | undefined, lifeDate: string): string | undefined {
  if (!birthDate) return AGE_UNKNOWN;
  const [by, bm, bd] = birthDate.slice(0, 10).split("-").map(Number);
  const [ly, lm, ld] = lifeDate.slice(0, 10).split("-").map(Number);
  if ([by, bm, bd, ly, lm, ld].some((n) => !Number.isFinite(n))) return AGE_UNKNOWN;
  let months = (ly - by) * 12 + (lm - bm);
  if (ld < bd) months -= 1;
  if (months < 0) return AGE_UNKNOWN;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  if (years === 0) return `${rem} 个月`;
  return rem === 0 ? `${years} 岁` : `${years} 岁 ${rem} 个月`;
}

/**
 * A claim may be stated as something that happened only when grounding verified all of it: the
 * evidence asserts it, and it is about this child — not merely about *someone* resolved. Polarity
 * is deliberately NOT part of this — 「还不会叫妈」 is a perfectly assertable fact, it simply is not
 * an achievement.
 */
export function isAssertable(claim: Pick<GroundedClaim, "assertionStatus" | "subject">, profileId?: string): boolean {
  if (claim.assertionStatus !== "supported_assertion" || !claim.subject.resolved) return false;
  if (profileId && claim.subject.subjectId && claim.subject.subjectId !== profileId) return false;
  return true;
}

/**
 * Inner state — what the child wanted, felt, liked, feared. An observable action (he stood, he
 * pushed the cup away) may be stated as fact; an inner state is always somebody's reading of him,
 * and the page must say whose: 「妈妈觉得他可能饿了」, never 「他饿了」. This classifier is shared by
 * the prompt (so the Writer is told which claims need attribution) and the validator (so a flat
 * statement is rejected). Deliberately narrow: it must not fire on 可爱 or on ordinary actions.
 */
export const INNER_STATE = /想(妈妈|爸爸|雪姨|回|要|吃|喝|睡|玩|出去|抱|念)|不想|舍不得|(太|很|最|真)爱|爱上|喜欢|讨厌|害怕|怕(黑|生|人|水)|饿了|困了|开心|高兴|难过|伤心|生气|委屈|着急|想念|期待|享受|不耐烦|烦了|无聊|不高兴|不乐意|不愿意|愿意|觉得|新鲜|好奇|敏感/;

export function isInnerStateText(text: string): boolean {
  return INNER_STATE.test(text);
}

// 宝宝 is what the family calls any baby, so it never counts as naming this one on its own.
export const GENERIC_ALIASES = new Set(["宝宝"]);
// A `[链接]` title or a quoted reply is not the family speaking.
export const NOT_AN_UTTERANCE = /\\?\[链接\\?\]|^\s*>\s/;

/**
 * A quote may reach the page only when the line it comes from is itself assertable material:
 * an assertable claim rests on that line, or the line names the child itself (「我张小年是爱国的」
 * carries its own subject — there is nothing to launder). Shared by the prompt, which hides every
 * other quote from the Writer, and the validator, which rejects one if it is used anyway.
 */
export function quoteIsAssertable(pkg: Pick<VerifiedMemoryEvidencePackage, "claims" | "identity">, quote: Pick<VerifiedQuote, "evidenceRef" | "text">): boolean {
  const assertable = pkg.claims.filter((c) => c.assertable);
  const assertableItems = new Set(assertable.flatMap((c) => c.evidenceRefs).map((ref) => ref.split("#")[0]));
  if (assertableItems.has(quote.evidenceRef.split("#")[0]!)) return true;
  if (assertable.some((c) => c.spans.some((s) => s.text.includes(quote.text)))) return true;
  const names = [pkg.identity.subject.primaryName, ...pkg.identity.subject.aliases.filter((a) => !GENERIC_ALIASES.has(a))];
  return !NOT_AN_UTTERANCE.test(quote.text) && names.some((n) => quote.text.includes(n));
}

export function mediaTierFor(confidence: number, boundItemId: string | undefined): MediaBindingTier {
  if (!boundItemId) return "unbound";
  if (confidence >= 0.9) return "confirmed";
  if (confidence >= 0.75) return "strong_contextual";
  return "day_level";
}

export type BuildPackageInput = {
  window: EvidenceWindow;
  windowFingerprint: string;
  grounding: GroundingResult;
  selectedBy: { policyId: string; action: string; worthinessScore: number };
  subject: { primaryName: string; aliases: string[]; narrativeLabel?: string; birthDate?: string };
  identityOf: (speakerDigest: string) => NarrativePerson;
  quotableLines: Array<{ text: string; evidenceRef: string; speakerRole?: string }>;
  longitudinal?: LongitudinalContextEntry[];
  lifeDate: string;
};

export function buildEvidencePackage(input: BuildPackageInput): VerifiedMemoryEvidencePackage {
  const { window, grounding } = input;

  const claims: VerifiedClaim[] = grounding.claims.map((claim) => ({
    claimId: claim.claimId,
    text: claim.text,
    assertionStatus: claim.assertionStatus,
    polarity: claim.polarity,
    observationMode: claim.observationMode,
    subjectResolved: claim.subject.resolved,
    subjectBasis: claim.subject.basis,
    subjectId: claim.subject.subjectId,
    speakers: claim.speakerDigests.map(input.identityOf),
    sourceIds: claim.sourceIds,
    evidenceRefs: claim.evidenceRefs,
    spans: claim.supportingSpans.map((span) => ({ ref: span.ref, text: span.text })),
    assertable: isAssertable(claim, window.profileId),
  }));

  // A quote is usable only if it is really in the window, character for character.
  const quotes: VerifiedQuote[] = [];
  input.quotableLines.forEach((line, index) => {
    const [itemId] = String(line.evidenceRef).split("#");
    const item = window.items.find((candidate) => candidate.itemId === itemId);
    if (!item || !item.text.includes(line.text)) return;
    quotes.push({
      quoteId: `quote-${index}`,
      text: line.text,
      speaker: input.identityOf(item.senderDigest),
      sourceId: item.sourceId,
      evidenceRef: line.evidenceRef,
    });
  });

  const media: MediaEvidence[] = window.mediaBindings.map((binding) => {
    const boundItem = binding.boundItemId ? window.items.find((i) => i.itemId === binding.boundItemId) : undefined;
    return {
      mediaId: binding.mediaId,
      tier: mediaTierFor(binding.confidence, binding.boundItemId),
      confidence: binding.confidence,
      boundItemId: binding.boundItemId,
      boundSourceId: boundItem?.sourceId,
      contentDescribed: false,
    };
  });

  const speakerDigests = [...new Set(window.items.map((item) => item.senderDigest))];
  const longitudinal = input.longitudinal ?? [];

  return {
    packageVersion: EVIDENCE_PACKAGE_VERSION,
    windowId: window.windowId,
    windowFingerprint: input.windowFingerprint,
    selectedBy: input.selectedBy,
    identity: {
      profileId: window.profileId,
      subject: { primaryName: input.subject.primaryName, aliases: input.subject.aliases, narrativeLabel: input.subject.narrativeLabel ?? input.subject.primaryName },
      people: speakerDigests.map(input.identityOf),
    },
    time: {
      lifeDate: input.lifeDate,
      activityDate: window.activityDate,
      occurredWindow: { from: window.timeRange.from, to: window.timeRange.to },
      ageAtEvent: ageAt(input.subject.birthDate, input.lifeDate),
      priorEvidenceThrough: longitudinal.length ? longitudinal.map((e) => e.lifeDate).sort().at(-1) : undefined,
    },
    claims,
    quotes,
    longitudinal,
    media,
  };
}

/**
 * A package is worth sending to the Writer only if something in it may actually be stated. A page
 * built entirely from questions and plans would have to invent in order to exist.
 */
export function packageHasAssertableMaterial(pkg: VerifiedMemoryEvidencePackage): boolean {
  return pkg.claims.some((claim) => claim.assertable);
}
