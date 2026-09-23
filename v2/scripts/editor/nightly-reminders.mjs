// 每周提醒的夜间自动化：提取（增量）→ 批准 → 留账。
//
// 首页「每周提醒」为空，是因为 9/17 之后没有任何提取批次覆盖新消息（2026-09-20 查明，见 docs/STATUS.md）。
// Teddy 2026-09-20 明确决定：要真正的全自动，产品判断选「夜里提取 + 夜里批准」。
//
// 必须由 .data/t20-run-env.mjs 启动（它开 ECS→RDS 隧道并把 DATABASE_URL 只对本进程指向 RDS，且需要
// --env-file=.env.local 提供 AI_PROVIDER=zhipu / ZHIPU_API_KEY）：
//   node --env-file=.env.local .data/t20-run-env.mjs -- scripts/editor/nightly-reminders.mjs
//
// 分工（不改一行既有代码）：
//   - 提取：现成的 scripts/upcoming-extract.mjs --incremental（DeepSeek，幂等，游标是「最后覆盖的那条消息」，
//     连续失败 8 次自动停并把窗口记为部分覆盖）。它永远不写 review_decision。
//   - 批准：lib/db/upcoming-store.ts 的 setUpcomingReviewDecision——另一个函数，只改审核那一列。
//     选批准哪些由 reminders-plan.mjs 决定（不碰人批过的、过敏感兜底、数量异常整批不批）。
//   - 账：每次批准了哪些 id 写进 NianlifeOps\ops-daily\editor\reminders-ledger.jsonl。库里没有「谁批准的」
//     这一列，所以这份账是唯一的审计依据。
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { getDb, closePool } from "../../lib/db/client.ts";
import * as t from "../../lib/db/schema.ts";
import { CANONICAL_PROFILE_ID } from "../../lib/db/config.ts";
import { setUpcomingReviewDecision } from "../../lib/db/upcoming-store.ts";
import { eq, like } from "drizzle-orm";
import { pickAutoApprovals, AUTO_REVIEWER } from "./reminders-plan.mjs";

const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const OUT_DIR = path.join(OPS, "upcoming");
const LEDGER = path.join(OPS, "editor", "reminders-ledger.jsonl");
const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const ledger = (o) => { fs.mkdirSync(path.dirname(LEDGER), { recursive: true }); fs.appendFileSync(LEDGER, JSON.stringify({ at: new Date().toISOString(), reviewer: AUTO_REVIEWER, ...o }) + "\n"); };

// 2026-09-23 起模型走智谱（AI_PROVIDER=zhipu + ZHIPU_API_KEY）；DeepSeek 旧配置仍可用。
const PROVIDER = (process.env.AI_PROVIDER ?? "").toLowerCase();
if (!((PROVIDER === "zhipu" && process.env.ZHIPU_API_KEY) || (PROVIDER === "deepseek" && process.env.DEEPSEEK_API_KEY))) {
  say("❌ 缺 AI_PROVIDER=zhipu / ZHIPU_API_KEY：请用 --env-file=.env.local 启动");
  ledger({ event: "preflight-failed", reason: "no model env" });
  process.exit(2);
}

// 手动模式：--approve-batches=upcoming-A,upcoming-B 跳过提取，只对指定批次走同一套兜底批准并记账。
// 用途：补跑（--since=…）或试探（--max-units=…）产生的批次不是「今晚的批次」，夜里的流程不会去批它们
// （批准是按单个批次 id 过滤的）。2026-09-20 一次 --max-units=1 的试探留下的 2 条就是这样，会永远没人批。
const manualBatches = (process.argv.find((a) => a.startsWith("--approve-batches=")) ?? "").slice("--approve-batches=".length).split(",").filter(Boolean);

fs.mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const outFile = path.join(OUT_DIR, `nightly-${stamp}.json`); // 候选详情引着家人聊天，必须在仓库外

let batches = [];
let extractedInfo = null;
if (manualBatches.length) {
  say(`手动模式：只批准批次 ${manualBatches.join("、")}（不提取）`);
  batches = manualBatches;
} else {
  // 1) 提取（子进程，沿用当前进程的环境，即已指向 RDS 隧道）
  say("提取：upcoming-extract.mjs --incremental");
  const r = spawnSync(process.execPath, ["--import", "tsx", "scripts/upcoming-extract.mjs", "--incremental", `--out=${outFile}`], { encoding: "utf8", env: process.env, cwd: process.cwd() });
  const stdout = r.stdout ?? "";
  process.stdout.write(stdout.split("\n").filter((l) => !/SECURITY WARNING|^In the next|^To prepare|^- If you|^See https|^\(Use/.test(l)).join("\n"));
  if (r.status !== 0) {
    say(`❌ 提取失败（退出码 ${r.status}）：${(r.stderr ?? "").slice(-300).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]")}`);
    ledger({ event: "extract-failed", status: r.status });
    await closePool();
    process.exit(1);
  }
  const batchId = (stdout.match(/batch (upcoming-\d+)/) ?? [])[1];
  const created = Number((stdout.match(/completed: (\d+) created/) ?? [])[1] ?? 0);
  const updated = Number((stdout.match(/, (\d+) updated/) ?? [])[1] ?? 0);
  if (!batchId) { say("提取没有产生批次（可能今晚没有新消息），不批准任何东西"); ledger({ event: "no-batch" }); await closePool(); process.exit(0); }
  say(`本批 ${batchId}：新建 ${created}，更新 ${updated}`);
  batches = [batchId];
  extractedInfo = { created, updated };
}

// 2) 读回各批次的条目，选出该批准的；3) 批准（只改审核那一列），并记账
const db = getDb();
for (const batchId of batches) {
  const rows = await db.select({
    id: t.upcomingItems.id, title: t.upcomingItems.title, status: t.upcomingItems.status, note: t.upcomingItems.note,
    reviewDecision: t.upcomingItems.reviewDecision, extractionBatchId: t.upcomingItems.extractionBatchId,
  }).from(t.upcomingItems).where(eq(t.upcomingItems.extractionBatchId, batchId));
  const plan = pickAutoApprovals(rows, batchId);
  say(`批次 ${batchId}：${rows.length} 条，批准 ${plan.approve.length}，留给人 ${plan.hold.length}${plan.tooMany ? "（数量超上限，整批留给人）" : ""}`);
  let approved = { updated: 0, ids: [] };
  if (plan.approve.length) approved = await setUpcomingReviewDecision(plan.approve, "approved", { profileId: CANONICAL_PROFILE_ID });
  ledger({ event: "approved", manual: manualBatches.length > 0, batchId, extracted: extractedInfo, approved: approved.ids, held: plan.hold, tooMany: plan.tooMany });
  say(`已批准 ${approved.updated} 条；留给人 ${plan.hold.length} 条${plan.hold.length ? "：" + plan.hold.map((h) => `${h.id.slice(-8)}(${h.reason})`).join("；") : ""}`);
}
await closePool();
process.exit(0);
