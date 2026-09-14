// 故事视频的消费契约（总指挥 视频首批，2026-09-14）。全部 fixture 合成，不含家庭数据。
//
// 契约：
//   · 一段视频只有在账本里有这一对 (故事, 视频) 的 media_binding=approved 时才属于这段故事（与照片同一道门）；
//   · 故事卡：先读获批照片，再读获批视频（每篇最多 STORY_VIDEOS_MAX 段），视频画成点开才播的播放器；
//   · 视频永远不是 lead、不占照片名额、不进首页（首页只读 storyPhotos）；
//   · 故事卡读过的视频不再出现在「这一天的照片」和「这个月的照片」里——和获批照片一样只读一次；
//   · 故事详情页：视频作 supporting，不作 hero；
//   · 审核为不配图（NO_HERO_MEDIA_ID）的故事一段视频也不画。
import test from "node:test";
import assert from "node:assert/strict";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildChapters, findMonth, STORY_VIDEOS_MAX } from "../lib/memory-chapters.ts";
import { buildMonthComposition, storyMediaOf } from "../lib/publication-moments.ts";
import { storyPhotoConfirmationsFrom } from "../lib/media/story-binding.ts";
import { storyLayout } from "../lib/media/presentation.ts";
import { NO_HERO_MEDIA_ID } from "../lib/media/hero.ts";
import { buildHomeFeed } from "../lib/home-feed.ts";

globalThis.React = React;
const { EditorialMemory } = await import("../components/editorial-memory.tsx");

const BIRTH = "2025-01-03";
const media = (id, type, takenAt, extra = {}) => ({
  id, profileId: "p", type, src: `/api/media/${id}?variant=${type === "video" ? "poster" : "web"}`, alt: type === "video" ? "WeChat video" : "WeChat image",
  takenAt, visibility: "family", rawSourceId: `src-${id}`, width: 720, height: 1280, ...(type === "video" ? { durationSeconds: 12 } : {}), ...extra,
});
const event = (id, occurredAt, mediaIds = [], extra = {}) => ({
  id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds, sourceIds: [],
  growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra,
});
const approve = (eventId, mediaId, decision = "approved") => ({ id: `rev-${eventId}-${mediaId}-${decision}`, targetKind: "media_binding", targetId: `${eventId}|${mediaId}`, decision, reviewedAt: "2026-09-01 10:00:00" });
const privilegeOf = (items) => ({ confirmed: new Set(), trusted: new Set(items.map((item) => item.id)), checked: new Set() });

function monthFor({ events, items, reviews }) {
  const chapters = buildChapters({ events, traces: [], media: items, birthDay: BIRTH, photoConfirmations: storyPhotoConfirmationsFrom(reviews) });
  return findMonth(chapters, "2025-08");
}

test("获批视频进 storyVideos，不进 storyPhotos，也不当 lead", () => {
  const p = media("p-1", "photo", "2025-08-05T02:00:00.000Z", { width: 1600, height: 1200 });
  const v = media("v-1", "video", "2025-08-05T02:10:00.000Z");
  const month = monthFor({ events: [event("e-1", "2025-08-05 00:00:00+00", [p.id, v.id])], items: [p, v], reviews: [approve("e-1", p.id), approve("e-1", v.id)] });
  const memory = month.memories[0];
  assert.deepEqual(memory.storyPhotos.map((item) => item.id), ["p-1"]);
  assert.deepEqual(memory.storyVideos.map((item) => item.id), ["v-1"]);
  assert.equal(memory.lead.id, "p-1", "lead 永远是照片");
  assert.equal(memory.storyVideos[0].durationSeconds, 12, "时长带到页面，播放器要用");
});

