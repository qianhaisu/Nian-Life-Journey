#!/usr/bin/env node
// Builds the read-only candidate ledger a month's photo curation runs on.
//
// Why this exists as a tool rather than a one-off query: every month past September needs the same
// ledger, and the September round proved that hand-written counts drift from the database. The
// ledger is the single input the curation and the acceptance checks both read, so a number can only
// be wrong in one place.
//
// It never writes: no production table is touched, no review decision is created or changed, no
// file is deleted. Output is a JSON file the caller names.
//
// The four states this ledger keeps apart, because collapsing them is how "approved" starts meaning
// four different things (CLAUDE.md, MEMORY-03):
//   exists      — a media row is present
//   deliverable — a derivative a page can actually fetch is ready (photo: web|thumbnail, video: poster)
//   publishable — deliverable AND visibility is not private; this is what a family page may show
//   subject     — media_subject_check says the picture is of the child. media_topic is NOT this:
//                 it is a topic score, and a high score never implies subject approval.
//
// Day assignment reads media.taken_at at face value. It is a plain `timestamp` holding Shanghai
// wall clock (lib/timeline-dates.ts), so adding or subtracting 8 hours corrupts it.
//
// Usage: node scripts/month-curation-ledger.mjs --month=2026-09 --out=<path.json>

import fs from "node:fs";
import path from "node:path";
import { openRds } from "../.data/night-rds.mjs";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};

const month = arg("month");
const out = arg("out");
if (!/^\d{4}-\d{2}$/.test(month ?? "")) {
  console.error("--month=YYYY-MM is required");
  process.exit(1);
}
if (!out) {
  console.error("--out=<path.json> is required");
  process.exit(1);
}
const [year, mon] = month.split("-").map(Number);
const monthStart = `${month}-01`;
const nextMonth = mon === 12 ? `${year + 1}-01-01` : `${year}-${String(mon + 1).padStart(2, "0")}-01`;

