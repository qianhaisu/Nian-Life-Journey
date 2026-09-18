#!/usr/bin/env node
// Local, deterministic pre-pass over a month's media: exact duplicates, dimensions, quality stats
// and candidate burst groups. No model is called here.
//
// The division of labour this file sits inside (CLAUDE.md, 2026-09-17): local code may decide what
// is byte-identical and what is worth *showing to a model together*. It may NOT decide that two
// pictures record the same action, or that a picture is not worth keeping. A 90-second window and a
// dHash distance are proximity hints for batching — they are not a verdict, and nothing downstream
// may treat a group as "already deduplicated" because this script drew a box around it.
//
// Usage: node scripts/month-local-grouping.mjs --ledger=<ledger.json> --cache=<dir> --out=<groups.json>
//        [--window=90]

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const ledgerPath = arg("ledger");
const cacheDir = arg("cache");
const outPath = arg("out");
const windowSeconds = Number(arg("window", "90"));
if (!ledgerPath || !cacheDir || !outPath) {
  console.error("--ledger, --cache and --out are required");
  process.exit(1);
}

const ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(cacheDir, "_manifest.json"), "utf8"));

// 64-bit difference hash: 9x8 grayscale, each pixel compared with its right neighbour.
async function dHash(file) {
  const raw = await sharp(file).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer();
  let bits = "";
  for (let row = 0; row < 8; row += 1) {
    for (let col = 0; col < 8; col += 1) {
      bits += raw[row * 9 + col] > raw[row * 9 + col + 1] ? "1" : "0";
    }
  }
  return bits;
}
const hamming = (a, b) => {
  let d = 0;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) d += 1;
  return d;
};

const items = [];
let analysed = 0;
for (const candidate of ledger.candidates) {
  const entry = manifest[candidate.mediaId];
  if (!entry) {
    items.push({ ...candidate, localError: "not in media cache" });
    continue;
  }
  const file = path.join(cacheDir, entry.file);
  const buffer = fs.readFileSync(file);
  let meta = {};
  let hash = null;
  let stats = null;
  try {
    meta = await sharp(buffer).metadata();
    hash = await dHash(buffer);
    const s = await sharp(buffer).stats();
    const channel = s.channels[0];
    stats = { sharpness: Number((s.sharpness ?? 0).toFixed(2)), entropy: Number((s.entropy ?? 0).toFixed(2)),
      mean: Number(channel.mean.toFixed(1)), stdev: Number(channel.stdev.toFixed(1)) };
  } catch (error) {
    items.push({ ...candidate, localError: String(error.message ?? error) });
    continue;
  }
  analysed += 1;
  items.push({
    mediaId: candidate.mediaId,
    day: candidate.day,
    takenAtWallClock: candidate.takenAtWallClock,
    type: candidate.assetMediaType ?? candidate.type,
    file: entry.file,
    derivativeSha256: entry.derivativeSha256,
    originalChecksum: candidate.originalChecksum ?? candidate.checksum ?? null,
    derivativeWidth: meta.width,
    derivativeHeight: meta.height,
    aspect: meta.width && meta.height ? Number((meta.width / meta.height).toFixed(3)) : null,
    dHash: hash,
    stats,
    privileged: candidate.privileged,
    trustedSource: candidate.trustedSource,
    subjectApproved: candidate.subjectApproved,
    subjectCheck: candidate.subjectCheck,
    publishable: candidate.publishable,
    sourceLabel: candidate.sourceLabel,
    rawSourceId: candidate.rawSourceId,
  });
}

// exact duplicates: identical ORIGINAL checksum is the authoritative identity; identical derivative
// bytes are reported separately because two different originals can resize to the same derivative.
const byOriginal = new Map();
const byDerivative = new Map();
for (const item of items) {
  if (item.originalChecksum) {
    const b = byOriginal.get(item.originalChecksum) ?? [];
    b.push(item.mediaId);
    byOriginal.set(item.originalChecksum, b);
  }
  if (item.derivativeSha256) {
    const b = byDerivative.get(item.derivativeSha256) ?? [];
    b.push(item.mediaId);
    byDerivative.set(item.derivativeSha256, b);
  }
}
const exactDuplicateClusters = [...byOriginal.entries()].filter(([, ids]) => ids.length > 1)
  .map(([checksum, mediaIds]) => ({ identity: "original checksum", checksum, mediaIds,
    representative: mediaIds.slice().sort()[0] }));
const derivativeOnlyClusters = [...byDerivative.entries()].filter(([, ids]) => ids.length > 1)
  .map(([sha, mediaIds]) => ({ identity: "derivative sha256", sha256: sha, mediaIds }))
  .filter((c) => !exactDuplicateClusters.some((e) => c.mediaIds.every((id) => e.mediaIds.includes(id))));

