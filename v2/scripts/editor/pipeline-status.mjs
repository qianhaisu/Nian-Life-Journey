// End-to-end daily update state ledger, non-reentrant lock manager, and live health inspector.
// Strictly separates "no_qualifying_material" / "skipped_no_material" (bound to an exact
// evidenceFingerprint so newly exported messages or photos automatically reopen the day)
// from "failed_infra" and "blocked_upstream_export".
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import { addDays, shanghaiToday, isReadable } from "./plan.mjs";
import { resolveEcsConnection } from "../lib/ecs-connection.mjs";

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function defaultPidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}

/**
 * Non-reentrant PID lockfile with automatic stale-process recovery.
 */
export function acquireProcessLock(lockPath, {
  pid = process.pid,
  label = "pipeline",
  nowMs = Date.now(),
  staleMs = 3 * 3600 * 1000,
  isPidAlive = defaultPidAlive,
} = {}) {
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  const payload = JSON.stringify({ pid, label, acquiredAt: new Date(nowMs).toISOString(), acquiredMs: nowMs }, null, 2) + "\n";

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(lockPath, payload, { encoding: "utf8", flag: "wx" });
      return { acquired: true, lockPath, pid, recoveredStale: attempt > 0 };
    } catch (err) {
      if (err?.code !== "EEXIST") throw err;
      let existing = null;
      try { existing = JSON.parse(fs.readFileSync(lockPath, "utf8")); } catch { existing = null; }
      const holderPid = Number(existing?.pid ?? 0);
      const ageMs = existing?.acquiredMs ? nowMs - Number(existing.acquiredMs) : Infinity;
      const alive = holderPid > 0 && isPidAlive(holderPid);
      if (alive && ageMs < staleMs) {
        return { acquired: false, lockPath, holderPid, acquiredAt: existing?.acquiredAt ?? null, reason: "lock_held_by_active_process" };
      }
      try { fs.unlinkSync(lockPath); } catch { /* race lost; next iteration handles */ }
    }
  }
  return { acquired: false, lockPath, reason: "lock_contention" };
}

export function releaseProcessLock(lockPath, pid = process.pid) {
  try {
    const existing = JSON.parse(fs.readFileSync(lockPath, "utf8"));
    if (Number(existing?.pid) === pid) fs.unlinkSync(lockPath);
  } catch { /* already cleaned up */ }
}

/**
 * Deterministic fingerprint of a day's raw evidence in RDS (messages + photos).
 * When late WeChat exports bring in missing messages or photos, this hash changes,
 * automatically invalidating any premature "no_qualifying_material" skip!
 */
export function computeDayEvidenceFingerprint(sources = [], photoIds = []) {
  const normalizedSources = [...sources]
    .map((s) => ({ id: s.id, time: s.time, speaker: s.speaker ?? null, text: s.text }))
    .sort((a, b) => a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  const normalizedPhotos = [...photoIds].sort();
  return sha256(JSON.stringify({ sources: normalizedSources, photos: normalizedPhotos }));
}

export function classifyDayState(status) {
  if (status === "published") return "published";
  if (status === "no_qualifying_material" || status === "no_raw_sources" || status === "skipped_no_material") return "skipped_no_material";
  if (status === "blocked_upstream_export") return "blocked_upstream_export";
  if (status === "failed_infra") return "failed_infra";
  return "pending_editorial";
}

/**
 * Pure per-day classification across [from .. through].
 * Never marks infra failures or upstream export lags as "no_qualifying_material".
 */
export function computeDayStatuses({
  from,
  through,
  publishedDays = new Set(),
  dayEvidence = {},
  ledgerDays = {},
  rdsMaxDay = null,
  upstreamStale = false,
}) {
  const out = [];
  for (let d = from; d <= through; d = addDays(d, 1)) {
    const ev = dayEvidence[d] ?? { readableCount: 0, totalCount: 0, photoCount: 0, fingerprint: computeDayEvidenceFingerprint([], []) };
    const led = ledgerDays[d] ?? null;
    const isPublished = publishedDays.has(d);

    let status;
    let detail;
    if (isPublished) {
      status = "published";
      detail = "已发布在线上月度内容文件中";
    } else if (led?.status === "failed_infra") {
      status = "failed_infra";
      detail = `上次处理未完成（${led.stage ?? "editorial"}: ${led.errorCode ?? "ERR"}），待自动重试，绝不归为无素材`;
    } else if (ev.readableCount === 0 && ev.photoCount === 0) {
      if (!rdsMaxDay || d > rdsMaxDay || upstreamStale) {
        status = "blocked_upstream_export";
        detail = `库中暂无该日消息，但上游导出水位仅到 ${rdsMaxDay ?? "未知"}，需先同步后再判定`;
      } else {
        status = "no_raw_sources";
        detail = "微信已同步越过该日，当日确实无可读聊天与儿童照片";
      }
    } else if (led?.status === "no_qualifying_material" || led?.status === "skipped_no_material") {
      if (led.evidenceFingerprint && led.evidenceFingerprint === ev.fingerprint) {
        status = "no_qualifying_material";
        detail = led.reason || "当日原始消息不含可独立成篇的儿童事实";
      } else {
        status = "pending_reopen";
        detail = `当日新增或变更了原始素材（可读消息 ${ev.readableCount} 条、照片 ${ev.photoCount} 张），已自动解除旧跳过标记`;
      }
    } else {
      status = "pending";
      detail = `待审稿写稿（可读消息 ${ev.readableCount} 条，已核验照片 ${ev.photoCount} 张）`;
    }

    out.push({
      day: d,
      status,
      classification: classifyDayState(status),
      readableCount: ev.readableCount,
      totalSourceCount: ev.totalCount,
      approvedPhotoCount: ev.photoCount,
      evidenceFingerprint: ev.fingerprint,
      detail,
    });
  }
  return out;
}

export function readEditorialLedger(ledgerPath) {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
    return parsed && typeof parsed === "object" && parsed.days ? parsed : { schema: "nianlife.editorial-ledger/1", updatedAt: null, days: {} };
  } catch {
    return { schema: "nianlife.editorial-ledger/1", updatedAt: null, days: {} };
  }
}

