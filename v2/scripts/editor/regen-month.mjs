// 按新规则重写一个月里「机器写的」那些天（_source:"machine"），人工编辑的天一个字不动。
//
//   node --import tsx scripts/editor/regen-month.mjs --month=2025-12 --base=<当前线上内容的本地副本> --out=<目录>
//     [--days=2025-12-04,2025-12-13]  只重写这几天
//     [--concurrency=4]
//
// 只产出候选文件，不装入生产：装入走 deploy-ecs-public.sh content-install（装之前先备份线上文件）。
//
// 每一天：读库（只读）组材料 → 无头 Claude 写稿（不给任何工具，见 nightly-editor.mjs callClaude 的安全边界）→
// 逐段校验（validate-day：引语原字 + 归属、点名证据、禁用写法、注册表外称谓、真名）→ 时间词、敏感兜底 →
// 不合格带着错误重写，最多 3 稿；3 稿都不过，这一天保持原样并记入 failed。
// 照片保持 9/19 已选的那一组；画面描述复用 DeepSeek 已有的识图结果，不重新识图。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { extractJson, checkDecision, timeWordProblems, sensitiveHits } from "./plan.mjs";
import { validateDayText } from "./validate-day.mjs";
import { appendDay } from "./append-day.mjs";
import { labelForSender, registeredLabels } from "./identity-rules.mjs";
import { buildDayPack, resolveParagraphSources } from "./day-pack.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const MONTH = arg("month");
const BASE = arg("base");
const OUT = arg("out");
const ONLY = (arg("days") ?? "").split(",").filter(Boolean);
const CONCURRENCY = Number(arg("concurrency") ?? 4);
const MAX_ATTEMPTS = 3;
const BIRTH_DAY = "2025-01-03";
const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const HISTORY = "C:/Users/teddy/NianlifeOps/memory-tab-20260917/10-history-rollout/months";
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
if (!MONTH || !BASE || !OUT) { console.error("用法：--month=YYYY-MM --base=<file> --out=<dir>"); process.exit(2); }
fs.mkdirSync(path.join(OUT, "days"), { recursive: true });
const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);

/** DeepSeek 已有的识图结果：mediaId → 画面描述（所有月份的 vision-cache 都读，照片可能跨月被引用）。 */
function loadVisionDescriptions() {
  const out = new Map();
  if (!fs.existsSync(HISTORY)) return out;
  for (const m of fs.readdirSync(HISTORY)) {
    const f = path.join(HISTORY, m, "vision-cache.json");
    if (!fs.existsSync(f)) continue;
    for (const v of Object.values(JSON.parse(fs.readFileSync(f, "utf8")))) if (v?.mediaId && v.description && !out.has(v.mediaId)) out.set(v.mediaId, v.description);
  }
  return out;
}

