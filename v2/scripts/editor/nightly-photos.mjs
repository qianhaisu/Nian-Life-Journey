// 照片的夜间自动化：找出新进库、还没核验的照片 → DeepSeek 看图 → 保守规则判定 → 写主体核验 → 并进当天的照片区。
//
// 2026-09-20 Teddy 明确决定：照片审批链要全自动——「通过 = 自动上页面，班级合影放行」。
// 这一步取代了原来「有人手动发起识别、再由人签」的流程。规则见 photos-plan.mjs（.data/ds-photo-policy.mjs 那套
// 保守规则，只放开「别的孩子入镜」）。不放行的（认不出/太小/背对/洗澡/医疗/证件/截图…）不写库、不上页面。
//
// 用法（DeepSeek 国内直连，不需要代理；图片从 nianlife.cn 的媒体接口取网页版）：
//   node --import tsx scripts/editor/nightly-photos.mjs                       # dry-run：识别并出报告，不写库、不改页面
//   NIANLIFE_PHOTOS_WRITE=1 node --import tsx scripts/editor/nightly-photos.mjs  # 写核验行 + 装入含照片的月内容
//
// 写库范围：只 insert 一种行——content_quality_reviews 的 media_subject_check（prompt_version 固定为
// deepseek-photo-auto-v1，唯一键保证重跑不重复）。写完核对增量，不符整笔回滚。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { shanghaiToday, addDays } from "./plan.mjs";
import { classifyPhotos, chooseLead } from "./photo-classify.mjs";
import { decidePhoto, pickPhotos, batchLooksBroken, mergeDayMedia, applyLead, PROMPT_VERSION, POLICY_VERSION, LOOKBACK_DAYS } from "./photos-plan.mjs";

const OPS = process.env.NIANLIFE_OPS_DIR ?? "C:/Users/teddy/NianlifeOps/ops-daily";
const ED = path.join(OPS, "editor");
const PH = path.join(OPS, "photos");
const REFS = path.join(PH, "refs");
const TMP = path.join(PH, "tmp");
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const WRITE = process.env.NIANLIFE_PHOTOS_WRITE === "1";
const TODAY = process.env.NIANLIFE_EDITOR_TODAY || shanghaiToday(new Date());
const ECS = { ssh: process.env.ECS_SSH ?? "ecs-user@47.99.243.155", key: process.env.ECS_KEY ?? "C:/Users/teddy/Downloads/nianlife-prod-ecs.pem" };
const MEDIA_BASE = process.env.NIANLIFE_MEDIA_BASE ?? "https://nianlife.cn";

const say = (m) => console.log(`[${new Date().toISOString()}] ${m}`);
const ledgerFile = path.join(PH, "ledger.jsonl");
const ledger = (o) => fs.appendFileSync(ledgerFile, JSON.stringify({ at: new Date().toISOString(), write: WRITE, ...o }) + "\n");
const stateFile = path.join(PH, "state.json");
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

fs.mkdirSync(TMP, { recursive: true });

function fetchContent(month) {
  const tmp = path.join(PH, `_current-${month}.json`);
  const r = spawnSync("scp", ["-q", "-o", "BatchMode=yes", "-o", "ConnectTimeout=20", "-i", ECS.key, `${ECS.ssh}:/srv/nianlife-content/${month}.json`, tmp], { encoding: "utf8" });
  if (r.status !== 0) return null;
  return JSON.parse(fs.readFileSync(tmp, "utf8"));
}

function installToProduction(month, file) {
  const bash = process.env.NIANLIFE_BASH ?? "C:/Program Files/Git/bin/bash.exe";
  const r = spawnSync(bash, [path.join(REPO_V2, "scripts/deploy-ecs-public.sh"), "content-install", month, file], {
    encoding: "utf8", env: { ...process.env, ECS_SSH: ECS.ssh, ECS_KEY: ECS.key, ECS_PUBLIC_IP: "47.99.243.155" },
  });
  const m = (r.stdout ?? "").match(/CONTENT_VERSION=(\S+)/);
  if (r.status === 0 && m) return { ok: true, version: m[1] };
  return { ok: false, error: (r.stderr || r.stdout || "").slice(-300) };
}

