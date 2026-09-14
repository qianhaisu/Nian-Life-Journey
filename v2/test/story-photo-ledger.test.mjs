// PAGE-DECISION-0914-C（2026-09-14）：故事照片除 life_events.media_ids 外，也读取配图审核账本里
// 「这一对 (eventId, mediaId) 最新决定是 approved」的照片——不改故事行。守住的边界：
//   · 账本批准、不在 media_ids 的照片能上故事卡与首页池；
//   · 未批准（needs_human_review / rejected / 被后来的决定撤回）不显示；
//   · 同一张照片批准给两篇故事：两篇都不从账本补图，首页也不收；
//   · 月相册与「这一天的照片」不因故事批准而扩容；
//   · 私有 / 不可交付的照片即使有批准也不显示。
// fixture 全部合成。
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { ledgerOnlyStoryPhotoIds, storyPhotoConfirmationsFrom } from "../lib/media/story-binding.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { buildHomeFeed } from "../lib/home-feed.ts";

const BIRTH = "2025-01-03";
const photo = (id, takenAt, extra = {}) => ({ id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "合成", takenAt, visibility: "family", rawSourceId: `src-${id}`, width: 1600, height: 1200, ...extra });
const event = (id, occurredAt, mediaIds = [], extra = {}) => ({ id, profileId: "p", title: `合成 ${id}`, story: "合成正文。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra });
const review = (eventId, mediaId, decision, reviewedAt = "2026-09-01T00:00:00Z", id = `r-${eventId}-${mediaId}-${decision}`) => ({ id, targetKind: "media_binding", targetId: `${eventId}|${mediaId}`, decision, reviewedAt });
const chaptersOf = ({ events, media, reviews, deliverable }) => buildChapters({ events, traces: [], media, deliverable: deliverable ?? new Set(media.map((m) => m.id)), birthDay: BIRTH, photoConfirmations: storyPhotoConfirmationsFrom(reviews) });
const storyPhotoIds = (chapters, month, eventId) => findMonth(chapters, month).memories.find((m) => m.id === eventId)?.storyPhotos?.map((p) => p.id) ?? [];

test("账本里逐对批准、不在 media_ids 的照片进入故事卡；故事行本身一字不改", () => {
  const pic = photo("m-play", "2026-07-18T03:00:00.000Z");
  const story = event("e-play", "2026-07-18 00:00:00+00", []);
  const before = JSON.stringify(story);
  const chapters = chaptersOf({ events: [story], media: [pic], reviews: [review("e-play", "m-play", "approved")] });
  assert.deepEqual(storyPhotoIds(chapters, "2026-07", "e-play"), ["m-play"]);
  assert.equal(JSON.stringify(story), before, "读的时候不改故事行");
});

test("未批准不显示：needs_human_review、rejected、以及批准后又被撤回的", () => {
  const pic = photo("m-x", "2026-07-18T03:00:00.000Z");
  const story = event("e-x", "2026-07-18 00:00:00+00", []);
  for (const reviews of [
    [review("e-x", "m-x", "needs_human_review")],
    [review("e-x", "m-x", "rejected")],
    [review("e-x", "m-x", "approved", "2026-09-01T00:00:00Z"), review("e-x", "m-x", "rejected", "2026-09-02T00:00:00Z")],
  ]) {
    assert.deepEqual(storyPhotoIds(chaptersOf({ events: [story], media: [pic], reviews }), "2026-07", "e-x"), [], JSON.stringify(reviews.map((r) => r.decision)));
  }
});

test("私有或不可交付的照片即使批准了也不显示", () => {
  const privatePic = photo("m-private", "2026-07-18T03:00:00.000Z", { visibility: "private" });
  const undeliverable = photo("m-undeliverable", "2026-07-18T04:00:00.000Z");
  const story = event("e-y", "2026-07-18 00:00:00+00", []);
  const chapters = chaptersOf({ events: [story], media: [privatePic, undeliverable], reviews: [review("e-y", "m-private", "approved"), review("e-y", "m-undeliverable", "approved")], deliverable: new Set(["m-private"]) });
  assert.deepEqual(storyPhotoIds(chapters, "2026-07", "e-y"), []);
});

test("一张照片批准给两篇故事：两篇都不从账本补这张图，首页池也不收", () => {
  const shared = photo("m-shared", "2026-08-19T03:00:00.000Z");
  const only = photo("m-only", "2026-08-20T03:00:00.000Z");
  const events = [event("e-a", "2026-08-19 00:00:00+00", []), event("e-b", "2026-08-19 00:00:00+00", []), event("e-c", "2026-08-20 00:00:00+00", [])];
  const reviews = [review("e-a", "m-shared", "approved"), review("e-b", "m-shared", "approved"), review("e-c", "m-only", "approved")];
  const chapters = chaptersOf({ events, media: [shared, only], reviews });
  assert.deepEqual(storyPhotoIds(chapters, "2026-08", "e-a"), []);
  assert.deepEqual(storyPhotoIds(chapters, "2026-08", "e-b"), []);
  assert.deepEqual(storyPhotoIds(chapters, "2026-08", "e-c"), ["m-only"]);
  assert.deepEqual(ledgerOnlyStoryPhotoIds("e-a", [], storyPhotoConfirmationsFrom(reviews)), []);

  // 首页：即使两篇都把这张照片列在 media_ids 里（逐对批准都成立），它也不进首页池。
  const listedEvents = [event("e-a", "2026-08-19 00:00:00+00", ["m-shared"]), event("e-b", "2026-08-19 00:00:00+00", ["m-shared"]), event("e-c", "2026-08-20 00:00:00+00", [])];
  const listedChapters = chaptersOf({ events: listedEvents, media: [shared, only], reviews });
  const archive = { store: { qualityReviews: reviews }, media: [shared, only], events: listedEvents, traceEvents: [], eventIdentities: listedEvents, chapters: listedChapters, birthDay: BIRTH, snapshots: [], privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() }, time: { today: "2026-09-14", activityDay: "2026-09-14" } };
  const feed = buildHomeFeed(archive, { edition: { id: "t", startedAt: "2026-09-14T00:00:00+08:00", expiresAt: "y", slot: 0, index: 0 } });
  assert.deepEqual(feed.photoCandidates.map((c) => c.photo.media.id), ["m-only"], "冲突照片不作为候选返回，也就不可能成为「换张照片」里的一张");
  assert.equal(feed.lead.story.eventId, "e-c");
});

test("账本批准的照片进首页池，点它的去处是批准它的那一篇", () => {
  const pic = photo("m-play", "2026-07-18T03:00:00.000Z");
  const events = [event("e-play", "2026-07-18 00:00:00+00", [])];
  const reviews = [review("e-play", "m-play", "approved")];
  const archive = { store: { qualityReviews: reviews }, media: [pic], events, traceEvents: [], eventIdentities: events, chapters: chaptersOf({ events, media: [pic], reviews }), birthDay: BIRTH, snapshots: [], privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() }, time: { today: "2026-09-14", activityDay: "2026-09-14" } };
  const feed = buildHomeFeed(archive, { edition: { id: "t", startedAt: "2026-09-14T00:00:00+08:00", expiresAt: "y", slot: 0, index: 0 } });
  assert.equal(feed.lead.photo.media.id, "m-play");
  assert.equal(feed.lead.story.href, "/events/e-play");
});

