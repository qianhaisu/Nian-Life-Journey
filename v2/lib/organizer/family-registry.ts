// The verified Family Identity Registry for 张年's archive.
//
// Every entry here was confirmed by Teddy. Display names and their digests were recovered
// deterministically (see identity.ts — forward hashing of the exporter's display name, never
// reversal); the RELATIONSHIP and NARRATIVE LABEL on each row are his confirmation, not inference.
// A speaker who is not in this list resolves to unknown and may not be named in a story.
//
// Note 苏静/阿静: the WeChat export writes her display name as 阿静, while the rest of the family
// @-mentions her as 苏静. Those are one person, which is exactly why canonicalPersonId exists —
// evidence from both spellings must count as one speaker, not two corroborating witnesses.
import { senderDigestForDisplayName, type IdentityRegistry } from "./identity";

export const FAMILY_REGISTRY: IdentityRegistry = {
  participants: [
    {
      sourceParticipantDigest: senderDigestForDisplayName("Ted"),
      displayName: "Ted",
      canonicalPersonId: "person-ted",
      relationshipToSubject: "father",
      narrativeLabel: "爸爸",
    },
    {
      sourceParticipantDigest: senderDigestForDisplayName("阿静"),
      displayName: "阿静",
      canonicalPersonId: "person-sujing",
      relationshipToSubject: "mother",
      narrativeLabel: "妈妈",
    },
    {
      // 育儿嫂 — a primary daily carer, so her reports are firsthand observation (see evidence/tier.ts).
      // The export escapes the trailing dot, and that escaped spelling is what the digest is built from.
      sourceParticipantDigest: senderDigestForDisplayName("hxx\\."),
      displayName: "hxx.",
      canonicalPersonId: "person-xueyi",
      relationshipToSubject: "nanny",
      narrativeLabel: "雪姨",
    },
  ],
};

/** The family role to record on a RawSource for a given speaker, or undefined when unknown. */
export function relationshipForSender(senderDigest: string): string | undefined {
  return FAMILY_REGISTRY.participants.find((participant) => participant.sourceParticipantDigest === senderDigest)?.relationshipToSubject;
}
