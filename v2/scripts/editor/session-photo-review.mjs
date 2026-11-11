// Model-session visual photo review & curation tool (zero external LLM calls per AGENTS.md 2026-10-12).
// Subcommands:
//   prepare --since YYYY-MM-DD --out <private-dir>
//   apply   --out <private-dir> --verdicts <verdicts.json>
//   curate  --from YYYY-MM-DD --until YYYY-MM-DD --out <day-media.json> [--leads <leads.json>]
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import sharp from "sharp";
import { assertOutsideRepository } from "../lib/repo-containment.mjs";
import { aggregateDayMedia } from "./day-media.mjs";

const REPO_LITERAL = path.resolve(fileURLToPath(new URL("../../../", import.meta.url)));
const REPO = { literal: REPO_LITERAL, real: fs.realpathSync.native(REPO_LITERAL) };
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function ensureOssEnv() {
  return import(new URL("../../.data/night-rds.mjs", import.meta.url)).then(({ parseEnvFile, openRds }) => {
    const oss = parseEnvFile("C:\\Users\\teddy\\nianlife-oss.env");
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

async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const opt = (name) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : undefined; };
  if (cmd === "prepare") {
    console.log(JSON.stringify(await prepareSheets({ since: opt("since") ?? "2026-10-24", out: opt("out") })));
  } else if (cmd === "apply") {
    console.log(JSON.stringify(await applyVerdicts({ out: opt("out"), verdictsFile: opt("verdicts") })));
  } else if (cmd === "curate") {
    console.log(JSON.stringify(await curateDayMedia({ from: opt("from"), until: opt("until"), out: opt("out"), leadsFile: opt("leads") ?? null })));
  } else {
    throw new Error("Usage: session-photo-review.mjs <prepare|apply|curate> ...");
  }
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
