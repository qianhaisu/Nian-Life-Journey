// 首页题签里的局部着色（2026-09-14，用户：着色不该只有 cold / hot 那一篇）。
//
// 上一版是 app/page.tsx 里按 eventId 逐篇写死的表，只有 coldhot 一篇有颜色；再往前一版按 cold/冷/
// hot/热 自动匹配，把每段生活都涂成同一个彩色模板，被删掉了。这一版取两者之间：
//
//   · 规则是**小词组**，不是整句标题，也不是 eventId——一个词组命中哪篇标题就标哪篇，新故事自动适用；
//   · 表很小、按语义分组，每组用站点已有的一支颜色（蓝 / 桃红 / 鼠尾草绿），加词要回答「它属于哪一组」；
//   · 克制：每个标题最多两段、互不重叠、着色总长不超过标题的一半，命中不了就是默认文字色。
//
// 词组必须是标题里**真有的那几个字**；拉丁词按词边界匹配（不会把 photo 里的 hot 标出来）。
// 这里只决定「哪几个字、哪一支颜色」，怎么画在 components/home-lead.tsx。

export type HomeEmphasisAccent = "blue" | "rose" | "sage";
export type TitleEmphasisSpan = { start: number; end: number; text: string; accent: HomeEmphasisAccent };
export type TitlePhraseRule = { phrase: string; accent: HomeEmphasisAccent };

export const TITLE_PHRASE_GROUPS = {
  // 他自己说出口的词：原样的那个词最值得被看见（9 月 7 日妈妈报的就是 cold 和 hot）。
  spoken: [
    { phrase: "cold", accent: "blue" },
    { phrase: "hot", accent: "rose" },
  ],
  // 一段生活里的场合与活动：读标题的人一眼要知道「这天有件事」。
  occasion: [
    { phrase: "庆典节目", accent: "rose" },
    { phrase: "毕业典礼", accent: "rose" },
    { phrase: "演出", accent: "rose" },
    { phrase: "生日", accent: "rose" },
  ],
  // 他那天的样子：发型、装扮这类一眼可见的小变化。
  look: [
    { phrase: "小辫子", accent: "sage" },
    { phrase: "辫子", accent: "sage" },
  ],
} as const satisfies Record<string, readonly TitlePhraseRule[]>;

export const TITLE_PHRASE_RULES: readonly TitlePhraseRule[] = Object.values(TITLE_PHRASE_GROUPS).flat();

/** 每个标题最多几段强调。两段以上就不再是强调，而是把一句话涂成三种颜色。 */
export const TITLE_EMPHASIS_MAX_SPANS = 2;
/** 着色总长占标题的上限。「他会说 cold，也会说 hot」是 7/16，定稿就是这样；再多就近乎整句染色。 */
export const TITLE_EMPHASIS_MAX_SHARE = 0.5;

const LATIN_WORD = /^[A-Za-z]+$/;

function escapeForRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function firstIndexOf(title: string, phrase: string): number {
  if (!LATIN_WORD.test(phrase)) return title.indexOf(phrase);
  const match = new RegExp(`(?<![A-Za-z])${escapeForRegExp(phrase)}(?![A-Za-z])`, "i").exec(title);
  return match ? match.index : -1;
}

export function titleEmphasis(title: string, rules: readonly TitlePhraseRule[] = TITLE_PHRASE_RULES): TitleEmphasisSpan[] {
  if (!title) return [];
  // 长的先占位：「小辫子」命中后，「辫子」不会再在同一处叠一段。
  const found: TitleEmphasisSpan[] = [];
  for (const rule of [...rules].sort((a, b) => b.phrase.length - a.phrase.length)) {
    if (!rule.phrase) continue;
    const start = firstIndexOf(title, rule.phrase);
    if (start < 0) continue;
    const end = start + rule.phrase.length;
    if (found.some((span) => start < span.end && end > span.start)) continue;
    found.push({ start, end, text: title.slice(start, end), accent: rule.accent });
  }
  found.sort((a, b) => a.start - b.start);
  const picked: TitleEmphasisSpan[] = [];
  let colored = 0;
  for (const span of found) {
    if (picked.length >= TITLE_EMPHASIS_MAX_SPANS) break;
    const length = span.end - span.start;
    if (colored + length > title.length * TITLE_EMPHASIS_MAX_SHARE) continue;
    picked.push(span);
    colored += length;
  }
  return picked;
}
