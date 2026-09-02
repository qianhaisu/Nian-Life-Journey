// Frozen calibration sets for Memory Editor evaluation.
//
// TWO SETS, DELIBERATELY SEPARATED:
//
//   DEVELOPMENT_SET — may inform prompt design and may appear as few-shot anchors.
//   HOLDOUT_SET     — must NEVER appear in a prompt, a few-shot example, or a tuning decision.
//                     It exists to answer one question: does a rubric written against the
//                     development set generalise to windows it has never seen?
//
// Both are frozen. Changing a label, adding a case, or moving a case between sets destroys the
// regression value of every earlier run, so treat them as append-only fixtures with a new set name
// rather than editing these in place.
//
// The sets are temporally disjoint: the development set lives in 2025-05..2025-08, the holdout in
// 2025-08-31..2026-02. That means the holdout also tests a later developmental stage (standing and
// crawling give way to self-feeding, gestures and walking), which is a harder and more honest
// generalisation test than a random split of the same weeks.
//
// Labels are judgements about the EVIDENCE, not about what is currently published. Three of the
// development cases are live memories today; two of them are labelled borderline here because that
// is where their evidence sits.

export type CalibrationClass = "positive" | "borderline" | "negative";

export type CalibrationCase = {
  id: string;
  /** Either an existing LifeEvent whose sources define the window, or a raw activity day. */
  eventId?: string;
  day?: string;
  /** Optional text anchor: build the window around the message containing this phrase. */
  anchor?: string;
  cls: CalibrationClass;
  /** Why this label, in terms of the evidence alone. */
  rationale: string;
};

// positive   — the evidence itself shows a developmental transition or a genuinely distinctive moment.
// borderline — ordinary-but-pleasant, a recurrence, or an explicit "not yet". Valid to keep as a
//              trace; must NOT be forced into either "important memory" or "noise".
// negative   — adult logistics, or conversational density with no moment behind it.
export const DEVELOPMENT_SET: CalibrationCase[] = [
  { id: "D-P1-crawls-unaided", eventId: "event-0226c115-1006-41dc-8d34-2f4ec991a619", cls: "positive", rationale: "「放在床上他就自己会爬」— independent crawling stated outright." },
  { id: "D-P2-wants-to-stand", eventId: "event-dc7193ad-8217-46c4-8ace-b2cc7602add8", cls: "positive", rationale: "「各种扶墙站，手一撑，然后就起来了」+「不满足于坐了」— pulling to stand, with the prior baseline named." },

  // Re-labelled after the v3 run and Teddy's review: the evidence proves a good night, not a
  // transition. There is no novelty marker in the window and no usable sleep baseline in the
  // archive, so trace/borderline is the honest class — it is not a recall failure to leave it here.
  { id: "D-B0-slept-through", eventId: "event-a9623b23-786c-43c7-9922-032ec95542c5", cls: "borderline", rationale: "「一觉睡到了5点，没有醒一下」proves a good night; nothing in evidence establishes it as new." },
  { id: "D-B1-tomato-noodles", eventId: "event-7f060955-2ac9-42e4-982a-a9cee5cab62b", cls: "borderline", rationale: "Charming and rich, but the content is a messy meal plus plans the family only discussed. Ordinary-but-pleasant." },
  { id: "D-B2-sleep-cues", eventId: "event-d7acbf51-315e-44d0-8b97-194cd15af258", cls: "borderline", rationale: "Observational chat about reading his sleep signals; no capability changes hands." },
  { id: "D-B3-june24-batch", eventId: "event-5f122471-250f-4184-aad6-151215a3c1ee", cls: "borderline", rationale: "Large mixed day, some child content among household talk." },
  { id: "D-B4-may18-batch", eventId: "event-8d516420-55c5-4ec0-bcef-202b296a71da", cls: "borderline", rationale: "Conversation opening; mixed child and logistics." },
  { id: "D-B5-may21-batch", eventId: "event-147e12e1-44f8-4611-aa30-226e6a6bc6ff", cls: "borderline", rationale: "Small early batch with media." },
  { id: "D-B6-jul20-batch", eventId: "event-77f5a5f9-a0be-449b-a97d-efb26d73f0f4", cls: "borderline", rationale: "Dense day mixing child observation with adult errands." },
  { id: "D-B7-jul31-batch", eventId: "event-972c4c45-ff55-4541-a125-ca4f4c686384", cls: "borderline", rationale: "Dense day, thin child signal." },
  { id: "D-B8-jul25-outing", eventId: "event-5a4e98a8-31b0-4b46-970e-d5dd83c730e1", cls: "borderline", rationale: "Pleasant outing after solids; no transition." },

  { id: "D-N1-adult-logistics", eventId: "event-04b6503e-2f25-431f-9cb0-78b1672021e0", cls: "negative", rationale: "Adult telling the family when he will be home." },
  { id: "D-N2-weather-warning", eventId: "event-b1c7cee8-428c-4d04-9a33-40d2f629f16f", cls: "negative", rationale: "Storm warning, close the windows." },
  { id: "D-N3-wifi-reset", eventId: "event-8c38c528-0a27-432b-afe8-f4bb8e2952d9", cls: "negative", rationale: "Household maintenance notice." },
  { id: "D-N4-delivery-window", eventId: "event-5d47165d-8c78-4b6a-af43-33e0199c9653", cls: "negative", rationale: "Glazier arrival time." },
  { id: "D-N5-family-context-only", eventId: "event-da3e8f50-2e47-4ff5-86a8-bb53053eee98", cls: "negative", rationale: "Family context with no claim about the child." },
  { id: "D-N6-location-share", eventId: "event-c84a6165-d802-470e-95a5-aa7e69619342", cls: "negative", rationale: "A bare location share." },
  { id: "D-N7-dense-chat-0827", day: "2025-08-27", cls: "negative", rationale: "226-message day. The density trap: many extractable facts, no moment." },
  { id: "D-N8-dense-chat-0812", day: "2025-08-12", cls: "negative", rationale: "186-message day, same trap." },
];

