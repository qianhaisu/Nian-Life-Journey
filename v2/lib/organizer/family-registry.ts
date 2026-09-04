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
    {
      // Teddy, 2026-09-04: 陈亚萍 is 张年's grandmother. This supersedes the earlier "low value"
      // judgement recorded against her conversation in STATE §2, which is void.
      sourceParticipantDigest: senderDigestForDisplayName("陈亚萍"),
      displayName: "陈亚萍",
      canonicalPersonId: "person-chenyaping",
      relationshipToSubject: "grandmother",
      narrativeLabel: "奶奶",
    },
    // The nursery's own accounts, one per class plus the centre and its after-hours desk. Teddy,
    // 2026-09-04: a teacher's words are to read as 老师, never as a family member's. They share one
    // canonicalPersonId on purpose — they are one institution, so two of them saying the same thing
    // is one witness, not two corroborating ones.
    //
    // Individual people in that group (大兵, 潇, and the rest) stay unmapped. Which of them are
    // teachers and which are relatives is not something this file may infer: an unmapped speaker
    // resolves to unknown and may not be named.
    ...["好奇星芽星班", "好奇星辰星班", "好奇星禾星班", "好奇星托育中心（金地园区）", "好奇星晚托服务号15267129562"].map((displayName) => ({
      sourceParticipantDigest: senderDigestForDisplayName(displayName),
      displayName,
      canonicalPersonId: "person-nursery",
      relationshipToSubject: "teacher",
      narrativeLabel: "老师",
    })),
  ],
};

/** The family role to record on a RawSource for a given speaker, or undefined when unknown. */
export function relationshipForSender(senderDigest: string): string | undefined {
  return FAMILY_REGISTRY.participants.find((participant) => participant.sourceParticipantDigest === senderDigest)?.relationshipToSubject;
}
