// 按新规则重写一个月里「机器写的」那些天（_source:"machine"），人工编辑的天一个字不动。
//
//   node --import tsx scripts/editor/regen-month.mjs --month=2025-12 --base=<当前线上内容的本地副本> --out=<目录>
//     [--days=2025-12-04,2025-12-13]  只重写这几天
//     [--concurrency=4]
//
// 只产出候选文件，不装入生产：装入走 deploy-ecs-public.sh content-install（装之前先备份线上文件）。
// 每一天的写法与校验见 day-writer.mjs；3 稿都不过，这一天保持原样并记入 failed。
// 照片保持已选的那一组；画面描述复用 DeepSeek 已有的识图结果，不重新识图。
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { appendDay } from "./append-day.mjs";
import { createDayWriter, rebuildSpeakers } from "./day-writer.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const BIRTH_DAY = "2025-01-03";
const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

/** 通过的天替换进月内容；照片、事件沿用旧的那一天。失败/跳过的天原样保留。纯函数。 */
export function applyRewrites(base, results, { now = new Date().toISOString(), basis = `regen-round3-${now.slice(0, 10)}` } = {}) {
  let next = JSON.parse(JSON.stringify(base));
  for (const r of [...results].sort((a, b) => a.day.localeCompare(b.day))) {
    if (!r.ok || r.skip) continue;
    const old = next.days.find((x) => x.day === r.day);
    const res = appendDay(next, {
      day: r.day, kind: r.decision.kind, title: r.decision.title, paragraphs: r.decision.paragraphs.map((p) => p.text),
      sourceIds: [...new Set([...r.sourceIds, ...(old?.sourceIds ?? [])])],
      firstScreenMediaIds: r.firstScreenMediaIds ?? old?.firstScreenMediaIds ?? [], expandedMediaIds: r.expandedMediaIds ?? old?.expandedMediaIds ?? [],
      storyBoundMediaIds: old?.storyBoundMediaIds ?? [], eventIds: r.eventIds ?? old?.eventIds ?? [], evidence: r.evidence,
    }, { birthDay: BIRTH_DAY, now });
    if (res.skipped) throw new Error(`${r.day} 是受保护的天，不能被重写`);
    next = res.content;
    const day = next.days.find((x) => x.day === r.day);
    day._sourceBasis = r.basis ?? basis;
    for (const k of ["mergedEventCount", "pendingCount", "mediaNote"]) if (old && k in old) day[k] = old[k];
  }
  return next;
}

async function main() {
  const MONTH = arg("month"), BASE = arg("base"), OUT = arg("out");
  const ONLY = (arg("days") ?? "").split(",").filter(Boolean);
  const CONCURRENCY = Number(arg("concurrency") ?? 4);
  if (!MONTH || !BASE || !OUT) { console.error("用法：--month=YYYY-MM --base=<file> --out=<dir>"); process.exit(2); }
  const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
  const realNames = JSON.parse(fs.readFileSync(path.join(OPS, "real-names.private.json"), "utf8")).names;
  const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
  const rds = await openRds({ localPort: 15500 + Math.floor(Math.random() * 100), readOnly: true });
  try {
    const writeDay = createDayWriter({ rds, outDir: OUT, realNames });
    const targets = base.days.filter((d) => d._source === "machine" && (!ONLY.length || ONLY.includes(d.day)));
    const protectedDays = base.days.filter((d) => d._source !== "machine").map((d) => d.day);
    say(`${MONTH}：要重写 ${targets.length} 天；受保护（人工/来源不明）${protectedDays.length} 天：${protectedDays.join(" ") || "无"}`);
    const results = [];
    const queue = [...targets];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const r = await writeDay(queue.shift());
        say(`[${r.day}] ${r.ok ? (r.skip ? `跳过：${r.skip}` : `通过（第 ${r.attempts.length} 稿）「${r.decision.title}」`) : `失败：${(r.errors ?? []).slice(0, 3).join("；")}`}`);
        results.push(r);
      }
    }));
    const next = applyRewrites(base, results);
    next.speakerBySourceId = await rebuildSpeakers(rds, next);
    fs.writeFileSync(path.join(OUT, `${MONTH}.candidate.json`), JSON.stringify(next, null, 1), "utf8");
    const summary = { month: MONTH, at: new Date().toISOString(), rewritten: results.filter((r) => r.ok && !r.skip).map((r) => r.day), failed: results.filter((r) => !r.ok).map((r) => r.day), skipped: results.filter((r) => r.skip).map((r) => r.day), protected: protectedDays, costUsd: Number(writeDay.cost().toFixed(3)) };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1), "utf8");
    say(`完成：重写 ${summary.rewritten.length}，失败 ${summary.failed.length}（${summary.failed.join(" ")}），花费约 $${summary.costUsd}`);
  } finally { await rds.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(3); });
