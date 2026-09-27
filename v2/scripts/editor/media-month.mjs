// 一个月里每一天的照片和视频从库里重新汇总（2026-09-23 第四轮 d 的补充要求）。
//
//   node --import tsx scripts/editor/media-month.mjs --month=2026-09 --out=<dir> [--write-reviews | --write] [--files-from=<dir>,<dir>]
//
// 1. 候选：这个月所有已入库、活着的媒体（原消息没被软删、没有 duplicateOf），按 taken_at 归到哪一天。
// 2. 判定：库里已有 media_subject_check 的沿用最新结论（approved 才收）。人工锁（manual / claude-* / `manual:` 原因码 / teddy-*）
//    一律不动；provider ∈ {deepseek, glm} 的自动拒绝，可以按新的家庭生活规则重审（旧行保留，插入新行）。
//    分组见 photos-plan.mjs partitionReviewRows（重跑同一份库得到同一份分组）。
//    没判过的交给 glm-5.3-flash 看图（photo-classify.mjs；视频用封面帧）：
//      · 出生前的天走孕期分类器 v2（皮肤症状特写、裸露孕肚明确排除；v1 缓存只在「拒绝」时沿用，v1 的放行按版本失效重判）。
//        库里旧版策略的放行（staleApproved）本轮必须重验：验成了写带新版本号的行（即使仍是放行）；取图失败 / 模型出错 /
//        拿不准 / 没轮到，这一轮一律撤下并拟写 needs_human_review 行，不让没验过的旧放行继续挂在页面上（resolveStaleApproved）。
//      · 出生后先走「照片里是不是张年」（decidePhoto）；没放行、来源是自家（family_photo 原片或爸爸/妈妈发的）的，
//        再走家庭生活分支（decideFamilyLifePhoto）。data/photo-scene-tags.json、data/photo-scenery.json 这两套旧证据没有
//        commercial（scenery 也没有 who），只用来**拒绝**；放行一律要 family-life-photo-v2 提示词的完整六个安全字段。
//        单独一个孩子必须主体判定 reference_child=yes 且场景有环境信息；不放行的不收，拿不准的不收；结论照夜间照片的格式写成核验行。
// 3. 排列：aggregateDayMedia——按拍摄时间，首屏 6 格，有视频至少一格是视频，有生活场景至少两格是生活场景。
//    「生活场景」= 本轮家庭生活分支放行的 + 库里已有的当前家庭策略放行行（isFamilyApprovedRow），重跑结果一致。
// 4. 全月所有天都参与判定。只改机器写的天（_source:"machine"）的媒体清单，正文一个字不动；
//    人工/来源不明的天不碰；有放行媒体但这个月还没有这一天的，新建空白机器条目（正文由改写流程写）。
//    每次模型判定存进 v2/data/media-subject-verdicts.json，同一张图同一版提示词复用、不重复付费。
// 5. 产物：<out>/<month>.media.json（候选内容）、reviews.json（拟写入的核验行，含 reReview / prior）、summary.json、verdict-meta.jsonl。
//    --write-reviews：只写核验行（一个事务，核对增量），不装内容。
//    --write：写核验行 + 备份线上文件 + content-install。安装前必须过 validateMonthContent，且不能有正文空白的新天、
//    不能有本轮撤下的旧放行还挂在内容里；不满足就不装（2026-09-27 起推广批次改为「判定入库」与「最终安装」分开，
//    安装只在全文写完并通过校验后由部署 session 执行）。
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { classifyPhotos, classifyPregnancyPhotos, classifyFamilyLifePhotos, curateScene, visionModel, CURATE_PROMPT_VERSION } from "./photo-classify.mjs";
import {
  decidePhoto, decidePregnancyPhoto, decideFamilyLifePhoto, subjectVerdictIsFinal, resolveStaleApproved, partitionReviewRows, isFamilyApprovedRow, installGate,
  familyEvidenceFromTags, familyEvidenceFromScenery, familyEvidenceFromModel,
  PROMPT_VERSION, POLICY_VERSION, PREGNANCY_PROMPT_VERSION, PREGNANCY_POLICY_VERSION,
  FAMILY_PROMPT_VERSION, FAMILY_POLICY_VERSION, AUTO_REVIEW_PROVIDERS,
} from "./photos-plan.mjs";
import { aggregateDayMedia } from "./day-media.mjs";
import { groupScenes, applySceneCuration, applyDailyCap, sceneKeyOf, DAY_MEDIA_CAP } from "./scene-curation.mjs";
import { labelForSender } from "./identity-rules.mjs";
import { validateMonthContent } from "../../lib/month-content.ts";

