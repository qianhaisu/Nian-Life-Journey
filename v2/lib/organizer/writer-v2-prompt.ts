// Writer v2 prompt.
//
// DRAFT, editorially uncalibrated. Fable 5.1 owns the final voice — see
// docs/writer-v2-fable-handoff-2026-09-03.md §7 for the questions this prompt does not answer. What
// IS settled here, and must survive any rewrite, is the contract: the Writer states only what the
// package marks assertable, cites what it used, and may decline.
//
// The prompt deliberately does not restate every rule the Narrative Validator enforces. A prompt
// that lists forty prohibitions produces a model that recites them; the validator is the thing that
// actually holds, and it fails closed. The prompt's job is to explain the WORK.
import type { NarrativePerson, VerifiedMemoryEvidencePackage } from "./writer-v2";

export const WRITER_V2_PROMPT_VERSION = "family-writer-v2-draft";

export const WRITER_V2_SYSTEM_PROMPT = `你在为一个孩子写他人生档案里的一页。读者是长大以后的他，和他的家人。

不是聊天摘要，不是育儿记录，是一本家庭出版物里的一页。

## 你收到的东西

「可以陈述的事实」：已经过逐条核实——说话的人是谁、当时到底说了什么、说的是不是这个孩子——都确认过了。**只有这些可以被你写成发生过的事。**

「仅供理解的背景」：可能是一个问题、一个计划、一个想象，或者主语无法确认的话。它们帮你读懂那一天，但**绝不能被写成发生过的事**。如果你要提到它们，必须写清楚那只是家里在聊、在打算、在猜。

「原话」：要引用就必须一字不差，用「」括起来。

「照片」：只标了它和这件事的绑定强度，**没有任何人看过照片内容**。你不知道照片上是什么，不要写。

## 怎么写

**具体胜过宏大。** 一个真实的小动作，比任何"这标志着成长"都值得留下。

**家人是有名字的。** 雪姨说的话就写雪姨，妈妈发现的就写妈妈。但不要每句都点名，读起来会像记录稿。不确定是谁说的，就不要安一个人上去。

**保留当时的不确定。** 证据说"他自己会爬"，但没有任何证据说这是"第一次"，那就写"已经能自己爬"，不要写"第一次学会爬"。这不是谨慎，这是准确。

**不够就少写。** 事实少，就写短。没有字数下限。宁可是两句真的，也不要凑出一段像样的。真的不够写，就把 insufficient 设为 true，什么都不写——这是一个完整的答案，不是失败。

**不确定就不写，不要写出你的犹豫。** 有些材料无法确认说的是谁，或者只是家里在猜。这种就直接不写，**绝不能**在正文里交代"这句话说的是谁没法确认""证据不足"这类话——读这本档案的是他的家人，不是系统的审阅者。

**正文不要重复标题那句话。** 标题概括，正文展开，两者不要是同一句。

**不要替他感动。** 没有证据的"他一定很开心""一家人都很感动""这标志着他长大了"，一句都不要。温度来自事实本身。

## 输出

调用 emit_memory，给出：
- title：6–18 个汉字，具体，一眼能看出这天发生了什么。
- story：不超过 180 个汉字。没有下限。
- narrativeClaims：把 story 里每一句陈述事实的话拆出来，各自标明它依据哪条 claimId 和 sourceId。
- usedClaimIds / usedQuoteIds / usedMediaIds：你实际用到的。

后台要能回答"这句话凭什么写"。前台不会显示这些编号。`;

export const WRITER_V2_TOOL_NAME = "emit_memory";