async function download(id, file) {
  const res = await fetch(`${MEDIA_BASE}/api/media/${encodeURIComponent(id)}?variant=web`, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) return false;
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return true;
}

async function main() {
  const refFiles = fs.existsSync(REFS) ? fs.readdirSync(REFS).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => path.join(REFS, f)) : [];
  if (refFiles.length < 3) { say(`❌ 参考图不足（${REFS} 里 ${refFiles.length} 张，至少 3 张）`); ledger({ event: "preflight-failed", reason: "refs" }); return 2; }
  const lock = path.join(PH, "run.lock");
  try { fs.writeFileSync(lock, String(process.pid), { flag: "wx" }); } catch { say("❌ 上一次还在跑（run.lock 存在）"); return 2; }
  const digest = { today: TODAY, write: WRITE, considered: 0, downloaded: 0, approved: 0, storeOnly: 0, held: 0, errors: 0, added: [], notes: [] };
  const state = readJson(stateFile, { seen: {}, tries: {} });
  state.tries ??= {};
  let rds;
  try {
    const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
    rds = await openRds({ localPort: 15570 + Math.floor(Math.random() * 100), readOnly: !WRITE });
    const q = async (s, p = []) => (await rds.client.query(s, p)).rows;

    // 1) 候选：最近 LOOKBACK_DAYS 天、type=photo、还没有任何主体核验
    const since = addDays(TODAY, -LOOKBACK_DAYS);
    const rows = (await q(
      `select m.id, to_char(m.taken_at,'YYYY-MM-DD') as taken_day from media m
        where m.type = 'photo' and m.taken_at >= $1::date
          and not exists (select 1 from content_quality_reviews r where r.target_kind = 'media_subject_check' and r.target_id = m.id)`, [since]))
      .map((r) => ({ id: r.id, takenDay: r.taken_day }));
    const picked = pickPhotos(rows, { today: TODAY, seen: state.seen });
    digest.considered = picked.length;
    say(`候选 ${rows.length} 张未核验，今晚处理 ${picked.length} 张（写库=${WRITE}）`);

    // 2) 下载 → 识别
    const items = [];
    let next = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (next < picked.length) {
        const p = picked[next++];
        const file = path.join(TMP, `${p.id}.webp`);
        try { if (await download(p.id, file)) items.push({ id: p.id, file, takenDay: p.takenDay }); } catch {}
      }
    }));
    digest.downloaded = items.length;
    say(`下载成功 ${items.length}/${picked.length}（下载不了的多半是没有可用的网页版，下次再试）`);
    let verdicts = {};
    if (items.length) {
      const r = await classifyPhotos(items, refFiles, { concurrency: 4 });
      verdicts = r.results;
      digest.model = r.model; digest.inputTokens = r.inputTokens; digest.outputTokens = r.outputTokens;
      say(`识别完成：${Object.keys(verdicts).length}/${items.length}，模型 ${r.model}，tokens in ${r.inputTokens} out ${r.outputTokens}`);
    }
    for (const it of items) { try { fs.rmSync(it.file); } catch {} }

    const done = items.filter((it) => verdicts[it.id]);
    const broken = batchLooksBroken(done.map((it) => verdicts[it.id]));
    if (broken.broken) {
      say(`❌ 这一批识别不可信，整批不写：${broken.why}`);
      ledger({ event: "batch-untrusted", why: broken.why, n: done.length });
      digest.notes.push(`整批不写：${broken.why}`);
      return 1;
    }

    // 3) 判定
    const toWrite = [];
    for (const it of done) {
      const v = verdicts[it.id];
      const d = decidePhoto(v);
      if (v.error) {
        digest.errors += 1;
        const tries = (state.tries[it.id] ?? 0) + 1;
        state.tries[it.id] = tries;
        if (tries >= 3) state.seen[it.id] = { status: "held", why: "model-error×3", at: TODAY }; // 连续三晚识别不出：留给人，不再每晚重试
        continue;
      }
      if (d.decision === "needs_human_review") { digest.held += 1; state.seen[it.id] = { status: "held", why: d.why ?? d.preset, at: TODAY }; continue; }
      if (d.decision === "approved") digest.approved += 1; else digest.storeOnly += 1;
      toWrite.push({ id: it.id, takenDay: it.takenDay, decision: d.decision, preset: d.preset });
    }
    say(`判定：放行 ${digest.approved}，不上页面 ${digest.storeOnly}，留给人 ${digest.held}，识别出错 ${digest.errors}`);

    // 4) 写核验行（一个事务，核对增量）
    if (WRITE && toWrite.length) {
      const profileId = (await q(`select profile_id from content_quality_reviews limit 1`))[0].profile_id;
      const model = digest.model ?? null;
      const before = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
      await rds.client.query("begin");
      try {
        let inserted = 0;
        for (const w of toWrite) {
          const id = `subj-autophoto-${createHash("sha256").update(`${POLICY_VERSION}\n${w.id}`).digest("hex").slice(0, 20)}`;
          const res = await rds.client.query(
            `insert into content_quality_reviews (id, profile_id, target_kind, target_id, decision, reason_codes,
               provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
             select $1,$2,'media_subject_check',$3,$4,$5::jsonb,'deepseek',$6,$7,$8,$9, now() at time zone 'Asia/Shanghai'
              where not exists (select 1 from content_quality_reviews where target_kind='media_subject_check' and target_id=$3)
             on conflict do nothing returning id`,
            [id, profileId, w.id, w.decision, JSON.stringify(["basis:auto-deepseek-policy", `label:${w.preset}`, "authorized-by:teddy-2026-09-20"]), model, PROMPT_VERSION, POLICY_VERSION, `${id}:media_subject_check`]);
          inserted += res.rowCount;
        }
        const after = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
        if (after - before !== inserted) throw new Error(`增量 ${after - before} != 写入 ${inserted}`);
        await rds.client.query("commit");
        say(`已写入 ${inserted} 条核验（${before} → ${after}）`);
        ledger({ event: "wrote", inserted, approved: toWrite.filter((w) => w.decision === "approved").map((w) => w.id), storeOnly: toWrite.filter((w) => w.decision === "store_only").map((w) => w.id) });
        for (const w of toWrite) state.seen[w.id] = { status: "wrote", at: TODAY };
      } catch (e) { await rds.client.query("rollback"); throw e; }
    } else if (!WRITE) {
      say("dry-run：不写库、不改页面");
    }

    // 5) 并进当天的照片区：只并「本流程放行」的照片（人工流程挑过、有意没选的照片不会被重新捡回来）
    const approvedRows = await q(
      `with latest as (select distinct on (target_id) target_id, decision, prompt_version from content_quality_reviews where target_kind='media_subject_check' order by target_id, reviewed_at desc)
       select m.id, to_char(m.taken_at,'YYYY-MM-DD') as day from media m join latest l on l.target_id = m.id
        where l.decision = 'approved' and l.prompt_version = $2 and m.type = 'photo' and m.taken_at >= $1::date order by m.taken_at, m.id`, [since, PROMPT_VERSION]);
    const byDay = new Map();
    for (const r of approvedRows) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push(r.id); }
    // dry-run 时，本晚的放行还没写库，也把它们算进去预演
    if (!WRITE) for (const w of toWrite.filter((x) => x.decision === "approved")) { if (!byDay.has(w.takenDay)) byDay.set(w.takenDay, []); if (!byDay.get(w.takenDay).includes(w.id)) byDay.get(w.takenDay).push(w.id); }
    const months = [...new Set([...byDay.keys()].map((d) => d.slice(0, 7)))].sort();
    for (const month of months) {
      const content = fetchContent(month);
      if (!content) { digest.notes.push(`${month} 还没有内容文件，照片暂不上页面`); continue; }
      let cur = content;
      const added = [];
      for (const day of [...byDay.keys()].filter((d) => d.startsWith(month)).sort()) {
        const m = mergeDayMedia(cur, day, byDay.get(day));
        if (m) { cur = m.content; added.push({ day, n: m.added.length }); }
        else if (!cur.days.some((d) => d.day === day)) digest.notes.push(`${day} 有已放行照片，但这天还没有故事，等故事写好后再并入`);
      }
      if (!added.length) continue;
      // 5b) 配图：照片是按时间并进去的，第一张只是「这天最早拍的」。让 DeepSeek 按这一天的标题挑封面。
      for (const a of added) {
        const entry = cur.days.find((d) => d.day === a.day);
        if (!entry?.title) continue;
        const pool = entry.expandedMediaIds.slice(0, 12);
        const files = [];
        for (const id of pool) {
          const f = path.join(TMP, `lead-${id.slice(-16)}.webp`);
          try { if (await download(id, f)) files.push({ id, file: f }); } catch {}
        }
        let picked = null;
        try { picked = await chooseLead(entry, files); } catch {}
        for (const f of files) { try { fs.rmSync(f.file); } catch {} }
        if (!picked) { digest.notes.push(`${a.day} 没能挑出配图，保持原样`); continue; }
        const applied = applyLead(cur, a.day, picked.id);
        if (applied) { cur = applied.content; a.lead = picked.why || "已换"; say(`${a.day} 配图 → ${picked.id.slice(-8)}（${picked.why}）`); }
      }
      const out = path.join(PH, `${month}.candidate.json`);
      fs.writeFileSync(out, JSON.stringify({ ...cur, generatedAt: new Date().toISOString() }, null, 1), "utf8");
      if (!WRITE) { digest.added.push(...added.map((a) => ({ ...a, published: false }))); say(`dry-run：${month} 将并入 ${added.map((a) => `${a.day}+${a.n}`).join(" ")}`); continue; }
      const r = installToProduction(month, out);
      if (!r.ok) { digest.notes.push(`${month} 装入失败：${r.error}`); ledger({ event: "install-failed", month, error: r.error }); continue; }
      digest.added.push(...added.map((a) => ({ ...a, published: true, version: r.version })));
      ledger({ event: "published", month, added, version: r.version });
      say(`已装入 ${month}（${r.version}）：${added.map((a) => `${a.day}+${a.n}`).join(" ")}`);
    }
    if (WRITE) fs.writeFileSync(stateFile, JSON.stringify(state, null, 1), "utf8");
    return 0;
  } finally {
    try { await rds?.close(); } catch {}
    try { fs.rmSync(lock); } catch {}
    writeDigest(digest);
  }
}

