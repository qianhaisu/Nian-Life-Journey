// 照片夜间审批的「决策层」：纯函数，不读库、不联网、不调模型。I/O 在 nightly-photos.mjs。
//
// 产品决定（Teddy 2026-09-20）：识别通过的照片自动上页面，不再有人工签；班级合影放行。
// 判定规则沿用 .data/ds-photo-policy.mjs（2026-09-17 那套保守规则），唯一的改动是「别的孩子入镜」
// 不再挡住放行——前提仍是模型明确认出画面里的主孩子就是张年（reference_child = yes）。
// 其余保守项一条没松：认不出 / 太小 / 背对镜头 / 洗澡·裸露 / 医疗·伤口 / 任何敏感类别都不放行。
// 不放行的不写库、也不显示（照片仍留在档案里，只是不上页面）。

/** 每晚最多处理几张：限制单晚的调用量；积压分几晚消化。 */
export const MAX_PHOTOS_PER_RUN = 200;
/** 只看最近这么多天的照片：更老的历史照片走过去的人工流程，夜里不去动。 */
export const LOOKBACK_DAYS = 30;
/** 一天的照片区最多放几张，首屏最多几张。 */
export const MAX_PER_DAY = 12;
export const FIRST_SCREEN = 4;
/** 单晚放行比例低于这个值（且样本足够）就停手不写：多半是识图能力或参考图出了问题。 */
export const MIN_APPROVE_RATE_TO_TRUST = 0.02;
export const MIN_SAMPLE_FOR_RATE = 40;

export const PROMPT_VERSION = "deepseek-photo-auto-v1";
export const POLICY_VERSION = "auto-photo-2026-09-20-subject-v1";
/** 孕期 v1 提示词没有 sensitive 字段：它放行过的皮肤特写和裸露孕肚（Teddy 2026-09-27 撤下 12 月 5 张）。缓存里的 v1 结果只在「拒绝」时可沿用。 */
export const LEGACY_PREGNANCY_PROMPT_VERSION = "pregnancy-photo-v1";
export const PREGNANCY_PROMPT_VERSION = "pregnancy-photo-v2";
export const PREGNANCY_POLICY_VERSION = "auto-photo-2026-09-27-pregnancy-v2";
/**
 * 家庭生活分支（Teddy 2026-09-27：1 月除了大头照外生活场景不够多）：来源是自家、画面有信息的生活照也放行。
 * v2（Codex 复核 2026-09-27）：提示词里 family_care 不再包含「宝宝自己睡觉 / 睁眼 / 推车里」——那是人像，不是生活场景；
 * 单独一个孩子要靠主体判定的 reference_child=yes 才能进，且必须是有信息的环境（吃饭 / 出游 / 家 / 旅程 / 庆祝），不能是人像。
 * v1 的提示词与策略版本不再产生新结论；库里若有 v1 策略的放行行，视为过期（partitionReviewRows → staleApproved），按 v2 复核。
 */
export const LEGACY_FAMILY_POLICY_VERSIONS = Object.freeze(["auto-photo-2026-09-27-family-v1"]);
export const FAMILY_PROMPT_VERSION = "family-life-photo-v2";
export const FAMILY_POLICY_VERSION = "auto-photo-2026-09-27-family-v2";
/** 家庭生活分支认可的场景：吃饭、出游、居住环境、家人互动/照料、旅程、庆祝。人像（portrait）和无关物件（none）不算。 */
export const FAMILY_SCENES = Object.freeze(["meal", "outing", "home", "family_care", "travel", "celebration"]);
/** 提示词会给出的全部场景 / 人物取值；不在这里面的值是「未知」，不放行。 */
const KNOWN_SCENES = new Set([...FAMILY_SCENES, "portrait", "none"]);
const KNOWN_WHO = new Set(["baby_only", "baby_and_adult", "adults_only", "nobody"]);
/** 只有大人的照片：只有在这些场景里才算「有信息」；纯成人人像不放行（不能全放无关成人照）。 */
const ADULTS_ONLY_SCENES = new Set(["meal", "outing", "travel", "celebration"]);
/** 单独一个孩子（已由主体判定认出是张年）：只有这些「有环境信息」的场景才走家庭生活分支；人像和照料（一个人谈不上照料）不算。 */
const SOLE_CHILD_SCENES = new Set(["meal", "outing", "home", "travel", "celebration"]);
/** 敏感项的全部已知取值（不含 none）。字段缺失 / null / 空串 / 不认识的值都不是 none，一律不放行。 */
export const SENSITIVE_KINDS = Object.freeze(["skin_symptom", "bare_belly", "nudity_or_bath", "health", "finance", "identity_document"]);
const SENSITIVE_SET = new Set(SENSITIVE_KINDS);
const GOOD_QUALITY = new Set(["good", "ok"]);

