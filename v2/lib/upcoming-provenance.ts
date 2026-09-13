// 首页待办 · family 安全来源投影。
//
// 一条待办出现在家人面前时，家人合理会问两件事：这是谁提的，以及它后来怎么样了。回答这两个问题
// 需要来源——但**原始聊天不能上首页**。所以这一层做的是：把内部证据换成一句经审核的摘要，
// 并在类型上挡住四种会出事的情况。
//
//   1. 角色只能来自成员表。未命中就是 `unconfirmed`，**不猜「老师」「妈妈」**。
//      猜错的代价不是难看，是把一句话安到一个没说过它的人嘴里。
//   2. 摘要只表达来源实际支持的内容，并保留语气。「要带去看医生吗」是疑问，
//      「周末想去泡汤」是计划，「如果还有鼻涕就吃药」是条件，「老师说他没哭」是转述。
//      语气丢了，一句讨论就会变成一件已定的事。
//   3. 提出依据与完成依据分开，且**完成摘要不能从提出来源里生成**。
//      「准备带去」证明不了「已经带到了」。
//   4. 缺字段不等于没来源。摘要还没审是 `pending_review`，
//      真的没有变更证据是 `noChangeEvidence: true`——页面必须能分清这两件事。
import type { UpcomingItemRecord } from "./upcoming-contract";

/** 谁提的。角色只有三种可能，没有第四种「大概是」。 */
export type UpcomingSourceRole =
  /** 成员表确认过的人。`role` 是 family-registry 的 narrativeLabel。 */
  | { kind: "family_member"; role: string }
  /** 不是聊天提出的：总指挥创建的档案核对提醒之类。写真实来源性质，不虚构聊天提出者。 */
  | { kind: "record_check"; label: string }
  /** 来源人物未确认。**页面必须显示成「来源人物未确认」，不得省略、更不得填一个名字。** */
  | { kind: "unconfirmed" };

/** 来源实际支持的语气。摘要必须与它一致。 */
export type UpcomingModality = "statement" | "question" | "plan" | "condition" | "relayed";

export type UpcomingSourceNote = {
  role: UpcomingSourceRole;
  modality: UpcomingModality;
  /** 经审核的一句话。不是聊天原文，也不含原始 id、路径。 */
  summary: string;
  /** 依据日期：这句话是哪天说的。 */
  onDay: string;
  /** 能明确区分时，事情实际发生在哪天。分不清就不给——**不伪造**。 */
  happenedOn?: string;
};

export type UpcomingProvenance = {
  itemId: string;
  /** `pending_review` = 摘要还没经总指挥审核。**这不是「没有来源」**，页面要照实说。 */
  reviewState: "approved" | "pending_review";
  raised?: UpcomingSourceNote;
  completed?: UpcomingSourceNote;
  rescheduled?: UpcomingSourceNote;
  cancelled?: UpcomingSourceNote;
  /** 这条事项**确实**没有任何变更证据。与 `pending_review` 分开，两者含义完全不同。 */
  noChangeEvidence: boolean;
};

/** 一条待审／已审的摘要。审核前后形状一样，只有 `approved` 变。 */
export type CuratedNote = Omit<UpcomingSourceNote, "role"> & {
  role: UpcomingSourceRole;
  approved: boolean;
};

export type CuratedProvenance = {
  itemId: string;
  raised?: CuratedNote;
  completed?: CuratedNote;
  rescheduled?: CuratedNote;
  cancelled?: CuratedNote;
};

/** 原始消息 id、内部路径、内部键的形状。任何一个出现在 family payload 里都是漏。 */
const LEAKS: Array<{ re: RegExp; what: string }> = [
  { re: /wechat-message:/i, what: "原始消息 id" },
  { re: /wechat-media:/i, what: "媒体 id" },
  { re: /media-asset:/i, what: "媒体资产 id" },
  { re: /event-[a-z0-9]{2,}-/i, what: "事件 id" },
  { re: /upcoming-[0-9a-f]{8,}/i, what: "内部事项 id" },
  { re: /commander:/i, what: "内部来源键" },
  // A Windows path has ONE backslash after the drive letter; `\\\\` here would only match two.
  { re: /[A-Za-z]:[\\/]/, what: "本机路径" },
  { re: /\/api\/|\/lib\/|\.mjs|\.ts\b/i, what: "内部路径" },
];