test("月相册与「这一天的照片」不因故事批准而扩容：批准前后两处的照片集合只减不增", () => {
  const approvedPic = photo("m-approved", "2026-07-18T03:00:00.000Z");
  const other = photo("m-other", "2026-07-18T05:00:00.000Z");
  const checkedOther = photo("m-checked", "2026-07-18T06:00:00.000Z");
  const media = [approvedPic, other, checkedOther];
  const events = [event("e-play", "2026-07-18 00:00:00+00", [])];
  const privilege = { confirmed: new Set(), trusted: new Set(media.map((m) => m.id)), checked: new Set(["m-checked"]) };
  const compose = (reviews) => buildMonthComposition(findMonth(chaptersOf({ events, media, reviews }), "2026-07"), privilege);
  const ids = (days) => days.flatMap((d) => d.photos.map((p) => p.id)).sort();
  const before = compose([]);
  const after = compose([review("e-play", "m-approved", "approved")]);
  assert.deepEqual(after.chapter[0].memory.storyPhotos.map((p) => p.id), ["m-approved"]);
  for (const id of ids(after.archiveDays)) assert.ok(ids(before.archiveDays).includes(id), `相册没有多出 ${id}`);
  for (const id of ids(after.dayPhotoGroups)) assert.ok(ids(before.dayPhotoGroups).includes(id), `日照片组没有多出 ${id}`);
  assert.ok(!ids(after.archiveDays).includes("m-approved") && !ids(after.dayPhotoGroups).includes("m-approved"), "故事卡上的那张不在相册 / 日组里再出现一次");
});