const PREGNANCY_SENSITIVE_PRESET = { skin_symptom: "skin", bare_belly: "bare-belly", nudity_or_bath: "bath", health: "medical", finance: "finance", identity_document: "idcard" };

/**
 * 「敏感项」字段的三种读法：明确安全（=== "none"）、明确有问题（已知的敏感类别）、说不清（缺失 / null / 空 / 不认识）。
 * 说不清的不能当安全用——旧提示词漏字段、模型少答一个键，都会落到这里。
 */
export function readSensitive(value) {
  if (value === "none") return { safe: true };
  if (typeof value === "string" && SENSITIVE_SET.has(value)) return { safe: false, kind: value };
  return { safe: false, unknown: true };
}

/**
 * 孕期照片的识别结果 → 决定（配合 classifyPregnancyPhotos）。
 * 孕期档案不判"是不是张年"，判"是不是安全、有价值的孕期 / 家庭生活记录"。
 *
 * v2（2026-09-27）：皮肤症状特写、裸露孕肚明确排除；穿衣的孕肚、产检、B 超、待产准备、家人日常继续放行。
 * 放行必须每个字段都明确：sensitive === "none"，quality ∈ {good, ok}；缺失 / null / 空 / 不认识的值一律不放行。
 * v1 的结果缺 sensitive 字段：它的「拒绝」（截图 / 证件 / 风景物件 / 糊掉）与字段无关，可沿用；
 * 它的「放行」不能直接信任——返回 needs_human_review（why: legacy-no-sensitive-field），调用方按新版本重判。
 * @returns {{decision:"approved"|"store_only"|"needs_human_review", preset:string, why?:string}}
 */
export function decidePregnancyPhoto(r) {
  if (!r || r.error) return { decision: "needs_human_review", preset: "unclear", why: "model-error" };
  if (r.kind === "screenshot") return { decision: "store_only", preset: "shot" };
  if (r.kind === "document") return { decision: "store_only", preset: "doc" };
  if (r.kind === "scenery_object") return { decision: "store_only", preset: "object" };
  if (r.kind === "family_life" && r.quality === "poor") return { decision: "store_only", preset: "family_life:poor" };
  if (r.kind === "pregnancy" && r.quality === "poor") return { decision: "store_only", preset: `${r.subtype ?? "pregnancy"}:poor` };
  if (r.kind !== "pregnancy" && r.kind !== "family_life") return { decision: "store_only", preset: `${r.kind ?? "unknown"}:${r.quality ?? "unknown"}` };
  if (!("sensitive" in r)) return { decision: "needs_human_review", preset: "unclear", why: "legacy-no-sensitive-field" };
  const sensitive = readSensitive(r.sensitive);
  if (sensitive.unknown) return { decision: "needs_human_review", preset: "unclear", why: "sensitive-unknown" };
  if (!sensitive.safe) return { decision: "store_only", preset: PREGNANCY_SENSITIVE_PRESET[sensitive.kind] ?? `sensitive:${sensitive.kind}`, why: `sensitive:${sensitive.kind}` };
  if (!GOOD_QUALITY.has(r.quality)) return { decision: "needs_human_review", preset: "unclear", why: "quality-unknown" };
  if (r.kind === "pregnancy") return { decision: "approved", preset: r.subtype ?? "pregnancy" };
  // 妈妈孕期的日常也是孕期档案（Teddy 2026-09-26），只挡糊掉的。
  return { decision: "approved", preset: r.subtype ?? "family_life" };
}

