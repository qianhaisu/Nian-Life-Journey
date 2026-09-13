// 照片质量评估的守卫 (lib/home-photo-quality.ts).
//
// 这些用例守的是同一件事：**一个看不见图片的模型，不能在账本里留下一个看起来像 AI 评分的数字**。
// 第一条用例里那段字符串是 2026-09-13 真实探测里 deepseek-v4-pro 自己的 thinking 原文。
import test from "node:test";
import assert from "node:assert/strict";
import {
  judgeVisionProbe, loadQualityCache, looksBlind, parseVisionScores, qualityLookupFrom,
  QUALITY_WEIGHTS, weightedScore,
} from "../lib/home-photo-quality.ts";

// 2026-09-13 探测：HTTP 200、input_tokens 100、图片被换成占位符，模型开始猜。
const REAL_BLIND_ANSWER = 'We need answer user\'s question. Need infer from image? Unsupported image? '
  + 'We don\'t have visual. The prompt says "[Unsupported Image] What single colour fills this image? '
  + 'Answer with one word." We don\'t see image. Need maybe identify color? Could be';

test("2026-09-13 真实回答：HTTP 200 但模型没看到图，能力探测必须判不通过", () => {
  assert.equal(looksBlind(REAL_BLIND_ANSWER), true);
  const verdict = judgeVisionProbe(REAL_BLIND_ANSWER, "orange");
  assert.equal(verdict.capable, false);
  assert.match(verdict.reason, /没看到图片/);
});

test("能力探测只有说对合成图的颜色才算通过", () => {
  assert.equal(judgeVisionProbe("Orange", "orange").capable, true);
  assert.equal(judgeVisionProbe("The image is filled with orange.", "orange").capable, true);
  // 说错了不算通过 —— 一个乱猜的纯文字模型有很大概率会说出某个颜色词。
  assert.equal(judgeVisionProbe("Blue", "orange").capable, false);
  assert.match(judgeVisionProbe("Blue", "orange").reason, /模型说的是/);
  assert.equal(judgeVisionProbe("", "orange").capable, false);
  assert.equal(judgeVisionProbe(undefined, "orange").capable, false);
});

test("四项缺一项就是失败，不用默认值补齐（补默认值就是伪造）", () => {
  const ok = parseVisionScores('{"interaction": 70, "readability": 80, "context": 90, "distinction": 60}');
  assert.deepEqual(ok.scores, { interaction: 70, readability: 80, context: 90, distinction: 60 });
  assert.equal(ok.error, undefined);
  const missing = parseVisionScores('{"readability": 80}');
  assert.equal(missing.scores, undefined);
  assert.match(missing.error, /interaction/);
  assert.equal(parseVisionScores('{"interaction": "高", "readability": 1, "context": 1, "distinction": 1}').scores, undefined);
  assert.match(parseVisionScores('{"interaction": 120, "readability": 1, "context": 1, "distinction": 1}').error, /超出 0–100/);
  assert.match(parseVisionScores("这张图看起来不错").error, /没有 JSON/);
  assert.match(parseVisionScores("{broken").error, /没有 JSON|JSON 解析失败/);
});

test("哪怕回答里带着一份完整的 JSON，只要有「没看到图」的痕迹就不算评估结果", () => {
  const sneaky = '[Unsupported Image] 我猜一下：{"interaction": 80, "readability": 80, "context": 80, "distinction": 80}';
  const parsed = parseVisionScores(sneaky);
  assert.equal(parsed.scores, undefined, "格式再漂亮也不是它看到的东西");
  assert.match(parsed.error, /没看到图片/);
});

test("权重就是规格给的 35/25/25/15，加权分算对", () => {
  assert.deepEqual(QUALITY_WEIGHTS, { interaction: 0.35, readability: 0.25, context: 0.25, distinction: 0.15 });
  assert.equal(weightedScore({ interaction: 100, readability: 100, context: 100, distinction: 100 }), 100);
  assert.equal(weightedScore({ interaction: 0, readability: 0, context: 0, distinction: 0 }), 0);
  assert.equal(weightedScore({ interaction: 100, readability: 0, context: 0, distinction: 0 }), 35);
});

