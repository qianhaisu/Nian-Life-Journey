// 一天的编辑稿守门人（纯函数，不读库、不读文件、不联网）。
//
// 这套规则原来只存在于 NianlifeOps\memory-tab-20260917\10-history-rollout\_tools\build-content.mjs
// （不受 git 管，而且是逐月定制的）。2026-09-20 为「每晚自动整理」搬进仓库：无论草稿是人写的、
// 我在会话里写的，还是以后夜里无头 Claude 写的，都必须过这一关；**过不了就不发布，不是降级发布**。
//
// 它只做机械可判定的事——引语逐字对得上原消息、没有真实姓名、没有技术字样、没有无来源的「第一次」、
// 没有未确认的称呼。它**不**判断这一天该不该写、写得好不好、有没有踩「不写的内容」清单
// （钱款、夫妻争执、排泄、伤痕来由……）：那些需要判断，仍然只能由编辑（Claude）负责，
// 见 EDITOR-BRIEF。所以通过校验 ≠ 可以发布，只是「没有明显违反机械规则」。

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
  const out = [];
  const stack = [];
  const s = String(text);
  for (let i = 0; i < s.length; i += 1) {
    if (s[i] === "「") stack.push(i);
    else if (s[i] === "」" && stack.length) {
      const start = stack.pop();
      if (!stack.length) out.push(s.slice(start + 1, i));
    }
  }
  if (stack.length) out.push(null);
  return out;
}

const TECHNICAL = /\[(media|图片|视频|表情包|语音|文件|动画表情)\]|\]\(media\/|https?:\/\/|undefined|Quark|微信|群聊|会话|导入|数据库|网站/i;

/** 这些称呼只有出现在「」里、是别人原话的一部分时才允许（正文不点名，见 EDITOR-BRIEF「称呼」）。 */
export const UNCONFIRMED_NAMES = ["雪姨", "小雪", "外婆", "干妈", "小姨", "晴姨", "阿姨", "保姆"];

const FIRST_TIME = /第一次|首次|头一回/;
const BAD_AGE = /两岁|2岁|二岁/;

/**
 * 校验一天的稿子。
 *
 * @param {{day:string,title:string|null,paragraphs:string[]}} entry
 * @param {string[]} sourceTexts   这一天引用的那些原消息的正文（不是全部消息——引语必须出在被引用的里面）
 * @param {{realNames?:string[]}} [opts]  真实姓名清单（来自私有的 speaker-map，绝不写进仓库）
 * @returns {{errors:string[]}}
 */
export function validateDayText(entry, sourceTexts, opts = {}) {
  const errors = [];
  const err = (where, msg) => errors.push(`${where}: ${msg}`);
  const norms = sourceTexts.map(normalizeForQuote);
  const chunks = [["标题", entry.title ?? ""], ...entry.paragraphs.map((p, i) => [`第 ${i + 1} 段`, p])];

  for (const [where, text] of chunks) {
    if (!text) continue;
    if (TECHNICAL.test(text)) err(where, "正文含工程/技术字样");

    const quotes = quotesOf(text);
    if (quotes.includes(null)) err(where, "引号不配对");

    const outside = String(text).replace(/「[^「」]*」/g, "");
    for (const name of UNCONFIRMED_NAMES) if (outside.includes(name)) err(where, `引号外出现未确认称呼「${name}」`);
    // 真实姓名连引号里也不行（EDITOR-BRIEF：已确认身份的人也只能用称呼，不能用真名）。
    for (const name of opts.realNames ?? []) if (name && text.includes(name)) err(where, "出现真实姓名，请换成称呼");

    for (const quote of quotes.filter(Boolean)) {
      const nq = normalizeForQuote(quote.replace(/「|」/g, ""));
      if (!nq) continue;
      // 省略号表示节选：每一段都要在同一条来源里找到。
      const parts = nq.split(/……|\.\.\./).filter(Boolean);
      const hit = norms.some((source) => parts.every((part) => source.includes(part)));
      if (!hit) err(where, `引语找不到来源「${quote}」`);
    }

    if (FIRST_TIME.test(outside) && !sourceTexts.some((source) => FIRST_TIME.test(source))) {
      err(where, "写了「第一次」但引用的来源里没有");
    }
    if (BAD_AGE.test(outside)) err(where, "出现与出生日期不符的岁数");
  }
  if (entry.paragraphs.length === 0 && !entry.title) err("整体", "一天既没有标题也没有正文");
  return { errors };
}
