// Narrative Validator v2 — the deterministic gate between the Writer and 张年's archive.
//
// Writer v1 already understood the important half of this: a quote must be verbatim, a milestone
// must be in the evidence, a cliché is a tell. What it could not check is the half that only exists
// once claims are grounded — whether the sentence the Writer wrote is supported by a claim that was
// itself verified, and whether the Writer stayed inside the material it was given.
//
// Two invariants govern everything below:
//
//   used evidence  ⊆  VerifiedMemoryEvidencePackage
//   every factual narrative claim  →  evidence support
//
// Fluent invention is the failure a reader is least able to catch, so an unverifiable sentence is
// rejected rather than softened. Fail closed: a story that cannot be checked is not published.
import { containsTechnicalPlaceholder } from "./quality-review";
import { extractQuotes } from "./family-writer";
import { isInnerStateText, mayIllustrateStory, quoteIsAssertable, type VerifiedMemoryEvidencePackage, type WriterV2Output } from "./writer-v2";

export const NARRATIVE_VALIDATOR_VERSION = "narrative-validator-v2.3";

// Family labels that may carry an attribution. Anyone else in a story is `unsupported_person`.
const FAMILY_LABELS = ["爸爸", "妈妈", "雪姨", "奶奶", "爷爷", "外婆", "外公", "姥姥", "姥爷"];

// 「妈妈觉得他可能饿了」: label + a verb of saying / seeing / judging. This is the only shape in
// which an inner state may reach the page (Decision 3, 2026-09-03).
const ATTRIBUTION_VERB = "(说|觉得|看|猜|感觉|发现|以为|认为|讲|估计|判断|问|提到|回|拍|听|想着|看来)";
const ATTRIBUTED = new RegExp(`(${FAMILY_LABELS.join("|")})[^。！？；]{0,6}${ATTRIBUTION_VERB}`);
// 「妈妈跟雪姨聊起……说」 names 雪姨 as the person spoken to, not the speaker, so a label right after
// an addressee marker is not an attribution.
const LABEL_WITH_VERB = new RegExp(`(?<![跟和对给向让同])(${FAMILY_LABELS.join("|")})[^。！？；「」]{0,6}${ATTRIBUTION_VERB}`, "g");

// The family's 「你」 has no referent the evidence can verify: 「他太爱你了」 said by 妈妈 is not
// 「他太爱妈妈了」 — she was talking to somebody. A feeling aimed at a named person may only be
// written when that person's name is in the line itself.
const FEELING_TOWARD_LABEL = new RegExp(`(爱|想|喜欢|黏|粘|找|要|抱|亲|认|离不开|依赖)(${FAMILY_LABELS.join("|")})`, "g");
const LABEL_SURFACE: Record<string, string[]> = { 妈妈: ["妈"], 爸爸: ["爸"], 雪姨: ["雪姨", "阿姨"] };

// 「妈妈看着张小年，说他腿粗」 when 妈妈 was looking at a photo. A stage direction is an observable
// action the Writer added for rhythm; it is stated as fact and nothing in the evidence shows it.
// Each verb is supported only by evidence containing the same act (哈哈 counts as laughing).
const STAGE_DIRECTION = /(看着|望着|盯着|抱着|搂着|牵着|摸着|拉着|跟着|笑着|笑称)/g;
const STAGE_SUPPORT: Record<string, RegExp> = {
  看着: /看/, 望着: /看|望/, 盯着: /看|盯/, 抱着: /抱/, 搂着: /搂|抱/, 牵着: /牵/, 摸着: /摸/, 拉着: /拉/, 跟着: /跟|一起/,
  笑着: /笑|哈哈|😂|🤣/, 笑称: /笑|哈哈|😂|🤣/,
};

// Before/after framing. Deliberately does not match a bare 从 (从早上 / 从沙发上), only 从…到….
const CONTRAST_LANGUAGE = /从[^。，]{1,12}到[^。，]{1,12}|(以前|之前|上个月|前几天|前些天|那时候|原来|过去|上次|早先)[^。]{0,20}(现在|如今|这天|这次|已经|变)|比(以前|之前|上次|上个月)/;

const splitSentences = (text: string) => text.split(/[。！？；\n]/).map((s) => s.trim()).filter(Boolean);
const stripQuotes = (text: string) => text.replace(/「[^」]*」/g, "「」");