/**
 * 库里的旧版放行（策略已过期）在本轮的最终结论。
 * 本轮成功重判（放行或拒绝）→ 用新结论，并写带新版本号的核验行（即使结论仍是放行）；
 * 取图失败 / 模型出错 / 拿不准 / 本轮没轮到 → 这一轮撤下（needs_human_review），拟写一条 needs_human_review 行，
 * 不能因为「库里已经是 approved」就继续显示一张没按新规则验过的照片（Codex 复核 2026-09-27）。
 * @param {{decision:string, preset:string, why?:string}|null} fresh  本轮的重判结果；null = 没判成
 * @param {string} [fallbackWhy]
 */
export function resolveStaleApproved(fresh, fallbackWhy = "not-judged") {
  if (!fresh || fresh.decision === "needs_human_review") return { decision: "needs_human_review", preset: "stale-unverified", why: `stale-unverified:${fresh?.why ?? fallbackWhy}` };
  return fresh;
}

/**
 * 库里已有的主体核验行是不是「人工锁」——不可被自动规则翻转。
 * 只有 provider ∈ {deepseek, glm} 的自动策略行可以按新规则重审（旧行保留，插入新行）；
 * manual / claude-code / claude-review、带 `manual:` 原因码、Teddy 点名的（prompt_version 以 teddy- 开头）一律锁死。
 * @param {{decision?:string, provider?:string, promptVersion?:string, reasonCodes?:unknown}|null} row
 */
export const AUTO_REVIEW_PROVIDERS = Object.freeze(["deepseek", "glm"]);
export function isLockedReview(row) {
  if (!row || !row.decision) return false;
  if (!AUTO_REVIEW_PROVIDERS.includes(String(row.provider ?? ""))) return true;
  if (String(row.promptVersion ?? "").startsWith("teddy-")) return true;
  const codes = Array.isArray(row.reasonCodes) ? row.reasonCodes : [];
  return codes.some((c) => String(c).startsWith("manual:"));
}

/**
 * 主体判定的 raw 结果，家庭生活分支能不能翻：截图 / 证件 / 拼图、任何敏感项、模型明确说是别的孩子，
 * 这些结论与「有没有生活场景」无关，分支不碰；返回 true 表示「不用再看」。
 */
export function subjectVerdictIsFinal(r) {
  if (!r || r.error) return false;
  if (decidePhoto(r).decision === "approved") return true;
  if (["document", "screenshot", "collage"].includes(r.kind)) return true;
  if (r.sensitive && r.sensitive !== "none") return true;
  if (r.child_present && r.reference_child === "no") return true;
  return false;
}

/** 证据对象里「不知道」的写法：字段留 null（不是 false、不是 "none"、不是 "nobody"）。decideFamilyLifePhoto 对 null 只会扣住，不会放行。 */
const bool = (v) => (typeof v === "boolean" ? v : null);
const str = (v) => (typeof v === "string" && v.length ? v : null);

/**
 * 旅程场景标签（data/photo-scene-tags.json，travel-scene-tags-v1）→ 家庭生活证据。标签是洛杉矶那段日子专用的
 * 固定选项（在哪里 / 在做什么 / 有谁），这里只做确定性映射，不看画面。
 *
 * 这套旧 schema 没有 commercial 字段，所以它给出的证据**只能用来拒绝**（人像 / 物件 / 糊掉 / 陌生人 / 敏感），
 * 不能放行——放行要走 family-life-photo-v2 提示词（六个安全字段齐全）。commercial 留 null 表示「不知道」。
 * 「只有宝宝」的睡觉 / 睁眼 / 看镜头 / 被抱着都是人像，不是生活场景；只有吃饭 / 风景 / 机场 / 车内这类环境信息才算场景。
 * @returns {null|{scene:string|null, who:string|null, quality:string, stranger_faces:boolean|null, commercial:null, sensitive:string|null, caption:string, basis:string, model?:string}}
 */
