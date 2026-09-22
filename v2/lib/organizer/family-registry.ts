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
      // 2026-09-22: Teddy confirmed hxx = 雪姨 in ALL groups (not just daycare). Scope restriction
      // removed. The same plain digest sits on 118 messages in 小雪微信群 (conversation:e6adbcaf…)
      // and will now resolve correctly as 雪姨 there too.
      sourceParticipantDigest: senderDigestForDisplayName("hxx."),
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
    {
      // Teddy, 2026-09-12: 大兵 is the director (园长) of 好奇星, the daycare 张年 attends.
      //
      // The recorded role and the spoken label are deliberately different. Teddy's instruction is
      // that stories and pages call him 「大兵老师」 and never 「园长」 — a title is how an
      // institution refers to itself, not how this family talks about the person who sends them
      // photographs of their son. So relationshipToSubject carries the fact and narrativeLabel
      // carries the word; nothing infers one from the other.
      //
      // His own canonicalPersonId, NOT person-nursery. The class accounts share one id because they
      // are one institution speaking; he posts as himself, and folding him in would quietly make him
      // and a class account "one witness" when they are two.
      //
      // Scoped, for the same reason 雪姨's plain spelling is scoped: the digest is a hash of the
      // display name, so any account anywhere displaying 大兵 would collide with it. Every occurrence
      // measured on 2026-09-12 — 540 messages in the class group, 172 in 张小年小群, and six
      // conversation ids in the database, all of them one of those two real groups — is the daycare.
      // 87c42fdc… is the 张小年小群 JSON, which this round's import creates; it is listed so the
      // rows that land there resolve rather than arriving unnamed.
      sourceParticipantDigest: senderDigestForDisplayName("大兵"),
      displayName: "大兵",
      canonicalPersonId: "person-dabing",
      relationshipToSubject: "teacher",
      narrativeLabel: "大兵老师",
      conversationIds: [
        DAYCARE_CONVERSATION, // 乳儿班 JSON
        "conversation:d64551c8e1cea882635e3969", // 乳儿班, earliest id
        "conversation:d3a0e5f619ac6fe3e40d81cf", // 乳儿班 md, post-fix id
        "conversation:bb5d5ba6da5986d35b923465", // 乳儿班 md, pre-fix id
        "conversation:87c42fdc94895ff6b94222da", // 张小年小群 JSON
        "conversation:8778e74dea416b9fc8ab6651", // 张小年小群 md, post-fix id
        "conversation:d016ea9b700f45190ee50221", // 张小年小群 md, pre-fix id
      ],
    },
    {
      // Teddy, 2026-09-12: 吴艳 is 大兵's wife and provides infant 抚触 (touch care) part-time.
      //
      // "caregiver", not any medical role. What the export shows her doing is the daycare's 抚触 and
      // 药浴 sessions and writing up what she did; nothing in this archive establishes a clinical
      // qualification, and tier.ts would read a medical role as a different kind of evidence.
      //
      // narrativeLabel is her name as the family writes it. No title is invented: Teddy gave the
      // relationship and 大兵's spoken label, and said nothing about hers, so this uses the plain
      // name rather than guessing at 老师.
      //
      // Scoped to 张小年小群, the only place she speaks — 81 messages in the JSON export, 4 rows in
      // the database so far. The @-mention form 「好奇星·安小苗｜吴艳」 is never a sender, only text
      // inside someone else's message, so it needs no entry.
      sourceParticipantDigest: senderDigestForDisplayName("吴艳"),
      displayName: "吴艳",
      canonicalPersonId: "person-wuyan",
      relationshipToSubject: "caregiver",
      narrativeLabel: "吴艳",
      conversationIds: [
        "conversation:87c42fdc94895ff6b94222da", // 张小年小群 JSON
        "conversation:8778e74dea416b9fc8ab6651", // 张小年小群 md, post-fix id
        "conversation:d016ea9b700f45190ee50221", // 张小年小群 md, pre-fix id
      ],
    },
    {
      // Teddy, 2026-09-21 (NIGHT-RELATIONS-20260921): 鹿城  筱薇 is 张年's maternal grandmother
      // (外婆). The display name contains a double space between 鹿城 and 筱薇 — that is the exact
      // spelling WeFlow exports and must be preserved; a single space hashes to a different digest.
      //
      // She speaks across multiple family groups: 472 messages in DB as of 2026-09-21, of which
      // 282 in 亲爱的爸爸妈妈 (conversation:77348fd4…) and 102 in the daycare class group
      // (DAYCARE_CONVERSATION). No conversationIds scope — she is a named family member whose
      // display name is distinctive enough that a collision with an unrelated account is implausible.
      // wxid confirmed 2026-09-22 via R7-CODEX-ACCOUNT-EVIDENCE.json (kept in private evidence file).
      // Display name used for matching.
      sourceParticipantDigest: senderDigestForDisplayName("鹿城  筱薇"),
      displayName: "鹿城  筱薇",
      canonicalPersonId: "person-waipo",
      relationshipToSubject: "maternal_grandmother",
      narrativeLabel: "外婆",
    },
    {
      // Teddy, confirmed 2026-09-12 session (stored in project memory), reconfirmed by context
      // 2026-09-21: 老苏 is 张年's maternal grandfather (外公). He is 苏静's father.
      //
      // 1,243 messages in DB as of 2026-09-21 across 12 conversations — scoped to all of them.
      // wxid confirmed 2026-09-22 via R7-CODEX-ACCOUNT-EVIDENCE.json (kept in private evidence file).
      // The registry uses displayName-based digests because WeFlow exports include a stable display
      // name; the wxid is retained in the private evidence file, not in source code.
      // The mapping is restricted to confirmed conversations; new conversations must be added explicitly.
      sourceParticipantDigest: senderDigestForDisplayName("老苏"),
      displayName: "老苏",
      canonicalPersonId: "person-laos",
      relationshipToSubject: "maternal_grandfather",
      narrativeLabel: "外公",
      conversationIds: [
        "conversation:77348fd4007b65a8c3dc680f", // 亲爱的爸爸妈妈 JSON (467 msgs)
        "conversation:c9882c6d1fb49581840dd47c", // 老苏家 JSON (238 msgs)
        DAYCARE_CONVERSATION,                    // 乳儿班 JSON (224 msgs)
        "conversation:b237eb2ab60e65c404be9cd0", // 老苏家 alt id (111 msgs)
        "conversation:8245344e70d2a1a24311ea3e", // 老苏家 alt id 2 (111 msgs)
        "conversation:e6adbcafc3c6e32be0494251", // 小雪微信群 (63 msgs)
        "conversation:d3a0e5f619ac6fe3e40d81cf", // 乳儿班 md post-fix (15 msgs)
        "conversation:d64551c8e1cea882635e3969", // 乳儿班 earliest id (5 msgs)
        "conversation:bb5d5ba6da5986d35b923465", // 乳儿班 md pre-fix (5 msgs)
        "conversation:3769bfd8fba668c7fb3ad240", // 亲爱的爸爸妈妈 md post-fix (2 msgs)
        "conversation:6a708760503a82492b62494b", // (1 msg)
        "conversation:6a77e80c2c1d96dd24bfc523", // (1 msg)
      ],
    },
    {
      // Teddy, confirmed 2026-09-12 session (stored in project memory), reconfirmed by context
      // 2026-09-21: 张存华 is 张年's paternal grandfather (爷爷). He is 张永滕's father.
      //
      // 572 messages in DB as of 2026-09-21 across 7 conversations — scoped to all of them.
      // wxid confirmed 2026-09-22 via R7-CODEX-ACCOUNT-EVIDENCE.json (kept in private evidence file).
      // Scoped to confirmed conversations, same reasoning as 老苏.
      sourceParticipantDigest: senderDigestForDisplayName("张存华"),
      displayName: "张存华",
      canonicalPersonId: "person-zhangcunhua",
      relationshipToSubject: "paternal_grandfather",
      narrativeLabel: "爷爷",
      conversationIds: [
        "conversation:77348fd4007b65a8c3dc680f", // 亲爱的爸爸妈妈 JSON (477 msgs)
        DAYCARE_CONVERSATION,                    // 乳儿班 JSON (86 msgs)
        "conversation:d3a0e5f619ac6fe3e40d81cf", // 乳儿班 md post-fix (3 msgs)
        "conversation:3769bfd8fba668c7fb3ad240", // 亲爱的爸爸妈妈 md post-fix (2 msgs)
        "conversation:d64551c8e1cea882635e3969", // 乳儿班 earliest id (2 msgs)
        "conversation:6a708760503a82492b62494b", // (1 msg)
        "conversation:bb5d5ba6da5986d35b923465", // 乳儿班 md pre-fix (1 msg)
      ],
    },
    // The nursery's own accounts, one per class plus the centre and its after-hours desk. Teddy,
    // 2026-09-04: a teacher's words are to read as 老师, never as a family member's. They share one
    // canonicalPersonId on purpose — they are one institution, so two of them saying the same thing
    // is one witness, not two corroborating ones.
    //
    // 潇 and the rest of the individuals in that group stay unmapped. Which of them are teachers and
    // which are relatives is not something this file may infer: an unmapped speaker resolves to
    // unknown and may not be named. 大兵 and 吴艳 are above because Teddy confirmed them, not
    // because anything here worked them out.
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
