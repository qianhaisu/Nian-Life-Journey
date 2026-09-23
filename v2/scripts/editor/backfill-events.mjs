// 把「审核通过、但还不在任何月页上」的 life_event 自动补进月内容文件。决策见 backfill-plan.mjs，写法与校验见 day-writer.mjs。
//
//   node --import tsx scripts/editor/backfill-events.mjs                         # dry-run：出计划与候选文件，不碰生产
//   node --import tsx scripts/editor/backfill-events.mjs --months=2025-12        # 只看这几个月
//   NIANLIFE_BACKFILL_PUBLISH=1 node --import tsx scripts/editor/backfill-events.mjs   # 通过校验的装入生产
//
// 每晚在夜间编辑之后跑（nightly-editor.cmd）。装入前把线上文件备份到 NianlifeOps\content-backups\<日期>-backfill\，
// 装入走 deploy-ecs-public.sh content-install（版本化 + 原子替换，可 content-rollback）。
// 受保护的天（人工/来源不明）一个字不碰；某一天 3 稿都没过校验，这一天保持原样，下一晚再试，连续 3 晚失败就 hold。
// 每条事件的去向都记进 NianlifeOps\ops-daily\editor\backfill-ledger.jsonl。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { planBackfill, dayTarget, attachEvents, BIRTH_DAY } from "./backfill-plan.mjs";
import { createDayWriter, rebuildSpeakers } from "./day-writer.mjs";
import { applyRewrites } from "./regen-month.mjs";
import { birthAge } from "./append-day.mjs";
import { afterFailure } from "./plan.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const ED = path.join(OPS, "editor");
const HISTORY = "C:/Users/teddy/NianlifeOps/memory-tab-20260917/10-history-rollout/months";
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const ECS = { ssh: process.env.ECS_SSH ?? "ecs-user@47.99.243.155", key: process.env.ECS_KEY ?? "C:/Users/teddy/Downloads/nianlife-prod-ecs.pem" };
const PUBLISH = process.env.NIANLIFE_BACKFILL_PUBLISH === "1";
const STAMP = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
const OUT = arg("out") ?? path.join(ED, "backfill", STAMP);
const CONCURRENCY = Number(arg("concurrency") ?? 4);
const MAX_DAYS = Number(arg("max-days") ?? 60); // 单次运行最多写几天：限制出错面，积压的分几晚消化
const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };
const ledger = (o) => fs.appendFileSync(path.join(ED, "backfill-ledger.jsonl"), JSON.stringify({ at: new Date().toISOString(), publish: PUBLISH, ...o }) + "\n");