export type NarrativeIssue = { code: string; detail?: string };
export type NarrativeValidationResult = { ok: boolean; issues: NarrativeIssue[] };

// Milestone / achievement language. Kept identical in spirit to Writer v1's list, because inventing
// a milestone is still the single most damaging thing this stage can produce.
const MILESTONE_CLAIM = /第一次|首次|终于|学会了|第一回|头一次|开始会|已经会/;

// Achievement framing that a not-yet or negated claim must never be turned into.
const ACHIEVED_FRAMING = /会了|学会|做到了|成功|已经能|已经会/;

// A plan or a hypothetical has to be visibly framed as one, or the reader cannot tell a thing the
// family discussed from a thing the child did.
const HYPOTHETICAL_FRAMING = /商量|讨论|计划|打算|想象|设想|准备|琢磨|说好|决定|聊到|提到/;

const CLICHES = [
  "这一天值得被记住", "在爱的陪伴下", "悄悄长大", "珍贵的成长瞬间", "幸福定格", "美好时光",
  "见证成长", "时光荏苒", "爱的印记", "温暖的港湾", "一段记忆", "生活痕迹",
  "见证了", "留下了美好", "满满的爱", "治愈了", "小小的身体里", "成长的印记",
];

// The prompt bans "家人" as a speaker (identity.ts's whole point: an unmapped speaker is
// UNKNOWN_SPEAKER_LABEL, never flattened into a generic family collective). Found 2026-09-05
// auditing P1-0 output: the writer routes around the literal ban with "家里人" — same anonymous
// collective, different two characters. A same-day fix that only blacklisted those two extra
// characters missed the actual shape of the problem (Cowork's catch): "有人问起..." and "家里有人
// 说..." are the identical failure — an attribution that cannot resolve to a specific person in
// family-registry — wearing yet another synonym. The real rule per identity.ts is "a speaker either
// resolves to a concrete identity or the sentence isn't written"; this pattern class is the pragmatic
// stand-in for that (a full parse-every-attribution-clause-and-resolve-against-the-registry checker
// would be the complete version, not built here) — verb-gated on 有人/大家 so it doesn't fire on an
// unrelated "有人" that isn't introducing a quote or judgment.
const GENERIC_FAMILY_COLLECTIVE = /家人|家里人|一家人|长辈|亲戚|家属|家庭成员|有人(说|问|讲|提到|回|答|猜|觉得)|大家(说|问|讲|提到|都说|都觉得)/;

// The pipeline's own reasoning must never reach the family. Found in the first Writer v2 shadow:
// asked to be careful about an unresolved subject, the model wrote the CAUTION into the story —
// 「家里聊起他已经学会欢迎欢迎，但这句话说的是谁，没法确认。」 A reader of 张年's archive should
// never learn that a subject resolver exists, let alone that one was uncertain. The right response
// to unverifiable material is to leave it out, not to narrate the doubt.
const PIPELINE_LANGUAGE = /没法确认|无法确认|不能确认|无法核实|未能确认|证据(不足|不支持|显示|表明)|无法归属|主语|指代不明|系统|模型|置信度|claim|sourceId|evidenceRef/i;

// Emotional and causal assertions the evidence almost never supports.
const EMOTION_INFERENCE = /一定很(开心|高兴|难过|激动)|肯定很|特别感动|满心欢喜|由衷地|心里一定/;
const CAUSAL_INFERENCE = /因为.{0,12}所以|正是因为|这说明|这意味着|标志着|说明他已经/;

const countHan = (text: string) => (text.match(/[一-鿿]/g) ?? []).length;

export type NarrativeValidationInput = {
  pkg: VerifiedMemoryEvidencePackage;
  output: WriterV2Output;
  /** Story length ceiling. There is deliberately no floor: few facts may honestly mean a short page. */
  storyMax?: number;
};

