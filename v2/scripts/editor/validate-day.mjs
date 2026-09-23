// 一天的编辑稿守门人（纯函数，不读库、不读文件、不联网）。
//
// 这套规则原来只存在于 NianlifeOps\memory-tab-20260917\10-history-rollout\_tools\build-content.mjs
// （不受 git 管，而且是逐月定制的）。2026-09-20 为「每晚自动整理」搬进仓库：无论草稿是人写的、
// 我在会话里写的，还是以后夜里无头 Claude 写的，都必须过这一关；**过不了就不发布，不是降级发布**。
//
// 它只做机械可判定的事——引语逐字对得上原消息、引语归在真正发这条消息的人名下、点名的人有证据、
// 没有含糊的「有人」、没有真实姓名、没有技术字样、没有无来源的「第一次」、没有注册表里没有的称谓。
// 它**不**判断这一天该不该写、写得好不好、有没有踩「不写的内容」清单（钱款、夫妻争执、排泄、伤痕来由……）：
// 那些需要判断，仍然只能由编辑（Claude）负责，见 EDITOR-BRIEF。所以通过校验 ≠ 可以发布。
//
// 2026-09-23（第三轮）加了三件事，都来自 /memory/2025/12 上家人能看到的错误：
//   1. 称谓白名单从 family-registry 自动生成（identity-rules.mjs），校验器里不再手写身份名单。
//   2. 引语归属：「X 说「……」」里的 X 必须就是那条原消息的发送人（按注册表解析）。
//      12 月 13 日一句话先被写成外公说、后被写成外婆说，两次都没人拦。
//   3. 点名证据：正文里点名一个人在场/做了什么，要有来源——他自己发的消息，或者有消息提到了他。
//      只凭照片里「戴眼镜」「年长」就写成爸爸、外婆，拦下。
import { unconfirmedNames, registeredLabels, mentionsOf } from "./identity-rules.mjs";

/** 引语比对口径：去掉空白、表情符号、方括号表情与转义符，其余逐字比对。 */
export const normalizeForQuote = (t) =>
  String(t ?? "")
    .replace(/\\([\[\]\(\)\.\-_*#!])/g, "$1")
    .replace(/\[[^\]\s]{1,8}\]/g, "")
    .replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, "")
    .replace(/[\s　]+/g, "")
    .replace(/[，,]/g, "，")
    .replace(/[！!]/g, "！")
    .replace(/[？?]/g, "？")
    .replace(/[：:]/g, "：");

/** 取出最外层「」里的引语；引号不配对时返回里面含一个 null。 */
export function quotesOf(text) {
  return quoteSpans(text).map((q) => q.text);
}

/** 同 quotesOf，但带位置：{text, start, end}（start 是「的下标）。不配对时末尾加 {text:null}。 */
function quoteSpans(text) {
  const out = [];
  const stack = [];
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "「") stack.push(i);
    else if (s[i] === "」" && stack.length) {
      const start = stack.pop();
      if (!stack.length) out.push({ text: s.slice(start + 1, i), start, end: i });
    }
  }
  if (stack.length) out.push({ text: null, start: -1, end: -1 });
  return out;
}

/** 把引号里的字换成同样长度的占位，保留下标：之后在「引号外」找词，位置还能对回原文。 */
const blankQuotes = (text) => String(text).replace(/「[^「」]*」/g, (m) => "　".repeat(m.length));