const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const MONTH = arg("month");
const OUT = path.resolve(arg("out") ?? `.data/r4/${MONTH}/media`);
const WRITE = process.argv.includes("--write");
const WRITE_REVIEWS = WRITE || process.argv.includes("--write-reviews");
const LIMIT = Number(arg("limit") ?? "") || Infinity; // 单次判定条数上限：大月份分几次跑，前台每次都能在几分钟内跑完；没判完的留给下一次（断点续跑）。
const NO_CURATE = process.argv.includes("--no-curate"); // 同场景精选（Teddy 2026-09-23）默认开；只在需要对比/回滚时关掉。
const FILES_FROM = (arg("files-from") ?? "").split(",").map((s) => s.trim()).filter(Boolean).map((s) => path.resolve(s)); // 复用之前批次下载过的缩略图
const OPS = "C:/Users/teddy/NianlifeOps";
const REFS = `${OPS}/ops-daily/photos/refs`;
const ECS = { ssh: "ecs-user@47.99.243.155", key: "C:/Users/teddy/Downloads/nianlife-prod-ecs.pem" };
const REPO_V2 = path.resolve(new URL("../..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));
const say = (m) => console.log(`[media ${MONTH}] ${m}`);
const scp = (dest) => spawnSync("scp", ["-q", "-o", "BatchMode=yes", "-i", ECS.key, `${ECS.ssh}:/srv/nianlife-content/${MONTH}.json`, dest], { encoding: "utf8" }).status === 0;

// 出生日（上海日期）：之前的天走孕期分类器，当天起走「照片里是不是张年」。
const BIRTH_DAY = "2025-01-03";
const isPreBirth = (day) => day < BIRTH_DAY;
// Batch callers may isolate per-month caches, then merge them after their writers finish.
const VERDICT_STORE = arg("verdict-store") ? path.resolve(arg("verdict-store")) : path.join(REPO_V2, "data/media-subject-verdicts.json");
const SCENE_TAGS = path.join(REPO_V2, "data/photo-scene-tags.json");
const SCENERY = path.join(REPO_V2, "data/photo-scenery.json");
const readJson = (f, fallback) => (fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, "utf8")) : fallback);
// 写前重读合并：两个月份同时跑时，互不覆盖对方刚存的判定。
function saveStore(store) {
  const disk = readJson(VERDICT_STORE, { items: {}, scenes: {} });
  store.items = { ...disk.items, ...store.items };
  store.scenes = { ...(disk.scenes ?? {}), ...(store.scenes ?? {}) };
  fs.writeFileSync(VERDICT_STORE, JSON.stringify(store, null, 1) + "\n", "utf8");
}
// 来源是不是自家的：自家相册原片，或爸爸/妈妈在微信发的（与 travel-curate.mjs 同一条规则）。
const OURS_SENDERS = new Set(["爸爸", "妈妈"]);
const isOurs = (r) => r.sourceType === "family_photo" || (!!r.sender && OURS_SENDERS.has(labelForSender(r.sender, r.convId) ?? ""));

