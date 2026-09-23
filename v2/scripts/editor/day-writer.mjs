// 写（或重写）月页上的一天：组材料 → 无头 Claude 写稿 → 全部校验 → 不过就带着错误重写。
// regen-month.mjs（按新规则重写机器写的天）和 backfill-events.mjs（把审核通过的新事件补进月页）共用这一段，
// 所以两条路径过的是同一套校验，没有「补进来的内容走捷径」。
//
// 安全边界同 nightly-editor.mjs：模型不给任何工具（--tools ""），在空目录里跑，不存会话，保留本机代理。
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { extractJson, checkDecision, timeWordProblems, sensitiveHits } from "./plan.mjs";
import { validateDayText } from "./validate-day.mjs";
import { labelForSender, registeredLabels } from "./identity-rules.mjs";
import { buildDayPack, resolveParagraphSources } from "./day-pack.mjs";

export const MAX_ATTEMPTS = 3;
const HISTORY = "C:/Users/teddy/NianlifeOps/memory-tab-20260917/10-history-rollout/months";

/** DeepSeek 已有的识图结果：mediaId → 画面描述（所有月份的 vision-cache 都读，照片可能跨月被引用）。 */
export function loadVisionDescriptions(dir = HISTORY) {
  const out = new Map();
  if (!fs.existsSync(dir)) return out;
  for (const m of fs.readdirSync(dir)) {
    const f = path.join(dir, m, "vision-cache.json");
    if (!fs.existsSync(f)) continue;
    for (const v of Object.values(JSON.parse(fs.readFileSync(f, "utf8")))) if (v?.mediaId && v.description && !out.has(v.mediaId)) out.set(v.mediaId, v.description);
  }
  return out;
}

export function loadBrief() {
  return fs.readFileSync(new URL("./BRIEF.regen.md", import.meta.url), "utf8").replace("{{LABELS}}", registeredLabels().join("、"));
}

export function callClaude(prompt, sandbox) {
  return new Promise((resolve) => {
    const env = { ...process.env };
    for (const k of Object.keys(env)) if (/^CLAUDE_CODE_|^CLAUDECODE$|^CLAUDE_PID$/.test(k)) delete env[k];
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

/** 一稿的全部校验。返回 {problems, evidence}。纯函数。 */
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

/**
 * @param {{rds:object, outDir:string, realNames:string[], vision?:Map<string,string>, brief?:string, call?:Function}} ctx
 * @returns {(target:{day:string, ageLabel?:string, eventIds:string[], expandedMediaIds:string[], firstScreenMediaIds:string[]}) => Promise<object>}
 */
export function createDayWriter({ rds, outDir, realNames, vision = loadVisionDescriptions(), brief = loadBrief(), call = callClaude }) {
  if (!realNames?.length) throw new Error("真名清单为空：拒绝运行");
  const sandbox = path.join(outDir, "_sandbox");
  let cost = 0;
  // 同一个 pg client 不能并发查询：材料按顺序取，模型调用可以并发。
  let chain = Promise.resolve();
  const query = (sql, params) => { const p = chain.then(() => rds.client.query(sql, params)); chain = p.catch(() => {}); return p; };

  async function packFor(t) {
    const rows = (await query(
      `select id, source_label, to_char(captured_at,'HH24:MI') t, text, metadata->>'senderDigest' dg, media_ids
         from raw_sources where captured_at >= $1::date and captured_at < ($1::date + 1) and deleted_at is null
           and coalesce(metadata->>'duplicateOf', '') = '' -- 跨导出重复（NOT_DUPLICATE_MARKED_SQL）
         order by captured_at, id`, [t.day])).rows;
    const events = t.eventIds?.length ? (await query(`select title, story from life_events where id = any($1)`, [t.eventIds])).rows : [];
    const first = new Set(t.firstScreenMediaIds);
    return buildDayPack({
      rows: rows.map((r) => ({ id: r.id, t: r.t, text: r.text, speaker: labelForSender(r.dg, r.source_label), mediaIds: r.media_ids ?? [] })),
      photos: t.expandedMediaIds.map((id) => ({ mediaId: id, description: vision.get(id) ?? null, firstScreen: first.has(id) })),
      events,
    });
  }

  const writeDay = async (t) => {
    const pack = await packFor(t);
    const known = new Set([...pack.keys.keys(), ...pack.photoKeys.keys()]);
    const hasPhotos = t.expandedMediaIds.length > 0;
    let errors = null, final = null, lastReply = null;
    const attempts = [];
    for (let attempt = 1; attempt <= MAX_ATTEMPTS && !final; attempt += 1) {
      const prompt = [brief, `\n## 这一天：${t.day}（${t.ageLabel ?? ""}）${hasPhotos ? `，有 ${t.expandedMediaIds.length} 张已选照片` : "，没有照片"}\n\n${pack.text}\n`,
        errors ? `\n## 上一稿没有通过校验，请只修正这些问题，事实不要增减：\n${errors.map((e) => `- ${e}`).join("\n")}\n` : "",
        "\n现在只输出那个 JSON 对象。"].join("");
      const res = await call(prompt, sandbox);
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
    const r = { day: t.day, ok: Boolean(final), skip: final?.skip ?? null, decision: final?.decision ?? null, evidence: final?.evidence ?? null, sourceIds, attempts, errors: final ? null : errors, lastReply: final ? undefined : lastReply };
    fs.mkdirSync(path.join(outDir, "days"), { recursive: true });
    fs.writeFileSync(path.join(outDir, "days", `${t.day}.json`), JSON.stringify(r, null, 1), "utf8");
    return r;
  };
  writeDay.cost = () => cost;
  return writeDay;
}

/** 资料区称谓整月按注册表重建：未登记的人不给称谓。 */
export async function rebuildSpeakers(rds, content) {
  const allIds = [...new Set(content.days.flatMap((d) => d.sourceIds ?? []))];
  const who = (await rds.client.query(`select id, source_label, metadata->>'senderDigest' dg from raw_sources where id = any($1)`, [allIds])).rows;
  return Object.fromEntries(who.map((r) => [r.id, labelForSender(r.dg, r.source_label)]).filter(([, l]) => l));
}
