// 首页照片质量评估的**缓存与守卫**（HOME-20260913, 2026-09-13）。
//
// 评估本身不在 SSR 里跑（lib/home-feed.ts 的规矩：模型不进入 SSR）。它是一个离线有界批次
// （scripts/home-photo-quality.mjs），把结果写成一个 JSON 缓存；首页只读缓存，读不到就走确定性降级。
//
// ─────────────────────────────────────────────────────────────────────────────
// 这个文件真正存在的理由：2026-09-13 的探测结果
// ─────────────────────────────────────────────────────────────────────────────
//
// 生产 provider 是 DeepSeek（AI_PROVIDER=deepseek、AI_MODEL=deepseek-v4-pro，端点
// https://api.deepseek.com/anthropic）。给它发一张自己生成的 64×64 纯橙色 PNG，问「这张图是什么
// 颜色，一个词回答」：
//
//   HTTP 200。usage.input_tokens = 100。模型自己的 thinking 里写着：
//   「The prompt says "[Unsupported Image] What single colour fills this image?" We don't see image.
//     Need maybe identify color? Could be」
//
// **图片在到达模型之前被换成了一个 `[Unsupported Image]` 占位符，然后模型开始猜。** 请求没有报错，
// 没有 4xx，没有任何一个字段说「我不支持图片」——如果那次调用问的是「这张照片里孩子在做什么」，
// 它会返回一段通顺的、完全编造的描述，而我们会把它当成 AI 评分写进账本。
//
// 这正是任务卡点名的那条：**不能用纯文字模型猜照片内容**。所以这里的守卫不是防御性文档，
// 它是这条链路上唯一能挡住伪造评分的东西：
//
//   1. 批次开始前先用一张**合成图**（不是任何家庭照片）做能力探测，答案我们自己知道。
//      模型说不出那个颜色，整批直接中止，一个分数都不写。
//   2. 任何一次回答里出现 `[Unsupported Image]` 这类占位符痕迹，那一张判失败，不写分数。
//   3. 解析严格：四项分数缺一项就是失败，不用默认值补。
//
// 宁可整批不跑，也不要写一个看起来像 AI 评分的数字。
import type { HomePhotoQuality, HomePhotoQualityLookup } from "@/lib/home-feed";

/** 缓存文件路径的环境变量。没设、文件不存在、读坏了——一律当「没有评估结果」，走确定性降级。 */
export const HOME_PHOTO_QUALITY_PATH_ENV = "HOME_PHOTO_QUALITY_PATH";

/** 缓存文件的形状。`assessedAt` / `model` 是可核对的来源，不是装饰。 */
export type HomePhotoQualityCache = {
  /** 写这份缓存时用的模型标识。 */
  model: string;
  /** 什么时候跑的。 */
  assessedAt: string;
  /** 候选范围的说明：哪些照片被评过，为什么是这些。 */
  scope: string;
  /** mediaId → 四项分数。 */
  scores: Record<string, {
    interaction: number; readability: number; context: number; distinction: number;
  }>;
};

/** 四项权重（共同规格 §5.3）。总和为 1。 */
export const QUALITY_WEIGHTS = { interaction: 0.35, readability: 0.25, context: 0.25, distinction: 0.15 } as const;

export function weightedScore(parts: { interaction: number; readability: number; context: number; distinction: number }): number {
  return Math.round(
    parts.interaction * QUALITY_WEIGHTS.interaction
    + parts.readability * QUALITY_WEIGHTS.readability
    + parts.context * QUALITY_WEIGHTS.context
    + parts.distinction * QUALITY_WEIGHTS.distinction,
  );
}

/**
 * 缓存 → 首页用的 lookup。
 *
 * 缓存里查不到的照片返回 undefined，**不返回一个 0 分**：undefined 让 lib/home-feed.ts 走确定性
 * 降级并标注「还没评过」，而 0 分会被当成「评过了，很差」——那是两句完全不同的话。
 */
export function qualityLookupFrom(cache: HomePhotoQualityCache | undefined): HomePhotoQualityLookup {
  if (!cache) return () => undefined;
  return (mediaId: string): HomePhotoQuality | undefined => {
    const parts = cache.scores[mediaId];
    if (!parts) return undefined;
    return {
      score: weightedScore(parts),
      interaction: parts.interaction,
      readability: parts.readability,
      context: parts.context,
      distinction: parts.distinction,
      source: "ai_vision",
      assessedAt: cache.assessedAt,
      model: cache.model,
    };
  };
}