test("缓存里没有这张照片时返回 undefined，不是 0 分", () => {
  const lookup = qualityLookupFrom({
    model: "test-vision", assessedAt: "2026-09-13T00:00:00Z", scope: "测试",
    scores: { "media-a": { interaction: 60, readability: 80, context: 100, distinction: 40 } },
  });
  const found = lookup("media-a");
  assert.equal(found.source, "ai_vision");
  assert.equal(found.model, "test-vision");
  assert.equal(found.score, weightedScore({ interaction: 60, readability: 80, context: 100, distinction: 40 }));
  assert.equal(found.degraded, undefined, "真的评过就不该带降级说明");
  // 「没评过」和「评过了很差」是两句不同的话。
  assert.equal(lookup("media-b"), undefined);
  assert.equal(qualityLookupFrom(undefined)("media-a"), undefined);
});

test("缓存文件缺失、坏了、或缺关键字段，一律当没有评估结果（首页照样渲染）", async () => {
  assert.equal(await loadQualityCache(undefined, {}), undefined, "没设环境变量");
  assert.equal(await loadQualityCache("./no-such-file-9f3a.json", {}), undefined, "文件不存在");
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const dir = await mkdtemp(path.join(os.tmpdir(), "nl-quality-"));
  const broken = path.join(dir, "broken.json");
  await writeFile(broken, "{not json", "utf8");
  assert.equal(await loadQualityCache(broken, {}), undefined, "坏 JSON");
  const noModel = path.join(dir, "no-model.json");
  await writeFile(noModel, JSON.stringify({ scores: {}, assessedAt: "x" }), "utf8");
  assert.equal(await loadQualityCache(noModel, {}), undefined, "缺 model —— 分数就没有可核对的来源");
  const good = path.join(dir, "good.json");
  await writeFile(good, JSON.stringify({ model: "m", assessedAt: "t", scope: "s", scores: {} }), "utf8");
  assert.equal((await loadQualityCache(good, {})).model, "m");
});

// ── 修 3：readHomeFeed 真的去读那份离线缓存（原来这一段是断的） ──────────────────

const MEDIA = "media-x";
const BIRTH = "2025-01-03";
const TODAY = "2026-09-13";

/** 一份最小的真档案：一段记忆 + 一张逐对获批的配图。两条用例共用。 */
async function archiveFixture() {
  const { buildChapters } = await import("../lib/memory-chapters.ts");
  const { storyPhotoConfirmationsFrom } = await import("../lib/media/story-binding.ts");
  const media = [{
    id: MEDIA, profileId: "p", type: "photo", src: "/api/media/x", thumbnailSrc: "/api/media/x?t",
    width: 2000, height: 1500, takenAt: "2026-09-07T10:00:00+08:00", visibility: "family", rawSourceId: "r",
  }];
  const events = [{
    id: "e-1", profileId: "p", title: "一段记忆", story: "正文", occurredAt: "2026-09-07 00:00:00+00",
    people: [], tags: [], contentTypes: ["family"], mediaIds: [MEDIA], sourceIds: [], growthRecordIds: [],
    careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"],
    visibility: "family", keptInYearbook: false,
  }];
  const reviews = [{ id: "rev", targetKind: "media_binding", targetId: `e-1|${MEDIA}`, decision: "approved", reviewedAt: "2026-09-13T00:00:00Z" }];
  return {
    store: { qualityReviews: reviews }, media, events, traceEvents: [], eventIdentities: events,
    chapters: buildChapters({ events, traces: [], media, deliverable: new Set([MEDIA]), birthDay: BIRTH, photoConfirmations: storyPhotoConfirmationsFrom(reviews) }),
    birthDay: BIRTH, snapshots: [], privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() },
    time: { today: TODAY, activityDay: TODAY },
  };
}