export function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, filePath);
}

/**
 * Update per-day editorial ledger atomically.
 */
export function recordEditorialOutcomes(ledgerPath, {
  reviewedAt = new Date().toISOString(),
  runId = null,
  wrote = [],
  skipped = [],
  failed = [],
  dayFingerprints = {},
}) {
  const ledger = readEditorialLedger(ledgerPath);
  for (const item of wrote) {
    const day = typeof item === "string" ? item : item.day;
    const obj = typeof item === "object" && item ? item : {};
    ledger.days[day] = {
      status: "published",
      classification: "published",
      updatedAt: reviewedAt,
      runId,
      evidenceFingerprint: dayFingerprints[day] ?? obj.evidenceFingerprint ?? ledger.days[day]?.evidenceFingerprint ?? null,
      version: obj.version ?? ledger.days[day]?.version ?? null,
    };
  }
  for (const item of skipped) {
    const day = typeof item === "string" ? item : item.day;
    const reason = typeof item === "string" ? "当日原始消息不含可独立成篇的儿童事实" : item.reason;
    ledger.days[day] = {
      status: "no_qualifying_material",
      classification: "skipped_no_material",
      reason,
      updatedAt: reviewedAt,
      runId,
      evidenceFingerprint: dayFingerprints[day] ?? item.evidenceFingerprint ?? null,
    };
  }
  for (const item of failed) {
    const day = typeof item === "string" ? item : item.day;
    if (ledger.days[day]?.status === "published") continue;
    ledger.days[day] = {
      status: "failed_infra",
      classification: "failed_infra",
      stage: item.stage ?? "editorial",
      errorCode: item.errorCode ?? "UNKNOWN",
      updatedAt: reviewedAt,
      runId,
    };
  }
  ledger.updatedAt = reviewedAt;
  writeJsonAtomic(ledgerPath, ledger);
  return ledger;
}

async function queryRdsDayEvidence(client, from, untilExclusive, labelForSender) {
  const rawRows = (await client.query(`
    select id,
           to_char(captured_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as day,
           to_char(captured_at at time zone 'Asia/Shanghai', 'HH24:MI:SS.US') as time,
           text,
           source_label,
           metadata->>'senderDigest' as sender_digest
      from raw_sources
     where source_type = 'wechat'
       and captured_at >= ($1::date::timestamp at time zone 'Asia/Shanghai')
       and captured_at < ($2::date::timestamp at time zone 'Asia/Shanghai')
       and deleted_at is null
       and coalesce(metadata->>'duplicateOf', '') = ''
     order by captured_at, id
  `, [from, untilExclusive])).rows;

  const photoRows = (await client.query(`
    select m.id, to_char(m.taken_at, 'YYYY-MM-DD') as day
      from media m
     where m.type = 'photo'
       and m.visibility <> 'private'
       and m.taken_at >= $1::date
       and m.taken_at < $2::date
       and (
         select decision from content_quality_reviews q
          where q.target_kind = 'media_subject_check' and q.target_id = m.id
          order by q.reviewed_at desc limit 1
       ) = 'approved'
     order by m.taken_at, m.id
  `, [from, untilExclusive])).rows;

  const rawByDay = new Map();
  for (const r of rawRows) {
    if (!rawByDay.has(r.day)) rawByDay.set(r.day, []);
    rawByDay.get(r.day).push({
      id: r.id,
      time: r.time,
      text: String(r.text ?? ""),
      speaker: labelForSender(r.sender_digest, r.source_label),
    });
  }
  const photosByDay = new Map();
  for (const p of photoRows) {
    if (!photosByDay.has(p.day)) photosByDay.set(p.day, []);
    photosByDay.get(p.day).push(p.id);
  }

  const dayEvidence = {};
  const through = addDays(untilExclusive, -1);
  for (let d = from; d <= through; d = addDays(d, 1)) {
    const srcs = rawByDay.get(d) ?? [];
    const pids = photosByDay.get(d) ?? [];
    const readable = srcs.filter((s) => isReadable(s.text));
    dayEvidence[d] = {
      readableCount: readable.length,
      totalCount: srcs.length,
      photoCount: pids.length,
      fingerprint: computeDayEvidenceFingerprint(readable, pids),
    };
  }
  return dayEvidence;
}