/** 模型没有真的看到图片时，回答里会留下的痕迹。命中任何一条 → 这次回答不算评估结果。 */
const BLIND_MARKERS = [
  "[unsupported image]",
  "unsupported image",
  "don't see image",
  "do not see any image",
  "cannot see the image",
  "can't see the image",
  "no image was provided",
  "未看到图片",
  "无法查看图片",
  "看不到图片",
];

/**
 * 这段回答是不是「模型其实没看到图」。
 *
 * 只看痕迹，不做语义判断：一个真的看到了橙色方块的模型不会在回答里写
 * 「[Unsupported Image]」或「we don't see image」。
 */
export function looksBlind(answer: string): boolean {
  const lower = answer.toLowerCase();
  return BLIND_MARKERS.some((marker) => lower.includes(marker.toLowerCase()));
}

export type VisionProbeVerdict = { capable: boolean; reason: string };

/**
 * 能力探测的判定。`expected` 是我们自己生成那张合成图的已知答案（比如 "orange"）。
 *
 * 三种不通过，都返回 capable: false：
 *   · 回答里有「没看到图」的痕迹；
 *   · 回答里根本没有那个已知答案；
 *   · 回答是空的。
 *
 * 通过的唯一方式是它**说对了**。这是一道能力门，不是一次礼貌的询问——
 * 「HTTP 200」在 2026-09-13 的探测里恰好是最没有信息量的那个信号。
 */
export function judgeVisionProbe(answer: string | undefined, expected: string): VisionProbeVerdict {
  const text = (answer ?? "").trim();
  if (!text) return { capable: false, reason: "探测请求没有返回任何文字" };
  if (looksBlind(text)) return { capable: false, reason: `回答里有「没看到图片」的痕迹：${text.slice(0, 160)}` };
  if (!text.toLowerCase().includes(expected.toLowerCase())) {
    return { capable: false, reason: `合成探测图是 ${expected}，模型说的是：${text.slice(0, 160)}` };
  }
  return { capable: true, reason: `合成探测图的颜色答对了（${expected}）` };
}

export type ParsedScores = { interaction: number; readability: number; context: number; distinction: number };

const SCORE_KEYS: Array<keyof ParsedScores> = ["interaction", "readability", "context", "distinction"];

/**
 * 严格解析模型返回的四项分数。**缺一项就是失败**，不用默认值补齐。
 *
 * 补默认值是最容易滑进去的那种伪造：一个只返回了 readability 的回答，被补成
 * `{interaction: 0, readability: 80, context: 0, distinction: 0}` 之后，它长得和一次真实评估
 * 一模一样，只是分低——没有任何字段说那三项其实没人评过。
 */
export function parseVisionScores(text: string): { scores?: ParsedScores; error?: string } {
  if (looksBlind(text)) return { error: "回答里有「没看到图片」的痕迹，不作为评估结果" };
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { error: "回答里没有 JSON 对象" };
  let raw: unknown;
  try { raw = JSON.parse(match[0]); }
  catch (error) { return { error: `JSON 解析失败：${String((error as Error)?.message ?? error)}` }; }
  if (!raw || typeof raw !== "object") return { error: "JSON 不是一个对象" };
  const record = raw as Record<string, unknown>;
  const scores = {} as ParsedScores;
  for (const key of SCORE_KEYS) {
    const value = record[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return { error: `缺少或不是数字的字段：${key}` };
    if (value < 0 || value > 100) return { error: `字段 ${key} 超出 0–100：${value}` };
    scores[key] = Math.round(value);
  }
  return { scores };
}

/**
 * 读缓存文件。任何一步出问题都返回 undefined——首页照样渲染，只是分数标成降级。
 * 同步读、只在离线脚本和服务启动路径上用；SSR 里由调用方把结果传给 buildHomeFeed。
 */
export async function loadQualityCache(path?: string, env: NodeJS.ProcessEnv = process.env): Promise<HomePhotoQualityCache | undefined> {
  const file = path ?? env[HOME_PHOTO_QUALITY_PATH_ENV];
  if (!file) return undefined;
  try {
    const { readFile } = await import("node:fs/promises");
    const parsed = JSON.parse(await readFile(file, "utf8")) as HomePhotoQualityCache;
    if (!parsed || typeof parsed !== "object" || !parsed.scores || typeof parsed.scores !== "object") return undefined;
    if (!parsed.model || !parsed.assessedAt) return undefined;
    return parsed;
  } catch { return undefined; }
}
