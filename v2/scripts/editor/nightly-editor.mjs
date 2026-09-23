// 夜间编辑：把「已经搬进库」的微信消息，按天整理成月页上的一天。
//
// 每晚 23:30 的同步只做「搬进库」。「从消息里读出东西」（故事、月页内容）从来没有自动化过
// （2026-09-20 查明，见 docs/STATUS.md）。这个脚本补上那一步，但**默认不发布**：
//
//   node --import tsx scripts/editor/nightly-editor.mjs             # dry-run：写草稿与账，不碰生产
//   NIANLIFE_EDITOR_PUBLISH=1 node --import tsx scripts/editor/nightly-editor.mjs   # 通过守门后装入生产
//
// 信任边界（每一条都是有意的）：
//   - 只读库（openRds readOnly）。编辑器不写数据库，只写内容文件——最小权限。
//   - 只追加或替换「这一天」，绝不整体覆盖月内容（append-day.mjs）；已有的天一个字节不动。
//   - 校验不过 = 不发布（validate-day.mjs）；重试一次，再失败记一次，连续 3 晚失败就 hold 等人看。
//   - 命中确定性敏感词 = hold，不发布（plan.mjs sensitiveHits）。
//   - 不碰照片：新照片没有 media_subject_check 审批本来就不会显示，审批链是另一条线。
//   - 缺私有的真名清单 = 拒绝运行，而不是静默放行。
//   - 必须走本机代理：清掉 HTTP_PROXY 会让 Claude 返回假的 403（见记忆 nianlife-feedback-keep-proxy-for-claude）。
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { pickDays, isReadable, sensitiveHits, extractJson, checkDecision, timeWordProblems, afterFailure, shanghaiToday, addDays } from "./plan.mjs";
import { validateDayText } from "./validate-day.mjs";
import { labelForSender } from "./identity-rules.mjs";
import { appendDay } from "./append-day.mjs";

const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const ED = path.join(OPS, "editor");
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const BIRTH_DAY = "2025-01-03";
const PUBLISH = process.env.NIANLIFE_EDITOR_PUBLISH === "1";
const MODEL = process.env.NIANLIFE_EDITOR_MODEL || ""; // 空 = CLI 默认
const ECS = { ssh: process.env.ECS_SSH ?? "ecs-user@47.99.243.155", key: process.env.ECS_KEY ?? "C:/Users/teddy/Downloads/nianlife-prod-ecs.pem" };
const NOW = new Date();
const TODAY = process.env.NIANLIFE_EDITOR_TODAY || shanghaiToday(NOW);
const ONLY_DAYS = (process.env.NIANLIFE_EDITOR_DAYS || "").split(",").filter(Boolean); // 调试：只处理这些天，绕过「今天−2」

if (ONLY_DAYS.length && PUBLISH) {
  console.error("❌ NIANLIFE_EDITOR_DAYS（调试）不能和 NIANLIFE_EDITOR_PUBLISH=1 同时使用：它绕过「已覆盖不重写」，会替换已发布的稿子。");
  process.exit(2);
}
const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const ledger = (o) => fs.appendFileSync(path.join(ED, "ledger.jsonl"), JSON.stringify({ at: new Date().toISOString(), publish: PUBLISH, ...o }) + "\n");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

// ── 前置检查：缺任何一项就拒绝运行，并把原因说清楚 ───────────────────────────────
function preflight() {
  const problems = [];
  const namesFile = path.join(OPS, "real-names.private.json");
  if (!fs.existsSync(namesFile)) problems.push(`缺真名清单 ${namesFile}（缺清单时静默放行等于没校验）`);
  const brief = path.join(ED, "BRIEF.day.md");
  if (!fs.existsSync(brief)) problems.push(`缺提示词模板 ${brief}（node ${path.join(ED, "build-brief.mjs")} 生成）`);
  if (!process.env.HTTP_PROXY && !process.env.HTTPS_PROXY) problems.push("没有 HTTP_PROXY/HTTPS_PROXY：本机在国内，直连 Anthropic 会返回假的 403；代理程序（127.0.0.1:7994）没开？");
  return problems;
}