async function main() {
  if (!/^\d{4}-\d{2}$/.test(MONTH ?? "")) throw new Error("--month=YYYY-MM");
  fs.mkdirSync(path.join(OUT, "files"), { recursive: true });
  const live = path.join(OUT, "live.json");
  if (!scp(live)) throw new Error("取不到线上内容");
  const content = JSON.parse(fs.readFileSync(live, "utf8"));
  const { openRds } = await import(pathToFileURL(path.join(REPO_V2, ".data/night-rds.mjs")).href);
  const rds = await openRds({ localPort: 50000 + Math.floor(Math.random() * 10000), readOnly: !WRITE_REVIEWS });
  const q = async (s, p) => (await rds.client.query(s, p)).rows;
  try {
    const rows = await q(`
      with latest as (select distinct on (target_id) target_id, decision, provider, prompt_version, policy_version, reason_codes from content_quality_reviews where target_kind='media_subject_check' order by target_id, reviewed_at desc)
      select m.id, m.type, to_char(m.taken_at,'YYYY-MM-DD') as "day", to_char(m.taken_at,'YYYY-MM-DD"T"HH24:MI:SS') as "takenAt",
             l.decision, l.provider, l.prompt_version as "promptVersion", l.policy_version as "policyVersion", l.reason_codes as "reasonCodes",
             r.source_type as "sourceType", r.metadata->>'senderDigest' as sender, r.metadata->>'conversationId' as "convId"
        from media m left join raw_sources r on r.id = m.raw_source_id left join latest l on l.target_id = m.id
       where m.visibility <> 'private' and (r.id is null or (r.deleted_at is null and coalesce(r.metadata->>'duplicateOf','') = ''))
         and to_char(m.taken_at,'YYYY-MM') = $1
         and not exists (select 1 from media_rejections x where x.media_id = m.id)`, [MONTH]);
    const machineDays = new Set(content.days.filter((d) => d._source === "machine").map((d) => d.day));

    // 全月所有天都参与（Teddy 2026-09-26）：没有微信文字的日子，照片也要能进故事。
    const inScope = rows;
    const byId = new Map(inScope.map((r) => [r.id, r]));
    // 分组（photos-plan.mjs partitionReviewRows）：人工锁 / 没判过 / 可重审的自动拒绝 / 出生前上一轮撤下的 / 旧版策略的放行（必须重验）。
    const parts = partitionReviewRows(inScope, { isPreBirth });
    const locked = new Set(parts.locked.map((r) => r.id));
    const { unjudged, autoRejected, held: heldPreBirth, staleApproved } = parts;
    const staleIds = new Set(staleApproved.map((r) => r.id));
    // 旧版放行排最前：LIMIT 切掉的也一样撤下，但尽量让它们在本轮就验完。
    const allTodo = [...staleApproved, ...heldPreBirth, ...unjudged, ...autoRejected];
    const todo = allTodo.slice(0, LIMIT);
    const todoIds = new Set(todo.map((r) => r.id));
    const preBirthCount = inScope.filter((r) => isPreBirth(r.day)).length;
    say(`媒体 ${rows.length}（落在已有机器条目的天 ${rows.filter((r) => machineDays.has(r.day)).length}，出生前 ${preBirthCount}，自家来源 ${inScope.filter(isOurs).length}），库里已有判定 ${inScope.length - unjudged.length}（人工锁 ${locked.size}），待判定 ${unjudged.length}，可重审的自动拒绝 ${autoRejected.length}，上一轮撤下待再试 ${heldPreBirth.length}，旧版放行待复核 ${staleApproved.length}${allTodo.length > todo.length ? `（本次只处理 ${todo.length}，剩下留给下一次）` : ""}`);

    // 判定：下载网页版（视频用封面）交给看图模型
    const hashName = (id) => `${createHash("sha256").update(id).digest("hex").slice(0, 20)}.img`;
    const fileFor = (r) => path.join(OUT, "files", hashName(r.id));
    async function ensureFile(r) {
      const file = fileFor(r);
      if (fs.existsSync(file)) return { file };
      for (const dir of FILES_FROM) { const cached = path.join(dir, hashName(r.id)); if (fs.existsSync(cached)) { fs.copyFileSync(cached, file); return { file }; } }
      const res = await fetch(`https://nianlife.cn/api/media/${encodeURIComponent(r.id)}?variant=${r.type === "video" ? "poster" : "web"}`, { signal: AbortSignal.timeout(60_000) }).catch((e) => ({ ok: false, status: `fetch-error:${e?.name ?? e}` }));
      if (!res?.ok) return { file: null, status: res?.status };
      fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
      return { file };
    }
    // verdict：每张最终结论；locked 与未重审的库内结论原样沿用。
    // 旧版放行（staleApproved）一开始就是「撤下」：只有本轮重验成功才回到 approved / store_only；没轮到的（LIMIT）也撤下。
    const verdict = new Map(inScope.filter((r) => r.decision).map((r) => [r.id, staleIds.has(r.id) ? "needs_human_review" : r.decision]));
    const verdictMeta = new Map();
    const unavailable = [];
    const newRows = [];
    const calls = { pregnancy: 0, subject: 0, family: 0, scene: 0 };
    // 旧版放行本轮没验成的：id → 原因。写进 summary；--write 时若还挂在内容里就拒绝安装。
    const staleUnresolved = new Map(staleApproved.filter((r) => !todoIds.has(r.id)).map((r) => [r.id, "not-attempted:limit"]));
    // 旧版放行验不成 → 撤下 + 拟写 needs_human_review 行（同一策略同一张图同一结论的 id 幂等，重跑不重复插）。
    const withholdStale = (r, fresh, fallbackWhy, extra) => {
      const d = resolveStaleApproved(fresh, fallbackWhy);
      verdict.set(r.id, d.decision);
      if (d.decision === "needs_human_review") staleUnresolved.set(r.id, d.why);
      pushRow(r, d, extra);
    };

    // 每次模型判定都存进仓库（v2/data/media-subject-verdicts.json），同一张图同一版提示词不再重复付费。
    const store = readJson(VERDICT_STORE, { schema: 1, items: {}, scenes: {} });
    const sceneTags = readJson(SCENE_TAGS, {});
    const scenery = readJson(SCENERY, {});
    const modeFor = (day) => (isPreBirth(day) ? "pregnancy" : "subject");
    let reused = 0; let legacyReused = 0; let evidenceReused = 0;
    const pushRow = (r, d, extra) => newRows.push({ id: r.id, day: r.day, decision: d.decision, preset: d.preset, why: d.why ?? null, ...extra, reReview: Boolean(r.decision), prior: r.decision ? { decision: r.decision, provider: r.provider, promptVersion: r.promptVersion, policyVersion: r.policyVersion } : null });

    if (todo.length) {
      const toClassify = { pregnancy: [], subject: [] };
      // 第一步：主体 / 孕期判定，能复用的复用
      for (const r of todo) {
        const mode = modeFor(r.day);
        const held = store.items[r.id];
        if (mode === "pregnancy") {
          if (held?.mode === "pregnancy" && !held.raw?.error) {
            const d = decidePregnancyPhoto(held.raw);
            const legacy = held.promptVersion !== PREGNANCY_PROMPT_VERSION;
            // v2 缓存直接复用；v1 缓存只有「拒绝」可沿用（与 sensitive 字段无关），v1 的放行落到 legacy-no-sensitive-field → 重判
            if (!legacy || d.decision === "store_only") {
              verdictMeta.set(r.id, { raw: held.raw, decision: d, model: held.model, mode, promptVersion: held.promptVersion, source: legacy ? "store-legacy" : "store" });
              const extra = { model: held.model, promptVersion: held.promptVersion, policyVersion: PREGNANCY_POLICY_VERSION, basis: legacy ? `reuse:${held.promptVersion}` : "store" };
              if (staleIds.has(r.id)) withholdStale(r, d, "cache", extra); // 旧版放行：验成写新版本行，拿不准就撤下
              else if (d.decision === "needs_human_review") verdict.set(r.id, r.decision ?? "needs_human_review");
              else {
                verdict.set(r.id, d.decision);
                if (d.decision !== r.decision) pushRow(r, d, extra);
              }
              legacy ? legacyReused += 1 : reused += 1;
              continue;
            }
          }
        } else if (held?.mode === "subject" && held.promptVersion === PROMPT_VERSION && !held.raw?.error) {
          const d = decidePhoto(held.raw);
          verdictMeta.set(r.id, { raw: held.raw, decision: d, model: held.model, mode, promptVersion: held.promptVersion, source: "store" });
          if (d.decision === "approved") {
            verdict.set(r.id, "approved");
            // 库里不是 approved 的、或库里是旧版家庭策略放行的（staleApproved）：都写一条主体策略的放行行
            if (r.decision !== "approved" || staleIds.has(r.id)) pushRow(r, d, { model: held.model, promptVersion: PROMPT_VERSION, policyVersion: POLICY_VERSION, basis: "store" });
          } else if (!r.decision) {
            verdict.set(r.id, d.decision);
            if (d.decision !== "needs_human_review") pushRow(r, d, { model: held.model, promptVersion: PROMPT_VERSION, policyVersion: POLICY_VERSION, basis: "store" });
          }
          reused += 1;
          continue;
        } else if (r.decision && !staleIds.has(r.id)) {
          // 库里的自动拒绝、本地没有 raw：主体判定沿用库里的结论，只走家庭生活分支
          verdictMeta.set(r.id, { raw: null, decision: { decision: r.decision, preset: `db:${r.promptVersion ?? ""}` }, model: null, mode, promptVersion: r.promptVersion, source: "db" });
          continue;
        }
        const got = await ensureFile(r);
        if (!got.file) {
          unavailable.push({ id: r.id, day: r.day, type: r.type, status: got.status ?? null });
          // 旧版放行取不到图 = 没验过 → 撤下并拟写 needs_human_review 行；其他的沿用库里的结论 / 记 unavailable
          if (staleIds.has(r.id)) withholdStale(r, null, `unavailable:${got.status ?? "fetch"}`, { model: null, promptVersion: mode === "pregnancy" ? PREGNANCY_PROMPT_VERSION : FAMILY_PROMPT_VERSION, policyVersion: mode === "pregnancy" ? PREGNANCY_POLICY_VERSION : FAMILY_POLICY_VERSION, basis: "unavailable" });
          else verdict.set(r.id, r.decision ?? "unavailable");
          continue;
        }
        toClassify[mode].push({ id: r.id, file: got.file, day: r.day });
      }
      const refFiles = toClassify.subject.length ? fs.readdirSync(REFS).filter((f) => /\.(webp|jpe?g|png)$/i.test(f)).map((f) => path.join(REFS, f)) : [];
      for (const mode of ["pregnancy", "subject"]) {
        const items = toClassify[mode];
        if (!items.length) continue;
        const out = mode === "pregnancy" ? await classifyPregnancyPhotos(items, { concurrency: 6 }) : await classifyPhotos(items, refFiles, { concurrency: 6 });
        const { results, model } = out; calls[mode] += out.calls;
        const judgedAt = new Date().toISOString();
        const promptVersion = mode === "pregnancy" ? PREGNANCY_PROMPT_VERSION : PROMPT_VERSION;
        const policyVersion = mode === "pregnancy" ? PREGNANCY_POLICY_VERSION : POLICY_VERSION;
        for (const it of items) {
          const r = byId.get(it.id);
          const raw = results[it.id] ?? { error: "no-result" };
          // 保留同一张图已有的家庭生活判定（family），只换主体/孕期这一半
          store.items[it.id] = { ...(store.items[it.id] ?? {}), mode, promptVersion, policyVersion, model, raw, judgedAt };
          const d = mode === "pregnancy" ? decidePregnancyPhoto(raw) : decidePhoto(raw);
          verdictMeta.set(it.id, { raw, decision: d, model, mode, promptVersion, source: "model" });
          const extra = { model, promptVersion, policyVersion, basis: "model" };
          // 出生前的旧版放行：验成（放行或拒绝）都写带 v2 版本号的行，即使库里已是 approved；出错 / 拿不准 → 撤下 + needs_human_review 行
          if (mode === "pregnancy" && staleIds.has(it.id)) { withholdStale(r, raw.error ? null : d, raw.error ? `model-error:${raw.error}` : "model", extra); continue; }
          // 旧版家庭策略的放行（出生后）：主体判定没放行就先保持「撤下」，交给下面的家庭生活分支重验
          if (raw.error || d.decision === "needs_human_review") { verdict.set(it.id, staleIds.has(it.id) ? "needs_human_review" : (r.decision ?? "needs_human_review")); continue; }
          verdict.set(it.id, d.decision);
          pushRow(r, d, extra);
        }
        saveStore(store);
      }

      // 第二步：家庭生活分支——出生后、主体规则没放行、来源是自家、主体结论不是硬拒绝的
      const familyTodo = todo.filter((r) => !isPreBirth(r.day) && verdict.get(r.id) !== "approved" && verdict.get(r.id) !== "unavailable" && isOurs(r) && !subjectVerdictIsFinal(verdictMeta.get(r.id)?.raw ?? null));
      const familyEvidence = new Map(); // id → evidence
      const needModel = [];
      for (const r of familyTodo) {
        const subjectRaw = verdictMeta.get(r.id)?.raw ?? null;
        // 旧证据（旅程标签 / 风景判定）没有 commercial、scenery 没有 who：只能用来拒绝，拒不掉就要模型给完整六字段
        const old = familyEvidenceFromTags(sceneTags[r.id]) ?? familyEvidenceFromScenery(scenery[r.id]);
        if (old && decideFamilyLifePhoto(subjectRaw, { ours: true, family: old }).decision === "store_only") { familyEvidence.set(r.id, old); evidenceReused += 1; continue; }
        const held = store.items[r.id]?.family;
        const fromStore = held && held.promptVersion === FAMILY_PROMPT_VERSION ? familyEvidenceFromModel(held.raw, held.model) : null;
        if (fromStore) { familyEvidence.set(r.id, fromStore); reused += 1; continue; }
        const got = await ensureFile(r);
        if (!got.file) { if (!unavailable.some((u) => u.id === r.id)) unavailable.push({ id: r.id, day: r.day, type: r.type, status: got.status ?? null }); continue; }
        needModel.push({ id: r.id, file: got.file, day: r.day });
      }
      if (needModel.length) {
        const out = await classifyFamilyLifePhotos(needModel, { concurrency: 6 });
        calls.family += out.calls;
        const judgedAt = new Date().toISOString();
        for (const it of needModel) {
          const raw = out.results[it.id] ?? { error: "no-result" };
          // 家庭生活判定与主体判定并列存放（同一张图两种提示词），不覆盖主体 raw
          store.items[it.id] = { ...(store.items[it.id] ?? { mode: modeFor(it.day) }), family: { promptVersion: FAMILY_PROMPT_VERSION, policyVersion: FAMILY_POLICY_VERSION, model: out.model, raw, judgedAt } };
          const ev = familyEvidenceFromModel(raw, out.model);
          if (ev) familyEvidence.set(it.id, ev);
          else verdictMeta.get(it.id) && (verdictMeta.get(it.id).familyError = raw.error ?? "bad-shape");
        }
        saveStore(store);
      }
      for (const r of familyTodo) {
        const ev = familyEvidence.get(r.id);
        if (!ev) continue;
        const meta = verdictMeta.get(r.id) ?? { raw: null, decision: { decision: verdict.get(r.id) ?? "needs_human_review", preset: "db" }, model: null, mode: "subject", source: "db" };
        const d = decideFamilyLifePhoto(meta.raw, { ours: true, family: ev });
        meta.family = { evidence: ev, decision: d };
        verdictMeta.set(r.id, meta);
        const stale = staleIds.has(r.id);
        // 不放行：主体结论原样（库里的旧行 / 本次主体行）。旧版家庭策略的放行例外：明确的拒绝也是重验结果，要写成新版本的行。
        if (d.decision !== "approved" && !(stale && d.decision === "store_only")) continue;
        verdict.set(r.id, d.decision);
        // 本次主体判定已经排了一条行的，改成家庭生活分支的行（同一张图只写一条）
        const at = newRows.findIndex((w) => w.id === r.id);
        if (at >= 0) newRows.splice(at, 1);
        if (stale) staleUnresolved.delete(r.id);
        pushRow(r, d, { model: ev.model ?? null, promptVersion: ev.basis, policyVersion: FAMILY_POLICY_VERSION, basis: ev.basis, family: d.decision === "approved", caption: ev.caption });
      }
      // 兜底：本轮轮到、但到这里仍是「撤下」的旧版放行——确保每一张都有一条 needs_human_review 拟写行，summary 里点名
      for (const r of staleApproved) {
        if (!todoIds.has(r.id)) continue;
        if (verdict.get(r.id) !== "needs_human_review") { staleUnresolved.delete(r.id); continue; }
        const meta = verdictMeta.get(r.id);
        const why = meta?.family?.decision?.why ?? meta?.familyError ?? meta?.decision?.why ?? "unresolved";
        if (!staleUnresolved.has(r.id)) staleUnresolved.set(r.id, `stale-unverified:${why}`);
        if (!newRows.some((w) => w.id === r.id)) {
          const pre = isPreBirth(r.day);
          pushRow(r, resolveStaleApproved(null, why), { model: meta?.model ?? null, promptVersion: pre ? PREGNANCY_PROMPT_VERSION : FAMILY_PROMPT_VERSION, policyVersion: pre ? PREGNANCY_POLICY_VERSION : FAMILY_POLICY_VERSION, basis: "unresolved" });
        }
      }
    }
    if (reused || legacyReused || evidenceReused) say(`复用：仓库判定 ${reused} 条，孕期 v1 拒绝 ${legacyReused} 条，旅程场景/风景证据（只用于拒绝）${evidenceReused} 条；模型调用 孕期 ${calls.pregnancy} / 主体 ${calls.subject} / 家庭生活 ${calls.family}`);
    if (staleUnresolved.size) say(`旧版放行本轮没验成、已撤下 ${staleUnresolved.size} 张（拟写 needs_human_review 行）`);
    // 生活场景 = 本轮家庭生活分支放行的 + 库里已有的当前家庭策略放行行（带场景证据）；重跑时后者不会因为「不在 todo 里」丢掉标记
    const familyIds = new Set([
      ...[...verdictMeta.entries()].filter(([, m]) => m.family?.decision?.decision === "approved").map(([id]) => id),
      ...inScope.filter((r) => verdict.get(r.id) === "approved" && isFamilyApprovedRow(r)).map((r) => r.id),
    ]);
    const familyFromDb = inScope.filter((r) => verdict.get(r.id) === "approved" && isFamilyApprovedRow(r) && !verdictMeta.get(r.id)?.family).length;

    // 有入选照片但这个月还没有这一天的：新建空白机器条目（正文留给改写流程；--write 前必须补上，见下）
    const newDays = new Set();
    {
      const existingDays = new Set(content.days.map((d) => d.day));
      const dayOf = new Map(inScope.map((r) => [r.id, r.day]));
      for (const [id, dec] of verdict) if (dec === "approved" && dayOf.has(id) && !existingDays.has(dayOf.get(id))) newDays.add(dayOf.get(id));
      for (const day of newDays) {
        content.days.push({ _source: "machine", _sourceBasis: "photos-only", day, kind: "visual-description", title: null, paragraphs: [], firstScreenMediaIds: [], expandedMediaIds: [], storyBoundMediaIds: [], sourceIds: [] });
        machineDays.add(day);
      }
      if (newDays.size) say(`新建空白机器条目 ${newDays.size} 天：${[...newDays].sort().join(", ")}`);
      content.days.sort((a, b) => a.day.localeCompare(b.day));
    }

    // 排列并替换机器写的天的媒体清单
    const next = JSON.parse(JSON.stringify(content));
    const byDay = new Map();
    for (const r of inScope) { if (!byDay.has(r.day)) byDay.set(r.day, []); byDay.get(r.day).push({ id: r.id, type: r.type, takenAt: r.takenAt, allowed: verdict.get(r.id) === "approved", family: familyIds.has(r.id) }); }

    // 同场景精选（Teddy 2026-09-23）：先按拍摄时间（本地、10 分钟窗口）缩小候选，
    // 是不是真的同一场景、留哪几张交给看图模型（并发跑，月份大也能在前台跑完）；
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
    // 场景精选的模型判断同样存库复用：同一组成员（按 id 排序）只问一次。
    // 场景精选规则 v3 把每个主体的上限收紧到一张。旧版判断即使是纯人像，
    // 也可能保留三张，因此一律不能复用。
    store.scenes ??= {};
    const sceneStoreKey = (group) => createHash("sha256").update(group.map((m) => m.id).sort().join("|")).digest("hex").slice(0, 24);
    let scenesReused = 0;
    for (const { group } of multiGroups) {
      const held = store.scenes[sceneStoreKey(group)];
      if (held?.promptVersion === CURATE_PROMPT_VERSION) { decisions.set(sceneKeyOf(group), { sameScene: held.sameScene, keep: held.keep, why: held.why }); scenesReused += 1; }
    }
    if (multiGroups.length) {
      let cursor = 0;
      await Promise.all(Array.from({ length: 6 }, async () => {
        while (cursor < multiGroups.length) {
          const { group } = multiGroups[cursor++];
          if (decisions.has(sceneKeyOf(group))) continue;
          const withFiles = [];
          for (const m of group) { const { file } = await ensureFile(m); if (file) withFiles.push({ id: m.id, file }); }
          if (withFiles.length < 2) continue; // 图取不全就不精选，全部保留
          calls.scene += 1;
          const decision = await curateScene(withFiles);
          if (!decision) continue; // 判不出来：全部保留
          decisions.set(sceneKeyOf(group), decision);
          store.scenes[sceneStoreKey(group)] = { members: group.map((m) => m.id), sameScene: decision.sameScene, keep: decision.keep, why: decision.why ?? "", model: visionModel(), promptVersion: CURATE_PROMPT_VERSION, judgedAt: new Date().toISOString() };
        }
      }));
      saveStore(store);
      if (scenesReused) say(`场景精选复用已存判断 ${scenesReused} 组`);
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
    // 每一张的判定明细（对照页用）与每天的统计
    const verdictMetaOut = [];
    const attached = new Set(next.days.filter((d) => d._source === "machine").flatMap((d) => d.expandedMediaIds ?? []));
    const perDay = new Map();
    for (const r of inScope) {
      const meta = verdictMeta.get(r.id);
      const decision = verdict.get(r.id) ?? "unjudged";
      const source = meta?.source ?? (r.decision ? (locked.has(r.id) ? "db-locked" : "db") : "none");
      verdictMetaOut.push({ id: r.id, day: r.day, type: r.type, decision, source, ours: isOurs(r), locked: locked.has(r.id), mode: meta?.mode ?? modeFor(r.day), model: meta?.model ?? null, promptVersion: meta?.promptVersion ?? r.promptVersion ?? null, raw: meta?.raw ?? null, preset: meta?.decision?.preset ?? null, why: meta?.decision?.why ?? null, family: meta?.family ?? null, prior: r.decision ? { decision: r.decision, provider: r.provider, promptVersion: r.promptVersion } : null, attached: attached.has(r.id) });
      const p = perDay.get(r.day) ?? { day: r.day, total: 0, approved: 0, family: 0, rejected: 0, uncertain: 0, unavailable: 0, attached: 0, attachedFamily: 0, reasons: {} };
      p.total += 1;
      if (decision === "approved") p.approved += 1;
      else if (decision === "unavailable") p.unavailable += 1;
      else if (decision === "needs_human_review" || decision === "unjudged") p.uncertain += 1;
      else p.rejected += 1;
      if (familyIds.has(r.id)) p.family += 1;
      if (decision !== "approved" && decision !== "unavailable") { const k = meta?.family?.decision?.why ?? meta?.decision?.why ?? meta?.decision?.preset ?? decision; p.reasons[k] = (p.reasons[k] ?? 0) + 1; }
      if (attached.has(r.id)) { p.attached += 1; if (familyIds.has(r.id)) p.attachedFamily += 1; }
      perDay.set(r.day, p);
    }
    fs.writeFileSync(path.join(OUT, "verdict-meta.jsonl"), verdictMetaOut.map((v) => JSON.stringify(v)).join("\n") + "\n", "utf8");

    const daysWithoutEntry = [...byDay.entries()].filter(([day, list]) => !content.days.some((d) => d.day === day) && list.some((m) => m.allowed)).map(([day]) => day);
    const candidate = path.join(OUT, `${MONTH}.media.json`);
    fs.writeFileSync(candidate, JSON.stringify(next, null, 1));
    const approvedIds = newRows.filter((r) => r.decision === "approved").map((r) => r.id);
    const reviewRows = newRows.map((w) => ({ ...w, reviewId: reviewIdFor(w) }));
    fs.writeFileSync(path.join(OUT, "reviews.json"), JSON.stringify({ month: MONTH, at: new Date().toISOString(), lockRule: `provider ∉ {${AUTO_REVIEW_PROVIDERS.join(",")}} / reason_codes 含 manual: / prompt_version teddy-* 的行不可翻转，且这些对象不插新行`, rows: reviewRows }, null, 1));
    const rejectedSample = verdictMetaOut.filter((v) => v.decision !== "approved").slice(0, 30);
    const heldRows = newRows.filter((w) => w.decision === "needs_human_review").length;
    const summary = { month: MONTH, total: rows.length, judgedThisRun: [...verdictMeta.values()].filter((m) => m.source === "model").length, reusedFromStore: reused, legacyReused, evidenceReused, judgedBeforeInDb: inScope.length - unjudged.length, locked: locked.size, reReviewCandidates: autoRejected.length, heldRetried: heldPreBirth.length, staleApproved: staleApproved.length, staleUnresolved: [...staleUnresolved].map(([id, why]) => ({ id, day: byId.get(id)?.day ?? null, why })), modelCalls: calls, approvedTotal: [...verdict.values()].filter((d) => d === "approved").length, familyApproved: familyIds.size, familyFromDb, familyAttached: [...attached].filter((id) => familyIds.has(id)).length, dayCap: DAY_MEDIA_CAP, unavailable, perDay: [...perDay.values()].sort((a, b) => a.day.localeCompare(b.day)), judged: newRows.length, reReviewRows: newRows.filter((w) => w.reReview).length, heldRows, approvedNew: approvedIds.length, approvedIds, rejectedSample, newPhotos: photos, newVideos: videos, changedDays, newDays: [...newDays].sort(), daysWithoutEntry, curation };
    fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
    say(`新挂上 照片 ${photos} / 视频 ${videos}，改动 ${changedDays.length} 天；家庭生活放行 ${familyIds.size}（其中库里已有 ${familyFromDb}，挂上 ${summary.familyAttached}）；拟写核验行 ${newRows.length}（通过 ${approvedIds.length}，拒绝 ${newRows.length - approvedIds.length - heldRows}，撤下待人看 ${heldRows}，其中重审 ${summary.reReviewRows}）`);
    if (!WRITE_REVIEWS) return;

    if (newRows.length) {
      const profileId = (await q(`select profile_id from content_quality_reviews limit 1`))[0].profile_id;
      const before = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
      await rds.client.query("begin");
      let inserted = 0;
      for (const w of reviewRows) {
        const model = w.model ?? visionModel();
        const provider = String(model).startsWith("glm") ? "glm" : "deepseek";
        const codes = [w.family ? "basis:auto-family-life-policy" : "basis:auto-deepseek-policy", `label:${w.preset}`, `evidence:${w.basis ?? "model"}`, "authorized-by:teddy-2026-09-27-rollout"];
        if (w.reReview) codes.push(`re-review-of:${w.prior?.provider ?? ""}/${w.prior?.promptVersion ?? ""}/${w.prior?.decision ?? ""}`);
        // 没判过的：对象上不能已有任何行。重审的：对象上不能有任何人工锁行（manual / claude-* / manual: 原因码 / teddy-*），且最新一行必须是自动策略。
        const guard = w.reReview
          ? `and not exists (select 1 from content_quality_reviews g where g.target_kind='media_subject_check' and g.target_id=$3 and (g.provider is null or g.provider not in ('deepseek','glm') or g.prompt_version like 'teddy-%' or g.reason_codes::text like '%manual:%'))
             and (select g.provider from content_quality_reviews g where g.target_kind='media_subject_check' and g.target_id=$3 order by g.reviewed_at desc limit 1) in ('deepseek','glm')`
          : `and not exists (select 1 from content_quality_reviews g where g.target_kind='media_subject_check' and g.target_id=$3)`;
        const res = await rds.client.query(
          `insert into content_quality_reviews (id, profile_id, target_kind, target_id, decision, reason_codes, provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at)
           select $1,$2,'media_subject_check',$3,$4,$5::jsonb,$10,$6,$7,$8,$9, now() at time zone 'Asia/Shanghai'
            where not exists (select 1 from content_quality_reviews where id=$1) ${guard}
           on conflict do nothing returning id`,
          [w.reviewId, profileId, w.id, w.decision, JSON.stringify(codes), model, w.promptVersion ?? PROMPT_VERSION, w.policyVersion ?? POLICY_VERSION, `${w.reviewId}:media_subject_check`, provider]);
        inserted += res.rowCount;
      }
      const after = Number((await q(`select count(*)::int n from content_quality_reviews`))[0].n);
      if (after - before !== inserted) { await rds.client.query("rollback"); throw new Error(`核验行增量 ${after - before} != ${inserted}`); }
      await rds.client.query("commit");
      summary.reviewsInserted = inserted; summary.reviewsSkippedByGuard = reviewRows.length - inserted;
      fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
      say(`核验行已写入 ${inserted} 条（守卫跳过 ${reviewRows.length - inserted} 条）`);
    }
    if (!WRITE) return;
    // 安装前的三道闸（Codex 复核 2026-09-27）：内容必须过页面同一套 schema 校验；新建的天正文不能空白（空白天由改写流程写完再装）；
    // 本轮撤下的旧版放行不能还挂在内容里（人工天的媒体清单本脚本不动，所以要查）。任何一道不过就不装，核验行已写的保留。
    const gate = installGate(next, MONTH, { newDays, staleUnresolved: new Set(staleUnresolved.keys()), validate: validateMonthContent });
    if (gate.length) {
      summary.installRefused = gate;
      fs.writeFileSync(path.join(OUT, "summary.json"), JSON.stringify(summary, null, 1));
      throw new Error(`不装内容：${gate.join("；")}`);
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

/**
 * 核验行 id：策略版本 + 媒体 id + 结论派生。同一策略、同一张图、同一结论 → 同一 id，重跑不重复插；
 * 新策略（重审）或同一策略下结论变了（旧版放行先撤下 needs_human_review、下一轮验成 approved）→ 新 id，旧行保留。
 * 2026-09-27 之前不含结论：那时「撤下」行和随后的「放行」行会撞同一个 id，后者永远插不进去。
 */
function reviewIdFor(w) {
  return `subj-autophoto-${createHash("sha256").update(`${w.policyVersion ?? POLICY_VERSION}\n${w.id}\n${w.decision}`).digest("hex").slice(0, 20)}`;
}


main().catch((e) => { console.error(e); process.exit(3); });