export function findLeaks(value: unknown): string[] {
  const text = JSON.stringify(value ?? "");
  return LEAKS.filter((l) => l.re.test(text)).map((l) => l.what);
}

/**
 * 一句摘要能不能上 family。拒绝的三种：带内部标识、空、或者**和某条来源原文一模一样**
 * （那等于把聊天原文搬上首页，只是换了个字段名）。
 */
export function noteProblems(note: CuratedNote, sourceTexts: string[]): string[] {
  const problems: string[] = [];
  const summary = note.summary?.trim() ?? "";
  if (!summary) problems.push("摘要为空");
  problems.push(...findLeaks(summary).map((w) => `摘要里有${w}`));
  const norm = (s: string) => s.replace(/\s+/g, "").replace(/[\\[\\]（）()，。、！？!?,.]/g, "");
  if (summary && sourceTexts.some((t) => norm(t) && norm(t) === norm(summary))) {
    problems.push("摘要与来源原话逐字相同——那是把聊天原文搬上首页");
  }
  if (!note.onDay || !/^\d{4}-\d{2}-\d{2}$/.test(note.onDay)) problems.push("依据日期缺失或格式不对");
  if (note.happenedOn && !/^\d{4}-\d{2}-\d{2}$/.test(note.happenedOn)) problems.push("实际发生日期格式不对");
  if (note.role.kind === "family_member" && !note.role.role.trim()) problems.push("角色是成员但没有名字");
  if (note.role.kind === "record_check" && !note.role.label.trim()) problems.push("非聊天来源没有写来源性质");
  return problems;
}

/**
 * 组装一条事项的 family 来源投影。
 *
 * 只有 `approved` 的摘要会出去；任何一条没审，整条事项就是 `pending_review`——
 * 宁可页面说「来源摘要待审核」，也不要露出半截。
 *
 * `noChangeEvidence` 直接看记录本身有没有变更行，**不看摘要有没有写**：
 * 没人写摘要和真的没有变更，是两件事。
 */
export function buildUpcomingProvenance(
  record: Pick<UpcomingItemRecord, "id" | "changes" | "status">,
  curated: CuratedProvenance | undefined,
): UpcomingProvenance {
  const noChangeEvidence = record.changes.filter((c) => c.change !== "restated").length === 0;
  if (!curated?.raised) return { itemId: record.id, reviewState: "pending_review", noChangeEvidence };

  const notes = [curated.raised, curated.completed, curated.rescheduled, curated.cancelled].filter(Boolean) as CuratedNote[];
  if (notes.some((n) => !n.approved)) return { itemId: record.id, reviewState: "pending_review", noChangeEvidence };

  const strip = (n?: CuratedNote): UpcomingSourceNote | undefined =>
    n ? { role: n.role, modality: n.modality, summary: n.summary.trim(), onDay: n.onDay, happenedOn: n.happenedOn } : undefined;

  return {
    itemId: record.id,
    reviewState: "approved",
    raised: strip(curated.raised),
    // 完成／改期／取消的摘要只有在记录里真有对应变更时才给出。
    completed: record.changes.some((c) => c.change === "done") ? strip(curated.completed) : undefined,
    rescheduled: record.changes.some((c) => c.change === "rescheduled") ? strip(curated.rescheduled) : undefined,
    cancelled: record.changes.some((c) => c.change === "cancelled") ? strip(curated.cancelled) : undefined,
    noChangeEvidence,
  };
}

/** 出库前最后一道：整个 payload 里不许有任何内部标识。 */
export function assertFamilySafeProvenance(items: UpcomingProvenance[]): void {
  const leaks = findLeaks(items.map((i) => ({ ...i, itemId: undefined })));
  if (leaks.length) throw new Error(`family provenance payload leaks: ${leaks.join(", ")}`);
}
