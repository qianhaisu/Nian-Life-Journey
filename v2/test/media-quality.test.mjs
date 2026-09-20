// 画质闸门：原生分辨率不足的照片不进阅读面（lib/media-quality.ts + lib/media/deliverability.ts）。
//
// 起因是 Teddy 2026-09-20 在 /memory/2025/07/24 查看器里看到的第 3 张：media 行、media_assets 源
// 尺寸、投递用的 web 派生图三层都是 90×120，库里没有更大的授权原图，铺到全屏就是十几倍放大。
// 下面的数字全部取自当天在生产库上的只读盘点，不是随手编的——门槛以后要动，得先说明哪条事实变了。
//
// 这些用例同时钉两件事：规则本身，以及它**只在一道闸门上**生效——所有阅读面（首页/月页/月相册/
// 日页/故事详情/来源材料）都经过 deliverableMediaIds，所以不会出现这里没了那里还在。
import test from "node:test";
import assert from "node:assert/strict";
import {
  READABLE_MIN_SHORT_SIDE,
  THUMBNAIL_ONLY_MAX_SHORT_SIDE,
  bestKnownShortSide,
  isTooSmallToDisplay,
  photoQualityReasonCodes,
  photoQualityTier,
  shortSideOf,
} from "../lib/media-quality.ts";
import { THUMBNAIL_MIN_SIDE } from "../lib/media/hero.ts";
import { deliverableMediaIds, publishableMedia } from "../lib/media/deliverability.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { findMonth } from "../lib/memory-chapters.ts";
import { resolveMonthContentMedia, gateMaterialMedia } from "../lib/month-content.ts";

const PROFILE = "profile-zhangnian";
const photo = (width, height) => ({ type: "photo", width, height });

// —— 规则本身 ——

test("门槛就是项目既有的网格下限，不是新造的数", () => {
  // 首页 lib/home-memory.ts 的 usable() 早就在用 THUMBNAIL_MIN_SIDE 挑照片，所以首页从没出过这类
  // 小图。这里不是发明新标准，是把同一条线补到日页/月页/月相册/来源材料上。两者脱钩就会又出现
  // 「首页没有、点进去却有」的不一致。
  assert.equal(READABLE_MIN_SHORT_SIDE, THUMBNAIL_MIN_SIDE);
  assert.equal(READABLE_MIN_SHORT_SIDE, 160);
});

test("被举报的那张（90×120）判为 thumbnail_only", () => {
  assert.equal(photoQualityTier(photo(90, 120)), "thumbnail_only");
  assert.equal(isTooSmallToDisplay(photo(90, 120)), true);
});

test("生产里真实出现过的微信缩略图规格全部落在撤下档", () => {
  for (const [width, height] of [[67, 120], [120, 67], [80, 120], [20, 20], [135, 180], [157, 210], [210, 157], [158, 210], [156, 210]]) {
    assert.equal(isTooSmallToDisplay(photo(width, height)), true, `${width}x${height} 应判为过小`);
  }
  assert.equal(photoQualityTier(photo(67, 120)), "thumbnail_only");
  assert.equal(photoQualityTier(photo(157, 210)), "below_grid_floor");
});

test("边界带（短边 160–239）的真实照片一张都不撤", () => {
  // 线上这一带只有 11 张，已逐张看过联系表，画面都清楚。门槛必须是「小于 160」，否则会连它们
  // 一起撤掉。
  for (const [width, height] of [[165, 210], [175, 210], [182, 240], [183, 240], [210, 210], [210, 175], [237, 240]]) {
    assert.equal(isTooSmallToDisplay(photo(width, height)), false, `${width}x${height} 不该被撤`);
  }
  assert.equal(photoQualityTier(photo(160, 160)), "readable");
  assert.equal(photoQualityTier(photo(159, 300)), "below_grid_floor");
});

test("正常大图不受影响", () => {
  for (const [width, height] of [[1080, 1254], [1080, 1920], [1280, 1708], [240, 237], [394, 394]]) {
    assert.equal(isTooSmallToDisplay(photo(width, height)), false, `${width}x${height} 不该被撤`);
  }
});

