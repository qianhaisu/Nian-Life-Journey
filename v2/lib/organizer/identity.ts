// Family Identity Layer.
//
// Speaker identity is evidence, not decoration. "爸爸 and 妈妈 both saw him do it" is stronger
// evidence than one unattributed line, and a story that can say who spoke reads like a family
// record instead of a transcript summary. The WeChat importer stored only
// `metadata.senderDigest`, and the Evidence Builder used to hash the import-level `contributorId`
// on top of that, so every speaker in the family group collapsed into one anonymous sender.
//
// Recovery, not reversal. The stored digest is a forward hash chain over the exporter's display
// name:
//     senderDigest = sha256("sender:" + sha256(displayName).hex.slice(0, 24)).hex
// so a *candidate* display name can be hashed forward and compared. Nothing here inverts a hash: an
// unmatched digest stays unknown. Candidates come from names the archive already contains
// (@mentions, quoted-reply prefixes) or from a human-supplied list.
//
// Relationship is never inferred. A display name is a recoverable fact; "this person is 妈妈" is a
// claim about a real family that only the family can make. `relationshipToSubject` and
// `narrativeLabel` are therefore human-supplied fields, and an unmapped speaker stays explicitly
// unknown rather than being flattened into a generic "家人".
import { createHash } from "node:crypto";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");

/** Reproduces the importer's chain (lib/ingest/wechat-markdown.ts + lib/ingest/wechat-import.ts). */
export function senderDigestForDisplayName(displayName: string): string {
  return sha256(`sender:${sha256(displayName).slice(0, 24)}`);
}

// The exporter writes the display name into the message header with markdown escaping ("hxx\."),
// while the same name inside a message body is read unescaped. Both spellings hash differently, so
// a candidate must be tried in both forms — this is what recovered the archive's second-largest
// speaker (3,140 messages) after the plain spelling missed.
const MARKDOWN_PUNCTUATION = /([.\-_*[\]()#+!~`>])/g;
export function displayNameVariants(candidate: string): string[] {
  const trimmed = candidate.trim();
  if (!trimmed) return [];
  const bases = new Set([trimmed, `${trimmed}.`, trimmed.replace(/\.$/, "")]);
  const variants = new Set<string>();
  for (const base of bases) {
    if (!base) continue;
    variants.add(base);
    variants.add(base.replace(MARKDOWN_PUNCTUATION, "\\$1"));
  }
  return [...variants];
}

/**
 * Forward-matches candidate display names against digests already in the archive.
 * Only exact hash matches are returned; a candidate that matches nothing is simply dropped.
 */
export function recoverDisplayNames(knownDigests: Iterable<string>, candidates: Iterable<string>): Map<string, string> {
  const wanted = new Set(knownDigests);
  const recovered = new Map<string, string>();
  for (const candidate of candidates) {
    for (const variant of displayNameVariants(candidate)) {
      const digest = senderDigestForDisplayName(variant);
      if (wanted.has(digest) && !recovered.has(digest)) recovered.set(digest, variant);
    }
  }
  return recovered;
}

// Harvests the only places a display name appears inside message text. Used to build the candidate
// list for recovery without needing the original export on disk.
export function harvestDisplayNameCandidates(texts: Iterable<string>): Map<string, number> {
  const candidates = new Map<string, number>();
  const add = (raw: string) => {
    const name = raw.trim().replace(/\\/g, "").replace(/[：:，,。.\s]+$/, "");
    if (!name || name.length > 24) return;
    candidates.set(name, (candidates.get(name) ?? 0) + 1);
  };
  for (const text of texts) {
    for (const match of text.matchAll(/@([^\s@，。:：]{1,20})/g)) add(match[1]);
    for (const match of text.matchAll(/^>\s*([^:：\n]{1,20})[:：]/gm)) add(match[1]);
    for (const match of text.matchAll(/["“]([^"”\n]{1,20})["”]\s*撤回了一条消息/g)) add(match[1]);
  }
  return candidates;
}

export type ParticipantIdentity = {
  /** Stable identity of the speaker in the source system. The archive's join key. */
  sourceParticipantDigest: string;
  /** Name exactly as the export wrote it. A recovered fact, never shown raw in the family UI. */
  displayName?: string;
  /** Stable across display-name changes: the same person renamed keeps this id. Human-supplied. */
  canonicalPersonId?: string;
  /** Human-supplied. Never inferred from chat content. */
  relationshipToSubject?: string;
  /** What a story may call this person ("爸爸"). Human-supplied; absent means do not name them. */
  narrativeLabel?: string;
};

export type IdentityRegistry = { participants: ParticipantIdentity[] };

export type ResolvedSpeaker = {
  known: boolean;
  senderDigest: string;
  /** Stable, non-identifying token safe for grouping and for evidence-strength comparisons. */
  speakerKey: string;
  displayName?: string;
  canonicalPersonId?: string;
  relationshipToSubject?: string;
  /** Present only when a human mapped this speaker; the writer may use this and nothing else. */
  narrativeLabel?: string;
};

// An unmapped speaker is unknown, not "家人". Calling an unidentified person a family member is an
// unsupported claim, and it is exactly the flattening this layer exists to undo.
export const UNKNOWN_SPEAKER_LABEL = "未知发言人";

export function resolveSpeaker(senderDigest: string, registry: IdentityRegistry | undefined): ResolvedSpeaker {
  const speakerKey = `speaker-${senderDigest.slice(0, 8)}`;
  const participant = registry?.participants.find((candidate) => candidate.sourceParticipantDigest === senderDigest);
  if (!participant) return { known: false, senderDigest, speakerKey };
  return {
    known: true,
    senderDigest,
    // Two display names for one canonical person must group as one speaker; without a canonical id
    // the digest remains the identity.
    speakerKey: participant.canonicalPersonId ? `person-${participant.canonicalPersonId}` : speakerKey,
    displayName: participant.displayName,
    canonicalPersonId: participant.canonicalPersonId,
    relationshipToSubject: participant.relationshipToSubject,
    narrativeLabel: participant.narrativeLabel,
  };
}

/**
 * What the family UI and the writer may call this speaker. Never returns a raw WeChat id or hash:
 * an unmapped speaker is explicitly unknown.
 */
export function displayLabelFor(speaker: ResolvedSpeaker): string {
  return speaker.narrativeLabel ?? speaker.displayName ?? UNKNOWN_SPEAKER_LABEL;
}

/** Whether a story is allowed to name this speaker. Only a human-verified mapping unlocks it. */
export function mayNameInNarrative(speaker: ResolvedSpeaker): boolean {
  return Boolean(speaker.narrativeLabel);
}

/**
 * Independent corroboration: how many distinct people described this window. Counts canonical
 * people where known so one person under two display names is not counted twice, and never counts
 * unknown speakers as a single merged "家人".
 */
export function distinctSpeakerCount(senderDigests: Iterable<string>, registry: IdentityRegistry | undefined): number {
  const keys = new Set<string>();
  for (const digest of senderDigests) keys.add(resolveSpeaker(digest, registry).speakerKey);
  return keys.size;
}
