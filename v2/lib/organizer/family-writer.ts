// Gate C — Family Writer.
//
// Runs only on candidates that already cleared the Memory Editor and the H1–H9 validator, and may
// only use facts those stages verified. The writer's job is to turn a verified fact list into two
// or three plain sentences a parent would actually want to reread — not to add meaning.
//
// Everything below the prompt is a deterministic check on the model's output. Warmth that cannot be
// verified is indistinguishable from invention, so an unverifiable sentence is rejected rather than
// softened.
import { containsTechnicalPlaceholder } from "./quality-review";

export const FAMILY_WRITER_PROMPT_VERSION = "family-writer-v1";

export const FAMILY_WRITER_SYSTEM_PROMPT = `你在为一个孩子的人生档案写一段简短记录。读者是这个孩子长大以后，和他的家人。

你只能使用给定的「已核实事实」和「原话」。这些是唯一的事实来源。

**绝对禁止：**
- 补写聊天里没有发生的动作；
- 猜测情绪、动机或成长意义（"他一定很开心""这标志着他长大了"）；
- 把相邻但无关的事拼成因果；
- 根据文件名或媒体数量推断照片内容；
- 医疗、发育或心理判断；
- 确认照片里的人物身份；
- 把模糊代词写成确定人物。

**"有温度"来自：** 一个真实的小动作、一句准确的原话、家人真实的反应、场景里的具体细节，以及克制自然的叙述。

**"有温度"不等于套话。** 以下表达一律禁止出现：
"这一天值得被记住""在爱的陪伴下""悄悄长大""珍贵的成长瞬间""幸福定格""美好时光""见证成长""时光荏苒""爱的印记""温暖的港湾"，以及任何没有证据支撑的煽情句。

**成文要求：**
- title：6 到 18 个汉字，具体，能一眼看出这天发生了什么。不要用"一段记忆""生活痕迹"这类占位标题。
- story：60 到 180 个汉字，通常 2 到 3 句。
- 至少包含一个可验证的具体细节（一个动作、一个物件、一个数字或一句原话）。
- 如果引用原话，必须与「原话」列表里的文字逐字一致，用「」括起来。
- story 不要重复 title 的句子。
- 不要解释系统实现，不要出现文件路径、[图片]、[视频]、undefined 等技术文字。

如果给定事实不足以写出符合上述要求的内容，把 insufficient 设为 true，不要硬写。`;

export function buildFamilyWriterPrompt(input: { occurredAt: string; coreFacts: Array<{ statement: string; assertionKind: string; claimant?: string }>; quotableLines: Array<{ text: string; speakerRole: string }>; mediaCount: number }) {
  const facts = input.coreFacts.map((fact, index) => `  ${index + 1}. ${fact.statement}${fact.assertionKind === "attributed_claim" ? `（${fact.claimant ?? "家人"}转述）` : ""}`).join("\n");
  const quotes = input.quotableLines.length ? input.quotableLines.map((line) => `  - ${line.speakerRole}：「${line.text}」`).join("\n") : "  (无)";
  return `日期：${input.occurredAt}
当天媒体数量：${input.mediaCount}（内容未知，不可据此推断画面）

## 已核实事实（唯一可用的事实来源）
${facts}

## 可引用的原话（必须逐字引用）
${quotes}

请调用 emit_story 输出 title 和 story。`;
}

export const FAMILY_WRITER_TOOL_NAME = "emit_story";

export const FAMILY_WRITER_TOOL_SCHEMA = {
  type: "object",
  properties: {
    insufficient: { type: "boolean", description: "事实不足以写出合格内容时为 true" },
    title: { type: "string", description: "6 到 18 个汉字的具体标题" },
    story: { type: "string", description: "60 到 180 个汉字的正文" },
    usedFactIndexes: { type: "array", items: { type: "integer" }, description: "用到的已核实事实序号" },
  },
  required: ["insufficient", "title", "story", "usedFactIndexes"],
} as const;

const CLICHES = ["这一天值得被记住", "在爱的陪伴下", "悄悄长大", "珍贵的成长瞬间", "幸福定格", "美好时光", "见证成长", "时光荏苒", "爱的印记", "温暖的港湾", "一段记忆", "生活痕迹"];

const countHan = (text: string) => (text.match(/[一-鿿]/g) ?? []).length;

export type WriterValidationInput = { title: string; story: string; quotableLines: Array<{ text: string }>; evidenceTexts: string[] };
export type WriterValidationResult = { ok: boolean; issues: string[] };

// Every quoted span in the story must appear verbatim in the source evidence. This is the check that
// stops a "fluent but invented" quote, which is the failure mode a human reader is least likely to
// catch.
export function extractQuotes(story: string): string[] {
  return [...story.matchAll(/[「“"]([^」”"]+)[」”"]/g)].map((match) => match[1].trim()).filter(Boolean);
}

export function validateFamilyWriterOutput(input: WriterValidationInput): WriterValidationResult {
  const issues: string[] = [];
  const titleLength = countHan(input.title);
  const storyLength = countHan(input.story);
  if (titleLength < 6 || titleLength > 18) issues.push(`title_length_${titleLength}`);
  if (storyLength < 60 || storyLength > 180) issues.push(`story_length_${storyLength}`);
  if (containsTechnicalPlaceholder(input.title) || containsTechnicalPlaceholder(input.story)) issues.push("technical_placeholder");
  for (const cliche of CLICHES) if (input.title.includes(cliche) || input.story.includes(cliche)) issues.push(`cliche:${cliche}`);
  if (input.story.includes(input.title)) issues.push("title_repeated_in_story");

  const haystack = [...input.evidenceTexts, ...input.quotableLines.map((line) => line.text)].join("\n");
  for (const quote of extractQuotes(input.story)) {
    if (!haystack.includes(quote)) issues.push(`unsupported_quote:${quote.slice(0, 12)}`);
  }
  return { ok: issues.length === 0, issues };
}
