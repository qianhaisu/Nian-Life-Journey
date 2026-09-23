// 把「审核通过、但还没出现在任何月页上」的 life_event 补进月内容文件——决策层（纯函数）。
//
// 为什么需要：月内容文件 2026-09-19 批量生成过一次，之后 Organizer 新整理出的故事再也没进过页面
// （第三轮查明 812 条 life_events 不可见，其中 423 条是 9/19 之后才生成的）。夜间编辑只追加「还没有内容的新日子」，
// 不会回头把新事件放进已经写好的那一天。
//
// 每条事件的去向（按顺序判，先命中先算）：
//   skip:prebirth        出生前
//   skip:editorial       9/19 编辑读过并写明了不写的理由（droppedEvents）——尊重当时的判断，不自动翻案
//   skip:not-approved    审核结论不是 approved（needs_human_review 等 /inbox 审阅；store_only/rejected 不上页面）
//   attach               当天内容已经引用了它一半以上的来源消息（按「秒 + 文本」比，不看 id）：
//                        只把事件 id 挂到那一天，不重写文字
//   rewrite              那一天已有内容、是机器写的：带着新事件重写这一天（过全部校验）
//   new-day              那一天还没有内容：新写一天
//   blocked:protected    那一天是人工编辑的（或来源不明）：不碰，留给人看
// 一天里有多条事件时合并成一次重写，不会同一天重写好几遍。

export const BIRTH_DAY = "2025-01-03";
export const MAX_NEW_MEDIA_PER_EVENT = 6;
export const MAX_DAY_MEDIA = 30;

/**
 * @param {object} p
 * @param {{id:string, day:string, review:string|null, mediaIds?:string[], sourceKeys?:string[]}[]} p.events  不可见的事件
 * @param {Map<string, object>} p.contents   月份 → 月内容
 * @param {Set<string>} [p.editorialDropped] 9/19 编辑写明不写的事件 id
 * @param {Map<string, Set<string>>} [p.citedKeysByDay]  每一天内容已引用的来源消息的「秒+文本」键
 * @returns {{decisions:{id:string, day:string, action:string}[], days:{day:string, month:string, action:"attach"|"rewrite"|"new-day", eventIds:string[], mediaIds:string[]}[]}}
 */
export function planBackfill({ events, contents, editorialDropped = new Set(), citedKeysByDay = new Map() }) {
  const decisions = [];
  const byDay = new Map();
  for (const e of events) {
    const month = e.day.slice(0, 7);
    const content = contents.get(month);
    const existing = content?.days.find((d) => d.day === e.day) ?? null;
    let action;
    if (e.day < BIRTH_DAY) action = "skip:prebirth";
    else if (editorialDropped.has(e.id)) action = "skip:editorial";
    else if (e.review !== "approved") action = "skip:not-approved";
    else if (existing && existing._source !== "machine") action = "blocked:protected";
    else if (existing && covered(e.sourceKeys, citedKeysByDay.get(e.day))) action = "attach";
    else action = existing ? "rewrite" : "new-day";
    decisions.push({ id: e.id, day: e.day, action });
    if (!["attach", "rewrite", "new-day"].includes(action)) continue;
    if (!byDay.has(e.day)) byDay.set(e.day, { day: e.day, month, actions: new Set(), eventIds: [], mediaIds: [] });
    const slot = byDay.get(e.day);
    slot.actions.add(action);
    slot.eventIds.push(e.id);
    if (action !== "attach") for (const m of (e.mediaIds ?? []).slice(0, MAX_NEW_MEDIA_PER_EVENT)) if (!slot.mediaIds.includes(m)) slot.mediaIds.push(m);
  }
  const days = [...byDay.values()].sort((a, b) => a.day.localeCompare(b.day)).map((s) => ({
    day: s.day, month: s.month,
    // 同一天只要有一条需要重写，整天就重写一次（被 attach 的事件也一起挂上）。
    action: s.actions.has("new-day") ? "new-day" : s.actions.has("rewrite") ? "rewrite" : "attach",
    eventIds: s.eventIds, mediaIds: s.mediaIds,
  }));
  return { decisions, days };
}

function covered(keys, cited) {
  if (!keys?.length || !cited) return false;
  return keys.filter((k) => cited.has(k)).length / keys.length >= 0.5;
}

/**
 * 重写/新写一天时交给 day-writer 的目标：旧的照片在前，新事件的照片接在后面（封顶），事件 id 取并集。
 * 新的一天首屏取前三张。
 */
export function dayTarget(existing, slot, { ageLabel } = {}) {
  const oldExpanded = existing?.expandedMediaIds ?? [];
  const expanded = [...oldExpanded, ...slot.mediaIds.filter((m) => !oldExpanded.includes(m))].slice(0, MAX_DAY_MEDIA);
  const first = existing?.firstScreenMediaIds?.length ? existing.firstScreenMediaIds : expanded.slice(0, 3);
  return {
    day: slot.day,
    ageLabel: existing?.ageLabel ?? ageLabel,
    eventIds: [...new Set([...(existing?.eventIds ?? []), ...slot.eventIds])],
    expandedMediaIds: expanded,
    firstScreenMediaIds: first,
  };
}

/** attach：只把事件 id 挂到这一天，文字、照片一概不动。机器写的天才挂；返回新月内容。纯函数。 */
export function attachEvents(content, day, eventIds) {
  const next = JSON.parse(JSON.stringify(content));
  const d = next.days.find((x) => x.day === day);
  if (!d) throw new Error(`${day} 不在这个月的内容里`);
  if (d._source !== "machine") throw new Error(`${day} 是受保护的天，不挂事件`);
  d.eventIds = [...new Set([...(d.eventIds ?? []), ...eventIds])];
  if (!d.eventId) d.eventId = d.eventIds[0] ?? null;
  return next;
}