// ── 现有内容：从 ECS 取（生产上实际在用的那一份），不信本地副本 ──────────────────────
function fetchContent(month) {
  const tmp = path.join(ED, `_current-${month}.json`);
  const r = spawnSync("scp", ["-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ECS.key, `${ECS.ssh}:/srv/nianlife-content/${month}.json`, tmp], { encoding: "utf8" });
  if (r.status !== 0) return null; // 这个月还没有内容文件（新月份）：从空白开始
  return JSON.parse(fs.readFileSync(tmp, "utf8"));
}

// ── 材料 ────────────────────────────────────────────────────────────────────────
// 发送人称谓只按 family-registry 解析（identity-rules.mjs）。2026-09-23 之前这里读的是 9/18 的 speaker-map.json，
// 那份表把雪姨标成「发言人E」「小年小姨」——引语因此被归到错的人名下。未登记的人一律「未登记的人」，不能被点名。
export const UNREGISTERED = "未登记的人";
async function loadDayPack(rds, day) {
  const rows = (await rds.client.query(
    `select id, source_label, to_char(captured_at at time zone 'Asia/Shanghai','HH24:MI') t, text, metadata->>'senderDigest' d
       from raw_sources where captured_at >= $1::date and captured_at < ($1::date + 1) and deleted_at is null
         and coalesce(metadata->>'duplicateOf', '') = '' -- 跨导出重复（NOT_DUPLICATE_MARKED_SQL）
       order by captured_at, id`, [day])).rows;
  const keys = new Map();
  const lines = [];
  for (const r of rows) {
    if (!isReadable(r.text)) continue;
    const k = `s${keys.size + 1}`;
    const speaker = labelForSender(r.d, r.source_label);
    keys.set(k, { id: r.id, text: String(r.text).trim(), hour: Number(String(r.t).slice(0, 2)), speaker, label: speaker ?? UNREGISTERED });
    lines.push(`${k} ${r.t} ${keys.get(k).label}: ${String(r.text).replace(/\s+/g, " ").trim().slice(0, 420)}`);
  }
  return { keys, text: lines.join("\n"), total: rows.length };
}

// ── 调 Claude（无头，保留代理，不给任何工具）──────────────────────────────────────
//
// 安全边界，每一条都核对过 `claude --help`：
//   --tools ""                官方文档：「Use "" to disable all tools」。模型拿不到 Bash/Read/Write 任何东西，
//                             所以就算简报里混进了恶意指令也做不了任何事，最坏只是写出一篇会被校验拦下的稿子。
//                             （--allowedTools 只是「免审批」清单，不等于禁用，不能拿它当边界。）
//   --no-session-persistence  不把私人消息存进会话记录。
//   cwd = 空的临时目录        项目里的 CLAUDE.md 会按 cwd 自动发现；在空目录里跑，模型只看到简报和当天材料。
//   不用 --bare              它让认证「只认 ANTHROPIC_API_KEY、不读 OAuth」，本机是订阅登录，加了就又是 403。
//   保留 HTTP_PROXY           清掉它会从国内直连而得到假的 403（记忆 nianlife-feedback-keep-proxy-for-claude）。
function callClaude(prompt) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$/.test(k)) delete env[k]; // 不带会话标记；代理变量保留
    const sandbox = path.join(ED, "_sandbox");
    fs.mkdirSync(sandbox, { recursive: true });
    // 整条命令行用一个字符串交给 shell，才能保住 --tools "" 里的空字符串（数组形式在 Windows 上会把它吞掉）。
    const cmdline = `claude -p --output-format json --max-turns 1 --tools "" --no-session-persistence${MODEL ? ` --model ${MODEL}` : ""}`;
    const child = spawn(cmdline, { env, cwd: sandbox, shell: true, stdio: ["pipe", "pipe", "pipe"] });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => { child.kill(); resolve({ ok: false, error: "调用超时（8 分钟）" }); }, 8 * 60 * 1000);
    child.on("close", () => {
      clearTimeout(timer);
      try {
        const j = JSON.parse(out);
        if (j.is_error) {
          const hint = j.api_error_status === 403 ? "（403：代理程序没开？本机在国内，直连 Anthropic 会被拒）" : "";
          return resolve({ ok: false, error: `Claude 报错 ${j.api_error_status ?? ""}${hint}：${String(j.result).slice(0, 160)}` });
        }
        resolve({ ok: true, reply: j.result, costUsd: j.total_cost_usd });
      } catch { resolve({ ok: false, error: `无法解析 Claude 输出：${(out || err).slice(0, 200)}` }); }
    });
    child.stdin.write(prompt);
    child.stdin.end();
  });
}