export function familyEvidenceFromTags(t) {
  if (!t || t.error || t.filtered || !t.promptVersion) return null;
  const who = { 只有宝宝: "baby_only", 宝宝和大人: "baby_and_adult", 只有大人: "adults_only", 没有人: "nobody" }[t.who] ?? null;
  const place = String(t.place ?? ""); const activity = String(t.activity ?? "");
  let scene;
  if (activity === "食物") scene = "meal";
  else if (activity === "风景") scene = "outing";
  else if (place === "机场") scene = "travel";
  else if (place === "车内" && who !== "nobody") scene = "travel";
  else if (who === "baby_and_adult" && ["被抱着", "喝奶", "和大人互动", "换尿布"].includes(activity)) scene = "family_care";
  else if (who === "adults_only" && place === "餐厅") scene = "meal";
  else if (who === "adults_only" && place === "户外") scene = "outing";
  else if (who === "nobody" && ["卧室", "客厅", "厨房"].includes(place) && activity !== "物品") scene = "home";
  else if (who === "nobody" || activity === "物品" || activity === "宠物") scene = "none";
  else scene = "portrait";
  const appeal = Number(t.appeal) || 0;
  const quality = t.sharp !== true ? "poor" : appeal >= 60 ? "good" : appeal >= 40 ? "ok" : "poor";
  return { scene, who, quality, stranger_faces: bool(t.stranger_faces), commercial: null, sensitive: str(t.sensitive), caption: String(t.caption ?? "").slice(0, 16), basis: String(t.promptVersion), model: t.model };
}

/**
 * 旅行风景判定（data/photo-scenery.json，travel-scenery-v1）→ 家庭生活证据。它不知道「有谁」、没有 commercial，
 * 所以同样**只能用来拒绝**（截图 / 证件 / 满屏文字 / 物件 / 糊掉 / 陌生人 / 敏感）；who 留 null，不推断成「没有人」。
 * kind=people（以成年人为主体）和 kind=child（有个孩子，但它既不能证明是张年、也说不出环境）都返回 null，交给模型。
 */
export function familyEvidenceFromScenery(s) {
  if (!s || s.error || s.filtered || !s.promptVersion) return null;
  const kind = String(s.kind ?? "");
  if (kind === "people" || kind === "child") return null;
  const scenic = Number(s.scenic) || 0;
  const sharp = s.sharp === true;
  const base = { who: null, stranger_faces: bool(s.stranger_faces), commercial: null, sensitive: str(s.sensitive), caption: String(s.caption ?? "").slice(0, 16), basis: String(s.promptVersion), model: s.model };
  if (kind === "screenshot" || kind === "document" || s.text_heavy === true) return { ...base, scene: "none", quality: sharp ? "ok" : "poor" };
  if (kind === "scenery" || kind === "landmark") return { ...base, scene: "outing", quality: !sharp ? "poor" : scenic >= 60 ? "good" : scenic >= 40 ? "ok" : "poor" };
  if (kind === "food") return { ...base, scene: "meal", quality: sharp ? "ok" : "poor" };
  if (kind === "indoor") return { ...base, scene: "home", quality: sharp ? "ok" : "poor" };
  return { ...base, scene: "none", quality: sharp ? "ok" : "poor" };
}

/** 家庭生活提示词（family-life-photo-v2）的原始结果 → 证据。六个键都要在；值原样带过去（类型不对的留 null），由 decideFamilyLifePhoto 逐项核对。 */
export function familyEvidenceFromModel(raw, model) {
  if (!raw || raw.error) return null;
  for (const k of ["scene", "who", "quality", "stranger_faces", "commercial", "sensitive"]) if (!(k in raw)) return null;
  return { scene: str(raw.scene), who: str(raw.who), quality: str(raw.quality), stranger_faces: bool(raw.stranger_faces), commercial: bool(raw.commercial), sensitive: str(raw.sensitive), caption: String(raw.caption ?? "").slice(0, 16), basis: FAMILY_PROMPT_VERSION, model };
}

