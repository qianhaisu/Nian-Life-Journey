// 一个月里每一天的照片和视频从库里重新汇总（2026-09-23 第四轮 d 的补充要求）。
//
//   node --import tsx scripts/editor/media-month.mjs --month=2026-09 --out=<dir> [--write]
//
// 1. 候选：这个月所有已入库、活着的媒体（原消息没被软删、没有 duplicateOf），按 taken_at 归到哪一天。
// 2. 判定：已有 media_subject_check 的沿用最新结论（approved 才收；needs_human_review / store_only 不收）；
//    没判过的交给 deepseek-flash 看图（photo-classify.mjs，与夜间照片、月页照片描述同一个模型；视频用封面帧），
//    decidePhoto（主体、截图、证件、医疗、裸露……）不放行的不收，拿不准的不收；结论照夜间照片的格式写回核验行。
// 3. 排列：aggregateDayMedia——按拍摄时间，首屏 6 格，有视频至少一格是视频。
// 4. 只改机器写的天（_source:"machine"）的媒体清单，正文一个字不动；人工/来源不明的天不碰；
//    有放行媒体但这个月还没有这一天的，记下来不新建（新的一天由回填/夜间编辑去写）。
// 5. --write：写核验行（一个事务，核对增量）→ 备份线上文件 → content-install。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classifyPhotos, curateScene } from "./photo-classify.mjs";
import { decidePhoto, PROMPT_VERSION, POLICY_VERSION } from "./photos-plan.mjs";
import { aggregateDayMedia } from "./day-media.mjs";
import { groupScenes, applySceneCuration, applyDailyCap, sceneKeyOf, DAY_MEDIA_CAP } from "./scene-curation.mjs";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const MONTH = arg("month");
const OUT = path.resolve(arg("out") ?? `.data/r4/${MONTH}/media`);
const WRITE = process.argv.includes("--write");
const LIMIT = Number(arg("limit") ?? "") || Infinity; // 单次判定条数上限：大月份分几次跑，前台每次都能在几分钟内跑完；没判完的留给下一次（断点续跑）。
const NO_CURATE = process.argv.includes("--no-curate"); // 同场景精选（Teddy 2026-09-23）默认开；只在需要对比/回滚时关掉。
const OPS = "C:/Users/teddy/NianlifeOps";
const REFS = `${OPS}/ops-daily/photos/refs`;
const ECS = { ssh: "ecs-user@47.99.243.155", key: "C:/Users/teddy/Downloads/nianlife-prod-ecs.pem" };
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const say = (m) => console.log(`[media ${MONTH}] ${m}`);
const scp = (dest) => spawnSync("scp", ["-q", "-o", "BatchMode=yes", "-i", ECS.key, `${ECS.ssh}:/srv/nianlife-content/${MONTH}.json`, dest], { encoding: "utf8" }).status === 0;

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH ?? "")) throw new Error("--month=YYYY-MM");
  fs.mkdirSync(path.join(OUT, "files"), { recursive: true });
  const live = path.join(OUT, "live.json");
  if (!scp(live)) throw new Error("取不到线上内容");
  const content = JSON.parse(fs.readFileSync(live, "utf8"));
  const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
  const rds = await openRds({ localPort: 50000 + Math.floor(Math.random() * 10000), readOnly: !WRITE });
  const q = async (s, p) => (await rds.client.query(s, p)).rows;
  try {
    const rows = await q(`
      with latest as (select distinct on (target_id) target_id, decision from content_quality_reviews where target_kind='media_subject_check' order by target_id, reviewed_at desc)
      select m.id, m.type, to_char(m.taken_at,'YYYY-MM-DD') as "day", to_char(m.taken_at,'YYYY-MM-DD"T"HH24:MI:SS') as "takenAt", l.decision
        from media m left join raw_sources r on r.id = m.raw_source_id left join latest l on l.target_id = m.id
       where m.visibility <> 'private' and (r.id is null or (r.deleted_at is null and coalesce(r.metadata->>'duplicateOf','') = ''))
         and to_char(m.taken_at,'YYYY-MM') = $1
         and not exists (select 1 from media_rejections x where x.media_id = m.id)`, [MONTH]);
    const machineDays = new Set(content.days.filter((d) => d._source === "machine").map((d) => d.day));
    const inScope = rows.filter((r) => machineDays.has(r.day));
    const allTodo = inScope.filter((r) => !r.decision);
    const todo = allTodo.slice(0, LIMIT);
    say(`媒体 ${rows.length}（机器写的天 ${inScope.length}），待判定 ${allTodo.length}${allTodo.length > todo.length ? `（本次只判 ${todo.length}，剩下留给下一次）` : ""}`);

    // 判定：下载网页版（视频用封面）交给 deepseek-flash
    const fileFor = (r) => path.join(OUT, "files", `${createHash("sha256").update(r.id).digest("hex").slice(0, 20)}.img`);
    async function ensureFile(r) {
      const file = fileFor(r);
      if (fs.existsSync(file)) return file;
      const res = await fetch(`https://nianlife.cn/api/media/${encodeURIComponent(r.id)}?variant=${r.type === "video" ? "poster" : "web"}`, { signal: AbortSignal.timeout(60_000) }).catch(() => null);
      if (!res?.ok) return null;
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return file;
    }
    const verdict = new Map(inScope.filter((r) => r.decision).map((r) => [r.id, r.decision]));
    const newRows = [];
    if (todo.length) {
      const refFiles = fs.readdirSync(REFS).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => path.join(REFS, f));
      const items = [];
      for (const r of todo) {
        const file = await ensureFile(r);
        if (!file) { verdict.set(r.id, "unavailable"); continue; }
        items.push({ id: r.id, file });
      }
      const { results, model } = await classifyPhotos(items, refFiles, { concurrency: 6 });
      for (const it of items) {
        const v = results[it.id];
        const d = decidePhoto(v);
        if (!v || v.error || d.decision === "needs_human_review") { verdict.set(it.id, "needs_human_review"); continue; } // 拿不准：不收，也不写结论（留给以后）
        verdict.set(it.id, d.decision);
        newRows.push({ id: it.id, decision: d.decision, preset: d.preset, model });
      }
    }

    // 排列并替换机器写的天的媒体清单
    const next = JSON.parse(JSON.stringify(content));
    const byDay = new Map();
    for (const r of inScope) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push({ id: r.id, type: r.type, takenAt: r.takenAt, allowed: verdict.get(r.id) === "approved" }); }

    // 同场景精选（Teddy 2026-09-23）：先按拍摄时间（本地、10 分钟窗口）缩小候选，
    // 是不是真的同一场景、留哪几张交给 deepseek-flash（并发跑，月份大也能在前台跑完）；
    // 全天再有一个 12 张的硬上限，场景之间轮流留代表。
    const curation = { scenesChecked: 0, scenesMerged: 0, beforeCount: 0, afterCount: 0, examples: [] };
    const groupsByDay = new Map();
    const multiGroups = []; // {day, group}
    for (const [day, list] of byDay) {
      const approved = list.filter((m) => m.allowed);
      curation.beforeCount += approved.length;
      if (NO_CURATE || approved.length <= 1) { groupsByDay.set(day, approved.map((m) => [m])); continue; }
      const groups = groupScenes(approved);
      groupsByDay.set(day, groups);
      for (const g of groups) if (g.length > 1) multiGroups.push({ day, group: g });
    }
    curation.scenesChecked = multiGroups.length;
    const decisions = new Map();
    if (multiGroups.length) {
      let next = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (next < multiGroups.length) {
          const { group } = multiGroups[next++];
          const withFiles = [];
          for (const m of group) { const file = await ensureFile(m); if (file) withFiles.push({ id: m.id, file }); }
          if (withFiles.length < 2) continue; // 图取不全就不精选，全部保留
          const decision = await curateScene(withFiles);
          if (!decision) continue; // 判不出来：全部保留
          decisions.set(sceneKeyOf(group), decision);
        }
      }));
    }
    for (const { day, group } of multiGroups) {
      const decision = decisions.get(sceneKeyOf(group));
      if (decision?.sameScene && decision.keep.length < group.length) {
        curation.scenesMerged += 1;
        if (curation.examples.length < 8) {
          const dropped = group.map((x) => x.id).filter((id) => !decision.keep.includes(id) && group.find((g) => g.id === id)?.type !== "video");
          curation.examples.push({ day, kept: decision.keep, dropped, why: decision.why ?? "" });
        }
      }
    }
    const curatedByDay = new Map();
    for (const [day, list] of byDay) {
      const groups = groupsByDay.get(day) ?? [];
      const curated = applySceneCuration(groups, decisions);
      const capped = applyDailyCap(curated, groups, { cap: DAY_MEDIA_CAP });
      curation.afterCount += capped.length;
      const keptIds = new Set(capped.map((m) => m.id));
      curatedByDay.set(day, list.map((m) => ({ ...m, allowed: m.allowed && keptIds.has(m.id) })));
    }
    say(`同场景精选：${curation.scenesChecked} 个候选场景，精选掉 ${curation.scenesMerged} 个；全月放行媒体 ${curation.beforeCount} → 挂上候选 ${curation.afterCount}`);

    let photos = 0, videos = 0;
    const changedDays = [];
    const typeOf = new Map(rows.map((r) => [r.id, r.type]));
    for (const d of next.days) {
      if (d._source !== "machine") continue;
      const agg = aggregateDayMedia(curatedByDay.get(d.day) ?? []);
      if (!agg.expandedMediaIds.length && !d.paragraphs.length && !d.title) continue; // 不让一天变成空块
      const before = new Set(d.expandedMediaIds);
      if (JSON.stringify(agg.expandedMediaIds) === JSON.stringify(d.expandedMediaIds) && JSON.stringify(agg.firstScreenMediaIds) === JSON.stringify(d.firstScreenMediaIds)) continue;
      for (const id of agg.expandedMediaIds) if (!before.has(id)) (typeOf.get(id) === "video" ? videos++ : photos++);
      d.expandedMediaIds = agg.expandedMediaIds;
      d.firstScreenMediaIds = agg.firstScreenMediaIds;
      d.storyBoundMediaIds = (d.storyBoundMediaIds ?? []).filter((id) => agg.expandedMediaIds.includes(id));
      if (!d.title && !d.paragraphs.length && !agg.expandedMediaIds.length) continue;
      changedDays.push(d.day);
    }
    const daysWithoutEntry = [...byDay.entries()].filter(([day, list]) => !content.days.some((d) => d.day === day) && list.some((m) => m.allowed)).map(([day]) => day);
    const candidate = path.join(OUT, `${MONTH}.media.json`);
    fs.writeFileSync(candidate, JSON.stringify(next, null, 1));
    const summary = { month: MONTH, judged: newRows.length, approvedNew: newRows.filter((r) => r.decision === "approved").length, newPhotos: photos, newVideos: videos, changedDays, daysWithoutEntry, curation };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
    say(`新挂上 照片 ${photos} / 视频 ${videos}，改动 ${changedDays.length} 天；判定写回 ${newRows.length} 条`);
    if (!WRITE) return;

    if (newRows.length) {
      const profileId = (await q(`select profile_id from content_quality_reviews limit 1`))[0].profile_id;
      const before = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
      await rds.client.query("begin");
      let inserted = 0;
      for (const w of newRows) {
        const id = `subj-autophoto-${createHash("sha256").update(`${POLICY_VERSION}\n${w.id}`).digest("hex").slice(0, 20)}`;
        const res = await rds.client.query(
          `insert into content_quality_reviews (id, profile_id, target_kind, target_id, decision, reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
           select $1,$2,'media_subject_check',$3,$4,$5::jsonb,$10,$6,$7,$8,$9, now() at time zone 'Asia/Shanghai'
            where not exists (select 1 from content_quality_reviews where target_kind='media_subject_check' and target_id=$3)
           on conflict do nothing returning id`,
          [id, profileId, w.id, w.decision, JSON.stringify(["basis:auto-deepseek-policy", `label:${w.preset}`, "authorized-by:teddy-2026-09-23-round4-media"]), w.model ?? "deepseek-flash", PROMPT_VERSION, POLICY_VERSION, `${id}:media_subject_check`, String(w.model ?? "deepseek-flash").startsWith("glm") ? "glm" : "deepseek"]);
        inserted += res.rowCount;
      }
      const after = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
      if (after - before !== inserted) { await rds.client.query("rollback"); throw new Error(`核验行增量 ${after - before} != ${inserted}`); }
      await rds.client.query("commit");
    }
    if (changedDays.length) {
      const bak = `${OPS}/content-backups/round4/${MONTH}`; fs.mkdirSync(bak, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "");
      if (!scp(`${bak}/${MONTH}.${stamp}.before-media.json`)) throw new Error("装入前备份失败");
      const r = spawnSync("C:/Program Files/Git/bin/bash.exe", [path.join(REPO_V2, "scripts/deploy-ecs-public.sh"), "content-install", MONTH, candidate], { encoding: "utf8", env: { ...process.env, ECS_SSH: ECS.ssh, ECS_KEY: ECS.key, ECS_PUBLIC_IP: "47.99.243.155" } });
      const m = (r.stdout ?? "").match(/CONTENT_VERSION=(\S+)/);
      if (r.status !== 0 || !m) throw new Error(`content-install 失败：${(r.stderr || r.stdout || "").slice(-300)}`);
      summary.version = m[1];
      fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
      say(`已装入 ${m[1]}`);
    }
  } finally { await rds.close(); }
}

main().catch((e) => { console.error(e); process.exit(3); });