function inspectWeFlowUpstream(today) {
  const yesterday = addDays(today, -1);
  const srcDir = process.env.NIANLIFE_WECHAT_EXPORT_TEXTS ?? "E:/WechatHis/texts";
  let maxExportedDay = null;
  let transcriptCount = 0;
  const dateRe = /\b(202\d)\\?-([01]\d)\\?-([0-3]\d)\b/g;

  if (fs.existsSync(srcDir)) {
    const files = [];
    for (const ent of fs.readdirSync(srcDir, { withFileTypes: true })) {
      if (ent.isDirectory()) {
        for (const f of fs.readdirSync(path.join(srcDir, ent.name), { withFileTypes: true })) {
          if (f.isFile() && /\.md$/i.test(f.name)) files.push(path.join(srcDir, ent.name, f.name));
        }
      } else if (ent.isFile() && /\.md$/i.test(ent.name)) {
        files.push(path.join(srcDir, ent.name));
      }
    }
    transcriptCount = files.length;
    for (const f of files) {
      const buf = fs.readFileSync(f);
      const tail = buf.subarray(Math.max(0, buf.length - 131072)).toString("utf8");
      for (const m of tail.matchAll(dateRe)) {
        const d = `${m[1]}-${m[2]}-${m[3]}`;
        if (d <= today && (!maxExportedDay || d > maxExportedDay)) maxExportedDay = d;
      }
    }
  }

  const tasks = [];
  try {
    const wfPath = path.join(os.homedir(), "AppData", "Roaming", "weflow", "WeFlow-config.json");
    if (fs.existsSync(wfPath)) {
      const wf = JSON.parse(fs.readFileSync(wfPath, "utf8"));
      for (const group of Object.values(wf.exportAutomationTaskMap ?? {})) {
        for (const t of group?.tasks ?? []) {
          if (!t?.enabled) continue;
          const rs = t.runState ?? {};
          tasks.push({
            id: t.id,
            lastRunStatus: rs.lastRunStatus ?? "unknown",
            lastTriggeredAt: rs.lastTriggeredAt ? new Date(rs.lastTriggeredAt).toISOString() : null,
            lastSuccessAt: rs.lastSuccessAt ? new Date(rs.lastSuccessAt).toISOString() : null,
            wcdbDisconnected: typeof rs.lastError === "string" && rs.lastError.includes("WCDB"),
            intervalDays: t.schedule?.intervalDays ?? null,
            intervalHours: t.schedule?.intervalHours ?? null,
            preset: t.template?.dateRangeConfig?.preset ?? null,
          });
        }
      }
    }
  } catch { /* ignore */ }

  const stale = !maxExportedDay || maxExportedDay < yesterday;
  return {
    ok: !stale,
    transcriptCount,
    maxExportedDay,
    expectedAtLeast: yesterday,
    stale,
    autoTasksWithError: tasks.filter((t) => t.lastRunStatus === "error").length,
    tasks,
  };
}

function inspectArchiveSnapshots(opsRoot) {
  const exportsDir = path.join(path.dirname(opsRoot), "exports");
  if (!fs.existsSync(exportsDir)) return { ok: false, latestSnapshot: null };
  const dirs = fs.readdirSync(exportsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^202\d-\d{2}-\d{2}/.test(d.name))
    .map((d) => d.name)
    .sort();
  const latest = dirs.at(-1) ?? null;
  if (!latest) return { ok: false, latestSnapshot: null };
  const manifestPath = path.join(exportsDir, latest, "MANIFEST.json");
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); } catch { /* ignore */ }
  return {
    ok: Boolean(manifest),
    latestSnapshot: latest,
    archivedAt: manifest?.archivedAt ?? null,
    fileCount: manifest?.files?.length ?? 0,
    maxExportedDay: manifest?.maxExportedDay ?? null,
  };
}

