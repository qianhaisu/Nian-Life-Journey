// Holdout V3 — frozen, independently constructed real-data test set for a one-time evaluation of
// frozen Organizer V6 (Claim Grounding). PRECISION-FOCUSED.
//
// Construction rules, all of which were followed:
//
//   - Every case is identified by (conversation, lifeDate, anchorSourceId, windowFingerprint).
//     No case is anchored by a date alone. That is not a style preference: every day in Holdout 1
//     was a day wrong for months precisely because its cases carried a date and no source id, and
//     nothing could compare the date to a real row (see calibration-sets.ts).
//   - Everything already spent is excluded: the V1 development set, spent Holdout 1 (BOTH its
//     corrected and its originally-recorded days), spent Holdout V2, and the 30-window V6 shadow
//     corpus, which became spent the moment its results were read.
//   - Candidates were drawn mechanically — a grammar/change-of-state language scan and deterministic
//     per-month quantile sampling (scripts/organizer-holdout-v3-candidates.mjs) — plus an
//     archive-wide scan for capability language over unspent days. No pass looked at what any router
//     would do with a candidate before it was labelled.
//   - Every candidate's real text was read before its frozenLabel was assigned. Labels are
//     judgements about evidence, never inferred from a keyword: HV3-B02 contains 「学会」 and is
//     borderline anyway, because the claim is hedged AND disputed in the window itself.
//
// COMPOSITION AND ITS LIMIT. 2 positives / 6 borderlines / 7 negatives. The target was 3 positives.
// Only two survived the standard, and the bar was NOT lowered to reach three: the archive-wide scan
// found just 6 unspent messages carrying unhedged capability language, because Holdout 1 was itself
// built by scanning for exactly that language and had already claimed the rest. The nearest
// third positive (self-settling to sleep, HV3-B01) is labelled borderline because it is reported as
// a good day rather than as a change — no novelty marker, no baseline contrast.
//
// Consequence, stated up front so no reader has to infer it: **recall confidence from this set is
// very limited.** Two positives can show that the promotion path still fires; they cannot measure
// how often it should have fired and did not. Precision is what this set measures.
export type CalibrationClassV3 = "positive" | "borderline" | "negative";

export type HoldoutV3Case = {
  id: string;
  conversation: string;
  /** Asia/Shanghai calendar day, derived through life-date.ts and cross-checked in preflight. */
  lifeDate: string;
  /** A real source id inside the target window. Preflight asserts it resolves to exactly one. */
  anchorSourceId: string;
  /** sha256(conversation|activityDate|sorted sourceIds)[0..32]. Detects any drift in membership. */
  windowFingerprint: string;
  frozenLabel: CalibrationClassV3;
  rationale: string;
};

const MAIN = "conversation:856b8ec2b8f3ec2871782ca6";