const TECHNICAL = /\[(media|图片|视频|表情包|语音|文件|动画表情)\]|\]\(media\/|https?:\/\/|undefined|Quark|微信|群聊|会话|导入|数据库|网站/i;

/**
 * 正文不得出现在引号外的称谓，由注册表生成（见 identity-rules.mjs）。
 * 注册表里有的人（外婆、雪姨……）自动放行；「小雪」「干妈」「阿姨」这类不是注册称呼的，拦下。
 */
export const UNCONFIRMED_NAMES = unconfirmedNames();

/**
 * 含糊的指人写法。能从发送人解析出来的人一律写称谓；解析不出来的，这句话就不写，
 * 而不是用「有人」「大人」「一位戴眼镜的男士」糊过去。2025-12 页面上各出现过多次。
 */
export const VAGUE_PERSON = [
  [/(?<![没所])有人/, "有人"],
  [/那边说/, "那边说"],
  [/家里有人/, "家里有人"],
  [/大人/, "大人"],
  [/一旁的/, "一旁的"],
  [/一位[^，。；！？「」]{0,12}?(男士|女士|老人|人)/, "一位…的人"],
  [/(戴眼镜|年长|年轻|短发|长发|卷发)的(男|女|人|老)/, "按外貌指人"],
];

const FIRST_TIME = /第一次|首次|头一回/;
const BAD_AGE = /两岁|2岁|二岁/;

// 说话类动词：称谓后面跟着它，这个称谓就是一句话的说话人。
const SPEECH_VERB = "说|问|回|答|讲|喊|叫|感叹|感慨|提醒|叮嘱|嘱咐|交代|告诉|补充|夸|笑|接话|写道|留言|评论|吐槽|解释|发现|总结|提议|建议|担心|念叨|附和|回应|安慰|催|强调|报告|汇报|确认|猜";
// 发送/拍摄类动词：称谓后面跟着它，说的是「这个人发了/拍了」——证据是这个人自己发的消息。
const SEND_VERB = "发|拍|录|分享|转|晒|记|在群里|上传|传";

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function labelPattern(labels) {
  // 长的在前：「大兵老师」要先于「老师」匹配。
  return [...labels].sort((a, b) => b.length - a.length).map(escapeRe).join("|");
}

/** 一个来源可以是字符串（旧调用方式，只有正文）或 {id, text, speaker}。统一成对象。 */
const asSource = (s) => (typeof s === "string" ? { id: null, text: s, speaker: undefined } : { id: s.id ?? null, text: String(s.text ?? ""), speaker: s.speaker });

/**
 * 找出段落里每个「引号外」的已登记称谓，并判断它是说话人、发送人，还是「在场/动作」的点名。
 * @returns {{label:string, index:number, role:"speech"|"send"|"addressee"|"presence"}[]}
 */
export function personMentions(text, labels = registeredLabels()) {
  const s = blankQuotes(text);
  const re = new RegExp(`(${labelPattern(labels)})`, "g");
  const out = [];
  for (const m of s.matchAll(re)) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 14);
    // 称谓与动词之间允许几个字的状语（「妈妈在群里说」「雪姨下午问」），但不能跨标点或引号。
    const head = after.split(/[，。；！？、　「」]/)[0];
    const before = s.slice(Math.max(0, m.index - 3), m.index);
    let role = "presence";
    if (new RegExp(`^[^，。；！？]{0,8}?(${SPEECH_VERB})`).test(head)) role = "speech";
    else if (new RegExp(`^[^，。；！？]{0,5}?(${SEND_VERB})`).test(head)) role = "send";
    // 「爸爸问雪姨」「告诉奶奶」：被问、被告知的人。对话里点到，不是在场描述。
    else if (new RegExp(`(问|告诉|提醒|叮嘱|嘱咐|回复|跟|对|和|给)$`).test(before) && !head) role = "addressee";
    out.push({ label: m[0], index: m.index, role });
  }
  return out;
}

/**
 * 一句引语是谁说的：同一句（到上一个句号为止）里、引语之前最后一个「称谓+说话动词」；
 * 没有说话动词时退到这一句里引语之前最后一个称谓。都没有就返回 null（没有说明是谁说的）。
 */
export function attributedLabel(text, quoteStart, labels = registeredLabels()) {
  const s = blankQuotes(text).slice(0, quoteStart);
  const sentenceStart = Math.max(s.lastIndexOf("。"), s.lastIndexOf("！"), s.lastIndexOf("？"), s.lastIndexOf("；")) + 1;
  const sentence = s.slice(sentenceStart);
  const mentions = personMentions(sentence, labels);
  const speakers = mentions.filter((m) => m.role === "speech");
  if (speakers.length) return speakers[speakers.length - 1].label;
  // 引语紧跟在另一句引语后面（「雪姨说「A」，「B」」）：沿用前一句的说话人。
  return mentions.length ? mentions[mentions.length - 1].label : null;
}

function quoteHits(quote, sources) {
  const nq = normalizeForQuote(quote.replace(/「|」/g, ""));
  if (!nq) return null; // 空引语不核对
  const parts = nq.split(/……|\.\.\./).filter(Boolean);
  // 省略号表示节选：每一段都要在同一条来源里找到。
  return sources.filter((src) => { const ns = normalizeForQuote(src.text); return parts.every((part) => ns.includes(part)); });
}

/**
 * 校验一天的稿子。
 *
 * @param {{day:string,title:string|null,paragraphs:string[]}} entry
 * @param {(string|{id?:string,text:string,speaker?:string|null})[]} sources
 *   这一段（或这一天）引用的那些原消息。对象形式要带 speaker：按 family-registry 解析出的发送人称谓，
 *   未登记的人是 null。只给字符串时无法核对引语归属，每一句带引语的都会被拦下。
 * @param {{realNames?:string[]}} [opts]  真实姓名清单（来自私有的 speaker-map，绝不写进仓库）
 * @returns {{errors:string[], evidence:{quotes:object[], persons:object[]}}}
 *   evidence 是每一处引语、每一处点名的依据，交给调用方落账（quote-provenance / photo-person-evidence）。
 */