export async function inspectFullPipeline({
  today = shanghaiToday(),
  lookbackDays = 21,
  opsDir = process.env.NIANLIFE_OPS_DIR ?? path.join(os.homedir(), "NianlifeOps", "ops-daily"),
} = {}) {
  const [{ labelForSender }, { readProductionSnapshot }] = await Promise.all([
    import("./identity-rules.mjs"),
    import("./codex-editor.mjs"),
  ]);

  const from = addDays(today, -lookbackDays);
  const through = addDays(today, -1);
  const stateDir = path.join(opsDir, "state");
  const ledgerPath = path.join(stateDir, "editorial-ledger.json");
  const stateFilePath = path.join(stateDir, "pipeline-state.json");
  const workerStatePath = path.join(stateDir, "worker-state.json");
  const lastSyncRunPath = path.join(stateDir, "last-sync-run.json");

  const weflow = inspectWeFlowUpstream(today);
  const archive = inspectArchiveSnapshots(opsDir);
  let workerState = null;
  let lastSyncRun = null;
  try { workerState = JSON.parse(fs.readFileSync(workerStatePath, "utf8")); } catch { /* ignore */ }
  try { lastSyncRun = JSON.parse(fs.readFileSync(lastSyncRunPath, "utf8")); } catch { /* ignore */ }

  const rdsStage = { ok: false, error: null, rdsMaxDay: null, rdsMaxCapturedAt: null, totalWechatSources: 0, ossMediaReady: 0, r2MediaCount: 0 };
  const photoStage = { ok: false, unreviewedCount: 0, approvedButPrivateCount: 0, approvedDeliverableRecent: 0 };
  let dayEvidence = {};

  try {
    const { openRds } = await import(new URL("../../.data/night-rds.mjs", import.meta.url));
    const rds = await openRds({ readOnly: true, localPort: 15810 + Math.floor(Math.random() * 120) });
    try {
      const wm = (await rds.client.query(`
        select count(*)::int as total_wechat,
               to_char(max(captured_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD') as max_day,
               to_char(max(captured_at) at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as max_ts
          from raw_sources
         where source_type = 'wechat' and deleted_at is null
      `)).rows[0];
      rdsStage.totalWechatSources = wm.total_wechat;
      rdsStage.rdsMaxDay = wm.max_day;
      rdsStage.rdsMaxCapturedAt = wm.max_ts;

      const storageCounts = (await rds.client.query(`
        select provider, count(*)::int as n
          from media_locations
         where status = 'ready'
         group by provider
      `)).rows;
      rdsStage.ossMediaReady = storageCounts.find((r) => r.provider === "oss")?.n ?? 0;
      rdsStage.r2MediaCount = storageCounts.find((r) => r.provider === "r2")?.n ?? 0;
      rdsStage.ok = Boolean(rdsStage.rdsMaxDay && rdsStage.rdsMaxDay >= through && rdsStage.r2MediaCount === 0);

      const photoStats = (await rds.client.query(`
        select
          count(*) filter (
            where not exists (
              select 1 from content_quality_reviews r
               where r.target_kind = 'media_subject_check' and r.target_id = m.id
            )
          )::int as unreviewed,
          count(*) filter (
            where m.visibility = 'private' and exists (
              select 1 from content_quality_reviews r
               where r.target_kind = 'media_subject_check' and r.target_id = m.id and r.decision = 'approved'
            )
          )::int as approved_but_private,
          count(*) filter (
            where m.visibility <> 'private' and exists (
              select 1 from content_quality_reviews r
               where r.target_kind = 'media_subject_check' and r.target_id = m.id and r.decision = 'approved'
            )
          )::int as approved_visible
        from media m
        where m.type = 'photo' and m.taken_at >= $1::date
      `, [from])).rows[0];
      photoStage.unreviewedCount = photoStats.unreviewed;
      photoStage.approvedButPrivateCount = photoStats.approved_but_private;
      photoStage.approvedDeliverableRecent = photoStats.approved_visible;
      photoStage.ok = photoStats.unreviewed === 0 && photoStats.approved_but_private === 0;

      dayEvidence = await queryRdsDayEvidence(rds.client, from, today, labelForSender);
    } finally {
      await rds.close();
    }
  } catch (err) {
    rdsStage.error = String(err?.message ?? err).slice(0, 240);
  }

  const months = [];
  for (let d = from; d <= through; d = addDays(d, 1)) {
    const m = d.slice(0, 7);
    if (!months.includes(m)) months.push(m);
  }
  const publishedDays = new Set();
  const productionMonths = {};
  let productionReadError = null;
  const localContentDir = process.env.MONTH_CONTENT_DIR?.trim() || null;
  try {
    const ecs = resolveEcsConnection();
    const probeDir = path.join(stateDir, "probe-production");
    fs.mkdirSync(probeDir, { recursive: true });
    for (const m of months) {
      const dst = path.join(probeDir, `${m}.json`);
      try { fs.unlinkSync(dst); } catch {}
      const snap = readProductionSnapshot(m, dst, ecs);
      const dayList = snap.content?.days?.map((x) => x.day) ?? [];
      for (const d of dayList) publishedDays.add(d);
      let localMirrorMatches = undefined;
      if (localContentDir) {
        const localFile = path.join(localContentDir, `${m}.json`);
        if (snap.revision === "absent") {
          localMirrorMatches = !fs.existsSync(localFile);
        } else if (fs.existsSync(localFile)) {
          localMirrorMatches = sha256(fs.readFileSync(localFile)) === snap.revision;
        } else {
          localMirrorMatches = false;
        }
      }
      productionMonths[m] = {
        revision: snap.revision === "absent" ? "absent" : snap.revision.slice(0, 12),
        fullRevision: snap.revision,
        dayCount: dayList.length,
        latestDay: dayList.at(-1) ?? null,
        hasCover: Boolean(snap.content?.coverMediaId),
        ...(localMirrorMatches !== undefined ? { localMirrorMatches } : {}),
      };
    }
  } catch (err) {
    productionReadError = String(err?.message ?? err).slice(0, 240);
  }

  let liveHealth = { ok: false, sha: null, db: null, mediaProvider: null };
  try {
    const res = await fetch("https://nianlife.cn/api/health", { signal: AbortSignal.timeout(15_000) });
    if (res.ok) {
      const body = await res.json();
      liveHealth = {
        ok: Boolean(body.ok),
        sha: body.build?.sha ?? null,
        db: body.db ?? null,
        mediaProvider: body.media?.provider ?? null,
        rawSourceCount: body.rawSourceCount ?? null,
        mediaCount: body.mediaCount ?? null,
      };
    }
  } catch (err) {
    liveHealth.error = String(err?.message ?? err).slice(0, 160);
  }

  const ledger = readEditorialLedger(ledgerPath);
  const days = rdsStage.error || productionReadError
    ? []
    : computeDayStatuses({
        from,
        through,
        publishedDays,
        dayEvidence,
        ledgerDays: ledger.days,
        rdsMaxDay: rdsStage.rdsMaxDay,
        upstreamStale: weflow.stale,
      });

  const pendingDays = days.filter((d) => d.status === "pending" || d.status === "pending_reopen").map((d) => d.day);
  const failedInfraDays = days.filter((d) => d.status === "failed_infra").map((d) => d.day);
  const blockedUpstreamDays = days.filter((d) => d.status === "blocked_upstream_export").map((d) => d.day);
  const skippedNoMaterialDays = days
    .filter((d) => d.status === "no_qualifying_material" || d.status === "no_raw_sources")
    .map((d) => ({ day: d.day, status: d.status, reason: d.detail }));
  const publishedDaysInWindow = days.filter((d) => d.status === "published").map((d) => d.day);

  // Determine exact last successful stage, current failure (if any), and recovery action.
  let currentFailure = null;
  let recoveryAction = null;
  if (weflow.stale) {
    currentFailure = { stage: "1_weflow_export", reason: `E:/WechatHis/texts 最新消息仅到 ${weflow.maxExportedDay ?? "无"}（应至少到 ${through}）` };
    recoveryAction = "打开微信并登录，在 WeFlow 中手动导出最近聊天记录（并将计划任务改为每 4 小时增量导出最近 30 天），随后运行 v2\\.data\\daily-wechat-sync.cmd";
  } else if (!rdsStage.ok) {
    const r2Msg = rdsStage.r2MediaCount > 0 ? `检测到违规 R2 媒体 ${rdsStage.r2MediaCount} 条` : null;
    currentFailure = { stage: "3_rds_oss_sync", reason: rdsStage.error ?? r2Msg ?? `RDS 水位仅到 ${rdsStage.rdsMaxDay}（应到 ${through}）` };
    recoveryAction = "运行 C:\\Users\\teddy\\Documents\\Nianlife\\v2\\.data\\daily-wechat-sync.cmd 补齐入库与 OSS 媒体上传";
  } else if (!photoStage.ok) {
    currentFailure = { stage: "4_photo_review", reason: `存在 ${photoStage.unreviewedCount} 张未核验照片、${photoStage.approvedButPrivateCount} 张核验通过但仍为 private 的照片` };
    recoveryAction = "运行 session-photo-review.mjs 生成缩略图联系表并完成主体核验与 visibility='family' 原子更新";
  } else if (productionReadError) {
    currentFailure = { stage: "5_production_content_probe", reason: productionReadError };
    recoveryAction = "检查 ECS SSH 密钥与网络连通性后重跑 pipeline-status.mjs";
  } else if (failedInfraDays.length || pendingDays.length) {
    currentFailure = { stage: "5_editorial_review", reason: `待处理日期：${[...failedInfraDays, ...pendingDays].join(", ")}` };
    recoveryAction = "运行每日编辑工作流（codex-editor.mjs prepare -> 审稿写稿 -> apply --literary -> deploy-ecs-public.sh content-install -> revalidate -> record-editorial）";
  } else if (!liveHealth.ok) {
    currentFailure = { stage: "6_live_site", reason: liveHealth.error ?? "https://nianlife.cn/api/health 异常" };
    recoveryAction = "检查 ECS nianlife-diag-web 与 nianlife-caddy 容器状态";
  }

  const lastCompletedStage = !currentFailure
    ? "6_live_site (全链路健康，已处理至昨天)"
    : currentFailure.stage.startsWith("6_") ? "5_editorial_review"
    : currentFailure.stage.startsWith("5_") ? "4_photo_review"
    : currentFailure.stage.startsWith("4_") ? "3_rds_oss_sync"
    : currentFailure.stage.startsWith("3_") ? "2_archive_snapshot"
    : "0_none";

  const latestPublishedDay = [...publishedDays].sort().at(-1) ?? null;
  const resolvedDays = [
    ...publishedDays,
    ...days.filter((d) => d.classification === "published" || d.classification === "skipped_no_material").map((d) => d.day),
  ].sort();

  const report = {
    schema: "nianlife.pipeline-state/1",
    inspectedAt: new Date().toISOString(),
    today,
    window: { from, through, lookbackDays },
    overallHealthy: currentFailure === null,
    lastCompletedStage,
    processedThroughDay: resolvedDays.at(-1) ?? null,
    latestPublishedDay,
    rdsWatermarkDay: rdsStage.rdsMaxDay,
    currentFailure,
    recoveryAction,
    stages: {
      weflowExport: weflow,
      archiveSnapshot: archive,
      rdsOssSync: {
        ...rdsStage,
        lastWorkerRunAt: workerState?.lastSuccessfulRunAt ?? workerState?.lastRunAt ?? null,
        lastSyncRun,
      },
      photoReview: photoStage,
      editorialContent: {
        productionMonths,
        publishedCount: publishedDaysInWindow.length,
        publishedDays: publishedDaysInWindow,
        noQualifyingMaterialCount: days.filter((d) => d.status === "no_qualifying_material").length,
        noRawSourcesCount: days.filter((d) => d.status === "no_raw_sources").length,
        skippedNoMaterialCount: skippedNoMaterialDays.length,
        skippedNoMaterialDays,
        pendingDays,
        pendingEditorialDays: pendingDays,
        failedInfraDays,
        blockedUpstreamDays,
      },
      liveSite: liveHealth,
    },
    days,
  };

  writeJsonAtomic(stateFilePath, report);
  return report;
}