export const HOLDOUT_V3_SET: HoldoutV3Case[] = [
  // ---------------------------------------------------------------- positives
  {
    id: "HV3-P01-stands-unaided",
    conversation: MAIN, lifeDate: "2025-09-10",
    anchorSourceId: "wechat-message:canonical:0b103f8a23291df08e63a805ad6ed291a810d02e4fbb2aed94b0f9ea26851537",
    windowFingerprint: "1223ef34daa8f08a5f4361078fc7d672",
    frozenLabel: "positive",
    rationale: "Unhedged gross-motor capability with an explicit change marker (现在), reported firsthand by the primary daily carer, with video alongside. No question, no plan, no negation.",
  },
  {
    id: "HV3-P02-cruises-along-door",
    conversation: MAIN, lifeDate: "2025-08-22",
    anchorSourceId: "wechat-message:canonical:2f9ae2ed579f0e029bbbbaa26cf7aaad1ada74cd957d75c0c0c80cc608263414",
    windowFingerprint: "931d9df15316107b577726175ff76bed",
    frozenLabel: "positive",
    rationale: "Cruising while holding the glass door, stated plainly by the carer and framed by her as a step forward, with video in the same window. A real gross-motor capability, unhedged.",
  },

  // ---------------------------------------------------------------- borderlines
  {
    id: "HV3-B01-settles-himself-to-sleep",
    conversation: MAIN, lifeDate: "2025-07-01",
    anchorSourceId: "wechat-message:canonical:9cea5339d137a2baaff0000292fc2686d126b388d5ca8d2d26228ff31e695933",
    windowFingerprint: "99a3b0943dc073afdcfee3149fa52e21",
    frozenLabel: "borderline",
    rationale: "Two caregivers independently report that leaving him to play himself led to easy sleep. Genuine independence, but reported as a good day (今天) with no novelty marker and no baseline — a trace, not a transition. This is the case that was NOT promoted to positive to reach a target of three.",
  },
  {
    id: "HV3-B02-hedged-and-disputed-fake-crying",
    conversation: MAIN, lifeDate: "2025-07-14",
    anchorSourceId: "wechat-message:canonical:7d10cbe5ae027a99189103a6e33c09b8399363c974d9702ac86bd33ea5c1a506",
    windowFingerprint: "c3a0a4b14e06a57678cfd34e8cf9b88e",
    frozenLabel: "borderline",
    rationale: "Contains 「学会」 and is still borderline: the claim is hedged (我感觉), marked as recurrence (又), and explicitly questioned by the other caregiver in the same window. A keyword-only novelty detector fails this; H2's hedge rule and the speech-act layer should both hold.",
  },
  {
    id: "HV3-B03-incidental-self-soothing",
    conversation: MAIN, lifeDate: "2025-09-29",
    anchorSourceId: "wechat-message:canonical:8169cbad27ee18b5f2be814851549997cd2718e07878f089bc33411ea7a03125",
    windowFingerprint: "4d5ee915e6bbe0a16a05c10ec070c059",
    frozenLabel: "borderline",
    rationale: "One passing line that he settled himself after failed soothing, inside a window otherwise dominated by an adult disagreement about who watches the child. Real but incidental; must not be inflated into an independence milestone.",
  },
  {
    id: "HV3-B04-ordinary-pleasant-outfit-day",
    conversation: MAIN, lifeDate: "2025-10-17",
    anchorSourceId: "wechat-message:canonical:0943865c99b520dcd5ad7c001dc987926a6240b2535cc3338fd408801384ac1c",
    windowFingerprint: "b61effe90decf3948d9443a5a379dc1c",
    frozenLabel: "borderline",
    rationale: "Warm, ordinary day of clothes talk and videos with an affectionate 「成熟了」. Genuinely pleasant, no capability and no transition — the ordinary-but-charming shape that v4 over-promoted before v5 closed the medium-only door.",
  },
  {
    id: "HV3-B05-pacifier-no-longer-used",
    conversation: MAIN, lifeDate: "2025-08-22",
    anchorSourceId: "wechat-message:canonical:7ccfc358f0a0720760dc93d6a3e4c5df8419f2e2daa310e99f4828d6e08d7489",
    windowFingerprint: "4460e1beb97f44489c734164958dac34",
    frozenLabel: "borderline",
    rationale: "A real change (nobody has used the pacifier for a long time; he no longer sucks it) stated in passing inside adult vaccine worry. Reported as a settled state, not as something that happened that day.",
  },
  {
    id: "HV3-B06-bed-in-bed-experiment",
    conversation: MAIN, lifeDate: "2025-07-01",
    anchorSourceId: "wechat-message:canonical:d695b608c337ca091a4834f8bd50bf7536e7e377442e1bfd4e7a32e43d3dad6b",
    windowFingerprint: "e73635690fd90be533cd28031c5207cd",
    frozenLabel: "borderline",
    rationale: "A carer's homemade sleep-nest experiment that worked that afternoon, mixed with dinner logistics. About a caregiver's action and a hearsay rationale (听说), not about a change in the child.",
  },

  // ---------------------------------------------------------------- negatives
  {
    id: "HV3-N01-aspirational-first-step-question",
    conversation: MAIN, lifeDate: "2025-07-17",
    anchorSourceId: "wechat-message:canonical:ae5da8393797986ba7b04fe25a9feebdfcbde87a292b796c9e082e90a3ffd311",
    windowFingerprint: "763a559fc9484dd6346a5998b364c237",
    frozenLabel: "negative",
    rationale: "The central trap of this set. A parent asks WHEN he will finally take the historic first step instead of marching in place — an aspirational question about something that has NOT happened. It must never become a first-step Memory. Question, future, and negation all at once.",
  },
  {
    id: "HV3-N02-parenting-article-pasted-in",
    conversation: MAIN, lifeDate: "2025-06-28",
    anchorSourceId: "wechat-message:canonical:a45be8359487c6a102721d8720e9ed2f11dedd91496e26f4ea9284102a706926",
    windowFingerprint: "9826ecc739934820beec6c8f2fe34d5e",
    frozenLabel: "negative",
    rationale: "A general AI-assistant article about hand movements in five-to-six-month-olds, pasted into the chat and then dismissed. Third-party reference text about babies in general; nothing here is an observation of 张年, and none of it may become a fact about him.",
  },
  {
    id: "HV3-N03-english-plan-and-imagining",
    conversation: MAIN, lifeDate: "2025-10-16",
    anchorSourceId: "wechat-message:canonical:feda7321fdf58301cf65f73f2a852f977db32c98bfcebddb64dbc2c8a83603d1",
    windowFingerprint: "0f034057c85b1f7925a2fc257cc14810",
    frozenLabel: "negative",
    rationale: "A plan to start English enlightenment plus an explicit imagining of what he will do with the reading pen. Plan and hypothetical only; nothing occurred. Tests plan-factualization directly.",
  },
  {
    id: "HV3-N04-adult-restaurant-logistics",
    conversation: MAIN, lifeDate: "2025-10-29",
    anchorSourceId: "wechat-message:canonical:fe5e2d97bf4992c6811fda5d4c8168532196cfabc365745f5f41f2895d36b811",
    windowFingerprint: "c5019156b2f7fd9d690c82f2c3b077d4",
    frozenLabel: "negative",
    rationale: "An adult reporting queue length and food quality at a restaurant. No child content at all.",
  },
  {
    id: "HV3-N05-dinner-venue-logistics",
    conversation: MAIN, lifeDate: "2025-08-22",
    anchorSourceId: "wechat-message:canonical:ef73648fc277af54bf51735cedfbde575c34c136b24bb3f823637506c581efd8",
    windowFingerprint: "66ac98d6d282b1d49191163a37dcbe2d",
    frozenLabel: "negative",
    rationale: "Choosing where the adults will eat dinner, with a work-video aside. The child is mentioned only as part of household scheduling.",
  },
  {
    id: "HV3-N06-fever-day-health-only",
    conversation: MAIN, lifeDate: "2025-08-28",
    anchorSourceId: "wechat-message:canonical:16fafe7c25e31ab6b633bfb9c5b3ed30e2bd4718c763760394d86761b650f5d6",
    windowFingerprint: "402cbbba88f989aef55da8875e451f3b",
    frozenLabel: "negative",
    rationale: "A day of fever readings and how the family managed a third round of it. Health content must be isolated as observation with no diagnosis and no medical inference, and must never become a Memory. Also carries a caregiver's own technique discovery, which is about the adult, not a capability of the child.",
  },
  {
    id: "HV3-N07-density-without-a-moment",
    conversation: MAIN, lifeDate: "2025-08-22",
    anchorSourceId: "wechat-message:canonical:d7c8d2ba06d8cb64ab76834eb46b524f338a04132ea087121be2bef480103afc",
    windowFingerprint: "cb5d8304e279594b29f54135811f99ba",
    frozenLabel: "negative",
    rationale: "A 40-message day mixing a crib-height adjustment, a joke about his chubbiness, a plan to see a doctor at the weekend and dinner arrangements. The density trap: many extractable facts, no moment.",
  },
];