export function validateDayText(entry, sources, opts = {}) {
  const errors = [];
  const evidence = { quotes: [], persons: [] };
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const srcs = sources.map(asSource);
  const labels = registeredLabels();
  const chunks = [["标题", entry.title ?? ""], ...entry.paragraphs.map((p, i) => [`第 ${i + 1} 段`, p])];

  for (const [where, text] of chunks) {
    if (!text) continue;
    if (TECHNICAL.test(text)) err(where, "正文含工程/技术字样");

    const spans = quoteSpans(text);
    if (spans.some((q) => q.text === null)) err(where, "引号不配对");

    const outside = String(text).replace(/「[^「」]*」/g, "");
    for (const name of UNCONFIRMED_NAMES) if (outside.includes(name)) err(where, `引号外出现注册表里没有的称谓「${name}」`);
    for (const [re, label] of VAGUE_PERSON) if (re.test(outside)) err(where, `含糊的指人写法「${label}」：能解析发送人的写称谓，解析不出的不写`);
    // 真实姓名连引号里也不行（EDITOR-BRIEF：已确认身份的人也只能用称呼，不能用真名）。
    for (const name of opts.realNames ?? []) if (name && text.includes(name)) err(where, "出现真实姓名，请换成称呼");

    for (const q of spans.filter((x) => x.text !== null)) {
      const hits = quoteHits(q.text, srcs);
      if (hits === null) continue;
      if (hits.length === 0) { err(where, `引语找不到来源「${q.text}」`); continue; }
      if (where === "标题") continue; // 标题里的引语只核对字句，不要求写出说话人
      const label = attributedLabel(text, q.start, labels);
      if (!label) { err(where, `引语「${q.text}」没有写明是谁说的`); continue; }
      const match = hits.find((src) => src.speaker === label);
      if (!match) {
        const actual = [...new Set(hits.map((src) => src.speaker ?? "未登记的人"))].join("、");
        err(where, `引语归属不对：「${q.text}」写成${label}说的，原消息发送人是${actual}`);
        continue;
      }
      evidence.quotes.push({ where, quote: q.text, label, sourceId: match.id, senderLabel: match.speaker });
    }

    // 点名证据：说话/发送 → 要有这个人自己发的消息；在场/动作 → 要有消息提到了这个人。
    {
      for (const m of personMentions(text, labels)) {
        if (m.role === "speech" || m.role === "send") {
          const own = srcs.find((src) => src.speaker === m.label);
          if (own) { evidence.persons.push({ where, label: m.label, role: m.role, basis: "sender", sourceId: own.id }); continue; }
          if (m.role === "speech") { err(where, `写了${m.label}说话，但这一段的来源里没有${m.label}发的消息`); continue; }
          err(where, `写了${m.label}发来/拍下，但这一段的来源里没有${m.label}发的消息`);
          continue;
        }
        if (m.role === "addressee") {
          // 被问的人：他自己在这一段的来源里说过话，或者有消息提到了他，都算。
          const own = srcs.find((src) => src.speaker === m.label);
          if (own) { evidence.persons.push({ where, label: m.label, role: m.role, basis: "sender", sourceId: own.id }); continue; }
        }
        const named = srcs.find((src) => mentionsOf(m.label).some((alias) => normalizeForQuote(src.text).includes(alias)));
        if (named) { evidence.persons.push({ where, label: m.label, role: m.role, basis: "mention", sourceId: named.id, snippet: String(named.text).slice(0, 80) }); continue; }
        // 他自己用文字说了自己在做什么（「到杭州了」「我带他去小公园」）：本人的文字自述算证据。
        // 只认有正文的消息——只发了照片的那条不算，发照片的人通常是拍照的人，不在画面里。
        // 这类依据单独标成 self-report，验收时逐条人工抽读。
        const self = srcs.find((src) => src.speaker === m.label && normalizeForQuote(src.text));
        if (self) { evidence.persons.push({ where, label: m.label, role: m.role, basis: "self-report", sourceId: self.id, snippet: String(self.text).slice(0, 80) }); continue; }
        err(where, `点名了${m.label}在场，但这一段的来源里没有消息提到${m.label}（只凭照片外貌不算）：写「家人」或只写他自己`);
      }
    }

    const sourceTexts = srcs.map((src) => src.text);
    if (FIRST_TIME.test(outside) && !sourceTexts.some((source) => FIRST_TIME.test(source))) {
      err(where, "写了「第一次」但引用的来源里没有");
    }
    if (BAD_AGE.test(outside)) err(where, "出现与出生日期不符的岁数");
  }
  if (entry.paragraphs.length === 0 && !entry.title) err("整体", "一天既没有标题也没有正文");
  return { errors, evidence };
}
