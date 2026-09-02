// Frozen calibration sets for Memory Editor evaluation.
//
// TWO SETS, DELIBERATELY SEPARATED:
//
//   DEVELOPMENT_SET — may inform prompt design and may appear as few-shot anchors.
//   HOLDOUT_SET     — must NEVER appear in a prompt, a few-shot example, or a tuning decision.
//
// INPUT IDENTITY IS STABLE, NOT EVENT-DERIVED.
//
// A case used to be defined by a LifeEvent id, and the harness rebuilt its window from that event's
// `source_ids`. That was wrong twice over: the reconstruction produced a single window with no
// neighbours (so the Subject Resolver could never find an antecedent), and when the harness was
// changed to load the whole day instead, five of nineteen cases changed outcome — the fixture had no
// stable window at all.
//
// A case is now (conversation, day, anchorSourceId). Evaluation loads the complete conversation day,
// runs the production Evidence Builder, and selects THE window containing the anchor. If the anchor
// maps to zero or several windows the fixture is invalid and that case stops — the harness may never
// pick whichever window gives the nicer answer.
//
// Anchors were derived mechanically: the earliest source of the former event by (captured_at, id);
// for the two day-based negatives, the day's earliest child-naming message, else its earliest
// message. Neither rule looks at outcomes.
//
// Labels are judgements about the EVIDENCE, not about what is currently published.

export type CalibrationClass = "positive" | "borderline" | "negative";

export type CalibrationCase = {
  id: string;
  /** Stable input identity — never a LifeEvent id. */
  conversation: string;
  day: string;
  /** The single message that pins this case to one window. */
  anchorSourceId: string;
  cls: CalibrationClass;
  /** Why this label, in terms of the evidence alone. */
  rationale: string;
  /** Provenance only: which published artifact this case was originally drawn from. Never used to
   *  build the window. */
  derivedFromEventId?: string;
};

const CONVERSATION = "conversation:856b8ec2b8f3ec2871782ca6";

