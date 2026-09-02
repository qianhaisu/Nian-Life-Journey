// Holdout V2 — frozen, independently constructed real-data test set for a one-time evaluation of
// frozen Organizer V5. Construction and preflight are recorded in the handoff report; the summary:
//
//   - Every case is identified by (conversation, lifeDate, anchorSourceId), never by a LifeEvent id
//     and never by a day derived through JS `Date` + `.toISOString()` (the defect that invalidated
//     the first Holdout V2 attempt — see life-date.ts). Every lifeDate here was read via
//     the authoritative Shanghai life-date SQL and cross-checked against shanghaiCalendarDate() on
//     the anchor's own captured_at. (That SQL was originally written as a bare
//     to_char(captured_at, ...) on the belief that captured_at was tz-naive Shanghai wall clock; it
//     is in fact timestamptz, so the expression has since been corrected to convert AT TIME ZONE
//     'Asia/Shanghai' first — see life-date.ts. The cross-check against shanghaiCalendarDate() was
//     part of preflight from the start and passes for all 19 anchors under BOTH expressions, which
//     is the evidence that no Holdout V2 anchor ever fell in the affected 00:00-07:59 band.)
//   - Candidates were drawn two ways, both mechanical and reproducible: a keyword scan for
//     capability/transition/recurrence/negation language across the full archive, and deterministic
//     per-month quartile sampling (days at the 20th/50th/80th percentile position) for ordinary/dense
//     coverage. Neither pass looked at whether V5 would pass or fail a candidate before it was
//     labelled.
//   - Every candidate's real text was read before assigning frozenLabel — labels are judgements
//     about the evidence, never inferred from the presence of a keyword (see HV2-B03: it contains
//     the literal words "第一次" and is labelled borderline anyway, because the "first" is about the
//     SHAPE of a crying face, not a developmental transition).
//   - Preflight (evidence/window.ts's real buildEvidenceWindows, zero model calls) confirmed: every
//     anchor resolves to exactly one window, 19/19 VALID, 0 invalid, 0 ambiguous.
//   - None of these days/messages overlap the (spent, invalid) first Holdout V2 attempt or the
//     frozen development set. Two cases (HV2-P05, HV2-B07) come from a second, distinct WeChat
//     conversation (a teacher/parent daycare group) that appeared in the first attempt's dead H-P4
//     fixture but was never actually read by any run (that fixture failed with zero sources before
//     any query touched it) — recorded here for full transparency.
//
// FROZEN. Do not edit labels, anchors, dates, or composition. A change here invalidates the
// evaluation this set exists to run. Add a new set with a new name instead.
export type HoldoutV2Class = "positive" | "borderline" | "negative";

export type HoldoutV2Case = {
  id: string;
  conversation: string;
  lifeDate: string;
  anchorSourceId: string;
  cls: HoldoutV2Class;
  rationale: string;
};

const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";
const FEB = "conversation:d64551c8e1cea882635e3969";

