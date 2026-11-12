// Model-session visual photo review & curation tool (zero external LLM calls per AGENTS.md 2026-10-12).
// Subcommands:
//   prepare    --since YYYY-MM-DD --out <private-dir>
//   apply      --out <private-dir> --verdicts <verdicts.json>
//   curate     --from YYYY-MM-DD --until YYYY-MM-DD --out <day-media.json> [--leads <leads.json>]
//   day-sheets --out <private-dir> [--source-pack <source-pack.json>] [--day-media <day-media.json>] [--days d1,d2] [--all-expanded]
import fs from "node:fs";
import path from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { aggregateDayMedia } from "./day-media.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function resolveNightRdsUrl() {
  const local = new URL("../../.data/night-rds.mjs", import.meta.url);
  if (fs.existsSync(fileURLToPath(local))) return local.href;
  const fallback = process.env.NIANLIFE_NIGHT_RDS ?? path.join(homedir(), "Documents", "Nianlife", "v2", ".data", "night-rds.mjs");
  return pathToFileURL(fallback).href;
}

function ensureOssEnv() {
  return import(resolveNightRdsUrl()).then(({ parseEnvFile, openRds }) => {
    const ossPath = process.env.NIANLIFE_OSS_ENV ?? path.join(homedir(), "nianlife-oss.env");
    const oss = parseEnvFile(ossPath);
    if (oss.OSS_ENDPOINT?.includes("-internal")) oss.OSS_ENDPOINT = oss.OSS_ENDPOINT.replace("-internal", "");
    for (const [k, v] of Object.entries(oss)) {
      if (!k.startsWith("R2_") && v && !process.env[k]) process.env[k] = v;
    }
    process.env.MEDIA_STORAGE_PROVIDER = "oss";
    process.env.HOT_STORAGE_BACKEND = "local";
    return { openRds };
  });
}

