// 首页照片质量评估 —— 离线有界批次（HOME-20260913, 2026-09-13）。
//
// 模型不进入 SSR（lib/home-feed.ts 的规矩）。这个脚本在渲染之外跑一次，把结果写成一个 JSON 缓存，
// 首页只读缓存（lib/home-photo-quality.ts loadQualityCache），读不到就走确定性降级。
//
// 用法：
//   node --import tsx scripts/home-photo-quality.mjs --out <cache.json> [--limit 30] [--days 60]
//                                                    [--base http://127.0.0.1:18080] [--dry-run]
//
// 有界，四条边界都是硬的（共同规格 §5.4）：
//   · 候选只取最近 --days 天（默认 60）内**已经过展示门槛**的 (故事, 照片) 对——和首页用的是
//     同一个门（memory.lead → storyDisplayMedia，逐 (eventId,mediaId) 的 media_binding=approved）。
//     这里不自己判一次资格，否则脚本和首页会对「哪些照片可以看」给出两个答案。
//   · 最多 --limit 张（默认 30）。
//   · 连续失败 3 次停掉整批，不无限重试。
//   · 不打开任何全局 Organizer 开关，不写库，不改任何审核状态。只写 --out 那一个文件。
//
// 最前面是一道**能力门**：先用一张自己生成的合成图（不是任何家庭照片）问模型一个我们已知答案的
// 问题。模型答不对，整批中止，一个分数都不写。
//
// 2026-09-13 实测：DeepSeek（deepseek-v4-pro，https://api.deepseek.com/anthropic）在这道门上
// **不通过**——HTTP 200，但图片在到达模型前被换成 `[Unsupported Image]`，模型开始猜。详见
// lib/home-photo-quality.ts 顶部。所以今天跑这个脚本的正确结果就是「中止，未评估」，
// 而不是一份填满了数字的缓存。
import { readFileSync, writeFileSync } from "node:fs";
import sharp from "sharp";
import { loadFamilyArchive } from "../lib/family-archive.ts";
import { candidateMemories, HOME_CANDIDATE_WINDOW_DAYS, HOME_PHOTO_CANDIDATES_MAX } from "../lib/home-feed.ts";
import { judgeVisionProbe, parseVisionScores } from "../lib/home-photo-quality.ts";
import { assertProviderModel, resolveDeepSeekModel } from "../lib/organizer/deepseek-model.ts";

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = args.indexOf(`--${name}`);
  return index >= 0 && args[index + 1] && !args[index + 1].startsWith("--") ? args[index + 1] : fallback;
};
const has = (name) => args.includes(`--${name}`);

const OUT = flag("out");
const LIMIT = Number(flag("limit", "30"));
const DAYS = Number(flag("days", String(HOME_CANDIDATE_WINDOW_DAYS)));
const BASE = flag("base", "http://127.0.0.1:18080");
const DRY_RUN = has("dry-run");
const MAX_CONSECUTIVE_FAILURES = 3;

if (!OUT && !DRY_RUN) {
  console.error("用法：--out <cache.json>（或 --dry-run 只看候选，不调模型、不写文件）");
  process.exit(2);
}

// 凭据只从 .env.local 读，不打印任何值。
function env() {
  const values = { ...process.env };
  try {
    for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split(/\r?\n/)) {
      const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
      if (match && values[match[1]] === undefined) values[match[1]] = match[2].replace(/^["']|["']$/g, "");
    }
  } catch { /* 没有 .env.local 就只用进程环境 */ }
  return values;
}

const ENV = env();
const MODEL = resolveDeepSeekModel(ENV);
const BASE_URL = ENV.DEEPSEEK_BASE_URL;
const API_KEY = ENV.DEEPSEEK_API_KEY;

/** 一次模型调用。返回纯文本，失败抛错。调用计数由调用方累加，报告里要照实写。 */
let callCount = 0;
async function ask(content) {
  callCount += 1;
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL, max_tokens: 400, messages: [{ role: "user", content }] }),
    signal: AbortSignal.timeout(90_000),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text);
  assertProviderModel(MODEL, body);
  // thinking 块也要一起看：2026-09-13 那次，「没看到图」这句话只出现在 thinking 里。
  return (body.content ?? []).map((part) => part.thinking ?? part.text ?? "").join("\n").trim();
}

/** 能力门：一张自己生成的 64×64 纯橙色 PNG，答案我们知道。 */
async function visionGate() {
  const png = await sharp({ create: { width: 64, height: 64, channels: 3, background: { r: 255, g: 140, b: 0 } } }).png().toBuffer();
  const answer = await ask([
    { type: "image", source: { type: "base64", media_type: "image/png", data: png.toString("base64") } },
    { type: "text", text: "What single colour fills this image? Answer with one word." },
  ]);
  return judgeVisionProbe(answer, "orange");
}

