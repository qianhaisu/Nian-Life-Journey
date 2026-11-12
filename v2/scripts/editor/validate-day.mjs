// 一天的编辑稿守门人（纯函数，不读库、不读文件、不联网）。
//
// 2026-09-20 为「每晚自动整理」搬进仓库：无论草稿是谁写的，都必须过这一关；过不了就不发布，不是降级发布。
// 2026-09-23（第三轮）：称谓白名单从 family-registry 自动生成、引语归属核对原消息发送人、点名人物需有证据。
// 2026-11-12（STYLE.zhang 第二版对齐）：新增照片说明书腔拦截、群聊转播腔补漏（含叙述「点赞」「又发来」）、
// 编辑旁白拦截、引语数量上限（全篇 ≤4、单段 ≤2）、育儿套话清单同步，以及无依据跨日比较词（「终于」「比以前」）核验。
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

/** 取出最外层「」或“”里的引语；引号不配对时返回里面含一个 null。 */
export function quotesOf(text) {
  return quoteSpans(text).map((q) => q.text);
}

/** 同 quotesOf，但带位置：{text, start, end}（start 是左引号下标）。支持「」与“”，不配对时末尾加 {text:null}。 */
export function quoteSpans(text) {
  const out = [];
  const stack = [];
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (ch === "「" || ch === "“") {
      const close = ch === "「" ? "」" : "”";
      if (!stack.length || stack.at(-1).open === ch) stack.push({ idx: i, open: ch, close });
    } else if (ch === "」" || ch === "”") {
      if (stack.length && stack.at(-1).close === ch) {
        const top = stack.pop();
        if (!stack.length) out.push({ text: s.slice(top.idx + 1, i), start: top.idx, end: i });
      } else if (!stack.length) {
        out.push({ text: null, start: -1, end: -1 });
      }
    }
  }
  if (stack.length) out.push({ text: null, start: -1, end: -1 });
  return out;
}

/** 把引号里的字换成同样长度的占位，保留下标：之后在「引号外」找词，位置还能对回原文。 */
const blankQuotes = (text) => {
  const s = String(text);
  const spans = quoteSpans(s).filter((q) => q.text !== null && q.start >= 0);
  if (!spans.length) return s;
  let res = "";
  let cursor = 0;
  for (const q of spans) {
    res += s.slice(cursor, q.start) + "　".repeat(q.end - q.start + 1);
    cursor = q.end + 1;
  }
  return res + s.slice(cursor);
};

const stripQuotes = (text) => {
  const s = String(text);
  const spans = quoteSpans(s).filter((q) => q.text !== null && q.start >= 0);
  if (!spans.length) return s;
  let res = "";
  let cursor = 0;
  for (const q of spans) {
    res += s.slice(cursor, q.start);
    cursor = q.end + 1;
  }
  return res + s.slice(cursor);
};

function stripBookTitles(text) {
  return String(text ?? "").replace(/《[^》]*》/g, "《》");
}

/** 将引号与书名号内容替换为空壳占位，确保只检查引号与书名号之外的叙述文字，且两侧字符不会因拼接误匹配。 */
function stripQuotesAndBookTitles(text) {
  const s = String(text ?? "");
  const spans = quoteSpans(s).filter((q) => q.text !== null && q.start >= 0);
  let unquoted = "";
  let cursor = 0;
  for (const q of spans) {
    unquoted += s.slice(cursor, q.start) + "「」";
    cursor = q.end + 1;
  }
  unquoted += s.slice(cursor);
  return stripBookTitles(unquoted);
}

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

/**
 * 敏感信息（Teddy 2026-09-23，孕期与全站重写共用；引号里的原话也算——原话一样会出现在页面上）。
 * 只写与宝宝有关的结论（「产检一切正常」「宝宝比预计大五天」），下面这些一律不写。
 */
