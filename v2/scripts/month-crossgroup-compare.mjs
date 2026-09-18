#!/usr/bin/env node
// Day-level cross-group comparison: are two different bursts of the same day still showing the
// same thing? Burst grouping only ever joins frames seconds apart, so a child photographed eating
// at 08:37 and again at 11:49 lands in two groups that a reader would still experience as "another
// picture of lunch". Only the model gets to say that; this script asks it.
//
// Input is each group's representative for a day, in time order, in chunks. Comparing every pair of
// a 120-photo day is explicitly out of scope (and was ruled out in the task): neighbouring bursts
// are where redundancy actually accumulates.
//
// Output feeds the curation step. It never deletes anything: a representative the model calls
// redundant moves down the reading order, it does not leave the archive.
//
// Usage: node scripts/month-crossgroup-compare.mjs --groups=<groups.json> --vision=<results.json>
//        --cache=<media dir> --out=<crossgroup.json> [--chunk=6] [--retry-failed=<earlier crossgroup.json>]

import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const groupsPath = arg("groups");
const visionPath = arg("vision");
const mediaDir = arg("cache");
const outPath = arg("out");
const chunkSize = Number(arg("chunk", "6"));
if (!groupsPath || !visionPath || !mediaDir || !outPath) {
  console.error("--groups, --vision, --cache and --out are required");
  process.exit(1);
}

const MODEL = "deepseek-flash";
const env = {};
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (env.AI_MODEL && env.AI_MODEL.trim() !== MODEL) {
  console.error(`MODEL_NOT_ALLOWED: AI_MODEL="${env.AI_MODEL}"`);
  process.exit(1);
}
const BASE = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");

const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));
const vision = JSON.parse(fs.readFileSync(visionPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(mediaDir, "_manifest.json"), "utf8"));
const classification = vision.classification ?? {};
const kindOf = (mediaId) => classification[manifest[mediaId]?.derivativeSha256]?.mediaKind ?? null;

const repByGroup = new Map();
for (const c of vision.comparisons ?? []) if (c.representative) repByGroup.set(c.groupId, c.representative);
for (const group of groups.groups) {
  if (group.size === 1) repByGroup.set(group.groupId, group.mediaIds[0]);
  else if (!repByGroup.has(group.groupId)) {
    const chunk = (vision.chunkComparisons ?? []).find((c) => c.groupId === group.groupId && c.representative);
    if (chunk) repByGroup.set(group.groupId, chunk.representative);
  }
}

const PROMPT = [
  "下面这些照片来自同一天的不同时间段，每张代表当天的一个拍摄片段。",
  "请判断：把它们放在同一个页面上给家人看，哪些是内容重复、放在一起显得啰嗦的，哪些各自记录了不一样的事情。",
  "判断依据是画面里的场景、动作和信息，不要因为衣服相同、地点相同就判为重复；",
  "也不要因为时间不同就默认不重复。",
  "最后单独输出一行 JSON，不加代码块标记。顶层对象含两个键：",
  "clusters —— 数组，每个元素是一个由内容高度重复的图片编号组成的数组（整数），并在同一元素里用键无法表达，所以每个元素只放编号数组；只放确实重复的，没有就给空数组。",
  "keep —— 数组，列出所有各自有独立价值、应当都保留的图片编号（整数）。",
].join("\n");

const results = [];
const failures = [];
const callLog = [];
let calls = 0;
let inputTokens = 0;
let outputTokens = 0;

// --retry-failed=<crossgroup.json of an earlier run>: keep every result that run produced and send
// only the chunks it recorded as failures. Those failures stay in the record (marked resolved when the
// retry succeeds): a truncated call is answered by a later one, never erased from the ledger.
const retryPath = arg("retry-failed");
const prior = retryPath ? JSON.parse(fs.readFileSync(retryPath, "utf8")) : null;
const retryLabels = prior
  ? new Set((prior.failures ?? []).filter((f) => !f.resolvedByRetry).map((f) => f.label)) : null;
if (prior) {
  results.push(...(prior.results ?? []));
  callLog.push(...(prior.callLog ?? []));
  calls = prior.stats?.calls ?? 0;
  inputTokens = prior.stats?.inputTokens ?? 0;
  outputTokens = prior.stats?.outputTokens ?? 0;
}