// Deduplicate BEFORE grouping. The same photograph reaches the archive once per WeChat export, so
// 388 of September's rows are byte-identical to another row. Grouping the raw rows would invent
// "bursts" out of one picture imported twice, and would send the same image to the model repeatedly.
// Every duplicate row is kept in the ledger and mapped to its representative — nothing is dropped.
const pickRepresentative = (members) =>
  members.slice().sort((a, b) =>
    Number(b.privileged) - Number(a.privileged) ||
    Number(b.subjectApproved) - Number(a.subjectApproved) ||
    (a.takenAtWallClock ?? "").localeCompare(b.takenAtWallClock ?? "") ||
    a.mediaId.localeCompare(b.mediaId))[0];

const uniqueItems = [];
const seenOriginal = new Map();
for (const item of items) {
  if (item.localError) continue;
  const key = item.originalChecksum ?? `no-checksum:${item.mediaId}`;
  const bucket = seenOriginal.get(key) ?? [];
  bucket.push(item);
  seenOriginal.set(key, bucket);
}
for (const [, members] of seenOriginal) {
  const chosen = pickRepresentative(members);
  uniqueItems.push({ ...chosen, duplicateRowCount: members.length,
    duplicateMediaIds: members.map((m) => m.mediaId).filter((id) => id !== chosen.mediaId) });
}

// burst grouping inside a day: consecutive in time, close in time AND visually near.
const groups = [];
const byDay = new Map();
for (const item of uniqueItems) {
  const b = byDay.get(item.day) ?? [];
  b.push(item);
  byDay.set(item.day, b);
}
for (const [day, dayItems] of [...byDay.entries()].sort()) {
  dayItems.sort((a, b) => (a.takenAtWallClock ?? "").localeCompare(b.takenAtWallClock ?? "") || a.mediaId.localeCompare(b.mediaId));
  let current = [];
  const flush = () => {
    if (!current.length) return;
    groups.push({
      groupId: `${day}#${String(groups.filter((g) => g.day === day).length + 1).padStart(2, "0")}`,
      day,
      size: current.length,
      kind: current.length === 1 ? "single" : "burst-candidate",
      startedAt: current[0].takenAtWallClock,
      endedAt: current[current.length - 1].takenAtWallClock,
      mediaIds: current.map((i) => i.mediaId),
      files: current.map((i) => i.file),
      basis: current.length === 1 ? "no neighbour within window" :
        `consecutive frames taken within ${windowSeconds}s of each other (time only; dHash recorded, not gated)`,
      dHashDistances: current.slice(1).map((item, i) =>
        current[i].dHash && item.dHash ? hamming(current[i].dHash, item.dHash) : null),
      note: "proximity hint only — whether the pictures actually show the same action is decided by the vision model, not here",
    });
    current = [];
  };
  for (const item of dayItems) {
    if (!current.length) { current = [item]; continue; }
    const prev = current[current.length - 1];
    const gap = (Date.parse(item.takenAtWallClock.replace(" ", "T") + "Z") -
                 Date.parse(prev.takenAtWallClock.replace(" ", "T") + "Z")) / 1000;
    // Time proximity alone opens a group. dHash is recorded, never used as a gate: measured on
    // September's own bursts, frames one second apart routinely sit 17-41 bits apart, so any
    // threshold tight enough to mean "same scene" also splits real bursts. Grouping too generously
    // costs one extra image in a model call; grouping too tightly hides duplicates from the model
    // entirely, which is the failure that matters.
    if (gap <= windowSeconds) current.push(item);
    else { flush(); current = [item]; }
  }
  flush();
}

const result = {
  generatedAt: new Date().toISOString(),
  month: ledger.month,
  method: {
    exactDuplicate: "sha-256 of the archived original (media_assets.checksum); derivative-byte matches reported separately",
    grouping: `same day, consecutive by media.taken_at, gap <= ${windowSeconds}s; 64-bit dHash distances recorded per group but never used as a gate`,
    quality: "sharp.stats() — deterministic, no model",
    boundary: "local signals narrow the candidate set only; they never decide sameness of action or whether a picture is worth keeping",
  },
  counts: {
    ledgerCandidates: ledger.candidates.length,
    analysed,
    uniqueOriginals: uniqueItems.length,
    duplicateRowsFolded: analysed - uniqueItems.length,
    localErrors: items.filter((i) => i.localError).length,
    exactDuplicateClusters: exactDuplicateClusters.length,
    exactDuplicateMedia: exactDuplicateClusters.reduce((n, c) => n + c.mediaIds.length, 0),
    derivativeOnlyClusters: derivativeOnlyClusters.length,
    groups: groups.length,
    burstGroups: groups.filter((g) => g.size > 1).length,
    singles: groups.filter((g) => g.size === 1).length,
    largestGroup: groups.reduce((m, g) => Math.max(m, g.size), 0),
  },
  exactDuplicateClusters,
  derivativeOnlyClusters,
  groups,
  uniqueItems,
  items,
};
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, JSON.stringify(result, null, 1));
console.log(JSON.stringify(result.counts, null, 1));
