// Bounded same-conversation subject continuity (Decision 1, 2026-09-03).
//
// Both frozen resolvers (subject-resolver.ts at window level, claim-grounding.ts at claim level)
// search for an explicit antecedent inside the window and its ±5 neighbours only. Holdout V3 lost
// both positives on that bound: the child was named in the same conversation, but earlier than five
// messages before the window. Measured over the whole archive, 67 of 671 windows carry a bare
// pronoun and no name inside that bound; for 7 of them the nearest earlier name is within two hours.
//
// This module resolves a bare pronoun by walking BACKWARDS through the same conversation, one
// message at a time, from the claim's own message towards the antecedent. It is not "look back until
// we find 张年":
//
//   - the walk is bounded in messages and in minutes, and stops cold at the bound;
//   - an intervening competing person (another child, an adult mentioned in the third person, a
//     comparison 「比小年大」) breaks the chain — the pronoun could be theirs;
//   - the chain must stay on the child: a run of intervening messages with neither a pronoun nor a
//     child-care topic is a topic change and breaks it;
//   - the anchor and the antecedent must both be spoken by verified caregivers;
//   - the anchor's message must itself carry a child-care topic, or a chain message must.
//
// What it will never do: use "this is 张年's site" or "single-child household" as the antecedent,
// resolve zero-anaphora (a message with no pronoun at all), or resolve forwards (cataphora stays
// with the ±5 neighbour rule of the frozen resolvers).
//
// Every resolution records the antecedent sources and span, the distance walked, the competing
// subjects considered and a reason, so the archive can answer "why is this sentence about him?".
import type { EvidenceItem, EvidenceWindow } from "./evidence/types";
import type { IdentityRegistry } from "./identity";
import { resolveSpeaker } from "./identity";

export const SUBJECT_CONTINUITY_VERSION = "subject-continuity-v1";

export type SubjectResolutionBasis = "explicit_in_claim" | "local_antecedent" | "conversation_continuity" | "unresolved";

export type SubjectResolutionEvidence = {
  version: string;
  subjectId?: string;
  basis: SubjectResolutionBasis;
  /** Sources the resolution rests on — the message(s) naming the child. Empty when unresolved. */
  antecedentSourceIds: string[];
  /** The exact span that names the child, as an evidenceRef (`itemId#spanId`). */
  antecedentSpan?: { ref: string; sourceId: string; itemId: string };
  /** How far the walk went from the anchor message to the antecedent. */
  antecedentDistance?: { messages: number; minutes: number };
  /** Anyone considered as a possible referent along the way. Non-empty means the chain broke. */
  competingSubjectIds: string[];
  /** Why the chain held, in fixed vocabulary — or why it did not (see `blockers`). */
  continuityReason?: string;
  blockers: string[];
  /** Speakers along the chain, canonical ids only, for audit. */
  chainSpeakerIds: string[];
};

export type ContinuityBounds = {
  /** Messages walked backwards from the anchor before giving up. */
  maxMessages: number;
  /** Minutes between the antecedent and the anchor before giving up. */
  maxMinutes: number;
  /** Consecutive intervening messages with neither a pronoun nor a child-care topic before the topic counts as changed. */
  maxTopicGap: number;
};

export const DEFAULT_CONTINUITY_BOUNDS: ContinuityBounds = { maxMessages: 60, maxMinutes: 120, maxTopicGap: 8 };

/** Additive context an EvidenceWindow may carry. Frozen paths never read it; the fingerprint never includes it. */
export type ContinuityContext = {
  version: string;
  bounds: ContinuityBounds;
  /** Same-conversation messages before the window, oldest first, already limited to the bounds. */
  priorItems: EvidenceItem[];
};

export type ContinuityOptions = {
  registry?: IdentityRegistry;
  bounds?: Partial<ContinuityBounds>;
};

// Shared with claim-grounding.ts by content, not by import, so the frozen module stays untouched.
const COMPETING_CHILD = /其他小朋友|别的孩子|别的小朋友|另一个孩子|同学|哥哥|姐姐|弟弟|妹妹|双胞胎|同伴|小伙伴|表弟|表妹|堂弟|堂妹|小女孩|小男孩|别人家的孩子|人家的孩子|人家孩子|同龄|邻居家|小朋友|孩子们|其他宝宝|别的宝宝/;
const PRONOUN = /他|她|娃|崽/;
// The window resolver's infant-care vocabulary plus the developmental verbs and the clinic terms
// that only ever concern the child in this household. Deliberately not 吃/玩/笑/哭: adults do those.
const CHILD_CARE_TOPIC = /抱|喂|哄|睡|醒|尿不湿|纸尿裤|辅食|奶|爬|站|走|翻身|长牙|洗澡|推车|婴儿|宝宝|口水|安抚|奶嘴|便便|拉臭|扶|坐|发烧|体温|疫苗|儿保|学步|抓/;