export const SENSITIVE_TEXT = [
  ["妈妈本人的病情、用药、检查指标", /(妈妈|孕妇|她)[^。；！？]{0,8}(用药|吃药|打针|输液|化验|血糖|血压|血常规|指标|并发症|贫血|出血|手术|住院)|妊娠(期)?糖尿病|妊高症|妊娠高血压|先兆(流产|早产)|黄体酮|保胎药|宫缩抑制|糖耐|唐筛(结果|数值)|孕酮/],
  ["钱", /\d+(\.\d+)?\s*(元|块钱?|万|千|美元|美金|刀|港币)|[¥￥$]\s*\d|工资|收入|薪|费用|价格|报价|多少钱|花了|房贷|贷款|账户|转账|红包|报销|个税|退税|理财|存款|首付/],
  // Teddy 2026-09-24: nationality arrangements may be narrated; identifiers stay private.
  ["证件与身份办理", /身份证|护照|签证|绿卡|出生纸|出生证明|社保卡|医保卡|保险卡|户口|SSN|移民局/],
  ["精确地址与电话", /(?<!\d)1[3-9]\d{9}(?!\d)|\d{3,4}-\d{7,8}|门牌|\d+\s*(号楼|栋|幢|单元|室)|(路|街|道|弄|巷)\d+号/],
  ["夫妻争执、工作矛盾、负面评价", /吵架|争吵|吵了|冷战|闹崩|离婚|埋怨|抱怨|不满意|矛盾|甩锅|太差劲|不靠谱/],
];

const FIRST_TIME = /第一次|首次|头一回/;
const CROSS_DAY_FINALLY = /终于/;
const CROSS_DAY_COMPARE = /比以前|比平时|比往常/;
const BAD_AGE = /两岁|2岁|二岁/;

// 说话类动词/名词提示：称谓后面跟着它，这个称谓就是一句话的说话人。
const SPEECH_VERB = "说|问|回|答|讲|喊|叫|感叹|感慨|提醒|叮嘱|嘱咐|交代|告诉|补充|夸|笑|接话|写道|留言|评论|评语|评价|点评|打趣|调侃|吐槽|解释|发现|总结|提议|建议|担心|念叨|附和|回应|安慰|催|强调|报告|汇报|确认|猜";
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
    const head = after.split(/[，。；！？、　「」“”]/)[0];
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

/** 判断前一个引号是否在句末标点后结束了整句（如 `「……就会游。」爷爷的评语最短`）。 */
function isClosedQuoteSentenceBoundary(rawText, prevSpan, nextIndex) {
  if (!prevSpan || prevSpan.end < 0 || prevSpan.end >= nextIndex) return false;
  const innerLast = rawText[prevSpan.end - 1];
  if (innerLast !== "。" && innerLast !== "！" && innerLast !== "？") return false;
  const between = rawText.slice(prevSpan.end + 1, nextIndex);
  if (!between.trim()) return false;
  if (/^\s*[，,、；]/.test(between)) return false;
  return true;
}

/**
 * 一句引语是谁说的：同一句（到上一个句号为止）里、引语之前最后一个「称谓+说话动词」；
 * 没有说话动词时退到这一句里引语之前最后一个称谓。都没有就返回 null（没有说明是谁说的）。
 */
export function attributedLabel(text, quoteStart, labels = registeredLabels()) {
  const raw = String(text);
  const s = blankQuotes(raw).slice(0, quoteStart);
  let sentenceStart = Math.max(s.lastIndexOf("。"), s.lastIndexOf("！"), s.lastIndexOf("？"), s.lastIndexOf("；"), s.lastIndexOf("\n")) + 1;
  const priorSpans = quoteSpans(raw).filter((q) => q.text !== null && q.start >= 0 && q.end < quoteStart);
  for (const prev of priorSpans) {
    if (isClosedQuoteSentenceBoundary(raw, prev, quoteStart) && prev.end + 1 > sentenceStart) {
      sentenceStart = prev.end + 1;
    }
  }
  const sentence = s.slice(sentenceStart);
  const mentions = personMentions(sentence, labels);
  const speakers = mentions.filter((m) => m.role === "speech");
  if (speakers.length) return speakers[speakers.length - 1].label;
  // 引语紧跟在另一句引语后面（「雪姨说「A」，「B」」）：沿用前一句的说话人。
  return mentions.length ? mentions[mentions.length - 1].label : null;
}

export function quoteHits(quote, sources) {
  const nq = normalizeForQuote(String(quote ?? "").replace(/[「」“”]/g, ""));
  if (!nq) return null; // 空引语不核对
  const parts = nq.split(/……|\.\.\./).filter(Boolean);
  if (!parts.length) return [];
  // 省略号表示节选：每一段都要在同一条来源里找到。
  const srcs = sources.map(asSource);
  return srcs.filter((src) => { const ns = normalizeForQuote(src.text); return parts.every((part) => ns.includes(part)); });
}

/** 照片说明书腔（STYLE.zhang 第二版第五节：引号和书名号外禁用） */
export const PHOTO_SPEAK_RE = /照片里|画面中|镜头里|视频里|有一张|一张里|另一张里|这张照片/;