/**
 * 家庭生活分支：主体规则没放行的照片（认不出是不是张年 / 只有大人 / 只有物件），若来源是自家的，
 * 且画面是有信息的生活场景（吃饭、出游、居住环境、家人互动/照料、旅程、庆祝），也放行。
 *
 * 放行的每个安全字段都要**明确**：sensitive === "none"、stranger_faces === false、commercial === false（真布尔值）、
 * quality ∈ {good, ok}、scene / who 是提示词里的已知值。缺失 / null / 空 / 不认识 → needs_human_review（evidence-incomplete:<字段>），
 * 调用方拿完整的证据（family-life-photo-v2）再来。明确的坏值 → store_only，这一步不需要证据完整，旧证据也能拒。
 *
 * 单独一个孩子（who=baby_only）：不能靠这个分支绕过身份——必须主体判定原始结果里 reference_child === "yes"，
 * 而且场景得有环境信息（meal / outing / home / travel / celebration）；睡觉 / 睁眼 / 哭 / 看镜头是人像，
 * 一个人也谈不上「照料」。身份没证明的 → needs_human_review（sole-child-identity-unproven），没有「不知道是谁的孩子」的通道。
 *
 * 不放行：来源不是自家、陌生人大脸、商品/截图/证件、任何敏感项（皮肤症状、裸露、医疗、证件）、糊掉的、纯成人人像、无关物件。
 * 主体判定已经给出的硬结论（截图/证件/拼图、敏感、模型说是别的孩子）这里不翻。
 * @param {object|null} r  主体判定 raw（库里的旧拒绝没有 raw → null）
 * @param {{ours:boolean, family:object|null}} ev  ours：family_photo 原片或爸爸/妈妈发的；family：上面三个 familyEvidenceFrom* 之一
 * @returns {{decision:"approved"|"store_only"|"needs_human_review", preset:string, why?:string}}
 */
export function decideFamilyLifePhoto(r, ev) {
  if (!ev?.ours) return { decision: "store_only", preset: "family:not-ours", why: "source-not-family" };
  if (r && !r.error) {
    if (["document", "screenshot", "collage"].includes(r.kind)) return { decision: "store_only", preset: `family:${r.kind}`, why: "subject-kind" };
    if ("sensitive" in r) {
      const s = readSensitive(r.sensitive);
      if (s.unknown) return { decision: "needs_human_review", preset: "unclear", why: "subject-sensitive-unknown" };
      if (!s.safe) return { decision: s.kind === "nudity_or_bath" || s.kind === "health" ? "needs_human_review" : "store_only", preset: "family:sensitive", why: `sensitive:${s.kind}` };
    }
    if (r.child_present && r.reference_child === "no") return { decision: "needs_human_review", preset: "unclear", why: "model-says-other-child" };
  }
  const f = ev.family;
  if (!f) return { decision: "needs_human_review", preset: "unclear", why: "no-family-evidence" };
  const hold = (field) => ({ decision: "needs_human_review", preset: "unclear", why: `evidence-incomplete:${field}` });
  // 先看明确的坏值（旧证据也能拒），再看字段是否齐全（不齐全的只扣住，不放行）。
  const sensitive = readSensitive(f.sensitive);
  if (!sensitive.safe && !sensitive.unknown) return { decision: "store_only", preset: "family:sensitive", why: `sensitive:${sensitive.kind}` };
  if (f.stranger_faces === true) return { decision: "store_only", preset: "family:strangers", why: "stranger-faces" };
  if (f.commercial === true) return { decision: "store_only", preset: "family:commercial", why: "commercial" };
  if (f.quality === "poor") return { decision: "store_only", preset: "family:poor", why: "poor-quality" };
  if (f.scene === "portrait" || f.scene === "none") return { decision: "store_only", preset: f.who === "adults_only" ? "adult" : f.who === "baby_only" ? "portrait" : "object", why: `scene:${f.scene}` };
  if (f.who === "adults_only" && KNOWN_SCENES.has(f.scene) && !ADULTS_ONLY_SCENES.has(f.scene)) return { decision: "store_only", preset: "adult", why: "adults-only-not-informative" };
  if (f.who === "baby_only" && f.scene === "family_care") return { decision: "store_only", preset: "portrait", why: "sole-child-not-care" };
  if (sensitive.unknown) return hold("sensitive");
  if (typeof f.stranger_faces !== "boolean") return hold("stranger_faces");
  if (typeof f.commercial !== "boolean") return hold("commercial");
  if (!GOOD_QUALITY.has(f.quality)) return hold("quality");
  if (!FAMILY_SCENES.includes(f.scene)) return hold("scene");
  if (!KNOWN_WHO.has(f.who)) return hold("who");
  if (f.who === "baby_only") {
    if (!SOLE_CHILD_SCENES.has(f.scene)) return { decision: "store_only", preset: "portrait", why: "sole-child-not-informative" };
    if (!(r?.child_present === true && r?.reference_child === "yes")) return { decision: "needs_human_review", preset: "unclear", why: "sole-child-identity-unproven" };
  }
  return { decision: "approved", preset: `family:${f.scene}`, why: f.basis };
}

