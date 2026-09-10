// The four gates that together decide whether a reader ever sees a photograph beside a story, held
// in one place because production cannot currently demonstrate the positive case: the only story in
// the archive whose pictures have a per-item association carries a needs_review decision and has
// never been published. That is a review call, not a code one, so the passing case is proved here.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { isEventPublishable, indexReviews } from "../lib/organizer/quality-review.ts";
import { NO_HERO_MEDIA_ID } from "../lib/media/hero.ts";

const BIRTH = "2025-01-03";
const sourceOf = (id) => `source-of-${id}`;
const photo = (id, takenAt, dims = { width: 1600, height: 1200 }) => ({
  id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image",
  takenAt, visibility: "family", rawSourceId: sourceOf(id), ...dims,
});
const event = (id, occurredAt, mediaIds, extra = {}) => ({
  id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [],
  contentTypes: ["family"], mediaIds, sourceIds: mediaIds.map(sourceOf), growthRecordIds: [],
  careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"],
  visibility: "family", keptInYearbook: false, createdBy: "ai", organizerVersion: "organizer-v2", ...extra,
});
const trust = (media) => ({ confirmed: new Set(), trusted: new Set(media.map((m) => m.id)) });
const monthOf = (input, month) => findMonth(buildChapters({ events: [], traces: [], media: [], birthDay: BIRTH, ...input }), month);
const review = (id, decision) => ({ id: `r-${id}`, profileId: "p", targetKind: "life_event", targetId: id, decision });

test("gate 1 — a published story whose picture is part of its own material does show it", () => {
  const own = photo("its-own", "2026-08-19T08:00:00.000Z");
  const composition = buildMonthComposition(
    monthOf({ media: [own], events: [event("published", "2026-08-19 00:00:00+00", ["its-own"], { heroMediaId: "its-own" })] }, "2026-08"),
    trust([own]));
  const moment = composition.chapter.find((m) => m.memory?.id === "published");
  assert.equal(moment.memory.lead.id, "its-own", "association is what earns the slot, and it does earn it");
  assert.equal(moment.memory.noPhoto, false);
});

test("gate 2 — a needs_review story is not published, whatever its pictures could prove", () => {
  // Production's 2025-08-29「假哭时睁眼偷看有没有人哄」: four associated pictures, decision
  // needs_review, so no page and no chapter entry. The gates are independent and this one is first.
  const associated = event("pending", "2025-08-29 00:00:00+00", ["p1"], { heroMediaId: "p1" });
  const reviews = indexReviews([review("pending", "needs_human_review")]);
  assert.equal(isEventPublishable(associated, reviews), false);
  assert.equal(isEventPublishable(associated, indexReviews([review("pending", "rejected")])), false);
  assert.equal(isEventPublishable(associated, indexReviews([review("pending", "approved")])), true,
    "…and the only thing standing between it and the page is a human decision");
  assert.equal(isEventPublishable(associated, indexReviews([])), false, "AI content with no row stays closed");
});

test("gate 3 — a reviewed text-only story stays text-only even with an association", () => {
  const own = photo("its-own", "2026-08-19T08:00:00.000Z");
  const composition = buildMonthComposition(
    monthOf({ media: [own], events: [event("reviewed", "2026-08-19 00:00:00+00", ["its-own"], { heroMediaId: NO_HERO_MEDIA_ID })] }, "2026-08"),
    trust([own]));
  const moment = composition.chapter.find((m) => m.memory?.id === "reviewed");
  assert.equal(moment.memory.noPhoto, true);
  assert.equal(moment.memory.lead, undefined, "the decision outranks the evidence");
  assert.equal(moment.hero, undefined);
});

test("gate 4 — a story with no association borrows nothing, and the day's photographs are unharmed", () => {
  const dayPhoto = photo("of-that-day", "2026-08-20T08:00:00.000Z");
  const composition = buildMonthComposition(
    monthOf({ media: [dayPhoto], events: [event("no-link", "2026-08-20 00:00:00+00", ["of-that-day"], { sourceIds: ["written-from-chat-text"], heroMediaId: "of-that-day" })] }, "2026-08"),
    trust([dayPhoto]));
  const moment = composition.chapter.find((m) => m.memory?.id === "no-link");
  assert.equal(moment.memory.lead, undefined);
  assert.equal(moment.hero, undefined);
  assert.deepEqual(moment.supporting, []);
  assert.deepEqual(composition.archiveDays.flatMap((d) => d.photos.map((p) => p.id)), ["of-that-day"],
    "it is still one of the month's photographs, just not this story's");
});
