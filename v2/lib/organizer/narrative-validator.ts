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
import { mayIllustrateStory, type VerifiedMemoryEvidencePackage, type WriterV2Output } from "./writer-v2";

export const NARRATIVE_VALIDATOR_VERSION = "narrative-validator-v2";

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

  for (const id of output.usedClaimIds) if (!claimIds.has(id)) add("used_claim_not_in_package", id);
  for (const id of output.usedQuoteIds) if (!quoteIds.has(id)) add("used_quote_not_in_package", id);
  for (const id of output.usedMediaIds) if (!mediaIds.has(id)) add("used_media_not_in_package", id);

  // ---------------------------------------------------------------- per-claim support

  const claimById = new Map(pkg.claims.map((c) => [c.claimId, c]));

  if (output.narrativeClaims.length === 0) add("no_narrative_claims");

  for (const nc of output.narrativeClaims) {
    if (!nc.text?.trim()) { add("empty_narrative_claim"); continue; }
    if (nc.supportedByClaimIds.length === 0 && (nc.supportedByQuoteIds?.length ?? 0) === 0) {
      add("unsupported_narrative_claim", nc.text.slice(0, 40));
      continue;
    }
    for (const id of nc.supportedByClaimIds) {
      const claim = claimById.get(id);
      if (!claim) { add("narrative_claim_cites_unknown_claim", id); continue; }
      // The core rule. A question, a plan, a hypothetical or an unresolved subject may inform the
      // Writer's understanding; it may never be the support for a stated fact.
      if (!claim.assertable) add(`narrative_claim_cites_${claim.assertionStatus}`, `${id}: ${nc.text.slice(0, 30)}`);
      if (!claim.subjectResolved) add("narrative_claim_cites_unresolved_subject", id);
    }
    for (const id of nc.supportedBySourceIds) if (!sourceIds.has(id)) add("narrative_claim_cites_unknown_source", id);
    for (const id of nc.supportedByQuoteIds ?? []) if (!quoteIds.has(id)) add("narrative_claim_cites_unknown_quote", id);

    // Media may support a sentence only if it is really bound to this event. Same-day is never
    // enough, so a day_level photo cannot make a sentence true.
    for (const id of nc.supportedByMediaIds ?? []) {
      const media = pkg.media.find((m) => m.mediaId === id);
      if (!media) { add("narrative_claim_cites_unknown_media", id); continue; }
      if (!mayIllustrateStory(media.tier)) add("weak_media_used_as_event_evidence", `${id} (${media.tier})`);
    }
  }

  // ---------------------------------------------------------------- quotes

  const evidenceHaystack = [
    ...pkg.claims.flatMap((c) => c.spans.map((s) => s.text)),
    ...pkg.quotes.map((q) => q.text),
  ].join("\n");
  for (const quote of extractQuotes(story)) {
    if (!evidenceHaystack.includes(quote)) add("unsupported_quote", quote.slice(0, 20));
  }

  // ---------------------------------------------------------------- people

  // Every narrative label used must belong to a person actually in this package. 雪姨 must not
  // appear in a story she is not part of, and an unknown speaker must not acquire a family role.
  const knownLabels = new Set(pkg.identity.people.map((p) => p.narrativeLabel).filter(Boolean));
  for (const label of ["爸爸", "妈妈", "雪姨", "奶奶", "爷爷", "外婆", "外公", "姥姥", "姥爷"]) {
    if ((title.includes(label) || story.includes(label)) && !knownLabels.has(label)) {
      add("unsupported_person", label);
    }
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
  const hypotheticalMentioned = output.narrativeClaims.some((nc) =>
    nc.supportedByClaimIds.some((id) => {
      const c = claimById.get(id);
      return c && (c.assertionStatus === "plan_or_hypothetical" || c.assertionStatus === "question");
    }));
  if (hypotheticalPresent && hypotheticalMentioned && !HYPOTHETICAL_FRAMING.test(story)) {
    add("unframed_hypothetical");
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
  if (story && title && story.includes(title)) add("title_repeated_in_story");

  return { ok: issues.length === 0, issues };
}