test("尺寸未知、非有限值、非正数一律 unknown —— 缺数据不是撤下的理由", () => {
  for (const bad of [{}, { width: 90 }, { height: 120 }, { width: 0, height: 0 }, { width: -90, height: -120 },
    { width: Number.NaN, height: 120 }, { width: Infinity, height: 120 }, { width: "90", height: "120" }, { width: null, height: null }]) {
    assert.equal(shortSideOf(bad), null, `${JSON.stringify(bad)} 不该给出短边`);
    assert.equal(photoQualityTier({ type: "photo", ...bad }), "unknown", `${JSON.stringify(bad)} 应判 unknown`);
    assert.equal(isTooSmallToDisplay({ type: "photo", ...bad }), false, `${JSON.stringify(bad)} 不该被撤`);
  }
  assert.equal(shortSideOf(null), null);
  assert.deepEqual(photoQualityReasonCodes({ type: "photo" }), []);
});

test("多层证据取最大的短边：陈旧的缩略图元数据不该撤掉一张能救的照片", () => {
  // media 行记着缩略图尺寸，但资产其实是全尺寸——这张能救，不撤。
  const stale = { type: "photo", width: 90, height: 120, asset: { width: 1080, height: 1440 } };
  assert.equal(bestKnownShortSide(stale), 1080);
  assert.equal(isTooSmallToDisplay(stale), false);
  // 反过来：派生图列表里有一条大的 original，也算数。
  const fromLocation = { type: "photo", width: 90, height: 120, asset: { width: 90, height: 120 }, locations: [{ width: 90, height: 120 }, { width: 2000, height: 3000 }] };
  assert.equal(isTooSmallToDisplay(fromLocation), false);
  // 一条 thumbnail 派生图的小尺寸永远不会把结论拉低。
  const bigWithThumb = { type: "photo", width: 1080, height: 1440, locations: [{ width: 120, height: 160 }] };
  assert.equal(isTooSmallToDisplay(bigWithThumb), false);
  // 三层全小才撤（生产里 1,312 张就是这个形状）。
  const genuinelySmall = { type: "photo", width: 90, height: 120, asset: { width: 90, height: 120 }, locations: [{ width: 90, height: 120 }, { width: 90, height: 120 }] };
  assert.equal(isTooSmallToDisplay(genuinelySmall), true);
  // 证据里混进无效值不影响判断，也不会让有效证据失效。
  assert.equal(bestKnownShortSide({ type: "photo", width: 0, height: 0, asset: { width: 1080, height: 1440 }, locations: [null, undefined, { width: -1, height: -1 }] }), 1080);
});

test("这条规则只管照片，不替视频和文档做判断", () => {
  assert.equal(photoQualityTier({ type: "video", width: 90, height: 120 }), "readable");
  assert.equal(isTooSmallToDisplay({ type: "video", width: 90, height: 120 }), false);
  assert.equal(isTooSmallToDisplay({ type: "document", width: 20, height: 20 }), false);
});

test("理由码写明按哪一档判的（只用于报告，不写进任何账本）", () => {
  assert.deepEqual(photoQualityReasonCodes(photo(90, 120)), ["quality:thumbnail-only-source", `quality:short-side-le-${THUMBNAIL_ONLY_MAX_SHORT_SIDE}`]);
  assert.deepEqual(photoQualityReasonCodes(photo(157, 210)), ["quality:below-grid-floor", `quality:short-side-lt-${READABLE_MIN_SHORT_SIDE}`]);
  assert.deepEqual(photoQualityReasonCodes(photo(1080, 1920)), []);
});

// —— 闸门：所有阅读面共用的那一道 ——