export const HOLDOUT_V2_SET: HoldoutV2Case[] = [
  { id: "HV2-B01-half-year-ordinary", conversation: MAIN, lifeDate: "2025-07-02", anchorSourceId: "wechat-message:canonical:ccd312255966085836bc0986300ede1dac166de2a4fde4ccbfbab6c2cb47324b", cls: "borderline", rationale: "Ordinary pleasant day around his half-year mark; no capability or transition, just warmth (unafraid of strangers, laughing)." },
  { id: "HV2-N01-logistics-backup", conversation: MAIN, lifeDate: "2025-07-09", anchorSourceId: "wechat-message:canonical:98a4b8b1f5f621339b7833340c492101fdf04ce50dbc6f750a5e37b786dade0c", cls: "negative", rationale: "Dominated by furniture delivery, vitamin-D purchase and phone-backup logistics; one passing child mention." },
  { id: "HV2-N02-sleep-prediction", conversation: MAIN, lifeDate: "2025-07-10", anchorSourceId: "wechat-message:canonical:eb7054c139da49e363994dabb4c51cabe4333af25709eade13181374916531fd", cls: "negative", rationale: "A predicted future state (\"not far from sleeping through\"), not an observed transition — planned/not-occurred." },
  { id: "HV2-B02-ai-beautify-joke", conversation: MAIN, lifeDate: "2025-07-11", anchorSourceId: "wechat-message:canonical:b4bdcbd322760d854ba5b8a4d557452d0a92a9be31855a9933118fba5e3f0249", cls: "borderline", rationale: "A distinctive family joke about a video filter; no capability, genuinely charming." },
  { id: "HV2-B03-rectangle-cry-trap", conversation: MAIN, lifeDate: "2025-07-30", anchorSourceId: "wechat-message:canonical:da3a7abc3a28cc4f587a14ee31d0e9effa0a326a94887cb01d938c6b4b7737d5", cls: "borderline", rationale: "Contains the literal words \"第一次\" but describes the SHAPE of a crying face, not a developmental transition — a deliberate trap for keyword-only novelty detection." },
  { id: "HV2-B04-growing-up-reflection", conversation: MAIN, lifeDate: "2025-07-31", anchorSourceId: "wechat-message:canonical:f4950792644b85693180310721da0f12d7808eb91bc47e35afa821c7477bf8eb", cls: "borderline", rationale: "Nostalgic family reflection on him outgrowing his baby look, plus a solids-feeding plan; relationship-significant, no capability gained that day." },
  { id: "HV2-P01-grasp-finger-foods", conversation: MAIN, lifeDate: "2025-08-08", anchorSourceId: "wechat-message:canonical:90389ac73728f409d98bb3bbbb154040f7d094213e2c206ae6a847f1cb2cd60d", cls: "positive", rationale: "Explicit, unhedged fine-motor capability claim (grasping) with a real consequence (finger foods introduced)." },
  { id: "HV2-P02-wave-response", conversation: MAIN, lifeDate: "2025-08-13", anchorSourceId: "wechat-message:canonical:63f69f04ce8074ee11eda25f25d65ee2ae74edaa27760f04666f40e59ee0c66c", cls: "positive", rationale: "Unhedged report of a responsive imitative gesture (raises hand when told to wave) — real social/communicative capability." },
  { id: "HV2-N03-misattributed-standing", conversation: MAIN, lifeDate: "2025-08-17", anchorSourceId: "wechat-message:canonical:d135d475f412c5548bbd4d169f459c12fb8252eeed5719d4d71a9c8f7c33756c", cls: "negative", rationale: "The standing question is about a family friend's baby daughter (40+ days older), not 张年 — a subject-misattribution trap." },
  { id: "HV2-B05-standing-reaffirmed", conversation: MAIN, lifeDate: "2025-08-20", anchorSourceId: "wechat-message:canonical:d0a0a9bdb58839d54998e413bc111bfe3a14431789f24477506800eecde3c477", cls: "borderline", rationale: "Confirms an already-established standing ability with a raised crib rail — reaffirmation, not a new transition." },
  { id: "HV2-B06-solids-video-warmth", conversation: MAIN, lifeDate: "2025-09-05", anchorSourceId: "wechat-message:canonical:eb51b162a731d92bcd12e4fccc4f079d1c2016774c06427676353cd99325cef8", cls: "borderline", rationale: "A warm reaction to a home video of him eating; ordinary-but-pleasant, no capability change." },
  { id: "HV2-N04-routine-logistics", conversation: MAIN, lifeDate: "2025-09-08", anchorSourceId: "wechat-message:canonical:362a866d678f11610354def4224f5aea7f6780474c0f35ce727c3861e926ad99", cls: "negative", rationale: "Dense day of meal planning, a peach delivery and nanny scheduling; no distinctive child content." },
  { id: "HV2-P03-hand-control", conversation: MAIN, lifeDate: "2025-05-26", anchorSourceId: "wechat-message:canonical:f4d91d909f22b8d4934931987036e9262ecc052c3aba7b56596ba7d0a767a897", cls: "positive", rationale: "Unhedged claim of new hand-control dexterity with a concrete daily-life effect — real fine-motor development, May (earliest month in the set)." },
  { id: "HV2-N05-sparse-forwarded-link", conversation: MAIN, lifeDate: "2025-06-18", anchorSourceId: "wechat-message:canonical:4f82e415219863442eddb4fa3ec64a94af7ff1c97162cd1eba263551cde36a72", cls: "negative", rationale: "Nine messages: a lunch request and a forwarded parenting-app link — no observed content about the child at all." },
  { id: "HV2-N06-sparse-customer-service", conversation: MAIN, lifeDate: "2025-09-13", anchorSourceId: "wechat-message:canonical:fce94141219130054d7bfb0f2e6b56903bff68fcae7e8bfe2f09728f43b83a85", cls: "negative", rationale: "Sparse day dominated by an Amazon refund dispute; child mentions are bare logistics queries." },
  { id: "HV2-P04-calls-mama", conversation: MAIN, lifeDate: "2025-10-22", anchorSourceId: "wechat-message:canonical:28cefc1799db11d90566352859ef8f08c2bcb788b72b6a2c0f07074c098c01de", cls: "positive", rationale: "Explicit, unhedged announcement of a new speech capability (calling 妈妈) — found by quartile sampling, not keyword search." },
  { id: "HV2-N07-near-empty-logistics", conversation: MAIN, lifeDate: "2025-11-08", anchorSourceId: "wechat-message:canonical:5429fe6bb7529794df9d1d2868f8c2e978ae21bbe2a00ac57c3b87828235f597", cls: "negative", rationale: "Seven messages total: an address, a pickup, a food question — essentially empty of child content." },
  { id: "HV2-P05-first-day-away-daycare", conversation: FEB, lifeDate: "2026-02-23", anchorSourceId: "wechat-message:canonical:fc6885ee519ff77ea7af66c0ea61ef7ab6d3a49125dbf3fdbc30f3c81a0ca64d", cls: "positive", rationale: "A different conversation (teacher/parent group): explicit \"first time away from family\" plus an unhedged \"he can walk now\" statement from the teacher." },
  { id: "HV2-B07-not-yet-self-settle", conversation: FEB, lifeDate: "2026-02-24", anchorSourceId: "wechat-message:canonical:6c43c34f777bc1fcb756c0641f252ce93ff9ad1521b3624479b64f5a261ebadc", cls: "borderline", rationale: "Explicit NOT-yet capability negation from his teacher in a new setting, plus a same-day other-child mention and exporter system-noise lines." },
];
