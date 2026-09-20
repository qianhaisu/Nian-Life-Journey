// 每周提醒的「自动批准」决策层：纯函数，不读库、不写库、不联网。
//
// 背景（2026-09-20）：首页「每周提醒」为空，因为 9/17 之后没有任何提取批次覆盖新消息，而提取出来的待办按
// 产品规则要先经人工批准才显示（lib/upcoming.ts）。Teddy 2026-09-20 明确决定：要真正的全自动，产品判断选
// 「夜里提取 + 夜里批准」。这里就是「夜里批准」——只有一处不动摇：
//
//   提取器 mergeUpcomingCandidates 永远不写 review_decision（lib/db/upcoming-store.ts 明写：一次重跑
//   不能批准任何东西，也不能撤销批准）。批准由另一个函数 setUpcomingReviewDecision 做，且只改审核这一列。
//   所以「批准」是一个单独的、可审计的步骤，不是提取的副作用——本文件决定这一步对哪些条目做。
//
// 自动批准仍然要过的机械兜底（宁可多留几条等人看，不可让明显不该上首页的内容直接上去）：
//   - 只批准「本次运行新建/更新的、仍是 needs_human_review」的条目——绝不碰人已经批准或驳回的；
//   - 标题为空、或状态不认识的，不批准；
//   - 命中敏感兜底（钱款/排泄/争执/伤痕/证件号）的，不批准，留给人看；
//   - 每晚最多批准 MAX_AUTO_APPROVALS 条：一次批准几十条几乎一定是提取器出了岔子，不是家里突然有几十件事。
// 日期不会在这里被「编」：提取器合同规定解析不出就存 unconfirmed + 原话（lib/upcoming-contract.ts），
// 批准不改日期、不改状态、不改证据。
import { sensitiveHits } from "./plan.mjs";

/** 一晚最多自动批准几条。超过就一条都不批，整批留给人——数量异常本身就是要看的信号。 */
export const MAX_AUTO_APPROVALS = 25;
export const AUTO_REVIEWER = "auto-nightly";

const KNOWN_STATUS = new Set(["open", "tentative", "done", "rescheduled", "cancelled"]);

/**
 * @param {Array<{id:string,title:string,status:string,note?:string,reviewDecision:string,extractionBatchId:string}>} rows
 * @param {string} batchId 本次提取运行的批次 id
 * @returns {{approve:string[], hold:{id:string,reason:string}[], tooMany:boolean}}
 */
export function pickAutoApprovals(rows, batchId) {
  const hold = [];
  const candidates = [];
  for (const row of rows) {
    if (row.extractionBatchId !== batchId) continue;          // 不是这一批的不碰
    if (row.reviewDecision !== "needs_human_review") continue; // 人批过/驳回过的绝不碰
    if (!row.title || !String(row.title).trim()) { hold.push({ id: row.id, reason: "标题为空" }); continue; }
    if (!KNOWN_STATUS.has(row.status)) { hold.push({ id: row.id, reason: `状态不认识：${row.status}` }); continue; }
    const hits = sensitiveHits({ title: row.title, paragraphs: [row.note ?? ""] });
    if (hits.length) { hold.push({ id: row.id, reason: `命中敏感兜底：${hits.map((h) => h.category).join("、")}` }); continue; }
    candidates.push(row.id);
  }
  if (candidates.length > MAX_AUTO_APPROVALS) {
    return { approve: [], hold: [...hold, ...candidates.map((id) => ({ id, reason: `一晚 ${candidates.length} 条超过上限 ${MAX_AUTO_APPROVALS}，整批留给人` }))], tooMany: true };
  }
  return { approve: candidates, hold, tooMany: false };
}