/**
 * 库里已有的一条家庭生活放行行，是不是当前策略下、带着场景证据的：只有这样的行才在重跑时继续算「生活场景」
 * （首屏留位、场景精选不复用旧判断）。旧策略的家庭行、没有 label:family:<场景> 的行不算，免得把人像也当生活照计数。
 * @param {{decision?:string, policyVersion?:string, reasonCodes?:unknown}|null} row
 */
export function isFamilyApprovedRow(row) {
  if (!row || row.decision !== "approved" || row.policyVersion !== FAMILY_POLICY_VERSION) return false;
  const codes = Array.isArray(row.reasonCodes) ? row.reasonCodes.map(String) : [];
  if (!codes.includes("basis:auto-family-life-policy")) return false;
  return codes.some((c) => c.startsWith("label:family:") && FAMILY_SCENES.includes(c.slice("label:family:".length)));
}

/**
 * 把这个月库里的媒体行分成几类，重跑结果一样（同一份库、同一版策略 → 同一份分组）：
 *   locked        人工锁：不动、不插新行
 *   unjudged      没判过
 *   autoRejected  出生后、自动策略的拒绝 / 拿不准：可按家庭生活规则重审（旧行保留）
 *   held          出生前、自动策略的 needs_human_review（上一轮撤下的旧版放行）：本轮再试孕期 v2
 *   staleApproved 自动策略的放行，但策略版本已过期（出生前 ≠ 当前孕期策略；家庭生活分支 ≠ 当前家庭策略）：
 *                 本轮必须重验，验不成就撤下（resolveStaleApproved）
 * @param {Array<{id:string, day:string, decision?:string|null, provider?:string, promptVersion?:string, policyVersion?:string, reasonCodes?:unknown}>} rows
 * @param {{isPreBirth:(day:string)=>boolean}} p
 */
export function partitionReviewRows(rows, { isPreBirth }) {
  const out = { locked: [], unjudged: [], autoRejected: [], held: [], staleApproved: [] };
  for (const r of rows) {
    if (!r.decision) { out.unjudged.push(r); continue; }
    if (isLockedReview(r)) { out.locked.push(r); continue; }
    const pre = isPreBirth(r.day);
    if (r.decision === "approved") {
      const stale = pre ? r.policyVersion !== PREGNANCY_POLICY_VERSION : LEGACY_FAMILY_POLICY_VERSIONS.includes(String(r.policyVersion ?? ""));
      if (stale) out.staleApproved.push(r);
      continue;
    }
    if (pre) { if (r.decision === "needs_human_review") out.held.push(r); continue; }
    out.autoRejected.push(r);
  }
  return out;
}

/**
 * media-month --write 的安装闸：返回拒绝理由清单，空数组 = 可装。
 *   1. 页面同一套 schema 校验（validate = lib/month-content.ts validateMonthContent，由调用方传入，这里不引 TS）；
 *   2. 本轮新建的天正文不能空白；其他天也不能既没标题又没正文；
 *   3. 本轮撤下、没验过的旧版放行不能还挂在任何一天的媒体清单里（人工天的清单 media-month 不动，所以要查）。
 * @param {object} content  候选月内容
 * @param {string} month
 * @param {{newDays:Set<string>, staleUnresolved:Set<string>, validate:(c:object, m:string)=>unknown}} p
 */