function callClaude(prompt) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$/.test(k)) delete env[k];
    const sandbox = path.join(OUT, "_sandbox");
    fs.mkdirSync(sandbox, { recursive: true });
    const cmdline = `claude -p --output-format json --max-turns 1 --tools "" --no-session-persistence`;
    const child = spawn(cmdline, { env, cwd: sandbox, shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: "调用超时（8 分钟）" }); }, 8 * 60 * 1000);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) return resolve({ ok: false, error: `Claude 报错 ${j.api_error_status ?? ""}：${String(j.result).slice(0, 160)}` });
        resolve({ ok: true, reply: j.result, costUsd: j.total_cost_usd, model: Object.keys(j.modelUsage ?? {}).join(",") });
      } catch { resolve({ ok: false, error: `无法解析 Claude 输出：${(out || err).slice(0, 200)}` }); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

/** 一稿的全部校验。返回 {problems, evidence}。 */
export function checkDraft(decision, pack, realNames) {
  const problems = [];
  const evidence = { quotes: [], persons: [] };
  const all = [];
  for (const [i, para] of decision.paragraphs.entries()) {
    const src = resolveParagraphSources(para.sources, pack);
    all.push(...src);
    const v = validateDayText({ title: null, paragraphs: [para.text] }, src, { realNames });
    problems.push(...v.errors.map((e) => e.replace(/^第 1 段/, `第 ${i + 1} 段`)));
    for (const kind of ["quotes", "persons"]) evidence[kind].push(...v.evidence[kind].map((e) => ({ ...e, where: `第 ${i + 1} 段`, paragraphSources: para.sources })));
    const bad = timeWordProblems(para.text, src.filter((x) => x.text || x.speaker).map((x) => x.hour));
    if (bad.length) problems.push(`第 ${i + 1} 段: 写了「${bad.join("、")}」，但这一段引用的消息都不在这个时段`);
  }
  const t = validateDayText({ title: decision.title, paragraphs: [] }, all, { realNames });
  problems.push(...t.errors.filter((e) => !/既没有标题/.test(e)));
  for (const p of t.evidence.persons) evidence.persons.push(p);
  const hits = sensitiveHits({ title: decision.title, paragraphs: decision.paragraphs.map((p) => p.text) });
  if (hits.length) problems.push(`命中敏感兜底：${hits.map((h) => `${h.category}「${h.hit}」`).join("、")}——这类内容不写`);
  return { problems, evidence };
}

async function main() {
  const base = JSON.parse(fs.readFileSync(BASE, "utf8"));
  const brief = fs.readFileSync(new URL("./BRIEF.regen.md", import.meta.url), "utf8").replace("{{LABELS}}", registeredLabels().join("、"));
  const realNames = JSON.parse(fs.readFileSync(path.join(OPS, "real-names.private.json"), "utf8")).names;
  if (!realNames?.length) throw new Error("真名清单为空：拒绝运行");
  const vision = loadVisionDescriptions();
  const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
  const rds = await openRds({ localPort: 15500 + Math.floor(Math.random() * 100), readOnly: true });
  const results = [];
  let cost = 0;
  try {
    const targets = base.days.filter((d) => d._source === "machine" && (!ONLY.length || ONLY.includes(d.day)));
    const protectedDays = base.days.filter((d) => d._source !== "machine").map((d) => d.day);
    say(`${MONTH}：要重写 ${targets.length} 天；受保护（人工/来源不明）${protectedDays.length} 天：${protectedDays.join(" ") || "无"}`);

    const packFor = async (d) => {
      const rows = (await rds.client.query(
        `select id, source_label, to_char(captured_at,'HH24:MI') t, text, metadata->>'senderDigest' dg, media_ids
           from raw_sources where captured_at >= $1::date and captured_at < ($1::date + 1) and deleted_at is null order by captured_at, id`, [d.day])).rows;
      const events = d.eventIds?.length ? (await rds.client.query(`select title, story from life_events where id = any($1)`, [d.eventIds])).rows : [];
      const first = new Set(d.firstScreenMediaIds);
      return buildDayPack({
        rows: rows.map((r) => ({ id: r.id, t: r.t, text: r.text, speaker: labelForSender(r.dg, r.source_label), mediaIds: r.media_ids ?? [] })),
        photos: d.expandedMediaIds.map((id) => ({ mediaId: id, description: vision.get(id) ?? null, firstScreen: first.has(id) })),
        events,
      });
    };

    const work = async (d) => {
      const pack = await packFor(d);
      const known = new Set([...pack.keys.keys(), ...pack.photoKeys.keys()]);
      const hasPhotos = d.expandedMediaIds.length > 0;
      let errors = null, final = null, lastReply = null;
      const attempts = [];
      for (let attempt = 1; attempt <= MAX_ATTEMPTS && !final; attempt += 1) {
        const prompt = [brief, `\n## 这一天：${d.day}（${d.ageLabel ?? ""}）${hasPhotos ? `，有 ${d.expandedMediaIds.length} 张已选照片` : "，没有照片"}\n\n${pack.text}\n`,
          errors ? `\n## 上一稿没有通过校验，请只修正这些问题，事实不要增减：\n${errors.map((e) => `- ${e}`).join("\n")}\n` : "",
          "\n现在只输出那个 JSON 对象。"].join("");
        const res = await callClaude(prompt);
        if (!res.ok) { errors = [res.error]; attempts.push({ attempt, error: res.error }); continue; }
        cost += res.costUsd ?? 0;
        lastReply = res.reply;
        const shape = checkDecision(extractJson(res.reply), known, { kinds: ["story", "text-only", "visual-description"] });
        if (!shape.ok) { errors = [shape.error]; attempts.push({ attempt, error: shape.error, model: res.model }); continue; }
        if (shape.decision.decision === "skip") {
          if (hasPhotos) { errors = ["这一天有已选照片，不能跳过：只有照片就写 visual-description"]; attempts.push({ attempt, error: errors[0] }); continue; }
          final = { skip: shape.decision.reason }; break;
        }
        const { problems, evidence } = checkDraft(shape.decision, pack, realNames);
        attempts.push({ attempt, problems, model: res.model });
        if (problems.length) { errors = problems; continue; }
        final = { decision: shape.decision, evidence };
      }
      const sourceIds = final?.decision ? [...new Set(final.decision.paragraphs.flatMap((p) => resolveParagraphSources(p.sources, pack).map((s) => s.id)))] : [];
      const r = { day: d.day, ok: Boolean(final), skip: final?.skip ?? null, decision: final?.decision ?? null, evidence: final?.evidence ?? null, sourceIds, attempts, lastReply: final ? undefined : lastReply };
      fs.writeFileSync(path.join(OUT, "days", `${d.day}.json`), JSON.stringify(r, null, 1), "utf8");
      say(`[${d.day}] ${final ? (final.skip ? `跳过：${final.skip}` : `通过（第 ${attempts.length} 稿）「${final.decision.title}」`) : `失败：${(errors ?? []).slice(0, 3).join("；")}`}`);
      return r;
    };

    const queue = [...targets];
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => { while (queue.length) results.push(await work(queue.shift())); }));

    // 组装候选月内容：通过的天替换，失败的天保持原样（并记账），受保护的天不碰。
    let next = JSON.parse(JSON.stringify(base));
    for (const r of results.sort((a, b) => a.day.localeCompare(b.day))) {
      if (!r.ok || r.skip) continue;
      const old = next.days.find((x) => x.day === r.day);
      const sourceIds = [...new Set([...r.sourceIds, ...(old.sourceIds ?? [])])];
      const res = appendDay(next, {
        day: r.day, kind: r.decision.kind, title: r.decision.title, paragraphs: r.decision.paragraphs.map((p) => p.text),
        sourceIds, firstScreenMediaIds: old.firstScreenMediaIds, expandedMediaIds: old.expandedMediaIds, storyBoundMediaIds: old.storyBoundMediaIds ?? [],
        eventIds: old.eventIds ?? [], evidence: r.evidence,
      }, { birthDay: BIRTH_DAY, now: new Date().toISOString() });
      if (res.skipped) throw new Error(`${r.day} 被 append-day 判为受保护，却出现在重写名单里`);
      next = res.content;
      const day = next.days.find((x) => x.day === r.day);
      day._sourceBasis = `regen-round3-${new Date().toISOString().slice(0, 10)}`;
      for (const k of ["mergedEventCount", "pendingCount", "mediaNote"]) if (k in old) day[k] = old[k];
    }
    // 资料区的称谓整月按注册表重建：9/18 的表里有「发言人E」「小年小姨」（都是雪姨）。未登记的人不给称谓。
    const allIds = [...new Set(next.days.flatMap((d) => d.sourceIds ?? []))];
    const who = (await rds.client.query(`select id, source_label, metadata->>'senderDigest' dg from raw_sources where id = any($1)`, [allIds])).rows;
    next.speakerBySourceId = Object.fromEntries(who.map((r) => [r.id, labelForSender(r.dg, r.source_label)]).filter(([, l]) => l));
    fs.writeFileSync(path.join(OUT, `${MONTH}.candidate.json`), JSON.stringify(next, null, 1), "utf8");
    const summary = { month: MONTH, at: new Date().toISOString(), rewritten: results.filter((r) => r.ok && !r.skip).map((r) => r.day), failed: results.filter((r) => !r.ok).map((r) => r.day), skipped: results.filter((r) => r.skip).map((r) => r.day), protected: protectedDays, costUsd: Number(cost.toFixed(3)) };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1), "utf8");
    say(`完成：重写 ${summary.rewritten.length}，失败 ${summary.failed.length}（${summary.failed.join(" ")}），花费约 $${summary.costUsd}`);
  } finally { await rds.close(); }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main().catch((e) => { console.error(e); process.exit(3); });
