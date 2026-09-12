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
// One conversation id is named below by a scoped entry. Taken from the gate's own constant rather
// than copied, so the two files cannot drift; subject-gate imports nothing at runtime, so this adds
// no cycle.
import { DAYCARE_CONVERSATION } from "./subject-gate";

/**
 * People who appear by NAME in the chats and are not 张年. Teddy-supplied facts, exactly like the
 * registry above — nothing here is inferred from chat content.
 *
 * What it is for: a window earns a model call because the child is named SOMEWHERE in it, and a
 * claim may then take a bounded antecedent walk to that naming. On 2025-11-17 that walk carried
 * 「简简今天吃的是生菜、虾和米饭」 onto 张年's page, and on 2025-01-09 eight photographs sent with the
 * words 「滕小时候」 became his. A sentence that names one of these people, and does not name him, is
 * not his day.
 *
 * What it is NOT for: it never makes a window unrelated, and it never fires on a sentence that names
 * him too. 「宝宝跟永滕小时候长得像吗」 is about him and stays — a shared moment with another person in
 * it is still his.
 */
export const OTHER_NAMED_PEOPLE: readonly string[] = Object.freeze([
  // The father's given name, as the family writes it. 「张永滕回来了吗」, 「滕小时候」.
  "永滕",
  "滕小时候",
  // Another child the nanny feeds and reports on. Teddy, 2026-09-11.
  "简简",
]);

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
      // The same display name, unescaped — which is the ONLY difference between the two entries.
      // WeFlow's Markdown transcript escapes the trailing dot in the message header ("hxx\.") and
      // its JSON writes the name plain ("hxx."); the two spellings hash to two digests
      // (11661f9a… and 10db6101…), so the same person arrives under two join keys depending on
      // which file an import read. identity.ts's displayNameVariants() has always known about this
      // pair; what it could not do is decide that the person behind them is the same one, which is
      // a claim about a real family and belongs here.
      //
      // The evidence, taken on 2026-09-12 over the one window where both exports cover the same
      // conversation (2026-09-04, the only day 雪姨 speaks in it): all 8 of her Markdown messages
      // have exactly one JSON message at the same second and its sender is "hxx." — no other
      // candidate at any of those seconds; 5 of the 8 agree character for character after undoing
      // the Markdown punctuation escaping, including 「下次换一种说话方式试试，"小年和妈妈比赛看看
      // 谁先走到学校好吗？"」; a 6th is the same quoted reply serialised two ways (`> 小年妈妈: …`
      // against `…[引用 小年妈妈：…]`, JSON kind 引用消息). The remaining 2 are sticker placeholders
      // and are NOT counted — a placeholder matching a placeholder proves nothing. The mapping is a
      // bijection in both directions across every overlapping message.
      //
      // Scoped to the nursery class group's JSON conversation, the one it was proven in. The same
      // plain digest also sits on 118 messages in 小雪微信群 (conversation:e6adbcaf…); whether that
      // is the same person is not something this file may infer, so those stay unnamed.
      sourceParticipantDigest: senderDigestForDisplayName("hxx."),
      displayName: "hxx.",
      canonicalPersonId: "person-xueyi",
      relationshipToSubject: "nanny",
      narrativeLabel: "雪姨",
      conversationIds: [DAYCARE_CONVERSATION],
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
    {
      // The exporting account's own placeholder. `senderDigestForDisplayName("我")` is
      // 4366d185…, matched by forward hash on 2026-09-11 — 10,047 messages, all of them inside the
      // two private chats below and none in any group, where everyone has a real display name.
      //
      // Teddy confirmed both of those exports came from his own WeChat, so 我 is the father in
      // these four conversation ids and in no others. The list is the conversation the mapping was
      // confirmed FOR, not a convenience: another household member's export would write their own
      // messages under the same placeholder and the same digest, and a global entry would quietly
      // put the father's name on them.
      sourceParticipantDigest: senderDigestForDisplayName("我"),
      displayName: "我",
      canonicalPersonId: "person-ted",
      relationshipToSubject: "father",
      narrativeLabel: "爸爸",
      conversationIds: [
        "conversation:0567a44e538fc41f22b57097", // 阿静 (妈妈) private chat
        "conversation:bfdcc142ba4c02f5aebec4c7", // 阿静, post-fix id
        "conversation:5e89f3dacc787d226503906a", // 陈亚萍 (奶奶) private chat
        "conversation:6789abd45ba255751fd4d428", // 陈亚萍, post-fix id
      ],
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