function buildPrompt({ brief, day, pack, samples, errors }) {
  const parts = [brief, `\n## 这一天：${day}\n\n下面是当天的消息（短键 时间 称呼: 正文）：\n\n${pack.text}\n`];
  if (samples.length) parts.push(`\n## 这个月已经写好的样稿（只用来对齐写法和长度，不要复述内容）\n\n${samples.map((s) => `【${s.day}】${s.title}\n${s.paragraphs.join("\n")}`).join("\n\n")}\n`);
  if (errors) parts.push(`\n## 上一稿没有通过校验，请只修正这些问题，事实不要增减：\n${errors.map((e) => `- ${e}`).join("\n")}\n`);
  parts.push("\n现在只输出那个 JSON 对象。");
  return parts.join("");
}

// ── 主流程 ──────────────────────────────────────────────────────────────────────
async function main() {
  fs.mkdirSync(path.join(ED, "drafts"), { recursive: true });
  fs.mkdirSync(path.join(ED, "held"), { recursive: true });
  fs.mkdirSync(path.join(ED, "digests"), { recursive: true });
  const lock = path.join(ED, ".lock");
  if (fs.existsSync(lock) && Date.now() - fs.statSync(lock).mtimeMs < 3 * 3600e3) { say("上一次运行还没结束（.lock 不足 3 小时），本次退出"); return 0; }
  fs.writeFileSync(lock, String(process.pid));
  const digest = { today: TODAY, publish: PUBLISH, wrote: [], held: [], skipped: [], failed: [], costUsd: 0 };
  try {
    const problems = preflight();
    if (problems.length) { for (const p of problems) say(`❌ ${p}`); ledger({ event: "preflight-failed", problems }); digest.failed.push(...problems.map((p) => ({ day: "-", reason: p }))); return 2; }

    const realNames = readJson(path.join(OPS, "real-names.private.json"), { names: [] }).names;
    const brief = fs.readFileSync(path.join(ED, "BRIEF.day.md"), "utf8");
    const stateFile = path.join(ED, "state.json");
    const state = readJson(stateFile, {});

    const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
    const rds = await openRds({ localPort: 15470 + Math.floor(Math.random() * 100), readOnly: true });
    try {
      const months = [...new Set([TODAY.slice(0, 7), addDays(TODAY, -READY_MONTH_LOOKBACK).slice(0, 7)])];
      const contents = new Map(months.map((m) => [m, fetchContent(m)]));
      const material = new Map();
      for (const m of months) {
        const r = await rds.client.query(`select distinct to_char(captured_at at time zone 'Asia/Shanghai','YYYY-MM-DD') d from raw_sources where captured_at >= $1::date and captured_at < ($1::date + interval '1 month') and deleted_at is null and text is not null`, [`${m}-01`]);
        for (const row of r.rows) material.set(row.d, true);
      }
      let plan = pickDays({ today: TODAY, months, coveredDays: (m) => new Set((contents.get(m)?.days ?? []).map((d) => d.day)), hasMaterial: (d) => material.has(d), state });
      if (ONLY_DAYS.length) plan = { write: ONLY_DAYS, skipped: [] };
      digest.skipped.push(...plan.skipped);
      say(`今天=${TODAY} 今晚要写 ${plan.write.length} 天：${plan.write.join(" ") || "（无）"}；跳过 ${plan.skipped.length} 天`);

      for (const day of plan.write) {
        const month = day.slice(0, 7);
        const pack = await loadDayPack(rds, day);
        say(`[${day}] 材料：库里 ${pack.total} 条，可读 ${pack.keys.size} 条`);
        if (pack.keys.size === 0) { state[day] = { attempts: 0, status: "skipped" }; digest.skipped.push({ day, reason: "过滤后没有可读文字" }); continue; }
        const knownKeys = new Set(pack.keys.keys());
        const samples = (contents.get(month)?.days ?? []).filter((d) => d.day < day).slice(-2).map((d) => ({ day: d.day, title: d.title, paragraphs: d.paragraphs }));

        let decision = null, errors = null, lastReply = null;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const res = await callClaude(buildPrompt({ brief, day, pack, samples, errors }));
          if (!res.ok) { errors = [res.error]; say(`[${day}] 第 ${attempt} 次调用失败：${res.error}`); continue; }
          digest.costUsd += res.costUsd ?? 0;
          lastReply = res.reply;
          const shape = checkDecision(extractJson(res.reply), knownKeys);
          if (!shape.ok) { errors = [shape.error]; say(`[${day}] 第 ${attempt} 稿形状不合：${shape.error}`); continue; }
          if (shape.decision.decision === "skip") { decision = shape.decision; break; }
          // 逐段校验：这一段的引语必须出在「这一段」列出的消息里；这一段的时间词要和这一段的来源时间对得上。
          const problems = [];
          const allSources = [];
          const evidence = { quotes: [], persons: [] };
          for (const [i, para] of shape.decision.paragraphs.entries()) {
            const src = para.sources.map((k) => pack.keys.get(k));
            allSources.push(...src);
            const v = validateDayText({ title: null, paragraphs: [para.text] }, src, { realNames });
            for (const kind of ["quotes", "persons"]) evidence[kind].push(...v.evidence[kind].map((e) => ({ ...e, where: `第 ${i + 1} 段` })));
            problems.push(...v.errors.map((e) => e.replace(/^第 1 段/, `第 ${i + 1} 段`)));
            const badTime = timeWordProblems(para.text, src.map((x) => x.hour));
            if (badTime.length) problems.push(`第 ${i + 1} 段: 写了「${badTime.join("、")}」，但这一段引用的消息都不在这个时段`);
          }
          // 标题：不能含真实姓名/技术字样，引语（如有）要出在任一来源里
          problems.push(...validateDayText({ title: shape.decision.title, paragraphs: [] }, allSources, { realNames }).errors.filter((e) => !/既没有标题/.test(e)));
          if (problems.length) { errors = problems; say(`[${day}] 第 ${attempt} 稿未过校验：${problems.length} 条`); continue; }
          decision = { ...shape.decision, evidence }; errors = null; break;
        }

        fs.writeFileSync(path.join(ED, "drafts", `${day}.json`), JSON.stringify({ day, decision, errors, reply: decision ? undefined : lastReply }, null, 1), "utf8");
        if (!decision) {
          state[day] = afterFailure(state[day]);
          digest.failed.push({ day, reason: (errors ?? ["无结果"]).join("；"), status: state[day].status });
          ledger({ event: "failed", day, attempts: state[day].attempts, status: state[day].status, errors });
          if (state[day].status === "held") fs.writeFileSync(path.join(ED, "held", `${day}.json`), JSON.stringify({ day, errors, lastReply }, null, 1), "utf8");
          continue;
        }
        if (decision.decision === "skip") {
          state[day] = { attempts: 0, status: "skipped" };
          digest.skipped.push({ day, reason: `模型判定不写：${decision.reason}` });
          ledger({ event: "model-skip", day, reason: decision.reason });
          continue;
        }
        const paragraphTexts = decision.paragraphs.map((x) => x.text);
        const hits = sensitiveHits({ title: decision.title, paragraphs: paragraphTexts });
        if (hits.length) {
          state[day] = { attempts: 0, status: "held" };
          fs.writeFileSync(path.join(ED, "held", `${day}.json`), JSON.stringify({ day, sensitive: hits, decision }, null, 1), "utf8");
          digest.held.push({ day, reason: `命中敏感兜底：${hits.map((h) => `${h.category}「${h.hit}」`).join("、")}` });
          ledger({ event: "held-sensitive", day, hits });
          continue;
        }

        // 追加进这个月的内容。新月份没有内容文件时从空白开始。
        const base = contents.get(month) ?? { schema: "nianlife.month-content/1", month, generatedAt: NOW.toISOString(), speakerBySourceId: {}, days: [] };
        const sources = [...new Set(decision.paragraphs.flatMap((x) => x.sources))].map((k) => pack.keys.get(k));
        const speakerBySourceId = Object.fromEntries(sources.map((s) => [s.id, s.label]));
        const { content: next, skipped: protectedDay } = appendDay(base, {
          day, kind: decision.kind, title: decision.title, paragraphs: paragraphTexts, sourceIds: sources.map((s) => s.id), evidence: decision.evidence,
        }, { birthDay: BIRTH_DAY, speakerBySourceId, dataCutoff: day });
        if (protectedDay) { digest.skipped.push({ day, reason: "这一天是人工编辑过的（或判断不出来源），不覆盖" }); ledger({ event: "protected", day }); continue; }
        contents.set(month, next);
        const out = path.join(ED, "drafts", `${month}.candidate.json`);
        fs.writeFileSync(out, JSON.stringify(next, null, 1), "utf8");

        if (!PUBLISH) {
          digest.wrote.push({ day, title: decision.title, published: false, note: "dry-run：草稿已写出，未装入生产" });
          ledger({ event: "drafted", day, title: decision.title });
          continue;
        }
        const r = installToProduction(month, out);
        if (!r.ok) { digest.failed.push({ day, reason: `装入失败：${r.error}`, status: "retry" }); ledger({ event: "install-failed", day, error: r.error }); contents.set(month, fetchContent(month) ?? base); continue; }
        state[day] = { attempts: 0, status: "published" };
        digest.wrote.push({ day, title: decision.title, published: true, version: r.version });
        ledger({ event: "published", day, title: decision.title, version: r.version });
      }
    } finally { rds.close?.(); }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 1), "utf8");
    return digest.failed.length && !digest.wrote.length ? 1 : 0;
  } finally {
    writeDigest(digest);
    try { fs.rmSync(lock); } catch {}
  }
}

