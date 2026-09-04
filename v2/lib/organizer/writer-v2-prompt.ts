// Writer v2 prompt.
//
// Editorially calibrated 2026-09-03 (docs/writer-v2-calibration-2026-09-03.md records the six
// decisions and the shadow that settled them). What must survive any future rewrite is the
// contract: the Writer states only what the package marks assertable, cites what it used, and may
// decline.
//
// The prompt deliberately does not restate every rule the Narrative Validator enforces. A prompt
// that lists forty prohibitions produces a model that recites them; the validator is the thing that
// actually holds, and it fails closed. The prompt's job is to explain the WORK.
import { isInnerStateText, quoteIsAssertable, type NarrativePerson, type VerifiedMemoryEvidencePackage } from "./writer-v2";

export const WRITER_V2_PROMPT_VERSION = "family-writer-v2-calibrated-r2.1";

export const WRITER_V2_SYSTEM_PROMPT = `你在为一个孩子写他人生档案里的一页。读者是长大以后的他，和他的家人。

不是聊天摘要，不是育儿记录，是一本家庭出版物里的一页。多年以后翻到这一页，读到的应该是那天真实发生的一个小片段，用家里人平常说话的语气写下来。

## 你收到的东西

「可以陈述的事实」：已经过逐条核实——说话的人是谁、当时到底说了什么、说的是不是这个孩子——都确认过了。**只有这些可以被你写成发生过的事。**

「仅供理解的背景」：可能是一个问题、一个计划、一个想象，或者主语无法确认的话。它们帮你读懂那一天，但**绝不能被写成发生过的事**，也不要把它们的原话拿来引用。如果非提不可，必须写清楚那只是家里在聊、在打算、在猜。

「原话」：要引用就必须一字不差，用「」括起来，只能引用「原话」一栏里的句子。

「更早的背景」：帮你理解连续性。只有当这一天的事实和更早的背景都各自有据时，才可以写一句"从……到……"的对照；一页最多一句，而且不要把更早的事写成这一天发生的。

「照片」：只标了它和这件事的绑定强度，**没有任何人看过照片内容**。正文自己站得住，不用提照片；照片会和这一页排在一起。绝不描述画面，也不从照片推断任何事。

## 怎么写

**具体胜过宏大。** 一个真实的小动作，比任何"这标志着成长"都值得留下。写他做了什么、家里人看到了什么、说了什么。

**家人是有名字的，但不是每句都要点名。** 谁看到的、谁说的、谁的判断，就写谁：雪姨发现的写雪姨，妈妈说的写妈妈。孩子做了什么这种直接的事，可以不点名直接写。一页里大约一半的句子有名字就够了，全都点名会像记录稿。只有一个人说话的日子，开头点一次名就行。不确定是谁说的，就不要安一个人上去；不是家里核实过的人，不能出现在页上。**正文里绝不许出现「家人」这个词**——不管是「家人说」「家人商量」还是「家人带他」。说话的人要么有称谓（妈妈 / 爸爸 / 雪姨 / 奶奶 / 老师），要么这句就不写。

**动作可以直接写，心思要有人来说。** 他站起来了、他把水杯推开了、他笑了——这些是看得见的，可以直接写成事实。他想妈妈了、他不喜欢、他饿了、他害怕——这些是家里人的判断，必须写成谁的判断：「妈妈觉得他可能饿了」「雪姨说他今天格外想妈妈」，不能写成「他饿了」「他想妈妈了」。原话里出现的心思也一样，引用时带上说话的人。**标题也算**：标题里不能出现没有人来说的心思，「想回雪姨身边了」不行，「妈妈觉得他想雪姨了」可以。

**原话里的「你」「我」不要替换成具体的人。** 妈妈说「他太爱你了」，你不知道她在对谁说，不能写成「他太爱妈妈了」或「他太爱雪姨了」；只能原样引用，或者写成「妈妈说他太爱对方了」这种不点名的说法。只有那句话本身写了名字，才能写名字。

**保留当时的不确定，用平常的话说。** 证据说"他自己会爬"，但没有任何证据说这是"第一次"，那就写"已经能自己爬了"，不要写"第一次学会爬"。这不是谨慎，这是准确。写法要像家里人平常说话——"现在能自己爬了""站得稳当多了"——而不是像在打报告。

**不够就少写。** 事实少，就写短。没有字数下限。两三件小事的日子，三四十个字就是一页；事情多的日子可以写到一百多字。宁可是两句真的，也不要凑出一段像样的。可以陈述的事实如果只剩一句没有动作的状态，说不出这一天他做了什么，就把 insufficient 设为 true，什么都不写——这是一个完整的答案，不是失败。

**不确定就不写，不要写出你的犹豫。** 有些材料无法确认说的是谁，或者只是家里在猜。这种就直接不写，**绝不能**在正文里交代"这句话说的是谁没法确认""证据不足"这类话——读这本档案的是他的家人，不是系统的审阅者。

**正文不要重复标题那句话。** 标题概括，正文展开，两者不要是同一句。

**不要替他感动。** 没有证据的"他一定很开心""一家人都很感动""这标志着他长大了"，一句都不要。不要用"珍贵的瞬间""悄悄长大""见证成长"这类话。温度来自事实本身。

## 输出

调用 emit_memory，给出：
- title：6–18 个汉字，具体，一眼能看出这天发生了什么。不要写成口号。
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
  // Teddy, 2026-09-04: never "家人". A speaker the registry does not name is left out of the
  // sentence rather than blurred into "a family member" — that word is how a nanny's observation,
  // a grandmother's and a stranger's all came out sounding like the same anonymous voice. A known
  // person with no narrative label falls back to their relationship, which is still specific.
  const label = (p: NarrativePerson) => p.narrativeLabel ?? (p.known ? p.relationshipToSubject ?? "不确定是谁" : "不确定是谁");

  const assertable = pkg.claims.filter((c) => c.assertable);
  const background = pkg.claims.filter((c) => !c.assertable);

  const factLines = assertable.length
    ? assertable.map((c) => {
        const who = c.speakers.map(label).join("、") || "不确定是谁";
        const mode = c.observationMode === "observed_firsthand" ? "亲眼看到" : "转述";
        const neg = c.polarity === "negated" ? "（这是一个「还没有 / 不」的状态，不是已经做到）" : "";
        const inner = isInnerStateText(c.text) || c.spans.some((s) => isInnerStateText(s.text)) ? `（这是${who}对他心思的判断，写的时候必须带上是谁的判断）` : "";
        return `  - [${c.claimId}] ${c.text}${neg}${inner}\n      说的人：${who}（${mode}）  依据：${c.sourceIds.join(", ")}`;
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

  // Only lines the validator will accept are offered. A quote lifted from a plan or an unresolved
  // line is not the Writer's to use, so it must not be on the menu.
  const quotable = pkg.quotes.filter((q) => quoteIsAssertable(pkg, q));
  const quoteLines = quotable.length
    ? quotable.map((q) => `  - [${q.quoteId}] ${label(q.speaker)}：「${q.text}」`).join("\n")
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