export function formatPipelineMarkdown(report) {
  const lines = [
    `# Nianlife 每日更新链路状态 (${report.today})`,
    "",
    `- **整体健康**: ${report.overallHealthy ? "正常 (OK)" : "待处理 / 异常 (ATTENTION)"}`,
    `- **最后成功阶段**: \`${report.lastCompletedStage}\``,
    `- **RDS 原始消息水位**: \`${report.rdsWatermarkDay ?? "未知"}\` (${report.stages.rdsOssSync.rdsMaxCapturedAt ?? "-"})`,
    `- **已审结处理水位**: \`${report.processedThroughDay ?? "未知"}\`（最新成文发布：\`${report.latestPublishedDay ?? "未知"}\`）`,
  ];
  if (report.currentFailure) {
    lines.push(
      `- **当前断点**: \`${report.currentFailure.stage}\` — ${report.currentFailure.reason}`,
      `- **恢复方式**: ${report.recoveryAction}`,
    );
  }
  lines.push("", "## 窗口内每日状态明细", "", "| 日期 | 状态 | 分类 | 可读消息 | 已放行照片 | 说明 |", "|---|---|---|---:|---:|---|");
  for (const d of report.days) {
    lines.push(`| ${d.day} | \`${d.status}\` | \`${d.classification}\` | ${d.readableCount} | ${d.approvedPhotoCount} | ${d.detail} |`);
  }
  return lines.join("\n") + "\n";
}

