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
export const PREGNANCY_PROMPT_VERSION = "pregnancy-photo-v1";
export const PREGNANCY_POLICY_VERSION = "auto-photo-2026-09-26-pregnancy-v1";

/**
 * 孕期照片的识别结果 → 决定（配合 classifyPregnancyPhotos）。
 * 孕期档案不判"是不是张年"，判"是不是有价值的孕期记录"。
 * @returns {{decision:"approved"|"store_only"|"needs_human_review", preset:string, why?:string}}
 */
export function decidePregnancyPhoto(r) {
  if (!r || r.error) return { decision: "needs_human_review", preset: "unclear", why: "model-error" };
  if (r.kind === "screenshot") return { decision: "store_only", preset: "shot" };
  if (r.kind === "document") return { decision: "store_only", preset: "doc" };
  if (r.kind === "scenery_object") return { decision: "store_only", preset: "object" };
  if (r.kind === "pregnancy" && r.quality !== "poor") return { decision: "approved", preset: r.subtype ?? "pregnancy" };
  // 妈妈孕期的日常也是孕期档案（Teddy 2026-09-26），只挡糊掉的。
  if (r.kind === "family_life" && r.quality !== "poor") return { decision: "approved", preset: r.subtype ?? "family_life" };
  if (r.kind === "family_life") return { decision: "store_only", preset: "family_life:poor" };
  return { decision: "store_only", preset: `${r.kind ?? "unknown"}:${r.quality ?? "unknown"}` };
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