// An adult mentioned in the third person is a competing referent for 他/她. Role nouns are matched
// as mentions; a speaker referring to their own role (mother writing 妈妈) is not a competitor.
const ADULT_ROLE_NOUNS: Array<{ pattern: RegExp; role?: string; id: string }> = [
  { pattern: /爸爸|爸比|老公|孩子他爸/, role: "father", id: "person-ted" },
  { pattern: /妈妈|老婆|孩子他妈/, role: "mother", id: "person-sujing" },
  { pattern: /雪姨|阿姨|育儿嫂|保姆/, role: "nanny", id: "person-xueyi" },
  { pattern: /爷爷|奶奶|外公|外婆|姥姥|姥爷|舅舅|舅妈|叔叔|姑姑|姨妈|小姨|婆婆|公公|老师|医生|护士|师傅|快递|司机/, id: "adult:unregistered" },
];

function namesSubject(text: string, names: string[]): boolean {
  return names.some((name) => name && text.includes(name));
}

function comparativeReferent(text: string, names: string[]): boolean {
  return names.some((name) => name && new RegExp(`比\\s*${name}[^\\n]{0,6}?[大小高矮]`).test(text));
}

function competingAdultsIn(text: string, speakerRole: string | undefined, registry: IdentityRegistry | undefined): string[] {
  const ids = new Set<string>();
  for (const noun of ADULT_ROLE_NOUNS) {
    if (!noun.pattern.test(text)) continue;
    if (noun.role && noun.role === speakerRole) continue;
    ids.add(noun.id);
  }
  for (const participant of registry?.participants ?? []) {
    const name = participant.displayName?.replace(/\\/g, "");
    if (!name || name.length < 2) continue;
    if (text.includes(name) && participant.relationshipToSubject !== speakerRole) ids.add(participant.canonicalPersonId ?? participant.sourceParticipantDigest);
  }
  return [...ids];
}

// A shared link's title or a quoted reply is not the family naming the child. Seen in the
// 2026-09-03 continuity shadow: 「\[链接\]五个月半的宝宝从床上掉下去」 — an article title whose 宝宝 is
// somebody else's baby — sat 43 messages above 「等他懂事以后再说吧」 as the nearest "antecedent".
const NOT_AN_UTTERANCE = /\\?\[链接\\?\]|^\s*>\s/;

function spanRefNaming(item: EvidenceItem, names: string[]): string | undefined {
  for (const span of item.spans) {
    const text = item.text.slice(span.start, span.end);
    if (NOT_AN_UTTERANCE.test(text)) continue;
    if (namesSubject(text, names) && !comparativeReferent(text, names)) return `${item.itemId}#${span.id}`;
  }
  return undefined;
}

function minutesBetween(later: string, earlier: string): number {
  return Math.round((Date.parse(later) - Date.parse(earlier)) / 60000);
}

/**
 * Attaches bounded prior-conversation context to every window of one conversation. Pure and
 * additive: the returned windows are shallow copies with a `continuity` field; items, neighbours,
 * ids and fingerprints are untouched. Windows must all belong to the same conversation and be in
 * the order buildEvidenceWindows produced.
 */
export function attachContinuityContext(windows: EvidenceWindow[], options: ContinuityOptions = {}): Array<EvidenceWindow & { continuity: ContinuityContext }> {
  const bounds = { ...DEFAULT_CONTINUITY_BOUNDS, ...options.bounds };
  const all = windows.flatMap((window) => window.items);
  return windows.map((window) => {
    // Count-limited only. The time bound is enforced by the walk itself, so a stale antecedent is
    // reported as `antecedent_out_of_bounds` rather than silently absent from the context.
    const start = all.findIndex((item) => item.itemId === window.items[0]?.itemId);
    const priorItems = start <= 0 ? [] : all.slice(Math.max(0, start - bounds.maxMessages), start);
    return { ...window, continuity: { version: SUBJECT_CONTINUITY_VERSION, bounds, priorItems } };
  });
}

function continuityOf(window: EvidenceWindow): ContinuityContext | undefined {
  return (window as EvidenceWindow & { continuity?: ContinuityContext }).continuity;
}

function unresolved(blockers: string[], competingSubjectIds: string[] = [], chainSpeakerIds: string[] = []): SubjectResolutionEvidence {
  return { version: SUBJECT_CONTINUITY_VERSION, basis: "unresolved", antecedentSourceIds: [], competingSubjectIds, blockers, chainSpeakerIds };
}

/**
 * Resolves the bare pronoun in `anchor` (a message of the window) by bounded backward continuity.
 *
 * Only called after the frozen resolvers have failed to find an antecedent in the window or its
 * neighbours; callers must keep that order, because a local antecedent is always the stronger basis.
 */