const EDITION = { id: "t", startedAt: "x", expiresAt: "y", slot: 0, index: 0 };

test("readHomeFeed 会读 HOME_PHOTO_QUALITY_PATH 指向的缓存，并把 ai_vision 分数带上首页", async () => {
  // 原来的洞：批次脚本写出缓存、buildHomeFeed 会用传进来的 quality，但 readHomeFeed 从不去读那个文件
  // —— 三个部件都对，中间没人接线，于是批次跑成功了首页也永远停在确定性降级分上。
  const { mkdtemp, writeFile } = await import("node:fs/promises");
  const path = await import("node:path");
  const os = await import("node:os");
  const { readHomeFeed, HOME_PHOTO_QUALITY_PATH_ENV } = await import("../lib/home-feed.ts")
    .then(async (feed) => ({ ...feed, ...(await import("../lib/home-photo-quality.ts")) }));

  const dir = await mkdtemp(path.join(os.tmpdir(), "nl-feed-cache-"));
  const file = path.join(dir, "quality.json");
  await writeFile(file, JSON.stringify({
    model: "cache-model", assessedAt: "2026-09-13T10:00:00Z", scope: "测试",
    scores: { [MEDIA]: { interaction: 80, readability: 90, context: 100, distinction: 70 } },
  }), "utf8");

  const archive = await archiveFixture();

  // **真的调 readHomeFeed**，不照抄它的接线：删掉它里面那一行，这条测试必须失败。
  const previous = process.env[HOME_PHOTO_QUALITY_PATH_ENV];
  process.env[HOME_PHOTO_QUALITY_PATH_ENV] = file;
  try {
    const feed = await readHomeFeed({ archive, upcoming: { status: "ready", items: [] }, edition: EDITION });
    assert.equal(feed.lead.photo.quality.source, "ai_vision", "readHomeFeed 必须自己把缓存读进来，否则这里还是降级分");
    assert.equal(feed.lead.photo.quality.model, "cache-model");
    assert.equal(feed.lead.photo.quality.degraded, undefined);
    assert.equal(feed.lead.photo.quality.interaction, 80);
    // 调用方显式传了 quality 时，以调用方为准（注入优先于文件）。
    const injected = await readHomeFeed({
      archive, upcoming: { status: "ready", items: [] }, edition: EDITION,
      quality: () => undefined,
    });
    assert.equal(injected.lead.photo.quality.source, "deterministic");
  } finally {
    if (previous === undefined) delete process.env[HOME_PHOTO_QUALITY_PATH_ENV];
    else process.env[HOME_PHOTO_QUALITY_PATH_ENV] = previous;
  }
});

test("环境变量没设时 readHomeFeed 退回确定性降级分，不报错", async () => {
  const { readHomeFeed } = await import("../lib/home-feed.ts");
  const previous = process.env.HOME_PHOTO_QUALITY_PATH;
  delete process.env.HOME_PHOTO_QUALITY_PATH;
  try {
    const feed = await readHomeFeed({ archive: await archiveFixture(), upcoming: { status: "ready", items: [] }, edition: EDITION });
    assert.equal(feed.lead.photo.quality.source, "deterministic");
    assert.ok(feed.lead.photo.quality.degraded, "降级要写原因");
  } finally {
    if (previous !== undefined) process.env.HOME_PHOTO_QUALITY_PATH = previous;
  }
});

test("环境变量没设 / 文件不在时，readHomeFeed 的接线返回 undefined，首页退回降级分而不是报错", async () => {
  const { loadQualityCache, qualityLookupFrom } = await import("../lib/home-photo-quality.ts");
  assert.equal(await loadQualityCache(undefined, {}), undefined);
  assert.equal(qualityLookupFrom(undefined)("any"), undefined, "lookup 返回 undefined → buildHomeFeed 走确定性降级");
});
