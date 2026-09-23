// 夜间编辑的「决策层」：全部是纯函数，不读库、不读文件、不联网、不调模型。
//
// 无人值守地替家人写故事，最容易出事的不是模型写得好不好，而是「什么时候该写、什么时候该拒绝」——
// 写了一个数据还没齐的日子、把已经写好的一天覆盖掉、把敏感内容带进页面。所以这些判断集中在这里，
// 每一条都有测试，I/O 层（nightly-editor.mjs）只负责把结果照做。

/** 某一天要等隔天的导出才齐（WeFlow 预设是「昨天」），所以只写「今天 − 1」及更早的日子。
 * 2026-09-21 Teddy 要求把 2 改成 1：00:15 跑时 23:30 的同步已把昨天的消息入库，等两天只是白白晚一天出现在页面上。 */
export const READY_LAG_DAYS = 1;
/** 每晚最多写几天：限制单晚的成本和出错面，积压的日子分几晚消化。 */
export const MAX_DAYS_PER_RUN = 3;
/** 同一天连续失败几个晚上后就 hold，不再自动重试，等人看。 */
export const MAX_ATTEMPTS = 3;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function addDays(day, delta) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

/** Asia/Shanghai 的今天（YYYY-MM-DD）。不依赖机器时区。 */
export function shanghaiToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 3600e3).toISOString().slice(0, 10);
}

/**
 * 今晚该写哪些天。
 *
 * @param {object} p
 * @param {string} p.today            Asia/Shanghai 的今天
 * @param {string[]} p.months         要看的月份（YYYY-MM），通常是当月，月初还包括上个月
 * @param {(month:string)=>Set<string>} p.coveredDays   这个月内容文件里已经有的天
 * @param {(day:string)=>boolean} p.hasMaterial         这一天库里有没有可读的消息（无材料的日子不必问模型）
 * @param {Record<string,{attempts:number,status:string}>} p.state   每天的历史（attempts / held / skipped / published）
 * @returns {{write:string[], skipped:{day:string,reason:string}[]}}
 */
export function pickDays({ today, months, coveredDays, hasMaterial, state }) {
  const cutoff = addDays(today, -READY_LAG_DAYS);
  const write = [];
  const skipped = [];
  for (const month of [...months].sort()) {
    const covered = coveredDays(month);
    const last = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0)).getUTCDate();
    for (let d = 1; d <= last; d += 1) {
      const day = `${month}-${String(d).padStart(2, "0")}`;
      if (day > cutoff) break;
      if (covered.has(day)) continue;
      const s = state[day];
      if (s?.status === "held") { skipped.push({ day, reason: `已 hold（连续失败 ${s.attempts} 次），等人处理` }); continue; }
      if (s?.status === "skipped") continue;
      if (!hasMaterial(day)) { skipped.push({ day, reason: "库里没有这一天的可读消息" }); continue; }
      write.push(day);
    }
  }
  return { write: write.slice(0, MAX_DAYS_PER_RUN), skipped };
}

// ── 消息过滤 ──────────────────────────────────────────────────────────────────

const PLACEHOLDER = /^\s*(\[(图片|视频|表情|表情包|动画表情|语音|文件|位置|名片|视频号|小程序|media|消息)\]|\\?\[.*?\])\s*$/;
const SYSTEM = /撤回了一条消息|拍了拍|当前(微信)?版本不支持展示|修改群名为|\$username\$|\$remark\$/;
/** 「> 」开头的是同一条引用消息在另一个会话里的副本，正文已经在原消息里，留着只会重复。 */
const QUOTE_COPY = /^\s*>\s/;

/** 这条消息该不该交给模型看。过滤只删「明显不是文字内容」的，不做任何语义判断。 */
export function isReadable(text) {
  const t = String(text ?? "").trim();
  if (!t) return false;
  if (PLACEHOLDER.test(t) || SYSTEM.test(t) || QUOTE_COPY.test(t)) return false;
  return true;
}

// ── 确定性的敏感内容兜底 ──────────────────────────────────────────────────────
//
// EDITOR-BRIEF「不写的内容」里大部分要靠判断（夫妻争执、伤痕来由……），这里做不到。但最硬的几类
// 可以机械拦一层：命中就 hold 给人看，而不是发布。宁可多 hold，不可少拦——被拦的日子第二天有人看，
// 发布出去的敏感内容收不回来。这是兜底，不是替代编辑的判断。
const SENSITIVE = [
  ["钱款", /红包|转账|房贷|贷款|还款|工资|存款|理财|汇款/],
  // 「拉了」单独太宽（拉了警报、拉了手、拉了窗帘）：2026-09-19 手补 9/18 时被「拉了防空警报」误伤。
  // 只在明确的排泄语境命中：拉了 + 次数/臭臭/便，或「又拉」「就拉」。误伤天天发生的兜底，人会学会无视它。
  ["排泄", /屎|大便|臭臭|便便|粑粑|拉稀|拉肚|拉了[一二两三四五六七八九十几\d]+次|拉了(臭|便|粑)|又拉了|就拉了|尿布|尿不湿|尿床/],
  ["争执", /吵架|争吵|吵了一架|冷战|离婚/],
  ["伤痕", /疤|淤青|淤血|红印|摔伤|烫伤|磕/],
  ["证件号码", /(?<!\d)1[3-9]\d{9}(?!\d)|(?<!\d)\d{17}[\dXx](?!\d)|身份证|密码/],
];