export function installGate(content, month, { newDays, staleUnresolved, validate }) {
  const reasons = [];
  if (!validate(content, month)) reasons.push("validateMonthContent 不通过（schema / 天字段 / 首屏不是展开的子集）");
  const hasText = (d) => Array.isArray(d.paragraphs) && d.paragraphs.some((p) => typeof p === "string" && p.trim());
  const blank = (content?.days ?? []).filter((d) => (newDays.has(d.day) ? !hasText(d) : !d.title && !hasText(d)));
  if (blank.length) reasons.push(`正文空白的天不能装：${blank.map((d) => d.day).join(", ")}`);
  const kept = (content?.days ?? []).flatMap((d) => (d.expandedMediaIds ?? []).map((id) => ({ id, day: d.day }))).filter((x) => staleUnresolved.has(x.id));
  if (kept.length) reasons.push(`本轮撤下、没验过的旧版放行还在内容里：${kept.map((x) => `${x.day}/${String(x.id).slice(0, 24)}`).join(", ")}`);
  return reasons;
}

/**
 * 一张照片的识别结果 → 决定。
 * @returns {{decision:"approved"|"store_only"|"needs_human_review", preset:string, why?:string}}
 */
export function decidePhoto(r) {
  if (!r || r.error) return { decision: "needs_human_review", preset: "unclear", why: "model-error" };
  if (r.kind === "document") return { decision: "store_only", preset: r.sensitive === "health" ? "medical" : r.sensitive === "identity_document" ? "idcard" : "doc" };
  if (r.kind === "screenshot") return { decision: "store_only", preset: r.sensitive === "finance" ? "finance" : r.sensitive === "health" ? "medshot" : "shot" };
  if (r.kind === "object") return { decision: "store_only", preset: r.sensitive === "health" ? "healthobj" : "object" };
  if (r.kind === "collage") return { decision: "store_only", preset: "collage" };
  if (r.kind !== "life") return { decision: "needs_human_review", preset: "unclear", why: "unknown-kind" };
  if (!r.child_present) return { decision: "store_only", preset: "adult" };
  if (r.reference_child === "no") return { decision: "needs_human_review", preset: "unclear", why: "model-says-other-child" };
  if (r.reference_child !== "yes") return { decision: "needs_human_review", preset: "unclear", why: "reference-uncertain" };
  if (r.sensitive === "nudity_or_bath") return { decision: "needs_human_review", preset: "bath" };
  if (r.sensitive === "health") return { decision: "needs_human_review", preset: "clinic" };
  if (r.sensitive !== "none") return { decision: "needs_human_review", preset: "unclear", why: `sensitive:${r.sensitive}` };
  // 别的孩子入镜（班级合影等）：放行——只要上面认出了主孩子是张年。
  if (r.main_child_size === "small") return { decision: "needs_human_review", preset: "unclear", why: "small" };
  if (!r.face_visible) return { decision: "needs_human_review", preset: "back" };
  return { decision: "approved", preset: Number(r.children_count) >= 2 || r.other_children_identifiable ? "withkids" : "life" };
}

/**
 * 选今晚要看的照片：最近 LOOKBACK_DAYS 天、还没有任何主体核验、且没有被人工/历史留过「待人看」标记。
 * @param {{id:string, takenDay:string}[]} rows
 * @param {{today:string, seen:Record<string,any>, max?:number}} p
 */
export function pickPhotos(rows, { today, seen, max = MAX_PHOTOS_PER_RUN }) {
  const since = new Date(new Date(`${today}T00:00:00Z`).getTime() - LOOKBACK_DAYS * 86400e3).toISOString().slice(0, 10);
  return rows
    .filter((r) => r.takenDay >= since && !seen[r.id])
    .sort((a, b) => a.takenDay.localeCompare(b.takenDay) || a.id.localeCompare(b.id))
    .slice(0, max);
}