function media(id, overrides = {}) {
  return { id, profileId: PROFILE, mediaAssetId: `asset-${id}`, type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt: "2026-02-10T08:00:00.000Z", visibility: "family", width: 1920, height: 1080, ...overrides };
}
function asset(id, overrides = {}) {
  return { id: `asset-${id}`, profileId: PROFILE, mediaType: "photo", mimeType: "image/jpeg", createdAt: "2026-02-10T08:00:00.000Z", ...overrides };
}
function location(id, variant, status, overrides = {}) {
  return { id: `loc-${id}-${variant}`, mediaAssetId: `asset-${id}`, provider: "hot", variant, providerRef: `media/${id}/${variant}`, status, createdAt: "2026-02-10T08:00:00.000Z", updatedAt: "2026-02-10T08:00:00.000Z", ...overrides };
}
function trace(id, occurredAt) {
  return { id, profileId: PROFILE, occurredAt, entries: ["托班户外活动"], sourceIds: [], scopes: ["family"], visibility: "family" };
}
function buildStore({ mediaRows = [], assets = [], locations = [], traces = [], qualityReviews = [] } = {}) {
  return {
    profile: { id: PROFILE, displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", bio: "", visibility: "family" },
    contributors: [], media: mediaRows, mediaAssets: assets, mediaLocations: locations, connectorStates: [],
    rawSources: [], events: [], dailyTraces: traces, growthRecords: [], careRecords: [], careEpisodes: [],
    monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], qualityReviews, links: [], monthlySnapshots: [],
  };
}

// 生产里那三张的形状：低分辨率的、正常的、尺寸不明的。
const LOW = { width: 90, height: 120 };
const OK = { width: 1080, height: 1440 };
const rowsUnderTest = () => ({
  mediaRows: [media("low", LOW), media("ok", OK), media("unknown", { width: 0, height: 0 })],
  assets: [asset("low", LOW), asset("ok", OK), asset("unknown")],
  locations: [
    location("low", "web", "ready", { ...LOW }), location("low", "thumbnail", "ready", { ...LOW }),
    location("ok", "web", "ready", { ...OK }), location("ok", "thumbnail", "ready", { width: 480, height: 640 }),
    location("unknown", "web", "ready"),
  ],
});

test("闸门：低分辨率的不进可投递集合，正常的和尺寸不明的都在", () => {
  const input = rowsUnderTest();
  const ids = deliverableMediaIds({ media: input.mediaRows, mediaAssets: input.assets, mediaLocations: input.locations });
  assert.equal(ids.has("low"), false);
  assert.equal(ids.has("ok"), true);
  assert.equal(ids.has("unknown"), true, "尺寸不明不该被撤");
  assert.deepEqual(publishableMedia({ media: input.mediaRows, mediaAssets: input.assets, mediaLocations: input.locations }).map((m) => m.id).sort(), ["ok", "unknown"]);
});

test("闸门：资产或派生图证明是全尺寸时，media 行上的陈旧小尺寸不生效", () => {
  const rows = [media("stale", { width: 90, height: 120 })];
  const assets = [asset("stale", { width: 1080, height: 1440 })];
  const locations = [location("stale", "web", "ready", { width: 1080, height: 1440 })];
  assert.equal(deliverableMediaIds({ media: rows, mediaAssets: assets, mediaLocations: locations }).has("stale"), true);
});

test("闸门：视频不受画质规则影响（有 poster 就照常发布）", () => {
  const rows = [media("clip", { type: "video", width: 90, height: 120 })];
  const assets = [asset("clip", { mediaType: "video", width: 90, height: 120 })];
  const locations = [location("clip", "poster", "ready", { width: 90, height: 120 })];
  assert.equal(deliverableMediaIds({ media: rows, mediaAssets: assets, mediaLocations: locations }).has("clip"), true);
});

test("闸门：private 仍然永不发布，画质规则不会把它放出来", () => {
  const input = rowsUnderTest();
  const rows = [...input.mediaRows, media("secret", { ...OK, visibility: "private" })];
  const assets = [...input.assets, asset("secret", OK)];
  const locations = [...input.locations, location("secret", "web", "ready", { ...OK })];
  const published = publishableMedia({ media: rows, mediaAssets: assets, mediaLocations: locations }).map((m) => m.id);
  assert.equal(published.includes("secret"), false);
});