/** @returns {{category:string, hit:string}[]} 命中的敏感类别（空数组 = 没命中） */
export function sensitiveHits(entry) {
  const text = [entry.title ?? "", ...(entry.paragraphs ?? [])].join("\n");
  const out = [];
  for (const [category, re] of SENSITIVE) {
    const m = text.match(re);
    if (m) out.push({ category, hit: m[0] });
  }
  return out;
}

// ── 模型输出 ──────────────────────────────────────────────────────────────────

/** 从模型回复里取出第一个完整的 JSON 对象（模型偶尔会在前后加话或套代码块）。取不到返回 null。 */
export function extractJson(reply) {
  const s = String(reply ?? "");
  const start = s.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < s.length; i += 1) {
    const c = s[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) {
        try { return JSON.parse(s.slice(start, i + 1)); } catch { return null; }
      }
    }
  }
  return null;
}

const MAX_TITLE = 30;
const MAX_TOTAL_CHARS = 900;
const MAX_PARAGRAPHS = 6;

/**
 * 模型给出的决定是否合乎形状与篇幅。不合就当作失败（进入重试/hold），而不是「凑合用」。
 * kinds：允许的 kind。夜间编辑没有照片，只许 story/text-only；重写已有照片的天（regen-month）还许 visual-description。
 * @returns {{ok:true, decision:object}|{ok:false, error:string}}
 */
export function checkDecision(decision, knownKeys, { kinds = ["story", "text-only"] } = {}) {
  if (!decision || typeof decision !== "object") return { ok: false, error: "模型没有给出可解析的 JSON" };
  if (decision.decision === "skip") {
    if (typeof decision.reason !== "string" || !decision.reason.trim()) return { ok: false, error: "skip 必须写明理由" };
    return { ok: true, decision };
  }
  if (decision.decision !== "write") return { ok: false, error: `decision 只能是 write 或 skip，实为 ${JSON.stringify(decision.decision)}` };
  if (!kinds.includes(decision.kind)) return { ok: false, error: `kind 只能是 ${kinds.join(" 或 ")}，实为 ${JSON.stringify(decision.kind)}` };
  if (typeof decision.title !== "string" || !decision.title.trim()) return { ok: false, error: "缺标题" };
  if ([...decision.title].length > MAX_TITLE) return { ok: false, error: `标题超过 ${MAX_TITLE} 字` };
  const p = decision.paragraphs;
  if (!Array.isArray(p) || p.length === 0) return { ok: false, error: "paragraphs 必须是非空数组" };
  if (p.length > MAX_PARAGRAPHS) return { ok: false, error: `段落超过 ${MAX_PARAGRAPHS} 段` };
  // 每段各自交代来源：引语必须出在「这一段」列出的消息里。整稿只给一个来源列表，
  // 等于允许把 A 段的引语归到 B 段的来源上（2026-09-20 dry-run 里看到的问题）。
  for (const [i, para] of p.entries()) {
    if (!para || typeof para.text !== "string" || !para.text.trim()) return { ok: false, error: `第 ${i + 1} 段必须是 {text, sources}，且 text 非空` };
    if (!Array.isArray(para.sources) || para.sources.length === 0) return { ok: false, error: `第 ${i + 1} 段没有列出来源` };
    const unknown = para.sources.filter((k) => !knownKeys.has(k));
    if (unknown.length) return { ok: false, error: `第 ${i + 1} 段的 sources 里有不存在的短键：${unknown.join(",")}` };
  }
  if (p.map((x) => x.text).join("").length > MAX_TOTAL_CHARS) return { ok: false, error: `正文超过 ${MAX_TOTAL_CHARS} 字` };
  return { ok: true, decision };
}

// ── 时间词核对 ────────────────────────────────────────────────────────────────
//
// 「上午/下午/晚上」这类词，如果这一段引用的消息全都在别的时段，就是写错了。窗口故意开得宽（边界两头各多 1–2 小时），
// 只拦明显对不上的：宁可放过一个边界上的说法，也不要天天误拦。它抓不到的（主语错了、把 A 说成 B 做的）只能靠抽检。
const PERIODS = { 凌晨: [0, 6], 早上: [5, 10], 上午: [6, 13], 中午: [10, 15], 下午: [12, 19], 傍晚: [15, 21], 晚上: [17, 24], 夜里: [20, 24] };

/** @param {string} text 段落正文  @param {number[]} hours 这一段引用的消息的小时 @returns {string[]} 对不上的时间词 */
export function timeWordProblems(text, hours) {
  const bad = [];
  if (hours.length === 0) return bad;
  for (const [word, [lo, hi]] of Object.entries(PERIODS)) {
    if (!text.includes(word)) continue;
    if (!hours.some((h) => h >= lo && h <= hi)) bad.push(word);
  }
  return bad;
}

/** 一次失败之后这一天的新状态：累计次数，够了就 hold。 */
export function afterFailure(prev) {
  const attempts = (prev?.attempts ?? 0) + 1;
  return { attempts, status: attempts >= MAX_ATTEMPTS ? "held" : "retry" };
}
