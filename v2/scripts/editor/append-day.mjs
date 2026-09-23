// 把一天追加进月内容文件（纯函数，不读文件、不联网）。**只追加或替换这一天，绝不整体覆盖。**
//
// 为什么是按天追加：`YYYY-MM.json` 里已有的每一天都是人手编辑过、验收过的。整体重建（旧的
// build-content.mjs 就是这么做的）会抹掉这些手工编辑；按天追加则让「新的一天进来」这件事对已发布
// 的内容零风险——最坏的情况也只是这一天写得不好，而不是整个月被改坏。
//
// 输入的 entry 必须已经通过 validateDayText（scripts/editor/validate-day.mjs）；这里再做形状检查，
// 因为 lib/month-content.ts 的校验是「任何一天不合格，整月退回旧版式」——一天的形状错了，
// 代价是整个月的编辑稿从页面上消失，所以宁可在这里就拒绝。

const KINDS = new Set(["story", "visual-description", "text-only"]);
const DAY = /^\d{4}-\d{2}-\d{2}$/;

export function birthAge(birthDay, day) {
  const [by, bm, bd] = birthDay.split("-").map(Number);
  const [y, m, d] = day.split("-").map(Number);
  let months = (y - by) * 12 + (m - bm);
  if (d < bd) months -= 1;
  if (months < 0) return undefined;
  return `${Math.floor(months / 12)}岁${months % 12}个月`;
}

/**
 * @param {object} content   现有的月内容（会被深拷贝，不改入参）
 * @param {object} entry     {day,kind,title,paragraphs,sourceIds?,firstScreenMediaIds?,expandedMediaIds?,storyBoundMediaIds?,eventIds?,evidence?}
 *   evidence：validateDayText 返回的依据（每句引语的来源与发送人、每处点名的依据），原样存在这一天的 _evidence 上，
 *   页面不读它；验收和抽检读它。
 * @param {{birthDay:string, speakerBySourceId?:Record<string,string>, dataCutoff?:string, now?:string}} opts
 *
 * 人工编辑过的天（_source="human"，或者没有 _source——判断不出来源的一律按人工处理）**永远不覆盖**，
 * 返回 skipped=true。这里没有 force 开关：人工改过的字，机器没有任何办法覆盖它（Teddy 2026-09-23 硬约束）。
 * 9/19 批量生成的天要先经 mark-source.mjs 对着生成日志确认是机器写的，补上 _source:"machine"，才可替换。
 */
export function appendDay(content, entry, opts) {
  const month = content.month;
  if (!DAY.test(entry.day)) throw new Error(`日期格式不对：${entry.day}`);
  if (!entry.day.startsWith(`${month}-`)) throw new Error(`这一天 ${entry.day} 不属于 ${month}`);
  if (!KINDS.has(entry.kind)) throw new Error(`kind 不合法：${entry.kind}`);
  if (!(entry.title === null || (typeof entry.title === "string" && entry.title.trim()))) throw new Error("title 必须是非空字符串或 null");
  if (!Array.isArray(entry.paragraphs) || entry.paragraphs.some((p) => typeof p !== "string" || !p.trim())) throw new Error("paragraphs 必须是非空字符串数组");
  const expanded = entry.expandedMediaIds ?? [];
  const first = entry.firstScreenMediaIds ?? [];
  if (!first.every((id) => expanded.includes(id))) throw new Error("firstScreenMediaIds 必须是 expandedMediaIds 的开头子集");
  if (entry.title === null && entry.paragraphs.length === 0 && expanded.length === 0) throw new Error("一天既没有文字也没有照片");

  const next = JSON.parse(JSON.stringify(content));
  const day = {
    day: entry.day,
    ageLabel: birthAge(opts.birthDay, entry.day),
    kind: entry.kind,
    title: entry.title,
    paragraphs: entry.paragraphs,
    firstScreenMediaIds: first,
    expandedMediaIds: expanded,
    storyBoundMediaIds: entry.storyBoundMediaIds ?? [],
    eventId: entry.eventIds?.[0] ?? null,
    eventIds: entry.eventIds ?? [],
    sourceIds: entry.sourceIds ?? [],
    mergedEventCount: 0,
    pendingCount: 0,
    mediaNote: null,
    _source: "machine",
  };
  if (entry.evidence) day._evidence = entry.evidence;
  const at = next.days.findIndex((existing) => existing.day === entry.day);
  const replaced = at >= 0;
  if (replaced) {
    // 判断不出来源的一律当作人工内容保护。
    if (next.days[at]._source !== "machine") return { content: next, replaced: false, skipped: true, days: next.days.length };
    next.days[at] = day;
  } else {
    next.days.push(day);
  }
  next.days.sort((a, b) => a.day.localeCompare(b.day));

  // 新引用的消息要有称呼映射，否则资料区里会显示成匿名。只加不改：已有的映射一条都不动。
  next.speakerBySourceId = { ...(next.speakerBySourceId ?? {}) };
  for (const [id, label] of Object.entries(opts.speakerBySourceId ?? {})) if (!(id in next.speakerBySourceId)) next.speakerBySourceId[id] = label;

  if (opts.dataCutoff) next.dataCutoff = opts.dataCutoff;
  next.generatedAt = opts.now ?? new Date().toISOString();
  return { content: next, replaced, days: next.days.length };
}
