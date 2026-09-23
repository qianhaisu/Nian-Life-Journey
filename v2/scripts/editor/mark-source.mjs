// 给月内容文件里每一天补上 `_source`：这一天是机器写的，还是人工改过的。
//
// 为什么要补：append-day.mjs 的规则是「没有 _source 的天一律当人工内容保护」——判断不出来源就不覆盖，
// 这条规则本身是对的。可 2026-09-19 那一批（20 个月一次生成）写出来的时候还没有这个字段，于是所有旧内容
// 都被当成人工内容锁死，连校验器拦下的错误都改不动。
//
// 怎么判断（只认有记录的，不猜）：
//   machine — 这一天和「生成日志」里的某一版逐字相同：
//             ① 9/19 批量生成的产物（NianlifeOps\memory-tab-20260917\10-history-rollout\content\<月>.json）；
//             ② 夜间编辑的账（ops-daily\editor\ledger.jsonl 里 event=published，同一天、同一标题）；
//             ③ 有记录的机器修订（knownMachineRevisions：修订前后两版都在备份里，并且在 docs/STATUS.md 留了账）。
//   human   — 已经带着 _source:"human"。
//   unknown — 和任何一版生成记录都对不上，又没有标记：**按人工处理，保护**，并列出来交给人看。
// 只写 machine；unknown 不写任何标记（保持「没有标记 = 保护」）。

/** 比较时只看会显示在页面上的字段；ageLabel、generatedAt 这类派生字段不算人工改动。 */
export function dayFingerprint(day) {
  return JSON.stringify({
    kind: day.kind,
    title: day.title ?? null,
    paragraphs: day.paragraphs ?? [],
    firstScreenMediaIds: day.firstScreenMediaIds ?? [],
    expandedMediaIds: day.expandedMediaIds ?? [],
  });
}

/**
 * @param {object} current                  线上正在用的月内容
 * @param {object} p
 * @param {object[]} p.generated            生成记录：[{label, content}]，每一份都是某次机器生成/修订的完整月内容
 * @param {{day:string,title:string}[]} [p.ledgerPublished]  夜间编辑发布过的天
 * @returns {{content:object, stats:{machine:number,human:number,unknown:number}, days:{day:string,source:string,basis:string}[]}}
 */
export function classifyDays(current, { generated = [], ledgerPublished = [] }) {
  const next = JSON.parse(JSON.stringify(current));
  const stats = { machine: 0, human: 0, unknown: 0 };
  const days = [];
  const byDay = new Map();
  for (const g of generated) for (const d of g.content?.days ?? []) {
    if (!byDay.has(d.day)) byDay.set(d.day, []);
    byDay.get(d.day).push({ label: g.label, fp: dayFingerprint(d) });
  }
  for (const d of next.days) {
    if (d._source === "human") { stats.human += 1; days.push({ day: d.day, source: "human", basis: "已标记" }); continue; }
    if (d._source === "machine") { stats.machine += 1; days.push({ day: d.day, source: "machine", basis: d._sourceBasis ?? "已标记" }); continue; }
    const fp = dayFingerprint(d);
    const hit = (byDay.get(d.day) ?? []).find((g) => g.fp === fp);
    const ledger = ledgerPublished.find((l) => l.day === d.day && l.title === d.title);
    if (hit || ledger) {
      d._source = "machine";
      d._sourceBasis = hit ? hit.label : "nightly-editor ledger";
      stats.machine += 1;
      days.push({ day: d.day, source: "machine", basis: d._sourceBasis });
    } else {
      stats.unknown += 1;
      days.push({ day: d.day, source: "unknown", basis: "与所有生成记录都对不上，按人工处理" });
    }
  }
  return { content: next, stats, days };
}