function parseJsonOrFile(raw) {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return JSON.parse(trimmed);
  if (fs.existsSync(path.resolve(trimmed))) return JSON.parse(fs.readFileSync(path.resolve(trimmed), "utf8"));
  return null;
}

async function loadFingerprintsFromRdsForDays(daysList) {
  const uniqueDays = [...new Set(daysList.filter((d) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort();
  if (!uniqueDays.length) return {};
  const from = uniqueDays[0];
  const untilExclusive = addDays(uniqueDays.at(-1), 1);
  const { labelForSender } = await import("./identity-rules.mjs");
  const { openRds } = await import(new URL("../../.data/night-rds.mjs", import.meta.url));
  const rds = await openRds({ readOnly: true, localPort: 15930 + Math.floor(Math.random() * 60) });
  try {
    const dayEvidence = await queryRdsDayEvidence(rds.client, from, untilExclusive, labelForSender);
    const out = {};
    for (const d of uniqueDays) {
      if (dayEvidence[d]?.fingerprint) out[d] = dayEvidence[d].fingerprint;
    }
    return out;
  } finally {
    await rds.close();
  }
}

async function cli() {
  const args = process.argv.slice(2);
  const cmd = args[0] && !args[0].startsWith("--") ? args[0] : "inspect";
  const flag = (name) => args.includes(`--${name}`);
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const opsDir = opt("ops-dir") ?? process.env.NIANLIFE_OPS_DIR ?? path.join(os.homedir(), "NianlifeOps", "ops-daily");

  if (cmd === "inspect") {
    const lookbackDays = Number(opt("lookback-days") ?? 21);
    const report = await inspectFullPipeline({ today: opt("today") ?? shanghaiToday(), lookbackDays, opsDir });
    const outFile = opt("out");
    if (outFile) writeJsonAtomic(path.resolve(outFile), report);
    if (flag("json") || outFile) console.log(JSON.stringify(report, null, 2));
    else console.log(formatPipelineMarkdown(report));
    process.exitCode = report.overallHealthy ? 0 : 1;
    return;
  }

  if (cmd === "record-sync") {
    const syncReceiptPath = path.join(opsDir, "state", "last-sync-run.json");
    const exitCode = Number(opt("exit-code") ?? 0);
    writeJsonAtomic(syncReceiptPath, {
      at: new Date().toISOString(),
      exitCode,
      ok: exitCode === 0,
      stage: opt("stage") ?? "worker",
      stamp: opt("stamp") ?? null,
    });
    return;
  }

  if (cmd === "record-editorial") {
    const ledgerPath = opt("ledger") ? path.resolve(opt("ledger")) : path.join(opsDir, "state", "editorial-ledger.json");
    const wroteMap = new Map();
    const skippedMap = new Map();
    const failedList = [];
    let reviewedAt = opt("reviewed-at") ?? new Date().toISOString();

    const receiptPath = opt("receipt");
    if (receiptPath) {
      const receipt = JSON.parse(fs.readFileSync(path.resolve(receiptPath), "utf8"));
      if (receipt.reviewedAt && !opt("reviewed-at")) reviewedAt = receipt.reviewedAt;
      for (const m of receipt.months ?? []) {
        const ver = m.candidateSha256 ? m.candidateSha256.slice(0, 12) : null;
        for (const w of m.wrote ?? []) {
          const day = typeof w === "string" ? w : w.day;
          if (day) wroteMap.set(day, { day, version: ver });
        }
        for (const s of m.skipped ?? []) {
          if (s?.day) skippedMap.set(s.day, { day: s.day, reason: s.reason || "当日原始消息不含可独立成篇的儿童事实" });
        }
      }
    }

    const decisionsPath = opt("decisions");
    if (decisionsPath) {
      const parsed = JSON.parse(fs.readFileSync(path.resolve(decisionsPath), "utf8"));
      const list = Array.isArray(parsed) ? parsed : (parsed.decisions ?? parsed.days ?? []);
      for (const item of list) {
        if (!item?.day) continue;
        if (item.decision === "skip" || item.status === "no_qualifying_material" || item.status === "skipped_no_material") {
          skippedMap.set(item.day, { day: item.day, reason: item.reason || "当日原始消息不含可独立成篇的儿童事实" });
        } else {
          if (!wroteMap.has(item.day)) wroteMap.set(item.day, { day: item.day, version: item.version ?? null });
        }
      }
    }

    const wroteRaw = opt("wrote");
    if (wroteRaw) {
      const parsed = parseJsonOrFile(wroteRaw);
      if (Array.isArray(parsed)) {
        for (const w of parsed) {
          const day = typeof w === "string" ? w : w.day;
          if (day) wroteMap.set(day, typeof w === "object" ? w : { day });
        }
      } else {
        for (const d of wroteRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
          wroteMap.set(d, { day: d, version: opt("version") ?? null });
        }
      }
    }

    const skippedRaw = opt("skipped");
    if (skippedRaw) {
      const parsed = parseJsonOrFile(skippedRaw);
      if (Array.isArray(parsed)) {
        for (const s of parsed) {
          const day = typeof s === "string" ? s : s.day;
          if (day) skippedMap.set(day, { day, reason: s.reason || "当日原始消息不含可独立成篇的儿童事实" });
        }
      } else {
        for (const token of skippedRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
          const idx = token.indexOf(":");
          const day = idx >= 0 ? token.slice(0, idx).trim() : token;
          const reason = idx >= 0 ? token.slice(idx + 1).trim() : (opt("reason") ?? "当日原始消息不含可独立成篇的儿童事实");
          skippedMap.set(day, { day, reason });
        }
      }
    }

    const failedRaw = opt("failed");
    if (failedRaw) {
      const parsed = parseJsonOrFile(failedRaw);
      if (Array.isArray(parsed)) {
        failedList.push(...parsed);
      } else {
        for (const token of failedRaw.split(",").map((s) => s.trim()).filter(Boolean)) {
          const [day, stage = "editorial", errorCode = "ERR"] = token.split(":");
          if (day) failedList.push({ day, stage, errorCode });
        }
      }
    }

    let dayFingerprints = parseJsonOrFile(opt("day-fingerprints")) ?? {};
    const targetDays = [...wroteMap.keys(), ...skippedMap.keys()].filter((d) => !dayFingerprints[d]);
    if (targetDays.length > 0 && !flag("no-rds")) {
      const liveFp = await loadFingerprintsFromRdsForDays(targetDays);
      dayFingerprints = { ...liveFp, ...dayFingerprints };
    }

    const updated = recordEditorialOutcomes(ledgerPath, {
      reviewedAt,
      runId: opt("run-id") ?? null,
      wrote: [...wroteMap.values()],
      skipped: [...skippedMap.values()],
      failed: failedList,
      dayFingerprints,
    });
    console.log(JSON.stringify({
      ok: true,
      ledgerPath,
      updatedAt: updated.updatedAt,
      wroteCount: wroteMap.size,
      skippedCount: skippedMap.size,
      failedCount: failedList.length,
      totalDaysInLedger: Object.keys(updated.days).length,
    }));
    return;
  }

  if (cmd === "revalidate") {
    const scope = opt("scope") ?? "archive";
    if (!/^[a-z0-9_-]+$/i.test(scope)) throw new Error(`Invalid revalidate scope: ${scope}`);
    const ecs = resolveEcsConnection();
    const sshBin = fs.existsSync("C:\\Program Files\\Git\\usr\\bin\\ssh.exe")
      ? "C:\\Program Files\\Git\\usr\\bin\\ssh.exe"
      : "ssh";
    // Public Caddy intentionally blocks /api/internal/*; invoke loopback 127.0.0.1:3000 inside ECS
    // using the container's own INGESTION_TOKEN so zero secrets cross the wire or appear in logs.
    const remoteScript = `docker exec nianlife-diag-web node -e 'fetch("http://127.0.0.1:3000/api/internal/revalidate",{method:"POST",headers:{"content-type":"application/json","authorization":"Bearer "+process.env.INGESTION_TOKEN},body:JSON.stringify({scope:process.argv[1]})}).then(async r=>{const t=await r.text();if(!r.ok){console.error("HTTP "+r.status+": "+t);process.exit(1)}console.log(t)})' '${scope}'`;
    const out = await new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      const child = spawn(sshBin, ["-o", "BatchMode=yes", "-o", "ConnectTimeout=15", "-i", ecs.key, ecs.ssh, remoteScript], {
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
      child.stdout.on("data", (d) => { stdout += String(d); });
      child.stderr.on("data", (d) => { stderr += String(d); });
      child.on("error", reject);
      child.on("exit", (code) => {
        if (code === 0) resolve(stdout.trim());
        else reject(new Error(`ECS loopback revalidate failed (exit ${code}): ${stderr.trim().slice(0, 240)}`));
      });
    });
    const parsed = JSON.parse(out);
    console.log(JSON.stringify({ ok: true, via: "ecs-loopback", ...parsed }));
    return;
  }

  if (cmd === "run-locked") {
    const sep = args.indexOf("--");
    if (sep < 0 || !args[sep + 1]) throw new Error("Usage: pipeline-status.mjs run-locked [--lock <path>] [--label <name>] -- <exe> [args...]");
    const lockPath = opt("lock") ? path.resolve(opt("lock")) : path.join(opsDir, "state", "sync.lock");
    const label = opt("label") ?? "daily-sync";
    const lock = acquireProcessLock(lockPath, { label });
    if (!lock.acquired) {
      console.error(`[pipeline-lock] skipped: ${lock.reason} (holderPid=${lock.holderPid ?? "?"}, acquiredAt=${lock.acquiredAt ?? "?"})`);
      process.exitCode = 75;
      return;
    }
    try {
      const [exe, ...childArgs] = args.slice(sep + 1);
      const exitCode = await new Promise((resolve, reject) => {
        const child = spawn(exe, childArgs, { stdio: "inherit", windowsHide: true });
        child.on("error", reject);
        child.on("exit", (code) => resolve(code ?? 0));
      });
      process.exitCode = exitCode;
    } finally {
      releaseProcessLock(lockPath, process.pid);
    }
    return;
  }

  throw new Error(`Unknown command: ${cmd}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  cli().catch((err) => {
    console.error(err?.stack ?? err);
    process.exitCode = 1;
  });
}