test("没有 approved 绑定的视频（故事自有 media_ids 也一样）不画；撤销立刻生效", () => {
  const v = media("v-own", "video", "2025-08-05T02:10:00.000Z");
  const e = event("e-own", "2025-08-05 00:00:00+00", [v.id], { heroMediaId: v.id });
  assert.equal(monthFor({ events: [e], items: [v], reviews: [] }).memories[0].storyVideos.length, 0, "cover/media_ids/life_event_id 都不是人工审核");
  const revoked = [approve("e-own", v.id), { ...approve("e-own", v.id, "rejected"), reviewedAt: "2026-09-02 10:00:00" }];
  assert.equal(monthFor({ events: [e], items: [v], reviews: revoked }).memories[0].storyVideos.length, 0, "最新一条是 rejected");
});

test("仅有视频获批的故事：卡片画视频，但没有 lead（封面、首页不会拿到视频）", () => {
  const v = media("v-only", "video", "2025-08-05T02:10:00.000Z");
  const memory = monthFor({ events: [event("e-v", "2025-08-05 00:00:00+00", [v.id])], items: [v], reviews: [approve("e-v", v.id)] }).memories[0];
  assert.equal(memory.lead, undefined);
  assert.deepEqual(memory.storyPhotos, []);
  assert.deepEqual(memory.storyVideos.map((item) => item.id), ["v-only"]);
});

test("审核为不配图的故事一段视频也不画；尺寸不达下限的视频不画；每篇最多 STORY_VIDEOS_MAX 段", () => {
  const v = media("v-1", "video", "2025-08-05T02:10:00.000Z");
  const noPhoto = monthFor({ events: [event("e-n", "2025-08-05 00:00:00+00", [v.id], { heroMediaId: NO_HERO_MEDIA_ID })], items: [v], reviews: [approve("e-n", v.id)] });
  assert.equal(noPhoto.memories[0].storyVideos.length, 0);
  const tiny = media("v-tiny", "video", "2025-08-05T02:10:00.000Z", { width: 0, height: 0 });
  assert.equal(monthFor({ events: [event("e-t", "2025-08-05 00:00:00+00", [tiny.id])], items: [tiny], reviews: [approve("e-t", tiny.id)] }).memories[0].storyVideos.length, 0);
  const many = [1, 2, 3].map((i) => media(`v-${i}`, "video", `2025-08-05T02:1${i}:00.000Z`));
  const capped = monthFor({ events: [event("e-m", "2025-08-05 00:00:00+00", many.map((m) => m.id))], items: many, reviews: many.map((m) => approve("e-m", m.id)) });
  assert.equal(capped.memories[0].storyVideos.length, STORY_VIDEOS_MAX);
});

test("故事卡读过的视频不再出现在日照片组与月相册；没获批的视频照旧留在相册", () => {
  const p = media("p-1", "photo", "2025-08-05T02:00:00.000Z", { width: 1600, height: 1200 });
  const v = media("v-1", "video", "2025-08-05T02:10:00.000Z");
  const other = media("v-other", "video", "2025-08-05T03:00:00.000Z");
  const items = [p, v, other];
  const month = monthFor({ events: [event("e-1", "2025-08-05 00:00:00+00", [p.id, v.id, other.id])], items, reviews: [approve("e-1", p.id), approve("e-1", v.id)] });
  const composition = buildMonthComposition(month, privilegeOf(items));
  const album = composition.archiveDays.flatMap((day) => day.photos.map((item) => item.id));
  const dayGroup = composition.dayPhotoGroups.flatMap((day) => day.photos.map((item) => item.id));
  assert.ok(!album.includes("v-1") && !dayGroup.includes("v-1"), "获批视频只在故事里读一次");
  assert.ok(!album.includes("p-1"), "获批照片同理（原有规则）");
  assert.ok(album.includes("v-other"), "没获批的视频还在相册，不被隐藏");
  assert.deepEqual(storyMediaOf(month.memories[0]).map((item) => item.id), ["p-1", "v-1"]);
});