const { client, close } = await openRds({ readOnly: true });
try {
  const { rows: media } = await client.query(
    `select
       m.id                                         as media_id,
       m.media_asset_id                             as media_asset_id,
       m.raw_source_id                              as raw_source_id,
       m.life_event_id                              as life_event_id,
       m.type                                       as type,
       m.mime_type                                  as mime_type,
       m.visibility                                 as visibility,
       m.width                                      as width,
       m.height                                     as height,
       m.file_size                                  as file_size,
       m.duration_seconds                           as duration_seconds,
       m.original_filename                          as original_filename,
       to_char(m.taken_at, 'YYYY-MM-DD')            as day,
       to_char(m.taken_at, 'YYYY-MM-DD HH24:MI:SS') as taken_at_wall_clock,
       a.checksum                                   as checksum,
       a.media_type                                 as asset_media_type,
       a.width                                      as asset_width,
       a.height                                     as asset_height,
       a.archive_status                             as archive_status,
       to_char(a.taken_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as asset_taken_at_shanghai,
       r.source_type                                as source_type,
       r.source_label                               as source_label,
       to_char(r.captured_at at time zone 'Asia/Shanghai', 'YYYY-MM-DD HH24:MI:SS') as source_captured_at_shanghai
     from media m
     left join media_assets a on a.id = m.media_asset_id
     left join raw_sources  r on r.id = m.raw_source_id
     where m.taken_at >= $1::timestamp and m.taken_at < $2::timestamp
     order by m.taken_at, m.id`,
    [monthStart, nextMonth],
  );

  const assetIds = [...new Set(media.map((m) => m.media_asset_id).filter(Boolean))];
  const mediaIds = media.map((m) => m.media_id);

  const { rows: locations } = await client.query(
    `select media_asset_id, variant, provider, status from media_locations where media_asset_id = any($1)`,
    [assetIds],
  );
  const { rows: reviews } = await client.query(
    `select target_kind, target_id, decision, subject_relevance, worthiness_score, provider, model,
            prompt_version, policy_version, id, reviewed_at::text as reviewed_at
       from content_quality_reviews
      where target_kind in ('media_subject_check','media_topic','media_water')
        and target_id = any($1)`,
    [mediaIds],
  );
  const { rows: bindings } = await client.query(
    `select target_id, decision, id, reviewed_at::text as reviewed_at
       from content_quality_reviews where target_kind = 'media_binding'`,
  );
  const { rows: rejections } = await client.query(
    `select media_id, checksum, category, reason_code, rejected_by, created_at::text as created_at
       from media_rejections where media_id = any($1)`,
    [mediaIds],
  );

  // trust list, kept in sync with lib/trusted-photo-sources.ts
  const TRUSTED_LABELS = new Set([
    "conversation:2109e1e89306b57b8334d349", // DAYCARE_CONVERSATION
    "conversation:d3a0e5f619ac6fe3e40d81cf",
    "conversation:a673c0e0563be6ecf1867094",
    "conversation:856b8ec2b8f3ec2871782ca6",
    "conversation:064d5dfbd798a5f27223c758",
  ]);

  const locByAsset = new Map();
  for (const l of locations) {
    const b = locByAsset.get(l.media_asset_id) ?? [];
    b.push(l);
    locByAsset.set(l.media_asset_id, b);
  }
  // latest-wins, ties broken on id — same rule as lib/media/story-binding.ts
  const latest = new Map();
  for (const rev of reviews) {
    const key = `${rev.target_kind}|${rev.target_id}`;
    const held = latest.get(key);
    const rank = `${rev.reviewed_at ?? ""}|${rev.id ?? ""}`;
    if (!held || rank > `${held.reviewed_at ?? ""}|${held.id ?? ""}`) latest.set(key, rev);
  }
  const bindingByMedia = new Map();
  for (const b of bindings) {
    const mediaId = String(b.target_id).split("|")[1];
    if (!mediaId) continue;
    const bucket = bindingByMedia.get(mediaId) ?? [];
    bucket.push({ decision: b.decision, reviewedAt: b.reviewed_at, eventId: String(b.target_id).split("|")[0] });
    bindingByMedia.set(mediaId, bucket);
  }
  const rejByMedia = new Map(rejections.map((r) => [r.media_id, r]));

  const readyVariants = (assetId) =>
    (locByAsset.get(assetId) ?? []).filter((l) => l.status === "ready").map((l) => `${l.provider}:${l.variant}`);

  const candidates = media.map((m) => {
    const ready = readyVariants(m.media_asset_id);
    const isVideo = (m.asset_media_type ?? m.type) === "video";
    const deliverable = isVideo
      ? ready.some((v) => v.endsWith(":poster"))
      : ready.some((v) => v.endsWith(":web") || v.endsWith(":thumbnail"));
    const subject = latest.get(`media_subject_check|${m.media_id}`) ?? null;
    const topic = latest.get(`media_topic|${m.media_id}`) ?? null;
    const trusted = m.source_type === "family_photo" || (m.source_label && TRUSTED_LABELS.has(m.source_label));
    const subjectApproved = subject?.decision === "approved";
    return {
      mediaId: m.media_id,
      mediaAssetId: m.media_asset_id,
      rawSourceId: m.raw_source_id,
      lifeEventId: m.life_event_id,
      type: m.type,
      assetMediaType: m.asset_media_type,
      mimeType: m.mime_type,
      day: m.day,
      daySource: "media.taken_at (plain timestamp = Shanghai wall clock, read at face value)",
      takenAtWallClock: m.taken_at_wall_clock,
      assetTakenAtShanghai: m.asset_taken_at_shanghai,
      sourceCapturedAtShanghai: m.source_captured_at_shanghai,
      checksum: m.checksum,
      originalFilename: m.original_filename,
      fileSize: m.file_size,
      width: m.width ?? m.asset_width,
      height: m.height ?? m.asset_height,
      durationSeconds: m.duration_seconds,
      archiveStatus: m.archive_status,
      // the four states, kept separate on purpose
      exists: true,
      deliverable,
      readyVariants: ready,
      visibility: m.visibility,
      publishable: deliverable && m.visibility !== "private",
      subjectCheck: subject
        ? { decision: subject.decision, subjectRelevance: subject.subject_relevance, reviewedAt: subject.reviewed_at,
            provider: subject.provider, model: subject.model, promptVersion: subject.prompt_version, policyVersion: subject.policy_version }
        : null,
      subjectApproved,
      topicReview: topic
        ? { decision: topic.decision, worthinessScore: topic.worthiness_score, reviewedAt: topic.reviewed_at, model: topic.model,
            note: "topic score only — never implies subject approval" }
        : null,
      sourceType: m.source_type,
      sourceLabel: m.source_label,
      trustedSource: Boolean(trusted),
      privileged: Boolean(trusted) || subjectApproved,
      storyBindings: bindingByMedia.get(m.media_id) ?? [],
      rejection: rejByMedia.get(m.media_id) ?? null,
    };
  });

  const byDay = new Map();
  for (const c of candidates) byDay.set(c.day, (byDay.get(c.day) ?? 0) + 1);

  const ledger = {
    generatedAt: new Date().toISOString(),
    month,
    dayField: "media.taken_at",
    dayFieldSemantics: "plain timestamp holding Shanghai wall clock; no timezone arithmetic applied",
    counts: {
      candidates: candidates.length,
      deliverable: candidates.filter((c) => c.deliverable).length,
      publishable: candidates.filter((c) => c.publishable).length,
      subjectApproved: candidates.filter((c) => c.subjectApproved).length,
      subjectPending: candidates.filter((c) => c.subjectCheck && c.subjectCheck.decision !== "approved").length,
      subjectNeverChecked: candidates.filter((c) => !c.subjectCheck).length,
      trustedSource: candidates.filter((c) => c.trustedSource).length,
      privileged: candidates.filter((c) => c.privileged).length,
      videos: candidates.filter((c) => (c.assetMediaType ?? c.type) === "video").length,
      withChecksum: candidates.filter((c) => c.checksum).length,
    },
    daysWithCandidates: [...byDay.entries()].sort().map(([day, n]) => ({ day, candidates: n })),
    candidates,
  };

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(ledger, null, 1));
  console.log(`ledger: ${candidates.length} candidates across ${byDay.size} days -> ${out}`);
  console.log(JSON.stringify(ledger.counts, null, 1));
} finally {
  await close();
}