const READY_MONTH_LOOKBACK = 3; // 月初三天内也看上个月：上个月最后几天的数据是月初才齐的

function installToProduction(month, file) {
  const bash = process.env.NIANLIFE_BASH ?? "C:/Program Files/Git/bin/bash.exe";
  const r = spawnSync(bash, [path.join(REPO_V2, "scripts/deploy-ecs-public.sh"), "content-install", month, file], {
    encoding: "utf8", env: { ...process.env, ECS_SSH: ECS.ssh, ECS_KEY: ECS.key, ECS_PUBLIC_IP: "47.99.243.155" },
  });
  const m = (r.stdout ?? "").match(/CONTENT_VERSION=(\S+)/);
  if (r.status === 0 && m) return { ok: true, version: m[1] };
  return { ok: false, error: `${(r.stderr || r.stdout || "").slice(-300)}` };
}

function writeDigest(d) {
  const L = [`# 夜间编辑 ${d.today}${d.publish ? "" : "（dry-run，未发布）"}`, ""];
  const sec = (title, rows, fmt) => { if (rows.length) L.push(`## ${title}`, ...rows.map(fmt), ""); };
  sec("写了", d.wrote, (w) => `- ${w.day}「${w.title}」${w.published ? `已发布 ${w.version}` : w.note}`);
  sec("hold（等人看）", d.held, (h) => `- ${h.day}：${h.reason}`);
  sec("失败", d.failed, (f) => `- ${f.day}：${f.reason}${f.status ? `（${f.status}）` : ""}`);
  sec("跳过", d.skipped.slice(0, 20), (s) => `- ${s.day}：${s.reason}`);
  if (!d.wrote.length && !d.held.length && !d.failed.length && !d.skipped.length) L.push("今晚没有需要做的事：所有已就绪的日子都已有内容。", "");
  L.push(`模型花费 ≈ $${d.costUsd.toFixed(3)}`);
  fs.writeFileSync(path.join(ED, "digests", `${d.today}.md`), L.join("\n") + "\n", "utf8");
  say(`摘要 → ${path.join(ED, "digests", `${d.today}.md`)}`);
}

main().then((code) => process.exit(code ?? 0)).catch((e) => { console.error(e); ledger({ event: "crash", error: String(e?.stack ?? e).slice(0, 500) }); process.exit(3); });