export function validateNarrative({ pkg, output, storyMax = 180 }: NarrativeValidationInput): NarrativeValidationResult {
  const issues: NarrativeIssue[] = [];
  const add = (code: string, detail?: string) => issues.push({ code, detail });

  if (output.contractVersion !== "writer-v2-output-contract-v1") add("wrong_contract_version", output.contractVersion);

  // Declining to write is always a valid, complete answer.
  if (output.insufficient) {
    if (output.title || output.story) add("insufficient_but_wrote_anyway");
    return { ok: issues.length === 0, issues };
  }

  if (!output.title?.trim()) add("missing_title");
  if (!output.story?.trim()) add("missing_story");
  const title = output.title ?? "";
  const story = output.story ?? "";

  // ---------------------------------------------------------------- subset invariant

  const claimIds = new Set(pkg.claims.map((c) => c.claimId));
  const quoteIds = new Set(pkg.quotes.map((q) => q.quoteId));
  const mediaIds = new Set(pkg.media.map((m) => m.mediaId));
  const sourceIds = new Set([
    ...pkg.claims.flatMap((c) => c.sourceIds),
    ...pkg.quotes.map((q) => q.sourceId),
    ...pkg.longitudinal.flatMap((l) => l.sourceIds),
  ]);

  for (const id of output.usedClaimIds ?? []) if (!claimIds.has(id)) add("used_claim_not_in_package", id);
  for (const id of output.usedQuoteIds ?? []) if (!quoteIds.has(id)) add("used_quote_not_in_package", id);
  for (const id of output.usedMediaIds ?? []) if (!mediaIds.has(id)) add("used_media_not_in_package", id);

  // ---------------------------------------------------------------- per-claim support

  const claimById = new Map(pkg.claims.map((c) => [c.claimId, c]));
  const knownLabels = new Set(pkg.identity.people.map((p) => p.narrativeLabel).filter(Boolean));

  // Flash (unlike pro) sometimes omits an array field entirely rather than sending `[]` — the type
  // says required, the wire payload doesn't always agree. Normalize once here rather than scattering
  // `?? []` at every call site (found the hard way: an unguarded access crashed a whole P1-0 run).
  const narrativeClaims = output.narrativeClaims ?? [];
  if (narrativeClaims.length === 0) add("no_narrative_claims");

  const quoteById = new Map(pkg.quotes.map((q) => [q.quoteId, q]));

  // A quote is usable only when the line it comes from is itself assertable material. Otherwise a
  // Writer could launder an unresolved-subject or hypothetical line into the page verbatim — the
  // validator would find the characters in the evidence and wave it through. So the haystack is
  // the assertable spans, plus package quotes whose source line an assertable claim rests on.
  const assertableSpanText = pkg.claims.filter((c) => c.assertable).flatMap((c) => c.spans.map((s) => s.text));
  const quotableText = [...assertableSpanText, ...pkg.quotes.filter((q) => quoteIsAssertable(pkg, q)).map((q) => q.text)].join("\n");
  for (const id of output.usedQuoteIds) {
    const q = quoteById.get(id);
    if (q && !quoteIsAssertable(pkg, q)) add("quote_from_unassertable_material", id);
  }

  for (const nc of narrativeClaims) {
    if (!nc.text?.trim()) { add("empty_narrative_claim"); continue; }
    if ((nc.supportedByClaimIds?.length ?? 0) === 0 && (nc.supportedByQuoteIds?.length ?? 0) === 0) {
      add("unsupported_narrative_claim", nc.text.slice(0, 40));
      continue;
    }
    const citedSpeakerLabels = new Set<string>();
    for (const id of nc.supportedByClaimIds ?? []) {
      const claim = claimById.get(id);
      if (!claim) { add("narrative_claim_cites_unknown_claim", id); continue; }
      // The core rule. A question, a plan, a hypothetical or an unresolved subject may inform the
      // Writer's understanding; it may never be the support for a stated fact.
      if (!claim.assertable) add(`narrative_claim_cites_${claim.assertionStatus}`, `${id}: ${nc.text.slice(0, 30)}`);
      if (!claim.subjectResolved) add("narrative_claim_cites_unresolved_subject", id);
      // Resolved is not the same as resolved-to-张年. A claim grounded on another child, or on an
      // adult, can never support a sentence in his archive.
      if (claim.subjectId && claim.subjectId !== pkg.identity.profileId) add("narrative_claim_cites_other_subject", `${id}: ${claim.subjectId}`);
      for (const s of claim.speakers) if (s.narrativeLabel) citedSpeakerLabels.add(s.narrativeLabel);
    }
    for (const id of nc.supportedBySourceIds ?? []) if (!sourceIds.has(id)) add("narrative_claim_cites_unknown_source", id);
    for (const id of nc.supportedByQuoteIds ?? []) {
      const q = quoteById.get(id);
      if (!q) { add("narrative_claim_cites_unknown_quote", id); continue; }
      if (q.speaker.narrativeLabel) citedSpeakerLabels.add(q.speaker.narrativeLabel);
    }

    // 「妈妈说……」 must be supported by material 妈妈 actually said. A sentence that attributes an
    // observation to a family member none of its cited evidence came from is invention with a
    // name on it — the more convincing for being specific.
    for (const m of stripQuotes(nc.text).matchAll(LABEL_WITH_VERB)) {
      const label = m[1]!;
      if (knownLabels.has(label) && !citedSpeakerLabels.has(label)) add("misattributed_speaker", `${label}: ${nc.text.slice(0, 30)}`);
    }

    // 「他太爱你了」 → 「他太爱妈妈了」. The cited line addresses somebody as 你; the page may name
    // that somebody only if the line itself does.
    const citedLines = [
      ...(nc.supportedByClaimIds ?? []).flatMap((id) => claimById.get(id)?.spans.map((s) => s.text) ?? []),
      ...(nc.supportedByQuoteIds ?? []).map((id) => quoteById.get(id)?.text ?? ""),
    ];
    if (citedLines.some((line) => /你/.test(line))) {
      for (const m of stripQuotes(nc.text).matchAll(FEELING_TOWARD_LABEL)) {
        const label = m[2]!;
        const surfaces = [label, ...(LABEL_SURFACE[label] ?? [])];
        if (!citedLines.some((line) => surfaces.some((s) => line.includes(s)))) add("second_person_resolved_to_person", `${label}: ${nc.text.slice(0, 30)}`);
      }
    }

    // 「妈妈看着张小年，说……」: the saying is evidenced, the looking is not.
    const citedText = citedLines.join("\n");
    for (const m of stripQuotes(nc.text).matchAll(STAGE_DIRECTION)) {
      const verb = m[1]!;
      if (!STAGE_SUPPORT[verb]!.test(citedText)) add("unsupported_stage_direction", `${verb}: ${nc.text.slice(0, 30)}`);
    }

    // Media may support a sentence only if it is really bound to this event. Same-day is never
    // enough, so a day_level photo cannot make a sentence true.
    for (const id of nc.supportedByMediaIds ?? []) {
      const media = pkg.media.find((m) => m.mediaId === id);
      if (!media) { add("narrative_claim_cites_unknown_media", id); continue; }
      if (!mayIllustrateStory(media.tier)) add("weak_media_used_as_event_evidence", `${id} (${media.tier})`);
    }
  }

  // ---------------------------------------------------------------- quotes

  // Milestone detection below still looks at everything the package holds, so a milestone word the
  // family used anywhere counts as evidence. Quotes are held to the stricter, assertable haystack.
  const evidenceHaystack = [
    ...pkg.claims.flatMap((c) => c.spans.map((s) => s.text)),
    ...pkg.quotes.map((q) => q.text),
  ].join("\n");
  for (const quote of extractQuotes(story)) {
    if (!quotableText.includes(quote)) add("unsupported_quote", quote.slice(0, 20));
  }

  // ---------------------------------------------------------------- people

  // Every narrative label used must belong to a person actually in this package. 雪姨 must not
  // appear in a story she is not part of, and an unknown speaker must not acquire a family role.
  for (const label of FAMILY_LABELS) {
    if ((title.includes(label) || story.includes(label)) && !knownLabels.has(label)) {
      add("unsupported_person", label);
    }
  }

  // ---------------------------------------------------------------- inner state

  // An action may be stated; a feeling, wish or preference is always somebody's reading of the
  // child and must say whose. Quoted text is excluded (the verbatim rule already governs it), and a
  // sentence counts as attributed only when a family label carries a verb of saying or judging.
  for (const sentence of splitSentences(`${title}。${story}`)) {
    const bare = stripQuotes(sentence);
    if (isInnerStateText(bare) && !ATTRIBUTED.test(bare)) add("inner_state_stated_as_fact", sentence.slice(0, 30));
  }

  // ---------------------------------------------------------------- novelty / polarity / mode

  const claimedMilestone = `${title}${story}`.match(MILESTONE_CLAIM)?.[0];
  if (claimedMilestone && !MILESTONE_CLAIM.test(evidenceHaystack)) add("invented_milestone", claimedMilestone);

  // A not-yet or negated claim rendered as an achievement.
  const usedClaims = output.usedClaimIds.map((id) => claimById.get(id)).filter((c): c is NonNullable<typeof c> => Boolean(c));
  const negatedUsed = usedClaims.filter((c) => c.polarity === "negated");
  if (negatedUsed.length > 0 && ACHIEVED_FRAMING.test(story) && !/还(不|没)|尚未/.test(story)) {
    add("negated_state_written_as_achieved", negatedUsed[0]!.text.slice(0, 30));
  }

  // A plan or hypothetical anywhere in the used material must be visibly framed.
  const hypotheticalPresent = pkg.claims.some((c) => c.assertionStatus === "plan_or_hypothetical" || c.assertionStatus === "question");
  const hypotheticalMentioned = narrativeClaims.some((nc) =>
    (nc.supportedByClaimIds ?? []).some((id) => {
      const c = claimById.get(id);
      return c && (c.assertionStatus === "plan_or_hypothetical" || c.assertionStatus === "question");
    }));
  if (hypotheticalPresent && hypotheticalMentioned && !HYPOTHETICAL_FRAMING.test(story)) {
    add("unframed_hypothetical");
  }

  // ---------------------------------------------------------------- longitudinal contrast

  // 「从抬头不稳到快要跑起来」 is only honest when both halves are evidenced: either the package
  // carries verified earlier baseline, or the sentence rests on at least two distinct assertable
  // claims of this day. A contrast built on one fact plus memory of "how he used to be" is invention.
  for (const nc of narrativeClaims) {
    if (!CONTRAST_LANGUAGE.test(stripQuotes(nc.text))) continue;
    const distinctAssertable = new Set((nc.supportedByClaimIds ?? []).filter((id) => claimById.get(id)?.assertable));
    if (pkg.longitudinal.length === 0 && distinctAssertable.size < 2) add("unsupported_longitudinal_contrast", nc.text.slice(0, 30));
  }

  // ---------------------------------------------------------------- time

  // A story must not date itself to a day the package does not cover.
  const dateLike = story.match(/20\d{2}\s*年|(\d{1,2})\s*月\s*(\d{1,2})\s*日/g) ?? [];
  if (dateLike.length > 0) {
    const [, month, day] = pkg.time.lifeDate.split("-");
    const ok = dateLike.every((d) => d.includes(String(Number(month))) || d.includes(String(Number(day))));
    if (!ok) add("unsupported_time_statement", dateLike.join(","));
  }

  // ---------------------------------------------------------------- tone

  if (containsTechnicalPlaceholder(title) || containsTechnicalPlaceholder(story)) add("technical_placeholder");
  for (const cliche of CLICHES) if (title.includes(cliche) || story.includes(cliche)) add("cliche", cliche);
  const collective = `${title}${story}`.match(GENERIC_FAMILY_COLLECTIVE)?.[0];
  if (collective) add("generic_family_collective", collective);
  const emotion = story.match(EMOTION_INFERENCE)?.[0];
  if (emotion) add("unsupported_emotional_inference", emotion);
  const causal = story.match(CAUSAL_INFERENCE)?.[0];
  if (causal) add("unsupported_causal_link", causal);
  const pipeline = `${title}${story}`.match(PIPELINE_LANGUAGE)?.[0];
  if (pipeline) add("pipeline_reasoning_in_prose", pipeline);

  // ---------------------------------------------------------------- shape

  const titleLen = countHan(title);
  if (titleLen > 0 && (titleLen < 6 || titleLen > 18)) add("title_length", String(titleLen));
  const storyLen = countHan(story);
  if (storyLen > storyMax) add("story_too_long", String(storyLen));
  // A title that is the family's own words may reappear as the quote it came from.
  if (story && title && stripQuotes(story).includes(title)) add("title_repeated_in_story");

  return { ok: issues.length === 0, issues };
}
