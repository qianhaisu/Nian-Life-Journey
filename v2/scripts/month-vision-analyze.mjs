#!/usr/bin/env node
// Runs the month's visual analysis through DeepSeek v4.1 Flash and caches every result.
//
// Two layers, kept separate in the output because conflating them is how "21 images analysed"
// silently became "21 images compared" in an earlier round:
//   classification — every unique image gets media_kind (photo / screenshot / document / video frame)
//                    and a plain description of what is visible. Single images get this too.
//   comparison     — only groups holding two or more images get a recommended representative and a
//                    list of which frames carry independent value. A single image has nothing to
//                    compare against and is never counted as "compared".
//
// The cache is keyed by the sha-256 of the exact bytes sent to the model, so a hit provably refers
// to the same picture. Results imported from an earlier round keep their own `source` and model
// fields; nothing is relabelled to look like it came from this run.
//
// Model policy (CLAUDE.md): deepseek-flash only. A configured AI_MODEL naming anything else stops
// the run before a request is sent, and a response reporting a different model is a hard failure.
//
// Usage: node scripts/month-vision-analyze.mjs --groups=<groups.json> --cache=<media dir>
//        --vision-cache=<vision.json> --out=<results.json> [--chunk=5] [--max-failures=15] [--limit=N]
//        [--concurrency=N] [--run-label=<text naming this round in each new result's source>] [--retries=2]

import { GLM_MODEL, isZhipu, messagesFetch, modelKey } from "../lib/organizer/glm-messages.mjs";
import fs from "node:fs";
import path from "node:path";

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const groupsPath = arg("groups");
const mediaDir = arg("cache");
const visionCachePath = arg("vision-cache");
const outPath = arg("out");
// Default 4, not 5. Measured across the completed history-rollout months (2026-09-18): chunk-size-5
// classify/compare calls truncated at 5.69% (21 of 369), every other size at 0% (0 of 1134, sizes
// 1-4). A truncated call produces no result and the whole chunk is resent whole — that resend is the
// literal duplicate call this default is chosen to avoid, not a guess at a "safer" number.
const chunkSize = Number(arg("chunk", "4"));
// Raised from 15 (2026-09-18, after 2026-03 tripped it): a month with unusually large bursts (2026-03
// had chunks up to 19 images before splitting) can accumulate 15 truncations while still mostly
// intact, and the retry pass below exists precisely to resolve truncations. The ceiling still exists
// to catch a systemic failure (wrong key, model down) rather than ordinary truncation noise.
const maxFailures = Number(arg("max-failures", "30"));
const limit = Number(arg("limit", "0"));
const concurrency = Number(arg("concurrency", "1"));
// Names the run in each new result's `source`, so a cache that outlives one run (or is seeded from
// another month's) still says which round produced each answer. Default keeps September's wording.
const runLabel = arg("run-label", "this run");
const sourceLabel = `deepseek-flash (${runLabel})`;
if (!groupsPath || !mediaDir || !visionCachePath || !outPath) {
  console.error("--groups, --cache, --vision-cache and --out are required");
  process.exit(1);
}