/** 群聊转播腔（STYLE.zhang 第二版第五节：引号和书名号外禁用，含叙述中的「点赞」「又发来」等） */
export const CHAT_RELAY_RE =
  /发来[^，。；！？]{0,6}?(照片|视频|消息|一段|几张|段)|又发来|陆续发来|传来(了)?(好)?消息|分享了一段视频|在(家人)?群里(说|聊起|问|发)?|家人群里聊起|有一条留言写道|通话时长|点赞/;

/**
 * 编辑旁白禁词清单（解释写法或取舍的元叙述，引号和书名号外禁用；后续如发现新的编辑旁白表达可在此扩充）。
 */
export const EDITORIAL_ASIDE_RE = /这里把|不必被?写成|值得记下的是/;

/** 育儿套话清单（与 STYLE.zhang 第二版第五节完全同步，并保留历史套话拦截项） */
export const PARENTING_CLICHE_RE =
  /成长的足迹|成长的印记|成长的每一步|满满的|岁月静好|快乐成长|健康快乐|元气满满|未来可期|治愈|仪式感|小小的身体[^。！？]{0,4}?大大的能量|见证成长|时光飞逝|美好的一天|充实的一天|快乐的一天|温馨的画面|平凡而温暖|每天都进步的宝贝/;

/** 叙述人称越界（STYLE.zhang 第二版：统一用第三人称「小年」或「他」，不用「你」「我」「我们」） */
export const NARRATIVE_PERSON_RE =
  /(?:^|[，。；！？、\s]|老师说|妈妈说|爸爸说|外婆说|外公说|奶奶说)[^，。；！？]{0,4}?(你自己|给你|你已经|你喜欢|你新学会|你会|你把|你跟|看着你|陪着你|我们家|我们宝贝|我们一起)/;

export const LITERARY_CLICHE = [
  [PHOTO_SPEAK_RE, "照片说明书腔"],
  [CHAT_RELAY_RE, "群聊转播腔"],
  [EDITORIAL_ASIDE_RE, "编辑旁白"],
  [PARENTING_CLICHE_RE, "育儿套话"],
  [NARRATIVE_PERSON_RE, "叙述人称越界（须统一第三人称「小年/他」，禁用「你/我们」）"],
];

/**
 * 统计一段文字中的引语处数：
 * 同一句内同一已登记说话人被拆成两半的引语（如 `奶奶说「A」，还出了个主意：「B。」`）算作 1 处发言引语（最多合并 2 个相邻片段）；
 * 不同说话人、跨句引语或未标说话人的引语均逐处累加。
 */
export function countQuotesInText(text, labels = registeredLabels()) {
  const raw = String(text ?? "");
  const spans = quoteSpans(raw).filter((q) => q.text !== null && q.start >= 0 && q.text.trim().length > 0);
  if (!spans.length) return 0;
  const blanked = blankQuotes(raw);
  let count = 0;
  let prevSpan = null;
  let prevSpeaker = null;
  let prevMerged = false;

  for (const span of spans) {
    const speaker = attributedLabel(raw, span.start, labels);
    let canMergeWithPrev = false;
    if (prevSpan && !prevMerged && prevSpeaker !== null && speaker === prevSpeaker) {
      const betweenBlanked = blanked.slice(prevSpan.end + 1, span.start);
      const hasSentenceBreak = /[。！？；\n]/.test(betweenBlanked) || isClosedQuoteSentenceBoundary(raw, prevSpan, span.start);
      if (!hasSentenceBreak) {
        canMergeWithPrev = true;
      }
    }
    if (canMergeWithPrev) {
      prevMerged = true;
    } else {
      count += 1;
      prevMerged = false;
    }
    prevSpan = span;
    prevSpeaker = speaker;
  }
  return count;
}

/**
 * 家庭成长故事文风与红线检查（引号与书名号外）：
 * 拒绝照片说明书腔、群聊转播腔、编辑旁白、育儿套话、人称越界、引语超量（全篇 >4 或单段 >2）与四段以上时间报账。
 */