export function resolveByConversationContinuity(
  window: EvidenceWindow,
  anchor: EvidenceItem,
  subject: { primaryName: string; aliases: string[]; profileId?: string },
  options: ContinuityOptions = {},
): SubjectResolutionEvidence {
  const context = continuityOf(window);
  if (!context) return unresolved(["no_continuity_context"]);
  const bounds = { ...context.bounds, ...options.bounds };
  const names = [subject.primaryName, ...subject.aliases].filter(Boolean);
  const subjectId = subject.profileId ?? window.profileId;
  const registry = options.registry;

  if (!PRONOUN.test(anchor.text)) return unresolved(["no_subject_reference"]);
  if (namesSubject(anchor.text, names)) return unresolved(["anchor_names_subject_use_local_resolution"]);

  const anchorSpeaker = resolveSpeaker(anchor.senderDigest, registry);
  if (!anchorSpeaker.known || !anchorSpeaker.relationshipToSubject) return unresolved(["anchor_speaker_unverified"]);

  // The anchor message itself may name a competing referent: 「雪姨明天几点来？她坐地铁」.
  const anchorAdults = competingAdultsIn(anchor.text, anchorSpeaker.relationshipToSubject, registry);
  if (COMPETING_CHILD.test(anchor.text) || comparativeReferent(anchor.text, names)) return unresolved(["competing_person_in_anchor"], ["child:unverified"]);
  if (anchorAdults.length > 0) return unresolved(["competing_person_in_anchor"], anchorAdults);

  // Ordered chain: prior context, the window's before-neighbours and the window's own items, all
  // strictly before the anchor. Deduplicated by itemId; sorted by time then id like the builder.
  const seen = new Set<string>();
  const chain = [...context.priorItems, ...window.neighbors.before, ...window.items]
    .filter((item) => { if (seen.has(item.itemId)) return false; seen.add(item.itemId); return true; })
    .filter((item) => item.itemId !== anchor.itemId && Date.parse(item.sentAt) <= Date.parse(anchor.sentAt))
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.itemId.localeCompare(b.itemId));

  const chainSpeakerIds = new Set<string>([anchorSpeaker.canonicalPersonId ?? anchorSpeaker.speakerKey]);
  let topicGap = 0;
  let childTopicSeen = CHILD_CARE_TOPIC.test(anchor.text);
  let messages = 0;

  for (let index = chain.length - 1; index >= 0; index -= 1) {
    const item = chain[index];
    messages += 1;
    const minutes = minutesBetween(anchor.sentAt, item.sentAt);
    if (messages > bounds.maxMessages || minutes > bounds.maxMinutes) {
      return unresolved(["antecedent_out_of_bounds"], [], [...chainSpeakerIds]);
    }

    const speaker = resolveSpeaker(item.senderDigest, registry);
    const text = item.text;

    // Competing referents break the chain before any antecedent can be credited.
    if (COMPETING_CHILD.test(text) || comparativeReferent(text, names)) {
      return unresolved(["competing_person_in_chain"], ["child:unverified"], [...chainSpeakerIds]);
    }
    const adults = competingAdultsIn(text, speaker.relationshipToSubject, registry);
    if (adults.length > 0 && !namesSubject(text, names)) {
      return unresolved(["competing_person_in_chain"], adults, [...chainSpeakerIds]);
    }

    const antecedentRef = spanRefNaming(item, names);
    if (antecedentRef) {
      if (!speaker.known || !speaker.relationshipToSubject) {
        return unresolved(["antecedent_speaker_unverified"], [], [...chainSpeakerIds]);
      }
      chainSpeakerIds.add(speaker.canonicalPersonId ?? speaker.speakerKey);
      if (!childTopicSeen && !CHILD_CARE_TOPIC.test(text)) {
        return unresolved(["antecedent_without_corroboration"], [], [...chainSpeakerIds]);
      }
      return {
        version: SUBJECT_CONTINUITY_VERSION,
        subjectId,
        basis: "conversation_continuity",
        antecedentSourceIds: [item.sourceId],
        antecedentSpan: { ref: antecedentRef, sourceId: item.sourceId, itemId: item.itemId },
        antecedentDistance: { messages, minutes },
        competingSubjectIds: [],
        continuityReason: messages === 1 ? "adjacent_named_antecedent" : "bounded_child_topic_chain",
        blockers: [],
        chainSpeakerIds: [...chainSpeakerIds],
      };
    }

    // Chain link quality: a message that keeps the pronoun or the care topic keeps the thread; a run
    // of messages doing neither is a change of subject.
    if (PRONOUN.test(text) || CHILD_CARE_TOPIC.test(text)) {
      topicGap = 0;
      if (CHILD_CARE_TOPIC.test(text)) childTopicSeen = true;
    } else {
      topicGap += 1;
      if (topicGap > bounds.maxTopicGap) return unresolved(["topic_discontinuity"], [], [...chainSpeakerIds]);
    }
    if (speaker.known && speaker.canonicalPersonId) chainSpeakerIds.add(speaker.canonicalPersonId);
  }

  return unresolved(["no_antecedent_in_bounds"], [], [...chainSpeakerIds]);
}

/** The earliest message in the window that carries a bare pronoun — the window-level anchor. */
export function firstPronounItem(window: EvidenceWindow): EvidenceItem | undefined {
  return window.items.find((item) => PRONOUN.test(item.text));
}