function escapeXml(str) {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function buildContactSheets(candidates, webpDir, sheetDir) {
  fs.mkdirSync(sheetDir, { recursive: true });
  const COLS = 4;
  const ROWS = 5;
  const PER_SHEET = COLS * ROWS;
  const CELL_W = 340;
  const CELL_H = 360;
  const HEADER_H = 34;
  const IMG_H = CELL_H - HEADER_H;
  const sheets = [];

  for (let offset = 0; offset < candidates.length; offset += PER_SHEET) {
    const chunk = candidates.slice(offset, offset + PER_SHEET);
    const actualRows = Math.ceil(chunk.length / COLS);
    const width = COLS * CELL_W;
    const height = actualRows * CELL_H;
    const composites = [];

    for (let i = 0; i < chunk.length; i += 1) {
      const item = chunk[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL_W;
      const y = row * CELL_H;

      const labelSvg = Buffer.from(
        `<svg width="${CELL_W}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${CELL_W}" height="${HEADER_H}" fill="#1f1c18"/>
          <rect x="0" y="${HEADER_H - 1}" width="${CELL_W}" height="1" fill="#463f36"/>
          <text x="10" y="22" fill="#f7f2e8" font-family="Segoe UI, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(`#${item.idx}  ${item.day.slice(5)} ${item.time.slice(0, 5)}  (${item.width || "?"}x${item.height || "?"})`)}</text>
        </svg>`,
      );
      composites.push({ input: labelSvg, left: x, top: y });

      const imgPath = path.join(webpDir, `${item.idx}.webp`);
      if (fs.existsSync(imgPath)) {
        const thumb = await sharp(imgPath)
          .resize(CELL_W - 8, IMG_H - 8, { fit: "contain", background: { r: 244, g: 239, b: 230, alpha: 1 } })
          .jpeg({ quality: 84 })
          .toBuffer();
        composites.push({ input: thumb, left: x + 4, top: y + HEADER_H + 4 });
      }
    }

    const sheetName = `sheet-${String(Math.floor(offset / PER_SHEET) + 1).padStart(2, "0")}.jpg`;
    const sheetPath = path.join(sheetDir, sheetName);
    await sharp({
      create: { width, height, channels: 3, background: { r: 244, g: 239, b: 230 } },
    })
      .composite(composites)
      .jpeg({ quality: 86 })
      .toFile(sheetPath);
    sheets.push(sheetPath);
  }
  return sheets;
}

export async function prepareSheets({ since, out }) {
  const dir = path.resolve(out);
  assertOutsideRepository(dir, REPO);
  fs.mkdirSync(dir, { recursive: true });
  const webpDir = path.join(dir, "webp");
  const sheetDir = path.join(dir, "sheets");
  fs.mkdirSync(webpDir, { recursive: true });

  const { openRds } = await ensureOssEnv();
  const { getStorageForProvider } = await import("../../lib/storage/hot-storage.ts");

  const rds = await openRds({ readOnly: true, localPort: 15840 + Math.floor(Math.random() * 80) });
  let rows;
  let stuckApprovedPrivate;
  try {
    rows = (await rds.client.query(`
      select distinct on (m.id)
             m.id,
             to_char(m.taken_at, 'YYYY-MM-DD') as day,
             to_char(m.taken_at, 'HH24:MI:SS') as time,
             m.width,
             m.height,
             m.visibility,
             l.provider,
             l.provider_ref
        from media m
        join media_locations l
          on l.media_asset_id = m.media_asset_id
         and l.variant in ('web', 'thumbnail')
         and l.status = 'ready'
         and l.provider in ('oss', 'hot')
       where m.type = 'photo'
         and m.taken_at >= $1::date
         and not exists (
           select 1 from content_quality_reviews r
            where r.target_kind = 'media_subject_check' and r.target_id = m.id
         )
       order by m.id, (case when l.variant = 'web' then 0 else 1 end)
    `, [since])).rows;

    stuckApprovedPrivate = (await rds.client.query(`
      select m.id, to_char(m.taken_at, 'YYYY-MM-DD') as day
        from media m
       where m.type = 'photo'
         and m.taken_at >= $1::date
         and m.visibility = 'private'
         and (
           select decision from content_quality_reviews r
            where r.target_kind = 'media_subject_check' and r.target_id = m.id
            order by r.reviewed_at desc limit 1
         ) = 'approved'
    `, [since])).rows;
  } finally {
    await rds.close();
  }

  rows.sort((a, b) => `${a.day} ${a.time}`.localeCompare(`${b.day} ${b.time}`) || a.id.localeCompare(b.id));
  const candidates = rows.map((r, idx) => ({
    idx,
    id: r.id,
    day: r.day,
    time: r.time,
    width: r.width,
    height: r.height,
    visibility: r.visibility,
    provider: r.provider,
    providerRef: r.provider_ref,
  }));

  let downloaded = 0;
  let failed = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < candidates.length) {
      const item = candidates[cursor++];
      const dst = path.join(webpDir, `${item.idx}.webp`);
      if (fs.existsSync(dst)) { downloaded += 1; continue; }
      try {
        const bytes = await getStorageForProvider(item.provider).get(item.providerRef);
        if (bytes) {
          fs.writeFileSync(dst, Buffer.from(bytes));
          downloaded += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }));

  const readyCandidates = candidates.filter((c) => fs.existsSync(path.join(webpDir, `${c.idx}.webp`)));
  const downloadFailedIds = candidates.filter((c) => !fs.existsSync(path.join(webpDir, `${c.idx}.webp`))).map((c) => c.id);
  const sheets = readyCandidates.length > 0 ? await buildContactSheets(readyCandidates, webpDir, sheetDir) : [];
  const meta = {
    schema: "nianlife.session-photo-candidates/1",
    generatedAt: new Date().toISOString(),
    since,
    totalCandidates: readyCandidates.length,
    downloaded,
    failed,
    downloadFailedIds,
    stuckApprovedPrivate,
    sheets,
    candidates: readyCandidates.map(({ providerRef, ...rest }) => rest),
  };
  fs.writeFileSync(path.join(dir, "candidates.json"), `${JSON.stringify(meta, null, 2)}\n`, "utf8");
  return { totalCandidates: readyCandidates.length, downloaded, failed, stuckApprovedPrivate: stuckApprovedPrivate.length, sheets: sheets.length };
}

export async function applyVerdicts({ out, verdictsFile }) {
  const dir = path.resolve(out);
  assertOutsideRepository(dir, REPO);
  const vPath = path.resolve(verdictsFile);
  assertOutsideRepository(vPath, REPO);

  const meta = JSON.parse(fs.readFileSync(path.join(dir, "candidates.json"), "utf8"));
  const verdicts = JSON.parse(fs.readFileSync(vPath, "utf8"));
  if (verdicts.totalCandidates !== meta.totalCandidates) {
    throw new Error(`verdicts.totalCandidates (${verdicts.totalCandidates}) != candidates.length (${meta.totalCandidates})`);
  }
  const rejectMap = verdicts.reject ?? {};
  const policyVersion = verdicts.policyVersion ?? "agy-photo-review-2026-11-11";
  for (const c of meta.candidates) {
    const rejectReason = rejectMap[String(c.idx)] ?? null;
    if (!rejectReason && !fs.existsSync(path.join(dir, "webp", `${c.idx}.webp`))) {
      throw new Error(`Refusing to approve candidate #${c.idx} (${c.id}): contact-sheet thumbnail webp/${c.idx}.webp is missing.`);
    }
  }

  const { openRds } = await ensureOssEnv();
  const rds = await openRds({ readOnly: false, localPort: 15880 + Math.floor(Math.random() * 80) });
  try {
    const profileId = (await rds.client.query("select profile_id from content_quality_reviews limit 1")).rows[0]?.profile_id ?? "profile-zhangnian";
    const beforeReviews = Number((await rds.client.query("select count(*)::int as n from content_quality_reviews")).rows[0].n);

    await rds.client.query("begin");
    try {
      let inserted = 0;
      const approvedIds = [];
      const rejectedIds = [];

      for (const c of meta.candidates) {
        const rejectReason = rejectMap[String(c.idx)] ?? null;
        const decision = rejectReason ? "store_only" : "approved";
        const reviewId = `subj-agy-${sha256(`${policyVersion}\n${c.id}`).slice(0, 20)}`;
        const reasonCodes = [
          "basis:antigravity-contact-sheet-review",
          rejectReason ? `label:${rejectReason}` : "label:life",
          "authorized-by:teddy-2026-11-11-agy-takeover",
        ];
        const res = await rds.client.query(`
          insert into content_quality_reviews (
            id, profile_id, target_kind, target_id, decision, reason_codes,
            provider, model, prompt_version, policy_version, review_fingerprint, reviewed_at
          )
          select $1, $2, 'media_subject_check', $3, $4, $5::jsonb,
                 'antigravity', 'agy-contact-sheet-v1', 'agy-contact-sheet-v1', $6, $7,
                 now() at time zone 'Asia/Shanghai'
           where not exists (
             select 1 from content_quality_reviews
              where target_kind = 'media_subject_check' and target_id = $3
           )
          on conflict do nothing
          returning id
        `, [reviewId, profileId, c.id, decision, JSON.stringify(reasonCodes), policyVersion, `${reviewId}:media_subject_check`]);

        inserted += res.rowCount;
        if (decision === "approved") approvedIds.push(c.id);
        else rejectedIds.push({ id: c.id, idx: c.idx, reason: rejectReason });
      }

      const afterReviews = Number((await rds.client.query("select count(*)::int as n from content_quality_reviews")).rows[0].n);
      if (afterReviews - beforeReviews !== inserted) {
        throw new Error(`Review delta mismatch: ${afterReviews - beforeReviews} != ${inserted}`);
      }

      const repairIds = (meta.stuckApprovedPrivate ?? []).map((x) => x.id);
      const idsToFlip = [...new Set([...approvedIds, ...repairIds])];
      let flippedCount = 0;
      if (idsToFlip.length > 0) {
        const flipRes = await rds.client.query(
          "update media set visibility = 'family' where id = any($1) and visibility = 'private' and type = 'photo'",
          [idsToFlip],
        );
        flippedCount = flipRes.rowCount;
      }

      await rds.client.query("commit");

      const receipt = {
        schema: "nianlife.session-photo-review-receipt/1",
        reviewedAt: new Date().toISOString(),
        policyVersion,
        totalCandidates: meta.totalCandidates,
        insertedReviews: inserted,
        approvedCount: approvedIds.length,
        rejectedCount: rejectedIds.length,
        repairedStuckPrivateCount: repairIds.length,
        flippedToFamilyCount: flippedCount,
        approvedIds,
        rejected: rejectedIds,
      };
      fs.writeFileSync(path.join(dir, "photo-review-receipt.json"), `${JSON.stringify(receipt, null, 2)}\n`, "utf8");
      return {
        insertedReviews: inserted,
        approvedCount: approvedIds.length,
        rejectedCount: rejectedIds.length,
        flippedToFamilyCount: flippedCount,
      };
    } catch (txErr) {
      await rds.client.query("rollback");
      throw txErr;
    }
  } finally {
    await rds.close();
  }
}

export async function curateDayMedia({ from, until, out, leadsFile = null }) {
  const outPath = path.resolve(out);
  assertOutsideRepository(outPath, REPO);
  const leads = leadsFile ? JSON.parse(fs.readFileSync(path.resolve(leadsFile), "utf8")) : {};

  const { openRds } = await ensureOssEnv();
  const rds = await openRds({ readOnly: true, localPort: 15910 + Math.floor(Math.random() * 70) });
  let rows;
  try {
    rows = (await rds.client.query(`
      with deduped as (
        select distinct on (coalesce(m.media_asset_id, m.id))
               m.id,
               m.media_asset_id,
               m.type,
               m.width,
               m.height,
               m.taken_at,
               to_char(m.taken_at, 'YYYY-MM-DD') as day,
               to_char(m.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') as ts
          from media m
         where m.visibility <> 'private'
           and m.taken_at >= $1::date
           and m.taken_at < $2::date
           and m.type = 'photo'
           and coalesce(m.width, 0) >= 480
           and coalesce(m.height, 0) >= 480
           and (
             select decision from content_quality_reviews q
              where q.target_kind = 'media_subject_check' and q.target_id = m.id
              order by q.reviewed_at desc limit 1
           ) = 'approved'
           and exists (
             select 1 from media_locations l
              where l.media_asset_id = m.media_asset_id
                and l.variant in ('web', 'thumbnail')
                and l.status = 'ready'
                and l.provider in ('oss', 'hot')
           )
         order by coalesce(m.media_asset_id, m.id),
                  (coalesce(m.width, 0) * coalesce(m.height, 0)) desc,
                  m.taken_at desc,
                  m.id asc
      )
      select id, type, width, height, day, ts
        from deduped
       order by taken_at asc, id asc
    `, [from, until])).rows;
  } finally {
    await rds.close();
  }

  const byDay = new Map();
  for (const r of rows) {
    if (!byDay.has(r.day)) byDay.set(r.day, []);
    byDay.get(r.day).push(r);
  }

  // Fold bursts (< 90s apart): sort within burst by pixel area descending, keep up to 3 best shots, then restore chronological order.
  const foldBursts = (list) => {
    const outList = [];
    let burst = [];
    let lastMs = 0;
    const flush = () => {
      if (!burst.length) return;
      const top = [...burst]
        .sort((a, b) => ((b.width || 0) * (b.height || 0)) - ((a.width || 0) * (a.height || 0)))
        .slice(0, 3)
        .sort((a, b) => a.ts.localeCompare(b.ts) || a.id.localeCompare(b.id));
      outList.push(...top);
      burst = [];
    };
    for (const item of list) {
      const ms = Date.parse(`${item.ts}+08:00`);
      if (burst.length && ms - lastMs > 90_000) flush();
      burst.push(item);
      lastMs = ms;
    }
    flush();
    return outList;
  };

  const result = {};
  for (const [day, list] of [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const folded = foldBursts(list);
    const agg = aggregateDayMedia(
      folded.map((x) => ({ id: x.id, type: "photo", takenAt: x.ts, allowed: true })),
      { max: 40 },
    );
    let { firstScreenMediaIds, expandedMediaIds } = agg;
    const leadId = leads[day];
    if (leadId && expandedMediaIds.includes(leadId)) {
      firstScreenMediaIds = [leadId, ...firstScreenMediaIds.filter((id) => id !== leadId)].slice(0, 6);
      expandedMediaIds = [leadId, ...expandedMediaIds.filter((id) => id !== leadId)];
    }
    result[day] = {
      totalApproved: list.length,
      afterBurstFold: folded.length,
      firstScreenMediaIds,
      expandedMediaIds,
      dimensions: Object.fromEntries(folded.map((x) => [x.id, { w: x.width, h: x.height, ts: x.ts }])),
    };
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return { daysWithPhotos: Object.keys(result).length, totalApprovedPhotos: rows.length };
}

function selectViewingIdsForDay(firstScreenMediaIds = [], expandedMediaIds = [], { allExpanded = false } = {}) {
  const first = Array.isArray(firstScreenMediaIds) ? firstScreenMediaIds : [];
  const expanded = Array.isArray(expandedMediaIds) ? expandedMediaIds : first;
  const firstSet = new Set(first);
  if (allExpanded || first.length < 4) {
    return [
      ...first.map((id, i) => ({ id, role: "firstScreen", slot: i + 1 })),
      ...expanded.filter((id) => !firstSet.has(id)).map((id, i) => ({ id, role: "expanded", slot: i + 1 })),
    ];
  }
  return first.map((id, i) => ({ id, role: "firstScreen", slot: i + 1 }));
}

async function renderDaySheetGroup(day, items, thumbDir, sheetDir) {
  fs.mkdirSync(sheetDir, { recursive: true });
  const COLS = 3;
  const ROWS = 4;
  const PER_SHEET = COLS * ROWS;
  const CELL_W = 460;
  const CELL_H = 440;
  const HEADER_H = 54;
  const IMG_H = CELL_H - HEADER_H;
  const sheets = [];

  for (let offset = 0; offset < items.length; offset += PER_SHEET) {
    const chunk = items.slice(offset, offset + PER_SHEET);
    const actualRows = Math.ceil(chunk.length / COLS);
    const width = COLS * CELL_W;
    const height = actualRows * CELL_H;
    const composites = [];

    for (let i = 0; i < chunk.length; i += 1) {
      const item = chunk[i];
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const x = col * CELL_W;
      const y = row * CELL_H;
      const badge = item.role === "firstScreen" ? `[首屏 ${item.slot}]` : `[展开 ${item.slot}]`;
      const badgeColor = item.role === "firstScreen" ? "#f6d38b" : "#d6cfc2";
      const spec = item.type === "video"
        ? `视频${item.durationSeconds ? ` ${Math.round(item.durationSeconds)}s` : ""}`
        : `${item.width || "?"}x${item.height || "?"}`;
      const line1 = `${badge}  ${day} ${item.time ? item.time.slice(0, 5) : ""}  (${spec})`;
      const line2 = item.id;

      const labelSvg = Buffer.from(
        `<svg width="${CELL_W}" height="${HEADER_H}" xmlns="http://www.w3.org/2000/svg">
          <rect width="${CELL_W}" height="${HEADER_H}" fill="#1f1c18"/>
          <rect x="0" y="${HEADER_H - 1}" width="${CELL_W}" height="1" fill="#463f36"/>
          <text x="10" y="21" fill="${badgeColor}" font-family="Microsoft YaHei, Segoe UI, Arial, sans-serif" font-size="14" font-weight="700">${escapeXml(line1)}</text>
          <text x="10" y="42" fill="#ffffff" font-family="Consolas, Segoe UI, monospace" font-size="12" font-weight="600">${escapeXml(line2)}</text>
        </svg>`,
      );
      composites.push({ input: labelSvg, left: x, top: y });

      const thumbPath = path.join(thumbDir, `${sha256(item.id).slice(0, 24)}.img`);
      if (fs.existsSync(thumbPath)) {
        const thumb = await sharp(thumbPath)
          .resize(CELL_W - 8, IMG_H - 8, { fit: "contain", background: { r: 244, g: 239, b: 230, alpha: 1 } })
          .jpeg({ quality: 86 })
          .toBuffer();
        composites.push({ input: thumb, left: x + 4, top: y + HEADER_H + 4 });
      }
    }

    const totalPages = Math.ceil(items.length / PER_SHEET);
    const sheetName = totalPages === 1
      ? `${day}.jpg`
      : `${day}-${String(Math.floor(offset / PER_SHEET) + 1).padStart(2, "0")}.jpg`;
    const sheetPath = path.join(sheetDir, sheetName);
    await sharp({
      create: { width, height, channels: 3, background: { r: 244, g: 239, b: 230 } },
    })
      .composite(composites)
      .jpeg({ quality: 88 })
      .toFile(sheetPath);
    sheets.push(sheetPath);
  }
  return sheets;
}

/**
 * Read-only per-day labeled contact sheet builder for mandatory pre-writing visual inspection (STYLE.zhang.md §3.1)
 * and P7 batch rewrites. Never writes to RDS, OSS, or the repository.
 */
export async function buildDaySheets({
  out,
  sourcePackFile = null,
  dayMediaFile = null,
  days = null,
  allExpanded = false,
}) {
  if (!out) throw new Error("Specify --out <private-dir>.");
  const dir = path.resolve(out);
  assertOutsideRepository(dir, REPO);
  fs.mkdirSync(dir, { recursive: true });
  const thumbDir = path.join(dir, "thumbs");
  const sheetDir = path.join(dir, "sheets");
  fs.mkdirSync(thumbDir, { recursive: true });

  const filterSet = Array.isArray(days) && days.length > 0 ? new Set(days) : null;
  const mediaMap = new Map();

  if (sourcePackFile) {
    const packPath = path.resolve(sourcePackFile);
    assertOutsideRepository(packPath, REPO);
    const pack = JSON.parse(fs.readFileSync(packPath, "utf8"));
    const packDir = path.dirname(packPath);
    const priorByDay = new Map();
    for (const m of pack.months ?? []) {
      if (m.snapshotFile) {
        const snapPath = path.join(packDir, m.snapshotFile);
        if (fs.existsSync(snapPath)) {
          const snap = JSON.parse(fs.readFileSync(snapPath, "utf8"));
          for (const d of snap.days ?? []) priorByDay.set(d.day, d);
        }
      }
    }
    for (const d of pack.days ?? []) {
      if (filterSet && !filterSet.has(d)) continue;
      const curated = pack.dayMedia?.[d];
      const prior = priorByDay.get(d);
      mediaMap.set(d, {
        firstScreenMediaIds: curated?.firstScreenMediaIds ?? prior?.firstScreenMediaIds ?? [],
        expandedMediaIds: curated?.expandedMediaIds ?? prior?.expandedMediaIds ?? [],
      });
    }
  }

  if (dayMediaFile) {
    const dmPath = path.resolve(dayMediaFile);
    assertOutsideRepository(dmPath, REPO);
    const dm = JSON.parse(fs.readFileSync(dmPath, "utf8"));
    for (const [d, entry] of Object.entries(dm)) {
      if (filterSet && !filterSet.has(d)) continue;
      if (!sourcePackFile || mediaMap.has(d)) {
        mediaMap.set(d, {
          firstScreenMediaIds: entry.firstScreenMediaIds ?? [],
          expandedMediaIds: entry.expandedMediaIds ?? entry.firstScreenMediaIds ?? [],
        });
      }
    }
  }

  const { openRds } = await ensureOssEnv();
  const { getStorageForProvider } = await import("../../lib/storage/hot-storage.ts");

  const rds = await openRds({ readOnly: true, localPort: 15920 + Math.floor(Math.random() * 60) });
  let mediaRows = [];
  try {
    if (!sourcePackFile && !dayMediaFile) {
      if (!filterSet || filterSet.size === 0) {
        throw new Error("Provide at least one of --source-pack, --day-media, or --days.");
      }
      const targetDays = [...filterSet].sort();
      const rawDayRows = (await rds.client.query(`
        with deduped as (
          select distinct on (coalesce(m.media_asset_id, m.id))
                 m.id,
                 m.type,
                 m.width,
                 m.height,
                 m.taken_at,
                 to_char(m.taken_at, 'YYYY-MM-DD') as day,
                 to_char(m.taken_at, 'YYYY-MM-DD"T"HH24:MI:SS') as ts
            from media m
           where m.visibility <> 'private'
             and to_char(m.taken_at, 'YYYY-MM-DD') = any($1)
             and (
               (m.type = 'photo' and coalesce(m.width, 0) >= 480 and coalesce(m.height, 0) >= 480 and (
                 select decision from content_quality_reviews q
                  where q.target_kind = 'media_subject_check' and q.target_id = m.id
                  order by q.reviewed_at desc limit 1
               ) = 'approved')
               or (m.type = 'video' and coalesce((
                 select decision from content_quality_reviews q
                  where q.target_kind = 'media_subject_check' and q.target_id = m.id
                  order by q.reviewed_at desc limit 1
               ), 'approved') <> 'store_only')
             )
             and exists (
               select 1 from media_locations l
                where l.media_asset_id = m.media_asset_id
                  and l.variant in ('web', 'thumbnail', 'poster')
                  and l.status = 'ready'
                  and l.provider in ('oss', 'hot')
             )
           order by coalesce(m.media_asset_id, m.id),
                    (coalesce(m.width, 0) * coalesce(m.height, 0)) desc,
                    m.taken_at desc,
                    m.id asc
        )
        select id, type, width, height, day, ts from deduped order by taken_at asc, id asc
      `, [targetDays])).rows;
      for (const d of targetDays) {
        const list = rawDayRows.filter((r) => r.day === d);
        const agg = aggregateDayMedia(
          list.map((x) => ({ id: x.id, type: x.type === "video" ? "video" : "photo", takenAt: x.ts, allowed: true })),
          { max: 40 },
        );
        mediaMap.set(d, { firstScreenMediaIds: agg.firstScreenMediaIds, expandedMediaIds: agg.expandedMediaIds });
      }
    }

    const wantedIds = new Set();
    for (const [, entry] of mediaMap) {
      for (const item of selectViewingIdsForDay(entry.firstScreenMediaIds, entry.expandedMediaIds, { allExpanded })) {
        wantedIds.add(item.id);
      }
    }

    if (wantedIds.size > 0) {
      mediaRows = (await rds.client.query(`
        select distinct on (m.id)
               m.id,
               m.type,
               to_char(m.taken_at, 'YYYY-MM-DD') as day,
               to_char(m.taken_at, 'HH24:MI:SS') as time,
               m.width,
               m.height,
               m.duration_seconds,
               l.variant,
               l.provider,
               l.provider_ref
          from media m
          join media_locations l
            on l.media_asset_id = m.media_asset_id
           and l.status = 'ready'
           and l.provider in ('oss', 'hot')
           and (
             (m.type = 'photo' and l.variant in ('web', 'thumbnail'))
             or (m.type = 'video' and l.variant in ('poster', 'thumbnail'))
           )
         where m.id = any($1)
           and m.visibility <> 'private'
         order by m.id,
                  (case l.variant when 'web' then 0 when 'poster' then 0 else 1 end)
      `, [[...wantedIds]])).rows;
    }
  } finally {
    await rds.close();
  }

  const rowById = new Map(mediaRows.map((r) => [r.id, r]));
  const toDownload = [...rowById.values()];
  let downloaded = 0;
  let failed = 0;
  let cursor = 0;
  await Promise.all(Array.from({ length: 6 }, async () => {
    while (cursor < toDownload.length) {
      const row = toDownload[cursor++];
      const dst = path.join(thumbDir, `${sha256(row.id).slice(0, 24)}.img`);
      if (fs.existsSync(dst)) {
        downloaded += 1;
        continue;
      }
      try {
        const bytes = await getStorageForProvider(row.provider).get(row.provider_ref);
        if (bytes) {
          fs.writeFileSync(dst, Buffer.from(bytes));
          downloaded += 1;
        } else {
          failed += 1;
        }
      } catch {
        failed += 1;
      }
    }
  }));

  const manifestDays = {};
  let totalSheets = 0;
  for (const [day, entry] of [...mediaMap.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const selected = selectViewingIdsForDay(entry.firstScreenMediaIds, entry.expandedMediaIds, { allExpanded });
    const enriched = selected.map((s) => {
      const row = rowById.get(s.id);
      return {
        ...s,
        type: row?.type ?? "photo",
        time: row?.time ?? "",
        width: row?.width ?? null,
        height: row?.height ?? null,
        durationSeconds: row?.duration_seconds ?? null,
        ready: Boolean(row && fs.existsSync(path.join(thumbDir, `${sha256(s.id).slice(0, 24)}.img`))),
      };
    });
    const sheets = enriched.length > 0 ? await renderDaySheetGroup(day, enriched, thumbDir, sheetDir) : [];
    totalSheets += sheets.length;
    manifestDays[day] = {
      firstScreenMediaIds: entry.firstScreenMediaIds,
      expandedMediaIds: entry.expandedMediaIds,
      viewedCount: enriched.length,
      sheets,
      items: enriched,
    };
  }

  const manifest = {
    schema: "nianlife.day-photo-sheets/1",
    generatedAt: new Date().toISOString(),
    allExpanded,
    daysCount: Object.keys(manifestDays).length,
    totalMediaViewed: toDownload.length,
    downloaded,
    failed,
    days: manifestDays,
  };
  const manifestPath = path.join(dir, "day-sheets.json");
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return {
    days: Object.keys(manifestDays).length,
    sheets: totalSheets,
    downloaded,
    failed,
    manifest: manifestPath,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  const flag = (name) => args.includes(`--${name}`);
  if (cmd === "prepare") {
    console.log(JSON.stringify(await prepareSheets({ since: opt("since") ?? "2026-10-24", out: opt("out") })));
  } else if (cmd === "apply") {
    console.log(JSON.stringify(await applyVerdicts({ out: opt("out"), verdictsFile: opt("verdicts") })));
  } else if (cmd === "curate") {
    console.log(JSON.stringify(await curateDayMedia({ from: opt("from"), until: opt("until"), out: opt("out"), leadsFile: opt("leads") ?? null })));
  } else if (cmd === "day-sheets") {
    const daysOpt = opt("days") ? opt("days").split(",").map((s) => s.trim()).filter(Boolean) : null;
    console.log(JSON.stringify(await buildDaySheets({
      out: opt("out"),
      sourcePackFile: opt("source-pack") ?? null,
      dayMediaFile: opt("day-media") ?? null,
      days: daysOpt,
      allExpanded: flag("all-expanded"),
    })));
  } else {
    throw new Error("Usage: session-photo-review.mjs <prepare|apply|curate|day-sheets> ...");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