// positive   — the evidence itself shows a developmental transition or genuinely distinctive moment.
// borderline — ordinary-but-pleasant, a recurrence, or an explicit "not yet". Valid to keep as a
//              trace; must NOT be forced into either "important memory" or "noise".
// negative   — adult logistics, or conversational density with no moment behind it.
export const DEVELOPMENT_SET: CalibrationCase[] = [
  { id: "D-P1-crawls-unaided", conversation: CONVERSATION, day: "2025-07-18", anchorSourceId: "wechat-message:canonical:0bc163cde112afbf46b40c26d890f8b4219c44d987b92fc3c8710b56406ef2eb", cls: "positive", rationale: "「放在床上他就自己会爬」— independent crawling stated outright.", derivedFromEventId: "event-0226c115-1006-41dc-8d34-2f4ec991a619" },
  { id: "D-P2-wants-to-stand", conversation: CONVERSATION, day: "2025-08-11", anchorSourceId: "wechat-message:canonical:e5403bf735eb850a680e1bf9803c2f4eb2151cf3c1602066274049361a9f188f", cls: "positive", rationale: "「各种扶墙站，手一撑，然后就起来了」+「不满足于坐了」— pulling to stand.", derivedFromEventId: "event-dc7193ad-8217-46c4-8ace-b2cc7602add8" },

  // Re-labelled after the v3 run: the evidence proves a good night, not a transition. No novelty
  // marker in the window and no usable sleep baseline — trace/borderline is the honest class.
  { id: "D-B0-slept-through", conversation: CONVERSATION, day: "2025-08-04", anchorSourceId: "wechat-message:canonical:9f3e0f6bb6cb5b6794d040f6f6ab95849a65ccdebc2a0bf0b939c288ff6e9c95", cls: "borderline", rationale: "「一觉睡到了5点，没有醒一下」proves a good night; nothing establishes it as new.", derivedFromEventId: "event-a9623b23-786c-43c7-9922-032ec95542c5" },
  { id: "D-B1-tomato-noodles", conversation: CONVERSATION, day: "2025-08-05", anchorSourceId: "wechat-message:canonical:dc9f040b84a718e013d6c48f0b857e201182be43a9ce010ae6d6142f47a436e7", cls: "borderline", rationale: "Charming and rich, but a messy meal plus plans the family only discussed.", derivedFromEventId: "event-7f060955-2ac9-42e4-982a-a9cee5cab62b" },
  { id: "D-B2-sleep-cues", conversation: CONVERSATION, day: "2025-07-15", anchorSourceId: "wechat-message:canonical:aa553778e692fea352511b842b60a68dac9e638703dfb240e5715e35dfb10b02", cls: "borderline", rationale: "Observational chat about reading his sleep signals; no capability changes hands.", derivedFromEventId: "event-d7acbf51-315e-44d0-8b97-194cd15af258" },
  { id: "D-B3-june24-batch", conversation: CONVERSATION, day: "2025-06-25", anchorSourceId: "wechat-message:canonical:1987c5afb74b4557234b48d51a94dcaa6d23e5453decac7b8fb5ea8010a27a49", cls: "borderline", rationale: "Large mixed day, some child content among household talk.", derivedFromEventId: "event-5f122471-250f-4184-aad6-151215a3c1ee" },
  { id: "D-B4-may18-batch", conversation: CONVERSATION, day: "2025-05-19", anchorSourceId: "wechat-message:canonical:a4edc3af45f3c99c2c600cabd2da481cde7bcbc2840c488e5fb1cd4bdf328289", cls: "borderline", rationale: "Conversation opening; mixed child and logistics.", derivedFromEventId: "event-8d516420-55c5-4ec0-bcef-202b296a71da" },
  { id: "D-B5-may21-batch", conversation: CONVERSATION, day: "2025-05-22", anchorSourceId: "wechat-message:canonical:c88a88624866d84de50e53cc7b3e45f6c316f8690d589b66754bac172d849f82", cls: "borderline", rationale: "Small early batch with media.", derivedFromEventId: "event-147e12e1-44f8-4611-aa30-226e6a6bc6ff" },
  { id: "D-B6-jul20-batch", conversation: CONVERSATION, day: "2025-07-21", anchorSourceId: "wechat-message:canonical:cab5a1a79a2a83840b84abf124aa6180159145b44099b4a8b58133ea5dceb3b8", cls: "borderline", rationale: "Dense day mixing child observation with adult errands.", derivedFromEventId: "event-77f5a5f9-a0be-449b-a97d-efb26d73f0f4" },
  { id: "D-B7-jul31-batch", conversation: CONVERSATION, day: "2025-08-01", anchorSourceId: "wechat-message:canonical:03497552855253d9ee056dfd112df444502c3bfd68d865e4db3824b57e2ec50a", cls: "borderline", rationale: "Dense day, thin child signal.", derivedFromEventId: "event-972c4c45-ff55-4541-a125-ca4f4c686384" },
  { id: "D-B8-jul25-outing", conversation: CONVERSATION, day: "2025-07-25", anchorSourceId: "wechat-message:canonical:6796c2430082bd7a1552b33618d7f99bd2054f820f059001fe2386b5d025a304", cls: "borderline", rationale: "Pleasant outing after solids; no transition.", derivedFromEventId: "event-5a4e98a8-31b0-4b46-970e-d5dd83c730e1" },

  { id: "D-N1-adult-logistics", conversation: CONVERSATION, day: "2025-06-09", anchorSourceId: "wechat-message:canonical:2ca89b052ad2ed75f0c4ac3ab2932816033004b715a54167afe341cfa0ad1066", cls: "negative", rationale: "Adult telling the family when he will be home.", derivedFromEventId: "event-04b6503e-2f25-431f-9cb0-78b1672021e0" },
  { id: "D-N2-weather-warning", conversation: CONVERSATION, day: "2025-06-27", anchorSourceId: "wechat-message:canonical:e3f78cbb63cee1a5e631570fbd84e542e9050d3db6c950da25779b2caab012e5", cls: "negative", rationale: "Storm warning, close the windows.", derivedFromEventId: "event-b1c7cee8-428c-4d04-9a33-40d2f629f16f" },
  { id: "D-N3-wifi-reset", conversation: CONVERSATION, day: "2025-06-29", anchorSourceId: "wechat-message:canonical:19c87385a765b3fbb53216189a657c1ee0f2b80d8b0ade080ba90d4b167e13be", cls: "negative", rationale: "Household maintenance notice.", derivedFromEventId: "event-8c38c528-0a27-432b-afe8-f4bb8e2952d9" },
  { id: "D-N4-delivery-window", conversation: CONVERSATION, day: "2025-06-29", anchorSourceId: "wechat-message:canonical:22324a72a3f7ece372351d6363aeeada6a411aba0f962bc008f07a5fe5f9e86f", cls: "negative", rationale: "Glazier arrival time.", derivedFromEventId: "event-5d47165d-8c78-4b6a-af43-33e0199c9653" },
  { id: "D-N5-family-context-only", conversation: CONVERSATION, day: "2025-07-08", anchorSourceId: "wechat-message:canonical:1414d7f6e59a628419d95912ffd1c097095a151e41c018ffab0260344ffbc63a", cls: "negative", rationale: "Family context with no claim about the child.", derivedFromEventId: "event-da3e8f50-2e47-4ff5-86a8-bb53053eee98" },
  { id: "D-N6-location-share", conversation: CONVERSATION, day: "2025-07-19", anchorSourceId: "wechat-message:canonical:2b7bbabc6e31b6057675ee4beb9297845f0f933494e6b67939644139e0cbc3f1", cls: "negative", rationale: "A bare location share.", derivedFromEventId: "event-c84a6165-d802-470e-95a5-aa7e69619342" },
  { id: "D-N7-dense-chat-0827", conversation: CONVERSATION, day: "2025-08-27", anchorSourceId: "wechat-message:canonical:05862212cf8e42262bf3e533c583f91bb108a06278d8c3321e62c1293a089e6a", cls: "negative", rationale: "226-message day. The density trap: many extractable facts, no moment." },
  { id: "D-N8-dense-chat-0812", conversation: CONVERSATION, day: "2025-08-12", anchorSourceId: "wechat-message:canonical:6ed5484348ee99fb7b2839bcece6e01ae652a9647765286869dba14688b90d3b", cls: "negative", rationale: "186-message day, same trap." },
];