function writeDigest(d) {
  const L = [`# 夜间照片 ${d.today}${d.write ? "" : "（dry-run，未写库）"}`, "",
    `处理 ${d.considered} 张，下载成功 ${d.downloaded}：放行 ${d.approved}，不上页面 ${d.storeOnly}，留给人 ${d.held}，识别出错 ${d.errors}`, ""];
  if (d.added.length) L.push("## 并入照片区", ...d.added.map((a) => `- ${a.day} +${a.n}${a.lead ? `，配图已换（${a.lead}）` : ""}${a.published ? ` 已发布 ${a.version}` : "（未发布）"}`), "");
  if (d.notes.length) L.push("## 备注", ...d.notes.map((n) => `- ${n}`), "");
  if (d.model) L.push(`模型 ${d.model}，tokens in ${d.inputTokens} out ${d.outputTokens}`);
  fs.mkdirSync(path.join(ED, "digests"), { recursive: true });
  fs.writeFileSync(path.join(ED, "digests", `photos-${d.today}.md`), L.join("\n") + "\n", "utf8");
  say(`摘要 → ${path.join(ED, "digests", `photos-${d.today}.md`)}`);
}

main().then((c) => process.exit(c ?? 0)).catch((e) => { console.error(e); try { ledger({ event: "crash", error: String(e?.stack ?? e).slice(0, 500).replace(/sk-[A-Za-z0-9_-]+/g, "[REDACTED]") }); } catch {} process.exit(3); });