test("故事卡渲染：照片在前、视频在后，视频是点开才播的播放器（poster + preview，不自动播放）", () => {
  const photoRef = { id: "p-1", src: "/api/media/p-1?variant=web", thumbnailSrc: "/api/media/p-1?variant=thumbnail", width: 1600, height: 1200, type: "photo", alt: "那天的照片" };
  const videoRef = { id: "v-1", src: "/api/media/v-1?variant=poster", width: 720, height: 1280, type: "video", durationSeconds: 12, alt: "那天的视频" };
  const memory = { id: "e-1", title: "记忆", excerpt: "一段话。", weight: "memory", signature: { day: "2025-08-05", dateLabel: "2025 年 8 月 5 日", ageLabel: "7 个月" }, lead: photoRef, storyPhotos: [photoRef], storyVideos: [videoRef], noPhoto: false, photoCount: 1, videoCount: 1 };
  const html = renderToStaticMarkup(React.createElement(EditorialMemory, { memory, showSignature: false, photos: "story" }));
  assert.ok(html.indexOf("p-1") < html.indexOf("v-1"), "照片在前");
  assert.match(html, /<video[^>]*poster="\/api\/media\/v-1\?variant=poster"/);
  assert.match(html, /<source src="\/api\/media\/v-1\?variant=preview" type="video\/mp4"/);
  assert.doesNotMatch(html, /autoplay/i);
  assert.match(html, /memory-photo-set/, "照片 + 视频按多项排");
  const videoOnly = renderToStaticMarkup(React.createElement(EditorialMemory, { memory: { ...memory, lead: undefined, storyPhotos: [], storyVideos: [videoRef] }, showSignature: false, photos: "story" }));
  assert.match(videoOnly, /<video/);
  assert.match(videoOnly, /memory-photo-portrait/);
  const withoutVideos = renderToStaticMarkup(React.createElement(EditorialMemory, { memory: { ...memory, storyVideos: undefined }, showSignature: false, photos: "story" }));
  assert.doesNotMatch(withoutVideos, /<video/, "没有 storyVideos 的旧记忆照旧只有照片");
});

test("故事详情页：获批视频作 supporting，不作 hero", () => {
  const p = media("p-1", "photo", "2025-08-05T02:00:00.000Z", { width: 1600, height: 1200 });
  const v = media("v-1", "video", "2025-08-05T02:10:00.000Z");
  const withPhoto = storyLayout([v, p]);
  assert.equal(withPhoto.hero.id, "p-1");
  assert.deepEqual(withPhoto.supporting.map((item) => item.id), ["v-1"]);
  const videoOnly = storyLayout([v]);
  assert.equal(videoOnly.hero, undefined, "视频不当 hero");
  assert.deepEqual(videoOnly.supporting.map((item) => item.id), ["v-1"]);
  assert.deepEqual(storyLayout([v], NO_HERO_MEDIA_ID).supporting, []);
});

test("首页不放视频：获批视频不进首页候选", () => {
  const v = media("v-1", "video", "2025-08-05T02:10:00.000Z");
  const p = media("p-1", "photo", "2025-08-06T02:00:00.000Z", { width: 1600, height: 1200 });
  const events = [event("e-v", "2025-08-05 00:00:00+00", [v.id]), event("e-p", "2025-08-06 00:00:00+00", [p.id])];
  const reviews = [approve("e-v", v.id), approve("e-p", p.id)];
  const chapters = buildChapters({ events, traces: [], media: [v, p], birthDay: BIRTH, photoConfirmations: storyPhotoConfirmationsFrom(reviews) });
  const archive = { store: { qualityReviews: reviews }, media: [v, p], events, traceEvents: [], eventIdentities: events, chapters, birthDay: BIRTH, snapshots: [],
    privilege: { confirmed: new Set(), trusted: new Set(), checked: new Set() }, time: { today: "2025-08-10", activityDay: "2025-08-10" } };
  const feed = buildHomeFeed(archive, { edition: { id: "t", startedAt: "2025-08-10T00:00:00+08:00", expiresAt: "x", slot: 0, index: 0 } });
  const ids = feed.photoCandidates.map((c) => c.photo.media.id);
  assert.ok(ids.includes("p-1"));
  assert.ok(!ids.includes("v-1"));
});