// NEVER used for prompt design, few-shot examples, or tuning. Left exactly as frozen: these cases
// were already day-anchored rather than event-derived, and nothing here has been inspected or run.
export type HoldoutCase = { id: string; day: string; anchor?: string; cls: CalibrationClass; rationale: string };

export const HOLDOUT_SET: HoldoutCase[] = [
  { id: "H-P1-self-feeding", day: "2025-08-31", anchor: "会自己吃了", cls: "positive", rationale: "「会自己吃了」— new independent capability, explicit in the window." },
  { id: "H-P2-learned-welcome", day: "2025-10-03", anchor: "已经学会欢迎欢迎", cls: "positive", rationale: "「已经学会欢迎欢迎」, contrasted with「还没学会拜拜」— a learned gesture with its own baseline." },
  { id: "H-P3-finds-pillow", day: "2025-10-10", anchor: "他现在会找枕头睡", cls: "positive", rationale: "「他现在会找枕头睡」—「现在会」marks the change explicitly." },
  { id: "H-P4-walking", day: "2026-02-22", anchor: "会走路了", cls: "positive", rationale: "「小年宝贝会走路了」— walking, plus his first day away from family." },

  { id: "H-B1-teething-again", day: "2025-09-22", anchor: "他又要长牙了", cls: "borderline", rationale: "「又」marks recurrence, not novelty." },
  { id: "H-B2-not-yet-mama", day: "2025-11-12", anchor: "但还不会叫妈", cls: "borderline", rationale: "An explicit NOT-yet: a capability named but denied." },
  { id: "H-B3-ordinary-pleasant-0916", day: "2025-09-16", cls: "borderline", rationale: "Ordinary pleasant day of family chat around the child." },
  { id: "H-B4-ordinary-pleasant-1013", day: "2025-10-13", cls: "borderline", rationale: "Ordinary pleasant day, moderate volume." },

  { id: "H-N1-neighbour-logistics", day: "2025-09-21", anchor: "邻居", cls: "negative", rationale: "Adult talk about neighbours and noise." },
  { id: "H-N2-dense-chat-1001", day: "2025-10-01", cls: "negative", rationale: "124-message day; density without a moment." },
  { id: "H-N3-dense-chat-1019", day: "2025-10-19", cls: "negative", rationale: "121-message day." },
  { id: "H-N4-dense-chat-1030", day: "2025-10-30", cls: "negative", rationale: "124-message day." },
  { id: "H-N5-dense-chat-1103", day: "2025-11-03", cls: "negative", rationale: "101-message day." },
];