test("阅读面：月页的照片与计数只剩够大的那些，月份本身不消失", () => {
  const input = rowsUnderTest();
  const archive = composeFamilyArchive(buildStore({ ...input, traces: [trace("t1", "2026-02-10 00:00:00")] }), []);
  const month = findMonth(archive.chapters, "2026-02");
  assert.ok(month, "这个月必须还在——撤下的是照片，不是月份");
  assert.deepEqual(archive.media.map((m) => m.id).sort(), ["ok", "unknown"]);
  // 计数与真实能看到的张数一致（原则三：看得见的数字不能和看不见的照片对不上）。
  assert.equal(month.photoCount, 2, "计数只数够大的那些");
  // month.photos 是月页顶部那条 strip，另有一条更严的既有规则（heroSized，480/720）在管它——
  // 尺寸不明的那张进不了 strip 是它的既有行为，不是本次画质闸门干的。
  assert.deepEqual(month.photos.map((p) => p.id), ["ok"]);
  const shown = month.photoDays.flatMap((day) => day.photos).map((p) => p.id);
  assert.equal(shown.includes("low"), false);
  assert.deepEqual(shown.sort(), ["ok", "unknown"]);
});

test("阅读面：日页/月相册的挑图与来源材料走同一份 excluded，低分辨率的不会从旁路漏回来", () => {
  const input = rowsUnderTest();
  const archive = composeFamilyArchive(buildStore(input), []);
  const available = new Map(archive.media.map((item) => [item.id, item]));
  // 日页：curated 列表点名了 low，但它已经不在 available 里（闸门在更前面），所以挑不出来。
  const picked = resolveMonthContentMedia(["low", "ok", "unknown"], available, archive.privilege.excluded).map((m) => m.id);
  assert.deepEqual(picked.sort(), ["ok", "unknown"]);
  // 来源材料：day-reading 用 gateMaterialMedia + deliverableMediaIds，两条都过滤掉 low。
  const sourceDeliverable = deliverableMediaIds({ media: input.mediaRows, mediaAssets: input.assets, mediaLocations: input.locations });
  assert.equal(sourceDeliverable.has("low"), false);
  assert.deepEqual(gateMaterialMedia(input.mediaRows, archive.privilege.excluded).map((m) => m.id).sort(), ["low", "ok", "unknown"],
    "gateMaterialMedia 只管主体排除；画质由 deliverable 过滤，两者互不冒充");
});

test("主体排除不受影响：store_only 仍然独立生效，画质规则没有把它顶掉", () => {
  const input = rowsUnderTest();
  const reviews = [{ id: "r1", profileId: PROFILE, targetKind: "media_subject_check", targetId: "ok", decision: "store_only", reasonCodes: [], provider: "cowork", reviewedAt: "2026-02-11T00:00:00.000Z" }];
  const archive = composeFamilyArchive(buildStore({ ...input, qualityReviews: reviews }), []);
  assert.equal(archive.privilege.excluded.has("ok"), true, "主体排除仍由账本决定");
  assert.equal(archive.privilege.excluded.has("low"), false, "画质撤下不写账本，不该出现在主体排除集合里");
  const available = new Map(archive.media.map((item) => [item.id, item]));
  assert.deepEqual(resolveMonthContentMedia(["low", "ok", "unknown"], available, archive.privilege.excluded).map((m) => m.id), ["unknown"]);
});

test("闸门是只读的：媒体行、资产、派生图一个字节都没被改", () => {
  const input = rowsUnderTest();
  const before = JSON.stringify(input);
  deliverableMediaIds({ media: input.mediaRows, mediaAssets: input.assets, mediaLocations: input.locations });
  publishableMedia({ media: input.mediaRows, mediaAssets: input.assets, mediaLocations: input.locations });
  composeFamilyArchive(buildStore(input), []);
  assert.equal(JSON.stringify(input), before, "闸门只回答给不给看，不改任何一行");
});