// NEVER used for prompt design or few-shot examples.
export const HOLDOUT_SET: CalibrationCase[] = [
  { id: "H-P1-self-feeding", day: "2025-08-31", anchor: "会自己吃了", cls: "positive", rationale: "「会自己吃了」— new independent capability, explicit in the window." },
  { id: "H-P2-learned-welcome", day: "2025-10-03", anchor: "已经学会欢迎欢迎", cls: "positive", rationale: "「已经学会欢迎欢迎」, contrasted in the same day with「还没学会拜拜」— a learned gesture with its own baseline." },
  { id: "H-P3-finds-pillow", day: "2025-10-10", anchor: "他现在会找枕头睡", cls: "positive", rationale: "「他现在会找枕头睡」—「现在会」marks the change explicitly." },
  { id: "H-P4-walking", day: "2026-02-22", anchor: "会走路了", cls: "positive", rationale: "「小年宝贝会走路了」— walking, plus his first day away from family." },

  { id: "H-B1-teething-again", day: "2025-09-22", anchor: "他又要长牙了", cls: "borderline", rationale: "「又」marks recurrence, not novelty. Must not be read as a first." },
  { id: "H-B2-not-yet-mama", day: "2025-11-12", anchor: "但还不会叫妈", cls: "borderline", rationale: "An explicit NOT-yet. The trap: a capability is named but denied." },
  { id: "H-B3-ordinary-pleasant-0916", day: "2025-09-16", cls: "borderline", rationale: "Ordinary pleasant day of family chat around the child." },
  { id: "H-B4-ordinary-pleasant-1013", day: "2025-10-13", cls: "borderline", rationale: "Ordinary pleasant day, moderate volume." },

  { id: "H-N1-neighbour-logistics", day: "2025-09-21", anchor: "邻居", cls: "negative", rationale: "Adult talk about neighbours and noise." },
  { id: "H-N2-dense-chat-1001", day: "2025-10-01", cls: "negative", rationale: "124-message day; density without a moment." },
  { id: "H-N3-dense-chat-1019", day: "2025-10-19", cls: "negative", rationale: "121-message day." },
  { id: "H-N4-dense-chat-1030", day: "2025-10-30", cls: "negative", rationale: "124-message day." },
  { id: "H-N5-dense-chat-1103", day: "2025-11-03", cls: "negative", rationale: "101-message day." },
];