const PROMPT = [
  "你在为一个家庭生活档案的首页挑照片。只根据你在这张图里真正看到的东西打分，看不清就给低分，不要推测。",
  "四项，各 0–100：",
  "  interaction  画面里有没有可见的互动或动作（人在做什么、和谁在一起）。只有静物、风景、截图、文字为主的画面给低分。",
  "  readability  画面本身读不读得出来：清晰度、光线、主体是否被遮挡或过小。",
  "  context     画面提供的可靠上下文：看得出是在什么场合、什么环境。",
  "  distinction  它和一张普通随手拍比起来有多不一样。",
  "不要评价长相，不要推测孩子的心情或内心想法。",
  '只输出一个 JSON 对象，四个键，值为数字：{"interaction":0,"readability":0,"context":0,"distinction":0}',
].join("\n");

async function fetchBytes(src) {
  const url = /^https?:\/\//.test(src) ? src : new URL(src, BASE).toString();
  const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`取图 HTTP ${res.status}`);
  const buffer = Buffer.from(await res.arrayBuffer());
  // 统一转成 JPEG 并限制长边，既省 token 也避免 HEIC 之类模型不认的容器。
  const jpeg = await sharp(buffer).rotate().resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer();
  return jpeg.toString("base64");
}

async function main() {
  const archive = await loadFamilyArchive();
  const today = archive.time.today;
  // 和首页同一个门：memory.lead 已经是逐 (eventId, mediaId) 人工审核后的结果。
  const candidates = [];
  for (const memory of candidateMemories(archive.chapters, today, DAYS)) {
    if (!memory.lead) continue;
    candidates.push({
      mediaId: memory.lead.id, eventId: memory.id, title: memory.title,
      day: memory.signature.day, src: memory.lead.src, width: memory.lead.width, height: memory.lead.height,
    });
  }
  const batch = candidates.slice(0, LIMIT);
  const scope = `最近 ${DAYS} 天内已过展示门槛的 (故事, 照片) 对；候选 ${candidates.length} 组，本批取前 ${batch.length} 组（上限 ${LIMIT}）`;

  console.log(`档案今天：${today}`);
  console.log(`候选范围：${scope}`);
  console.log(`首页一期最多呈现 ${HOME_PHOTO_CANDIDATES_MAX} 组候选`);
  for (const candidate of batch) {
    console.log(`  ${candidate.day}  ${candidate.mediaId.slice(0, 40)}  ${candidate.width}x${candidate.height}  ${candidate.title}`);
  }

  if (DRY_RUN) {
    console.log("\n--dry-run：没有调用任何模型，没有写文件。");
    console.log(`实际模型调用数：${callCount}`);
    return;
  }
  if (!BASE_URL || !API_KEY) {
    console.error("\n中止：没有配置模型端点或密钥。未写任何分数。");
    process.exit(1);
  }

  console.log("\n能力门：用一张自己生成的合成图探测……");
  let gate;
  try { gate = await visionGate(); }
  catch (error) { gate = { capable: false, reason: `探测请求失败：${String(error.message).slice(0, 200)}` }; }
  console.log(`  ${gate.capable ? "通过" : "不通过"}：${gate.reason}`);
  if (!gate.capable) {
    console.error([
      "",
      "中止整批：这个模型看不到图片，**一个分数都没有写**。",
      `模型：${MODEL}`,
      "首页会继续用确定性降级分，并在 quality.degraded 里标明「不是 AI 评分」。",
      "拿一个看不见图片的模型去评照片内容，得到的是编造，不是评估。",
      `实际模型调用数：${callCount}（只有这一次探测）`,
    ].join("\n"));
    process.exit(3);
  }

  const scores = {};
  const failures = [];
  let consecutive = 0;
  for (const candidate of batch) {
    try {
      const b64 = await fetchBytes(candidate.src);
      const answer = await ask([
        { type: "image", source: { type: "base64", media_type: "image/jpeg", data: b64 } },
        { type: "text", text: PROMPT },
      ]);
      const { scores: parsed, error } = parseVisionScores(answer);
      if (!parsed) throw new Error(error);
      scores[candidate.mediaId] = parsed;
      consecutive = 0;
      console.log(`  ✓ ${candidate.mediaId.slice(0, 24)} ${JSON.stringify(parsed)}`);
    } catch (error) {
      consecutive += 1;
      const reason = String(error.message ?? error).slice(0, 200);
      failures.push({ mediaId: candidate.mediaId, reason });
      console.log(`  ✗ ${candidate.mediaId.slice(0, 24)} ${reason}`);
      if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n连续失败 ${MAX_CONSECUTIVE_FAILURES} 次，停掉这一批（不无限重试）。`);
        break;
      }
    }
  }

  const cache = { model: MODEL, assessedAt: new Date().toISOString(), scope, scores };
  writeFileSync(OUT, `${JSON.stringify(cache, null, 1)}\n`, "utf8");
  console.log([
    "",
    `写入：${OUT}`,
    `评估成功：${Object.keys(scores).length} 张；失败：${failures.length} 张`,
    `实际模型调用数：${callCount}（含 1 次能力探测）`,
    failures.length ? `失败原因：\n${failures.map((f) => `  ${f.mediaId.slice(0, 24)} ${f.reason}`).join("\n")}` : "",
  ].filter(Boolean).join("\n"));
}

await main();