let MODEL = "deepseek-flash"; // 2026-09-23 起 AI_PROVIDER=zhipu 时改用 glm-5.3-flash（见下）
const env = {};
// 2026-09-23：AI_PROVIDER=zhipu 时经 glm-messages.mjs 改发智谱 glm-5.3-flash。
const mfetch = (url, init) => messagesFetch(url, init, env);
for (const line of fs.readFileSync(path.join(process.cwd(), ".env.local"), "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
if (isZhipu(env)) MODEL = GLM_MODEL;
if (env.AI_MODEL && env.AI_MODEL.trim() !== MODEL) {
  console.error(`MODEL_NOT_ALLOWED: AI_MODEL="${env.AI_MODEL}" is not ${MODEL}; nothing was sent.`);
  process.exit(1);
}
const BASE = (env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com/anthropic").replace(/\/$/, "");

const groups = JSON.parse(fs.readFileSync(groupsPath, "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(mediaDir, "_manifest.json"), "utf8"));
const visionCache = fs.existsSync(visionCachePath) ? JSON.parse(fs.readFileSync(visionCachePath, "utf8")) : {};
// Comparisons are cached per group so an interrupted run resumes instead of paying to compare the
// same burst twice. The key carries the group's exact member list: change the grouping and the
// cached comparison no longer applies, which is the behaviour we want.
const comparisonCachePath = arg("comparison-cache", visionCachePath.replace(/\.json$/, "-comparisons.json"));
const comparisonCache = fs.existsSync(comparisonCachePath)
  ? JSON.parse(fs.readFileSync(comparisonCachePath, "utf8")) : {};
const comparisonKey = (groupId, mediaIds) => `${groupId}::${mediaIds.join(",")}`;

const CLASSIFY_RULES = [
  "你在为一个家庭生活档案做照片初筛。下面每张图片前都标了编号。",
  "对每一张图片，判断两件事：",
  "1) media_kind：photo（真实拍摄的生活照）、screenshot（手机或电脑屏幕截图、聊天记录截图、网页截图）、document（文件、表格、证书、海报等以文字为主的拍摄件）、video_frame（视频截帧）。",
  "2) description：用一到两句中文客观描述画面里实际看得见的内容——人物动作、姿势、手里和面前的物品、环境。",
  "只描述画面里真实可见的东西。不要推测姓名、亲属关系、情绪原因、动作先后、是不是第一次，也不要描述没拍到的事。",
].join("\n");

const COMPARE_RULES = [
  "这些图片拍摄时间相近，可能是同一场景的连拍。请再判断：",
  "3) representative：给出最值得保留的那一张的编号，并在 representative_reason 里说明理由（考虑清晰度、脸部是否可见、表情、动作是否完整、画面信息是否丰富）。",
  "4) distinct：列出除代表之外、仍然记录了明显不同的动作或信息、值得单独保留的图片编号；如果其余各张只是同一姿势同一动作的重复，就给空列表。",
  "注意：同一个动作的连拍只留代表；但动作、互动或场景确实不同的，不要因为衣服相同或地点相同就判为重复。",
].join("\n");

const JSON_RULE = [
  "最后单独输出一行 JSON，不要加代码块标记。",
  "顶层是一个对象，含键 images，值是数组，每个元素含键 n（编号，整数）、media_kind（字符串）、description（字符串）。",
];
const JSON_RULE_COMPARE = JSON_RULE.concat([
  "顶层还要含键 representative（整数编号）、representative_reason（字符串）、distinct（整数编号数组）。",
]);

const stats = { calls: 0, cacheHitImages: 0, analysedImages: 0, failures: 0, truncated: 0,
  inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, thinkingChars: 0, callsWithThinking: 0, httpRetries: 0 };
const failures = [];
const callLog = [];

// What the provider's reply says about the call beyond the answer itself: prefix-cache hits, and how
// much of the output was the model thinking rather than writing the JSON. Recorded per call so a
// cost decision (e.g. whether thinking is worth a sample comparison) rests on measured numbers.
function replyShape(payload) {
  const blocks = payload.content ?? [];
  const thinking = blocks.filter((c) => c.type === "thinking" || c.type === "redacted_thinking");
  return {
    cacheReadTokens: payload.usage?.cache_read_input_tokens ?? null,
    thinkingBlocks: thinking.length,
    thinkingChars: thinking.reduce((n, c) => n + String(c.thinking ?? c.data ?? "").length, 0),
    textChars: blocks.filter((c) => c.type === "text").reduce((n, c) => n + String(c.text ?? "").length, 0),
  };
}

async function callModel(label, images, compare) {
  // Fixed instructions first, then the pictures. The rules, quality bar and output format are
  // identical for every call of the same kind, so putting them ahead of the images gives the
  // provider's prefix cache a shared opening to reuse; the numbered images, which change every call,
  // come after. The wording of the rules is unchanged.
  const rules = compare ? `${CLASSIFY_RULES}\n${COMPARE_RULES}\n${JSON_RULE_COMPARE.join("\n")}`
                        : `${CLASSIFY_RULES}\n${JSON_RULE.join("\n")}`;
  const content = [{ type: "text", text: rules }];
  images.forEach((img, i) => {
    content.push({ type: "text", text: `图${i + 1}：` });
    content.push({ type: "image", source: { type: "base64", media_type: img.mediaType, data: img.base64 } });
  });

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await mfetch(`${BASE}/v1/messages`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": modelKey(env),
          "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: MODEL, max_tokens: 8000, messages: [{ role: "user", content }] }),
      });
      if (!response.ok) {
        stats.httpRetries += 1;
        if (attempt === 3) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 160)}`);
        continue;
      }
      const payload = await response.json();
      if (payload.model && payload.model !== MODEL) {
        throw new Error(`PROVIDER_MODEL_MISMATCH: requested ${MODEL}, answered ${payload.model}`);
      }
      const text = (payload.content ?? []).filter((c) => c.type === "text").map((c) => c.text).join("");
      const shape = replyShape(payload);
      stats.calls += 1;
      stats.inputTokens += payload.usage?.input_tokens ?? 0;
      stats.outputTokens += payload.usage?.output_tokens ?? 0;
      stats.cacheReadTokens += shape.cacheReadTokens ?? 0;
      stats.thinkingChars += shape.thinkingChars;
      if (shape.thinkingBlocks) stats.callsWithThinking += 1;
      const truncated = payload.stop_reason === "max_tokens";
      if (truncated) stats.truncated += 1;
      callLog.push({ label, images: images.length, compare, requestedModel: MODEL,
        returnedModel: payload.model ?? null, stopReason: payload.stop_reason, truncated,
        usage: payload.usage, attempt, ...shape, promptLayout: "rules-first" });
      return { text, truncated, stopReason: payload.stop_reason, usage: payload.usage,
        returnedModel: payload.model ?? null };
    } catch (error) {
      if (attempt === 3) {
        stats.failures += 1;
        failures.push({ label, error: String(error.message ?? error) });
        return null;
      }
    }
  }
  return null;
}

function parseJson(text) {
  const candidates = [...text.matchAll(/\{[\s\S]*\}/g)].map((m) => m[0]);
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    try {
      const parsed = JSON.parse(candidates[i]);
      if (parsed && Array.isArray(parsed.images)) return parsed;
    } catch { /* try the next candidate */ }
  }
  // last resort: the largest brace-balanced slice
  const start = text.indexOf("{");
  if (start >= 0) {
    for (let end = text.length; end > start; end -= 1) {
      try {
        const parsed = JSON.parse(text.slice(start, end));
        if (parsed && Array.isArray(parsed.images)) return parsed;
      } catch { /* keep shrinking */ }
    }
  }
  return null;
}

const results = { generatedAt: new Date().toISOString(), month: groups.month, model: MODEL, runSource: sourceLabel,
  classification: {}, comparisons: [], chunkComparisons: [] };

const toAnalyse = [];
for (const group of groups.groups) {
  for (const mediaId of group.mediaIds) {
    const entry = manifest[mediaId];
    if (!entry) continue;
    if (!visionCache[entry.derivativeSha256]) toAnalyse.push({ mediaId, group: group.groupId });
  }
}
const groupedImages = groups.groups.reduce((n, g) => n + g.mediaIds.length, 0);
console.log(`${groupedImages} grouped images (of ${groups.uniqueItems.length} unique originals); ` +
  `${toAnalyse.length} need classification, ${groupedImages - toAnalyse.length} served from cache`);

const loadImage = (mediaId) => {
  const entry = manifest[mediaId];
  const buffer = fs.readFileSync(path.join(mediaDir, entry.file));
  return { mediaId, base64: buffer.toString("base64"),
    mediaType: entry.contentType?.startsWith("image/") ? entry.contentType : "image/jpeg",
    sha: entry.derivativeSha256 };
};

let processedGroups = 0;
let stopped = false;
// "" on the first pass; "#retryN" when a group is sent again (see the retry pass below)
let attemptSuffix = "";
async function processGroup(group) {
  const chunks = [];
  for (let i = 0; i < group.mediaIds.length; i += chunkSize) chunks.push(group.mediaIds.slice(i, i + chunkSize));

  const chunkReps = [];
  for (const [chunkIndex, chunk] of chunks.entries()) {
    const needed = chunk.filter((id) => !visionCache[manifest[id]?.derivativeSha256]);
    const needsCompare = chunk.length > 1;
    const cachedCompare = comparisonCache[comparisonKey(`${group.groupId}/c${chunkIndex}`, chunk)];
    if (!needed.length && (!needsCompare || cachedCompare)) {
      stats.cacheHitImages += chunk.length;
      if (cachedCompare) {
        results.chunkComparisons.push({ ...cachedCompare, fromCache: true });
        if (cachedCompare.representative) chunkReps.push(cachedCompare.representative);
      } else if (!needsCompare) {
        chunkReps.push(chunk[0]);
      }
      continue;
    }
    // A chunk is sent whole whenever any of its images is missing, or whenever it needs a
    // comparison: the model can only compare pictures it can see in the same request.
    const images = chunk.map(loadImage);
    const label = `${group.groupId}/c${chunkIndex + 1}${attemptSuffix}`;
    const answer = await callModel(label, images, needsCompare);
    if (!answer) continue;
    const parsed = parseJson(answer.text);
    if (!parsed) {
      stats.failures += 1;
      failures.push({ label, error: "unparseable JSON", truncated: answer.truncated, stopReason: answer.stopReason });
      continue;
    }
    if (answer.truncated) {
      failures.push({ label, error: "stop_reason=max_tokens — result treated as incomplete", stopReason: answer.stopReason });
      continue;
    }
    const byN = new Map((parsed.images ?? []).map((row) => [Number(row.n), row]));
    chunk.forEach((mediaId, i) => {
      const sha = manifest[mediaId].derivativeSha256;
      // An image already classified by an earlier, accepted round keeps that result and its
      // provenance. A multi-image group still has to be *sent* whole for the comparison, but being
      // re-sent is not a reason to relabel a cached answer as this run's work.
      if (visionCache[sha]) {
        stats.cacheHitImages += 1;
        return;
      }
      const row = byN.get(i + 1);
      if (!row) {
        failures.push({ label, mediaId, error: `model returned no entry for 图${i + 1}` });
        return;
      }
      visionCache[sha] = {
        mediaId, mediaKind: row.media_kind, description: row.description,
        source: sourceLabel, model: MODEL, stopReason: answer.stopReason,
        analysedAt: new Date().toISOString(), label,
      };
      stats.analysedImages += 1;
    });
    if (needsCompare && parsed.representative) {
      const repIndex = Number(parsed.representative) - 1;
      const repMediaId = chunk[repIndex] ?? null;
      const record = {
        groupId: group.groupId, chunkIndex, day: group.day, size: chunk.length,
        mediaIds: chunk, representative: repMediaId, reason: parsed.representative_reason ?? null,
        distinct: (parsed.distinct ?? []).map((n) => chunk[Number(n) - 1]).filter(Boolean),
        stopReason: answer.stopReason, returnedModel: answer.returnedModel,
      };
      results.chunkComparisons.push(record);
      comparisonCache[comparisonKey(`${group.groupId}/c${chunkIndex}`, chunk)] = record;
      if (repMediaId) chunkReps.push(repMediaId);
    } else if (!needsCompare) {
      chunkReps.push(chunk[0]);
    }
  }

  // second level: when a group needed more than one chunk, compare the chunk representatives
  const repKey = comparisonKey(`${group.groupId}/rep`, chunkReps);
  if (chunks.length > 1 && chunkReps.length > 1 && comparisonCache[repKey]) {
    results.comparisons.push({ ...comparisonCache[repKey], fromCache: true });
  } else if (chunks.length > 1 && chunkReps.length > 1) {
    const images = chunkReps.map(loadImage);
    const label = `${group.groupId}/rep${attemptSuffix}`;
    const answer = await callModel(label, images, true);
    const parsed = answer ? parseJson(answer.text) : null;
    if (parsed && !answer.truncated && parsed.representative) {
      const record = {
        groupId: group.groupId, day: group.day, level: "group (across chunks)",
        mediaIds: chunkReps, representative: chunkReps[Number(parsed.representative) - 1] ?? null,
        reason: parsed.representative_reason ?? null,
        distinct: (parsed.distinct ?? []).map((n) => chunkReps[Number(n) - 1]).filter(Boolean),
        stopReason: answer.stopReason, returnedModel: answer.returnedModel,
      };
      results.comparisons.push(record);
      comparisonCache[repKey] = record;
    } else if (answer) {
      failures.push({ label, error: "group-level comparison unusable", stopReason: answer.stopReason });
    }
  } else if (chunks.length === 1 && group.size > 1) {
    const chunk = results.chunkComparisons.find((c) => c.groupId === group.groupId && c.chunkIndex === 0);
    if (chunk) {
      results.comparisons.push({ groupId: group.groupId, day: group.day, level: "group (single chunk)",
        mediaIds: chunk.mediaIds, representative: chunk.representative, reason: chunk.reason,
        distinct: chunk.distinct, stopReason: chunk.stopReason, returnedModel: chunk.returnedModel });
    }
  }

}

// Groups are independent: each one's call only ever sees its own images, so running several at a
// time changes throughput and nothing else. The shared caches are plain objects in this one
// process, written to disk between waves, so there is no cross-process write to race on.
const queue = limit ? groups.groups.slice(0, limit) : groups.groups;
for (let i = 0; i < queue.length && !stopped; i += concurrency) {
  await Promise.all(queue.slice(i, i + concurrency).map(async (group) => {
    if (stopped) return;
    await processGroup(group);
    processedGroups += 1;
  }));
  if (stats.failures >= maxFailures) {
    console.error(`STOP: ${stats.failures} failures reached the limit; nothing further was sent.`);
    stopped = true;
  }
  fs.writeFileSync(visionCachePath, JSON.stringify(visionCache, null, 1));
  fs.writeFileSync(comparisonCachePath, JSON.stringify(comparisonCache, null, 1));
  console.log(`  groups ${processedGroups}/${queue.length} | calls ${stats.calls} | ` +
    `new ${stats.analysedImages} | cached ${stats.cacheHitImages} | fail ${stats.failures}`);
}

// Retry pass. A truncated or unparseable chunk leaves its pictures unclassified (and its group
// uncompared). Instead of a second run, this same process sends only the groups still incomplete,
// at the same concurrency, under a distinct label ("#retryN") so a truncated call's label can never
// become a result's label. Cached pictures and cached comparisons are not re-sent. The earlier
// failure stays on record, marked resolvedByRetry once its group is complete.
const retries = Number(arg("retries", "2"));
const groupComplete = (group) =>
  group.mediaIds.every((id) => !manifest[id] || visionCache[manifest[id].derivativeSha256]) &&
  (group.size < 2 || results.comparisons.some((c) => c.groupId === group.groupId && c.representative));
// Not gated on `stopped`: that flag means "the main pass stopped queuing NEW groups because
// failures hit the ceiling", not "give up on the month". A group the main pass never even reached
// (queued after the ceiling tripped) is exactly what `groupComplete` below calls incomplete, so
// leaving it out of the retry pass silently dropped 2026-03's back third of the month — caught only
// because month-curation-check.mjs's byte-coverage gate failed, not by anything in this script. The
// retry pass is still bounded (`retries` rounds, only over what's actually incomplete).
for (let round = 1; round <= retries; round += 1) {
  const pending = queue.filter((group) => !groupComplete(group));
  if (!pending.length) break;
  attemptSuffix = `#retry${round}`;
  console.log(`  retry ${round}: ${pending.length} incomplete group(s)`);
  for (let i = 0; i < pending.length; i += concurrency) {
    await Promise.all(pending.slice(i, i + concurrency).map((group) => processGroup(group)));
    fs.writeFileSync(visionCachePath, JSON.stringify(visionCache, null, 1));
    fs.writeFileSync(comparisonCachePath, JSON.stringify(comparisonCache, null, 1));
  }
}
for (const failure of failures) {
  const group = queue.find((g) => failure.label?.startsWith(`${g.groupId}/`));
  if (group && groupComplete(group)) failure.resolvedByRetry = true;
}
// a retried group re-reads its cached chunk comparisons; keep one record per chunk and per group
results.chunkComparisons = [...new Map(results.chunkComparisons.map((c) => [`${c.groupId}|${c.chunkIndex}`, c])).values()];
results.comparisons = [...new Map(results.comparisons.map((c) => [c.groupId, c])).values()];
stats.unresolvedFailures = failures.filter((x) => !x.resolvedByRetry).length;

results.classification = visionCache;
results.stats = stats;
results.failures = failures;
results.callLog = callLog;
fs.writeFileSync(visionCachePath, JSON.stringify(visionCache, null, 1));
fs.writeFileSync(comparisonCachePath, JSON.stringify(comparisonCache, null, 1));
fs.writeFileSync(outPath, JSON.stringify(results, null, 1));
console.log(JSON.stringify(stats, null, 1));
console.log(`comparisons: ${results.comparisons.length} group-level, ${results.chunkComparisons.length} chunk-level`);
console.log(`failures: ${failures.length}`);