export const WRITER_V2_TOOL_SCHEMA = {
  type: "object",
  properties: {
    insufficient: { type: "boolean", description: "可陈述的事实不足以写出一页时为 true" },
    title: { type: "string", description: "6-18 个汉字的具体标题" },
    story: { type: "string", description: "不超过 180 个汉字，无下限" },
    narrativeClaims: {
      type: "array",
      description: "story 中每一句陈述事实的话及其依据",
      items: {
        type: "object",
        properties: {
          text: { type: "string" },
          supportedByClaimIds: { type: "array", items: { type: "string" } },
          supportedBySourceIds: { type: "array", items: { type: "string" } },
          supportedByQuoteIds: { type: "array", items: { type: "string" } },
          supportedByMediaIds: { type: "array", items: { type: "string" } },
        },
        required: ["text", "supportedByClaimIds", "supportedBySourceIds"],
      },
    },
    usedClaimIds: { type: "array", items: { type: "string" } },
    usedQuoteIds: { type: "array", items: { type: "string" } },
    usedMediaIds: { type: "array", items: { type: "string" } },
    editorialNotes: { type: "string", description: "给后台审阅者的说明，家人看不到" },
  },
  required: ["insufficient", "narrativeClaims", "usedClaimIds", "usedQuoteIds", "usedMediaIds"],
} as const;

/**
 * Renders the package for the model. Assertable and non-assertable claims are put in SEPARATE
 * sections rather than flagged inline, because a flag in a list is something a model can skim past
 * and a heading is not.
 */
export function buildWriterV2Prompt(pkg: VerifiedMemoryEvidencePackage): string {
  const label = (p: NarrativePerson) => p.narrativeLabel ?? (p.known ? p.relationshipToSubject ?? "家人" : "不确定是谁");

  const assertable = pkg.claims.filter((c) => c.assertable);
  const background = pkg.claims.filter((c) => !c.assertable);

  const factLines = assertable.length
    ? assertable.map((c) => {
        const who = c.speakers.map(label).join("、") || "不确定是谁";
        const mode = c.observationMode === "observed_firsthand" ? "亲眼看到" : "转述";
        const neg = c.polarity === "negated" ? "（这是一个「还没有 / 不」的状态，不是已经做到）" : "";
        return `  - [${c.claimId}] ${c.text}${neg}\n      说的人：${who}（${mode}）  依据：${c.sourceIds.join(", ")}`;
      }).join("\n")
    : "  （没有可以陈述的事实）";

  const backgroundLines = background.length
    ? background.map((c) => {
        const why = c.assertionStatus === "question" ? "这是一个问句，没有人断言它发生了"
          : c.assertionStatus === "plan_or_hypothetical" ? "这是计划或设想，没有发生"
          : !c.subjectResolved ? "这句话说的是谁无法确认"
          : "证据不支持把它当作事实";
        return `  - [${c.claimId}] ${c.text}\n      ${why}`;
      }).join("\n")
    : "  （无）";

  const quoteLines = pkg.quotes.length
    ? pkg.quotes.map((q) => `  - [${q.quoteId}] ${label(q.speaker)}：「${q.text}」`).join("\n")
    : "  （无）";

  const contextLines = pkg.longitudinal.length
    ? pkg.longitudinal.map((l) => `  - ${l.lifeDate} ${l.text}`).join("\n")
    : "  （无）";

  const storyMedia = pkg.media.filter((m) => m.tier === "confirmed" || m.tier === "strong_contextual");
  const mediaLines = pkg.media.length
    ? [
        storyMedia.length
          ? `  可以当作这件事的照片：${storyMedia.map((m) => `[${m.mediaId}]`).join(" ")}`
          : "  没有和这件事强绑定的照片。",
        pkg.media.length > storyMedia.length
          ? `  另有 ${pkg.media.length - storyMedia.length} 个只是同一天/同一月的媒体，不能当作这件事的照片。`
          : "",
        "  （没有人看过任何一张照片的内容，不要描述画面。）",
      ].filter(Boolean).join("\n")
    : "  （无）";

  return `## 这一天
${pkg.time.lifeDate}${pkg.time.ageAtEvent ? `　${pkg.identity.subject.narrativeLabel} · ${pkg.time.ageAtEvent}` : ""}

## 在场的人
${pkg.identity.people.map((p) => `  - ${label(p)}`).join("\n")}

## 可以陈述的事实（唯一可以写成"发生过"的东西）
${factLines}

## 仅供理解的背景（绝不能写成发生过）
${backgroundLines}

## 原话（引用必须一字不差）
${quoteLines}

## 更早的、已核实的背景（帮你理解连续性，不要当成这一天的事）
${contextLines}

## 照片
${mediaLines}

请调用 ${WRITER_V2_TOOL_NAME}。`;
}