/** 这一晚的识别是否可信：样本够多而一张都没放行，多半是参考图或识图出了问题，不该把它写成「一批 store_only」。 */
export function batchLooksBroken(verdicts) {
  const life = verdicts.filter((v) => v && !v.error);
  if (verdicts.length >= MIN_SAMPLE_FOR_RATE && life.length / verdicts.length < 0.5) return { broken: true, why: `识别出错率过高（${verdicts.length - life.length}/${verdicts.length}）` };
  const approved = life.filter((v) => decidePhoto(v).decision === "approved").length;
  if (life.length >= MIN_SAMPLE_FOR_RATE && approved / life.length < MIN_APPROVE_RATE_TO_TRUST) return { broken: true, why: `${life.length} 张里放行 ${approved} 张，异常偏低` };
  return { broken: false };
}

/** 从一天的全部候选里均匀挑出至多 n 张（保持时间顺序），避免连拍挤满照片区。 */
export function spread(ids, n) {
  if (ids.length <= n) return [...ids];
  const out = [];
  for (let i = 0; i < n; i += 1) out.push(ids[Math.floor((i * ids.length) / n)]);
  return out;
}

/**
 * 把某一天的配图（第一张）换成 leadId。
 *
 * 为什么需要这个：月页上「被抬起来的那一天」用的大图，是 lib/month-day-weight.ts 的 pickLeadPhoto——
 * 它取 expandedMediaIds 里第一张合格的照片。而照片是按拍摄时间并进去的，第一张只是「这天最早拍的」，
 * 和这天的故事讲的是什么毫无关系。2026-09-18 就是这样：标题写「防空警报响起，小年抱住小脑袋趴下」，
 * 配图却是早上坐在玩具车里的一张（Teddy 2026-09-20 指出）。选哪张交给 DeepSeek（CLAUDE.md 的分工：
 * 选片与构图建议归 DeepSeek），这里只负责把它挪到最前面。
 *
 * 只挪位置，不删不加：这一天的照片一张都不会因为换封面而消失。
 */
export function applyLead(content, day, leadId) {
  const at = content.days.findIndex((d) => d.day === day);
  if (at < 0) return null;
  const cur = content.days[at];
  if (!cur.expandedMediaIds.includes(leadId)) return null;
  if (cur.expandedMediaIds[0] === leadId && cur.firstScreenMediaIds[0] === leadId) return null;
  const next = JSON.parse(JSON.stringify(content));
  const d = next.days[at];
  d.expandedMediaIds = [leadId, ...cur.expandedMediaIds.filter((id) => id !== leadId)];
  const first = cur.firstScreenMediaIds.filter((id) => id !== leadId);
  d.firstScreenMediaIds = [leadId, ...first].slice(0, Math.max(1, cur.firstScreenMediaIds.length || FIRST_SCREEN));
  return { content: next };
}

/**
 * 把新放行的照片并进某一天的照片区。只加不删、不改已有顺序：人（或之前的流程）挑过的照片原样保留。
 * @param {object} content   月内容（不改入参）
 * @param {string} day
 * @param {string[]} approvedIds  这一天全部已放行的照片，按拍摄时间排序
 * @returns {{content:object, added:string[]}|null}  这一天没有条目或没有新增 → null
 */
export function mergeDayMedia(content, day, approvedIds) {
  const at = content.days.findIndex((d) => d.day === day);
  if (at < 0) return null;
  const cur = content.days[at];
  const have = new Set(cur.expandedMediaIds);
  const fresh = approvedIds.filter((id) => !have.has(id));
  const room = Math.max(0, MAX_PER_DAY - cur.expandedMediaIds.length);
  // 已有的一张不动；新的从 fresh 里均匀取，不超过剩余名额
  const added = spread(fresh, room);
  if (!added.length) return null;
  const next = JSON.parse(JSON.stringify(content));
  const d = next.days[at];
  d.expandedMediaIds = [...cur.expandedMediaIds, ...added];
  if (!d.firstScreenMediaIds.length) d.firstScreenMediaIds = spread(d.expandedMediaIds, FIRST_SCREEN);
  return { content: next, added };
}