export function validateLiteraryStyle(entry) {
  const errors = [];
  const labels = registeredLabels();
  const paragraphs = entry.paragraphs ?? [];
  const chunks = [["标题", entry.title ?? ""], ...paragraphs.map((p, i) => [`第 ${i + 1} 段`, p])];
  let periodLeadCount = 0;
  let totalQuoteCount = 0;

  for (const [where, text] of chunks) {
    if (!text) continue;
    const outside = stripQuotesAndBookTitles(text);
    for (const [re, label] of LITERARY_CLICHE) {
      const m = outside.match(re);
      if (m) errors.push(`${where}: 含非虚构禁用${label}（命中「${m[0].trim()}」）`);
    }
    const quoteCount = countQuotesInText(text, labels);
    totalQuoteCount += quoteCount;
    if (where !== "标题" && quoteCount > 2) {
      errors.push(`${where}: 引语超量（单段最多 2 处，实为 ${quoteCount} 处）`);
    }
    if (where !== "标题") {
      const leads = [...outside.matchAll(/(?:^|[。！？\n])\s*(凌晨|早上|上午|下午|中午|傍晚|晚上|夜里)[，、]/g)];
      periodLeadCount += leads.length;
    }
  }
  if (totalQuoteCount > 4) {
    errors.push(`整体: 引语超量（全篇最多 4 处，实为 ${totalQuoteCount} 处）`);
  }
  if (periodLeadCount >= 4) {
    errors.push(`整体: 按时间段机械罗列（出现 ${periodLeadCount} 处「上午/中午/下午/晚上，」句首报账），请按场面与细节重新组织`);
  }
  return errors;
}

/**
 * 校验一天的稿子。
 *
 * @param {{day:string,title:string|null,paragraphs:string[]}} entry
 * @param {(string|{id?:string,text:string,speaker?:string|null})[]} sources
 *   这一段（或这一天）引用的那些原消息。对象形式要带 speaker：按 family-registry 解析出的发送人称谓，
 *   未登记的人是 null。只给字符串时无法核对引语归属，每一句带引语的都会被拦下。
 * @param {{realNames?:string[], literary?:boolean}} [opts]  真实姓名清单（来自私有的 speaker-map，绝不写进仓库）
 * @returns {{errors:string[], evidence:{quotes:object[], persons:object[]}}}
 *   evidence 是每一处引语、每一处点名的依据，交给调用方落账（quote-provenance / photo-person-evidence）。
 */
export function validateDayText(entry, sources, opts = {}) {
  const errors = [];
  const evidence = { quotes: [], persons: [] };
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const srcs = sources.map(asSource);
  const labels = registeredLabels();
  const chunks = [["标题", entry.title ?? ""], ...(entry.paragraphs ?? []).map((p, i) => [`第 ${i + 1} 段`, p])];

  for (const [where, text] of chunks) {
    if (!text) continue;
    if (TECHNICAL.test(text)) err(where, "正文含工程/技术字样");

    const spans = quoteSpans(text);
    if (spans.some((q) => q.text === null)) err(where, "引号不配对");

    const outside = stripQuotes(text);
    const outsideNoBook = stripBookTitles(outside);
    for (const name of UNCONFIRMED_NAMES) if (outsideNoBook.includes(name)) err(where, `引号外出现注册表里没有的称谓「${name}」`);
    for (const [re, label] of VAGUE_PERSON) if (re.test(outsideNoBook)) err(where, `含糊的指人写法「${label}」：能解析发送人的写称谓，解析不出的不写`);
    for (const [label, re] of SENSITIVE_TEXT) { const m = String(text).match(re); if (m) err(where, `敏感信息（${label}）「${m[0]}」：不写进故事`); }
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
    if (FIRST_TIME.test(outsideNoBook) && !sourceTexts.some((source) => FIRST_TIME.test(source))) {
      err(where, "写了「第一次」但引用的来源里没有");
    }
    if (CROSS_DAY_FINALLY.test(outsideNoBook) && !sourceTexts.some((source) => /终于|总算|好不容易/.test(source))) {
      err(where, "写了「终于」但引用的来源里没有");
    }
    if (CROSS_DAY_COMPARE.test(outsideNoBook) && !sourceTexts.some((source) => /比以前|比平时|比往常|以前|平时|往常/.test(source))) {
      err(where, "写了无来源的跨日比较（「比以前/比平时/比往常」）");
    }
    if (BAD_AGE.test(outsideNoBook)) err(where, "出现与出生日期不符的岁数");
  }
  if (opts.literary) errors.push(...validateLiteraryStyle(entry));
  if ((entry.paragraphs ?? []).length === 0 && !entry.title) err("整体", "一天既没有标题也没有正文");
  return { errors, evidence };
}
