import type { EvidenceWindow } from "./evidence/types";

// Which messages may become a record of 张年's life, decided before any model is called.
//
// The rule organizer had no such gate: it wrote a day's first chat line into the archive, which is
// how "你几点下班" and a used-car negotiation became entries in a child's life story. Teddy,
// 2026-09-04: the gate has to be strict on its own, because nobody is going to review the output —
// a sparse page is fine, a wrong one is not.
//
// This decides only what is ELIGIBLE. Whether an eligible day is worth writing, and whether each
// sentence is supported, stays with the evidence pipeline and the narrative validator.

/** What the family calls him. 张年 is his name; the rest are what actually appears in the chats. */
export const SUBJECT_NAMES = ["张年", "张小年", "小年年", "小年", "年年", "崽崽", "崽", "宝宝", "宝贝"] as const;

/**
 * 乳儿班张小年家庭群 — the nursery's family group. The one WeChat group with a single-child gate
 * policy of "all" (see POLICIES below), and the only WeChat source whose media (lib/family-archive.ts
 * mediaPrivilegeOf, T11) is trusted without a published event vouching for it, on the same reasoning:
 * every message and every photo in this specific group is about him. Named so the id isn't a bare
 * string duplicated across modules that need to agree on which conversation this is.
 */
export const DAYCARE_CONVERSATION = "conversation:2109e1e89306b57b8334d349";

export type SubjectGatePolicy =
  /** The whole conversation is about him, so every message is eligible. */
  | "all"
  /** A group that exists because of him: a naming message, and what the same person says next. */
  | "group"
  /** A private chat between adults: only a message that names him, and nothing inferred. */
  | "private"
  /** Superseded by a more complete re-export of the same real conversation — see below. */
  | "excluded";

export type SubjectGate = { policy: SubjectGatePolicy; conversation: string };

// Conversations by source label. Labels are content-derived hashes, so they are listed rather than
// pattern-matched; a conversation that is not listed gets the strictest policy, never the loosest.
//
// Two labels for one conversation is normal here: WeFlow exported some of these twice, and an
// export's Markdown and JSON carry different conversation identities on purpose (see
// lib/ingest/wechat-weflow-json.ts).
const POLICIES: Record<string, SubjectGatePolicy> = {
  // Teddy, 2026-09-04: everything in it is about him.
  [DAYCARE_CONVERSATION]: "all", // WeFlow JSON, 7,244 messages — see "excluded" below for its md pair

  // Groups that exist because of him. He is usually the subject, but the adults also talk to each
  // other in them, so a message earns its place by naming him or by continuing the thought of one.
  "conversation:a673c0e0563be6ecf1867094": "group", // 主群 (作战部队), current export
  "conversation:856b8ec2b8f3ec2871782ca6": "group", // 主群, earlier export
  "conversation:87c42fdc94895ff6b94222da": "group", // 张小年小群, JSON — see "excluded" below for its md pair
  "conversation:e6adbcafc3c6e32be0494251": "group", // 小雪微信群, JSON
  "conversation:77348fd4007b65a8c3dc680f": "group", // 亲爱的爸爸妈妈, JSON — see "excluded" below for its md pair
  "conversation:b237eb2ab60e65c404be9cd0": "group", // 老苏家

  // Private chats between two adults. Most of what is said has nothing to do with him.
  "conversation:0567a44e538fc41f22b57097": "private", // 阿静 (妈妈)
  "conversation:5e89f3dacc787d226503906a": "private", // 陈亚萍 (奶奶)

  // Superseded by a WeFlow JSON re-export of the SAME real conversation (see
  // lib/ingest/wechat-weflow-json.ts): same messages, different conversationId, so both used to
  // reach the gate and could each produce a page for the same day. Cowork, 2026-09-04, reviewing the
  // first 2026-09 dry-run: two near-identical stories came out for 09-02, one from each side of the
  // 乳儿班 md/json pair. Retiring (deleting) the smaller md rows needs Teddy's separate confirmation
  // (they're production rows), so for now the md side is excluded from the gate instead — the json
  // side is strictly the more complete re-export, so nothing is lost, and the duplicate is gone
  // without deleting anything. Exact-text (sentAt, sender, text) matching to prove the overlap
  // row-by-row does NOT work here — see subject-gate.test.mjs and STATUS.md 2026-09-04 for why.
  "conversation:bb5d5ba6da5986d35b923465": "excluded", // 乳儿班 md (70 rows), superseded by 2109e1e8… json
  "conversation:d016ea9b700f45190ee50221": "excluded", // 张小年小群 md (11 rows), superseded by 87c42fdc… json
  "conversation:2bca9fd86569eeed46b59927": "excluded", // 亲爱的爸爸妈妈 md (9 rows), superseded by 77348fd4… json
  // 温州爸妈 md (9 rows). Cowork's T9a/17:15 notes list this alongside the three json-superseded
  // conversations above, but no json re-export of 温州爸妈 is among the four groups being imported —
  // unconfirmed whether it's actually superseded, or a mislabel of a different conversation. Excluding
  // it anyway per Cowork's explicit instruction: it already contributes 0 kept messages in every
  // 2026-09 dry-run so far, so this changes nothing this month; re-verify before relying on this for
  // a month where it might actually matter.
  "conversation:b4bdc9710e1faebcc88fd25e": "excluded",
};