function fetchMonth(month, dest) {
  const r = spawnSync("scp", ["-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ECS.key, `${ECS.ssh}:/srv/nianlife-content/${month}.json`, dest], { encoding: "utf8" });
  return r.status === 0 ? JSON.parse(fs.readFileSync(dest, "utf8")) : null;
}
function install(month, file) {
  const bash = process.env.NIANLIFE_BASH ?? "C:/Program Files/Git/bin/bash.exe";
  const r = spawnSync(bash, [path.join(REPO_V2, "scripts/deploy-ecs-public.sh"), "content-install", month, file], { encoding: "utf8", env: { ...process.env, ECS_SSH: ECS.ssh, ECS_KEY: ECS.key, ECS_PUBLIC_IP: "47.99.243.155" } });
  const m = (r.stdout ?? "").match(/CONTENT_VERSION=(\S+)/);
  return r.status === 0 && m ? { ok: true, version: m[1] } : { ok: false, error: (r.stderr || r.stdout || "").slice(-300) };
}
/** 9/19 编辑写明「不写」的事件：尊重当时的判断，不自动翻案。 */
function editorialDropped() {
  const out = new Set();
  if (!fs.existsSync(HISTORY)) return out;
  for (const m of fs.readdirSync(HISTORY)) {
    const s = readJson(path.join(HISTORY, m, "stories.json"), null);
    if (!s) continue;
    for (const d of s.days ?? []) for (const e of d.droppedEvents ?? []) out.add(e.id);
    for (const e of s.skippedDayDroppedEvents ?? []) out.add(e.id);
    for (const sd of s.skippedDays ?? []) for (const e of sd.droppedEvents ?? []) out.add(e.id);
  }
  return out;
}

async function main() {
  fs.mkdirSync(path.join(OUT, "current"), { recursive: true });
  const realNames = readJson(path.join(OPS, "real-names.private.json"), { names: [] }).names;
  const stateFile = path.join(ED, "backfill-state.json");
  const state = readJson(stateFile, {});
  const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
  const rds = await openRds({ localPort: 15550 + Math.floor(Math.random() * 100), readOnly: true });
  const summary = { at: new Date().toISOString(), publish: PUBLISH, months: {} };
  try {
    // 1. 线上的月内容（生产上实际在用的那一份）
    const allMonths = (await rds.client.query(`select distinct to_char(occurred_at,'YYYY-MM') m from life_events where occurred_at >= $1::date order by 1`, [BIRTH_DAY])).rows.map((r) => r.m);
    const months = (arg("months") ?? "").split(",").filter(Boolean);
    const contents = new Map();
    for (const m of months.length ? months : allMonths) {
      const c = fetchMonth(m, path.join(OUT, "current", `${m}.json`));
      if (c) contents.set(m, c);
    }
    // 2. 不可见的事件（不在任何月内容的 eventId/eventIds 里）
    const visible = new Set();
    for (const c of contents.values()) for (const d of c.days) for (const id of [d.eventId, ...(d.eventIds ?? [])]) if (id) visible.add(id);
    const rows = (await rds.client.query(
      `select e.id, to_char(e.occurred_at,'YYYY-MM-DD') as "day", e.media_ids, e.source_ids,
              (select decision from content_quality_reviews c where c.target_id = e.id and c.target_kind = 'life_event' order by reviewed_at desc limit 1) review
         from life_events e where to_char(e.occurred_at,'YYYY-MM') = any($1)`, [[...contents.keys()]])).rows.filter((e) => !visible.has(e.id));
    // 3. 来源比对键（秒 + 去空白文本）：同一条消息被导入成不同 id 时也认得出来
    const need = new Set(rows.flatMap((e) => e.source_ids ?? []));
    for (const c of contents.values()) for (const d of c.days) for (const s of d.sourceIds ?? []) need.add(s);
    const keyOf = new Map((await rds.client.query(`select id, to_char(captured_at,'YYYY-MM-DD HH24:MI:SS')||'|'||regexp_replace(coalesce(text,''),'\\s+','','g') k from raw_sources where id = any($1)`, [[...need]])).rows.map((r) => [r.id, r.k]));
    const citedKeysByDay = new Map();
    for (const c of contents.values()) for (const d of c.days) citedKeysByDay.set(d.day, new Set((d.sourceIds ?? []).map((s) => keyOf.get(s)).filter(Boolean)));
    const held = new Set(Object.entries(state).filter(([, s]) => s.status === "held").map(([d]) => d));
    const plan = planBackfill({
      contents, editorialDropped: editorialDropped(), citedKeysByDay,
      events: rows.map((e) => ({ id: e.id, day: e.day, review: e.review, mediaIds: e.media_ids ?? [], sourceKeys: (e.source_ids ?? []).map((s) => keyOf.get(s)).filter(Boolean) })),
    });
    const counts = {};
    for (const d of plan.decisions) counts[d.action] = (counts[d.action] ?? 0) + 1;
    fs.writeFileSync(path.join(OUT, "plan.json"), JSON.stringify({ counts, ...plan }, null, 1));
    say(`不可见事件 ${rows.length} 条：${JSON.stringify(counts)}；要处理 ${plan.days.length} 天`);
    for (const d of plan.decisions.filter((x) => x.action.startsWith("skip") || x.action.startsWith("blocked"))) ledger({ event: "decided", ...d });

    // 4. 执行：attach 直接挂；rewrite/new-day 过 day-writer
    const todo = plan.days.filter((d) => !held.has(d.day)).slice(0, MAX_DAYS);
    const writeDay = createDayWriter({ rds, outDir: OUT, realNames });
    const results = new Map(); // month -> results[]
    const queue = todo.filter((d) => d.action !== "attach");
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
      while (queue.length) {
        const slot = queue.shift();
        const existing = contents.get(slot.month).days.find((x) => x.day === slot.day) ?? null;
        const target = dayTarget(existing, slot, { ageLabel: birthAge(BIRTH_DAY, slot.day) });
        const r = await writeDay(target);
        Object.assign(r, { eventIds: target.eventIds, expandedMediaIds: target.expandedMediaIds, firstScreenMediaIds: target.firstScreenMediaIds, basis: `backfill-${STAMP.slice(0, 8)}` });
        say(`[${slot.day}] ${slot.action} ${r.ok ? (r.skip ? `模型判定不写：${r.skip}` : `通过「${r.decision.title}」`) : `失败：${(r.errors ?? []).slice(0, 2).join("；")}`}`);
        if (!r.ok) { state[slot.day] = afterFailure(state[slot.day]); ledger({ event: "failed", day: slot.day, eventIds: slot.eventIds, errors: r.errors, status: state[slot.day].status }); }
        else if (r.skip) ledger({ event: "model-skip", day: slot.day, eventIds: slot.eventIds, reason: r.skip });
        if (!results.has(slot.month)) results.set(slot.month, []);
        results.get(slot.month).push(r);
      }
    }));

    // 5. 每个月组装候选、校验形状、（发布时）备份 + 装入
    const { validateMonthContent } = await import(pathToFileURL(path.join(REPO_V2, "lib/month-content.ts")).href);
    for (const month of [...new Set(todo.map((d) => d.month))].sort()) {
      let next = contents.get(month);
      for (const slot of todo.filter((d) => d.month === month && d.action === "attach")) next = attachEvents(next, slot.day, slot.eventIds);
      next = applyRewrites(next, results.get(month) ?? []);
      next.speakerBySourceId = await rebuildSpeakers(rds, next);
      if (!validateMonthContent(next, month)) { say(`❌ ${month} 候选没通过应用自己的校验，不装入`); ledger({ event: "invalid-month", month }); continue; }
      const file = path.join(OUT, `${month}.candidate.json`);
      fs.writeFileSync(file, JSON.stringify(next, null, 1), "utf8");
      const done = { attached: todo.filter((d) => d.month === month && d.action === "attach").map((d) => d.day), written: (results.get(month) ?? []).filter((r) => r.ok && !r.skip).map((r) => r.day), failed: (results.get(month) ?? []).filter((r) => !r.ok).map((r) => r.day) };
      summary.months[month] = done;
      if (!done.attached.length && !done.written.length) continue;
      if (!PUBLISH) { ledger({ event: "drafted", month, ...done }); continue; }
      const backupDir = path.join(path.dirname(OPS), "content-backups", `${STAMP.slice(0, 8)}-backfill`);
      fs.mkdirSync(backupDir, { recursive: true });
      const backup = fetchMonth(month, path.join(backupDir, `${month}.${STAMP}.json`));
      if (!backup) { say(`❌ ${month} 备份失败，不装入`); ledger({ event: "backup-failed", month }); continue; }
      const res = install(month, file);
      if (!res.ok) { say(`❌ ${month} 装入失败：${res.error}`); ledger({ event: "install-failed", month, error: res.error }); continue; }
      for (const d of done.written) state[d] = { attempts: 0, status: "published" };
      ledger({ event: "published", month, version: res.version, backup: path.join(backupDir, `${month}.${STAMP}.json`), ...done });
      say(`${month} 已装入 ${res.version}（挂 ${done.attached.length} 天，写 ${done.written.length} 天，失败 ${done.failed.length} 天）`);
    }
    summary.costUsd = Number(writeDay.cost().toFixed(3));
    summary.counts = counts;
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1));
    say(`完成，花费约 $${summary.costUsd}；输出 ${OUT}`);
  } finally { await rds.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); ledger({ event: "crash", error: String(e?.stack ?? e).slice(0, 500) }); process.exit(3); });