const byDay = new Map();
for (const group of groups.groups) {
  const rep = repByGroup.get(group.groupId);
  if (!rep) continue;
  // screenshots and documents never compete for a reading slot, so they are not compared here
  const kind = kindOf(rep);
  if (kind && kind !== "photo" && kind !== "video_frame") continue;
  const b = byDay.get(group.day) ?? [];
  b.push({ groupId: group.groupId, mediaId: rep, startedAt: group.startedAt, size: group.size });
  byDay.set(group.day, b);
}

for (const [day, reps] of [...byDay.entries()].sort()) {
  if (reps.length < 2) {
    if (!prior) results.push({ day, groupsCompared: reps.length, note: "fewer than two comparable groups; nothing to compare" });
    continue;
  }
  reps.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""));
  for (let i = 0; i < reps.length; i += chunkSize) {
    const chunk = reps.slice(i, i + chunkSize);
    if (chunk.length < 2) continue;
    const label = `${day}/x${Math.floor(i / chunkSize) + 1}`;
    if (retryLabels && !retryLabels.has(label)) continue;
    const content = [];
    chunk.forEach((r, idx) => {
      const entry = manifest[r.mediaId];
      const buffer = fs.readFileSync(path.join(mediaDir, entry.file));
      content.push({ type: "text", text: `图${idx + 1}（${r.startedAt}）：` });
      content.push({ type: "image", source: { type: "base64",
        media_type: entry.contentType?.startsWith("image/") ? entry.contentType : "image/jpeg",
        data: buffer.toString("base64") } });
    });
    content.push({ type: "text", text: PROMPT });
    let ok = false;
    for (let attempt = 1; attempt <= 3 && !ok; attempt += 1) {
      try {
        const response = await fetch(`${BASE}/v1/messages`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-api-key": env.DEEPSEEK_API_KEY,
            "anthropic-version": "2023-06-01" },
          body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content }] }),
        });
        if (!response.ok) { if (attempt === 3) throw new Error(`HTTP ${response.status}`); continue; }
        const payload = await response.json();
        if (payload.model && payload.model !== MODEL) throw new Error(`PROVIDER_MODEL_MISMATCH ${payload.model}`);
        calls += 1;
        inputTokens += payload.usage?.input_tokens ?? 0;
        outputTokens += payload.usage?.output_tokens ?? 0;
        callLog.push({ label, images: chunk.length, requestedModel: MODEL, returnedModel: payload.model ?? null,
          stopReason: payload.stop_reason, usage: payload.usage });
        if (payload.stop_reason === "max_tokens") {
          failures.push({ label, error: "stop_reason=max_tokens — treated as incomplete" });
          ok = true;
          break;
        }
        const text = (payload.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
        let parsed = null;
        for (const m of [...text.matchAll(/\{[\s\S]*\}/g)].reverse()) {
          try { const p = JSON.parse(m[0]); if (p && Array.isArray(p.clusters)) { parsed = p; break; } } catch { /* next */ }
        }
        if (!parsed) { failures.push({ label, error: "unparseable JSON" }); ok = true; break; }
        results.push({
          day, chunk: label, groupsCompared: chunk.length,
          groupIds: chunk.map((c) => c.groupId),
          mediaIds: chunk.map((c) => c.mediaId),
          redundantClusters: (parsed.clusters ?? []).map((cluster) =>
            (cluster ?? []).map((n) => chunk[Number(n) - 1]?.mediaId).filter(Boolean)).filter((c) => c.length > 1),
          keep: (parsed.keep ?? []).map((n) => chunk[Number(n) - 1]?.mediaId).filter(Boolean),
          stopReason: payload.stop_reason, returnedModel: payload.model ?? null,
        });
        ok = true;
      } catch (error) {
        if (attempt === 3) failures.push({ label, error: String(error.message ?? error) });
      }
    }
  }
  console.log(`${day}: ${reps.length} group representatives compared`);
}

const priorFailures = (prior?.failures ?? []).map((f) => (retryLabels?.has(f.label) && !failures.some((x) => x.label === f.label)
  ? { ...f, resolvedByRetry: true } : f));
const allFailures = [...priorFailures, ...failures];
fs.writeFileSync(outPath, JSON.stringify({
  generatedAt: new Date().toISOString(), month: groups.month, model: MODEL,
  ...(prior ? { retriedFrom: retryPath, retriedLabels: [...retryLabels] } : {}),
  stats: { calls, inputTokens, outputTokens, failures: allFailures.length,
    unresolvedFailures: allFailures.filter((f) => !f.resolvedByRetry).length },
  results, failures: allFailures, callLog,
}, null, 1));
console.log(`cross-group: ${calls} calls, ${results.length} comparisons, ${failures.length} failures`);