export function subjectGateFor(conversation: string): SubjectGate {
  // An unlisted conversation is treated as a private chat: eligibility has to be earned message by
  // message. Getting this default wrong in the other direction would publish a stranger's day.
  return { policy: POLICIES[conversation] ?? "private", conversation };
}

// Text that carries no claim about anyone. A day made only of these is not a quiet day worth
// describing; it is an absence of material, and saying anything about it would be invention.
const EMPTY_TEXT = /^\s*(?:\[(?:media|图片|视频|表情包|动画表情|语音|语音通话|文件|位置|小程序|链接|聊天记录)[^\]]*\]|\[语音通话\][^\n]*|https?:\/\/\S+|[\s\p{Extended_Pictographic}\p{Emoji_Presentation}·、。，！？…~-]*)\s*$/u;

export function isEmptyMessage(text: string): boolean {
  if (!text.trim()) return true;
  return EMPTY_TEXT.test(text.trim());
}

export function namesSubject(text: string): boolean {
  return SUBJECT_NAMES.some((name) => text.includes(name));
}

export type GateVerdict = {
  passes: boolean;
  kept: EvidenceWindow["items"];
  rejected: EvidenceWindow["items"];
};

/**
 * Applies a conversation's policy to one window's messages.
 *
 * `group` allows a naming message and the messages the SAME sender adds straight after it, which is
 * how people actually write: "他今天自己走了两步" then "走了三四步就坐下了". The run ends as soon as
 * somebody else speaks, so a reply about something unrelated never inherits eligibility.
 *
 * `private` allows only a message that names him. A bare pronoun in a chat between two adults, about
 * their own day, cannot be resolved to the child by anything this gate can see, and guessing is the
 * failure mode the whole gate exists to prevent.
 */
export function passesSubjectGate(window: EvidenceWindow, gate: SubjectGate): GateVerdict {
  if (gate.policy === "excluded") return { passes: false, kept: [], rejected: [...window.items] };
  const kept: EvidenceWindow["items"] = [];
  const rejected: EvidenceWindow["items"] = [];
  let carrySender: string | undefined;
  for (const item of window.items) {
    const text = item.text ?? "";
    if (isEmptyMessage(text) && !namesSubject(text)) { rejected.push(item); carrySender = undefined; continue; }
    const named = namesSubject(text);
    let eligible: boolean;
    if (gate.policy === "all") eligible = true;
    else if (gate.policy === "private") eligible = named;
    else eligible = named || (carrySender !== undefined && item.senderDigest === carrySender);
    // Keyed by digest, not by the label shown to a reader: several people share the label 老师, and
    // one of them naming him must not make the next one's unrelated message eligible.
    if (gate.policy === "group") carrySender = named ? item.senderDigest : eligible ? carrySender : undefined;
    (eligible ? kept : rejected).push(item);
  }
  // A window earns a model call only if something in it is actually about him. One eligible message
  // in a window of thirty is enough to look; it is not enough to publish, and nothing here says it is.
  return { passes: kept.length > 0, kept, rejected };
}
