// The Editorial Composition Layer (lib/publication-moments.ts): archive truth in, reading order
// out. These are the product invariants of P1-A2 — sizes and shapes below are real production
// cases (20x20 WeChat icons, 67x120 sticker thumbs, 21x16 and 45x81 fragments, a 120x67 hero,
// months of 100+ photos against zero published words), not convenient fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMemoryIndex } from "../lib/memory-index.ts";
import { DEFAULT_MEMORY_IA_POLICY } from "../lib/memory-ia-policy.ts";
import { NO_HERO_MEDIA_ID } from "../lib/media/hero.ts";
import { mediaPrivilegeOf } from "../lib/family-archive.ts";
import {
  BURST_GAP_SECONDS, MOMENT_SUPPORTING_MAX,
  buildMonthComposition, burstGroups, burstRepresentatives, readableEntries,
} from "../lib/publication-moments.ts";

const BIRTH = "2025-01-03";

const sourceOf = (mediaId) => `source-of-${mediaId}`;
function photo(id, takenAt, dims = { width: 1600, height: 1200 }) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", rawSourceId: sourceOf(id), ...dims };
}
function trace(id, occurredAt, entries) {
  return { id, profileId: "p", occurredAt, entries, sourceIds: [], scopes: ["family"], visibility: "family" };
}
// sourceIds defaults to the sources this event's own pictures arrived in — a story that really
// was written from them. Pass `sourceIds: []` for the archive's common case: a story whose
// pictures only share its day.
function event(id, occurredAt, mediaIds = [], extra = {}) {
  return { id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds, sourceIds: mediaIds.map(sourceOf), growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra };
}
const trust = (media) => ({ confirmed: new Set(), trusted: new Set(media.map((item) => item.id)) });
// The month's photographs wherever they are read: a chapter day's pictures travel with the day
// (「这一天的照片」), the rest stay in 「这个月的照片」. A picture is in exactly one of the two.
const monthPhotoIds = (composition) =>
  [...composition.dayPhotoGroups, ...composition.archiveDays].flatMap((day) => day.photos.map((item) => item.id));
const monthOf = (input, month) => findMonth(buildChapters({ events: [], traces: [], media: [], birthDay: BIRTH, ...input }), month);

test("tiny production sizes never gain publication privilege anywhere, and stay counted in the archive", () => {
  // Real rows: 20x20 icons (2026-08), 67x120 stickers (2025-10), 21x16 / 45x81 fragments.
  const media = [
    photo("icon", "2026-08-27T08:00:00.000Z", { width: 20, height: 20 }),
    photo("frag-1", "2026-08-27T09:00:00.000Z", { width: 21, height: 16 }),
    photo("frag-2", "2026-08-27T10:00:00.000Z", { width: 45, height: 81 }),
    photo("sticker", "2026-08-27T11:00:00.000Z", { width: 67, height: 120 }),
    photo("real", "2026-08-27T12:00:00.000Z"),
  ];
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust(media));
  const shown = [...composition.chronicle.flatMap((m) => [m.hero, ...m.supporting].filter(Boolean)), ...composition.preview, composition.cover].filter(Boolean);
  assert.ok(shown.length > 0);
  assert.ok(shown.every((item) => item.id === "real"), "only the real photograph is drawn in the reading layer");
  assert.deepEqual(composition.archiveDays.flatMap((day) => day.photos.map((p) => p.id)), ["real"], "fragments are not drawn in the archive layer either");
  assert.equal(composition.smallImageCount, 4, "…but they are counted, never deleted");
});

test("a wordless month publishes nothing rather than publishing the wrong thing", () => {
  // Production 2025-01, the month he was born: the page led with three unvouched chat images — two
  // Facebook Marketplace listings for a changing table and a baby tub, and a feeding-volume
  // infographic. Not one picture of the child. The wordless-month exception that put them there is
  // gone. Size cannot rescue it either: those screenshots are 1180x2556 and 1242x1660 — large, and
  // no more elongated than a portrait photo. Vouching is the only gate that separates them.
  const media = [photo("wx-big", "2025-10-14T08:00:00.000Z"), photo("wx-2", "2025-10-14T10:00:00.000Z")];
  const composition = buildMonthComposition(monthOf({ media }, "2025-10"));
  assert.equal(composition.cover, undefined, "no vouched picture → an index still shows type, not a guess");
  assert.deepEqual(composition.preview, []);
  assert.equal(composition.mode, "typography");
  assert.deepEqual(composition.chronicle, [], "nothing vouches for these, so nothing reaches the reading layer");
  // 2026-09-10: nor the month's photo section. It used to hold them — which is how a bank record
  // and a housing-fund statement came to sit under 「这个月的照片」 once that section was opened by
  // default. The rows are untouched in the archive itself; this is one display surface narrowing.
  assert.deepEqual(composition.archiveDays, [], "unvouched pictures are not the month's photographs");
  assert.equal(composition.totalPhotoCount, 0, "…and the month does not count them as such either");
  assert.equal(composition.smallImageCount, 0, "they are not withheld for their size, so they are not counted as small");
  assert.equal(composition.narration, undefined, "with nothing to point at, the page does not point");
});

test("a month that has words keeps the strict rule: unvouched pictures stay out of the reading layer", () => {
  const media = [photo("wx-big", "2025-10-14T08:00:00.000Z"), photo("wx-2", "2025-10-14T10:00:00.000Z")];
  const traces = [trace("t", "2025-10-20 00:00:00", ["晚上自己扶着沙发站了一会儿"])];
  const composition = buildMonthComposition(monthOf({ media, traces }, "2025-10"));
  assert.deepEqual(composition.chapter.map((m) => m.kind), ["text_led"]);
  assert.deepEqual(composition.chronicle, [], "the month can speak for itself, so uncertain pictures stay out");
  // The quiet-day line says "that day's photographs are down in 这个月的照片". With nothing of that
  // day in the section, the line would send the reader somewhere empty — so it is not printed.
  assert.deepEqual(composition.quietDays, []);
  assert.deepEqual(composition.archiveDays, []);
});

test("the photo section shows vouched pictures at any size, and the same set on the first screen and after expanding", () => {
  // The gate is source trust, not the hero floor: an ordinary small snapshot from the family's own
  // album is still one of the month's photographs. Only the thumbnail floor (can it be drawn)
  // applies. And because the expander returns composition.archiveDays verbatim
  // (app/memory/[year]/[month]/actions.ts), one set feeds the first screen, the expansion and every
  // count the page prints.
  const small = photo("small-but-real", "2026-08-10T08:00:00.000Z", { width: 300, height: 300 });
  const sticker = photo("sticker", "2026-08-10T08:30:00.000Z", { width: 67, height: 120 });
  const chat = photo("unvouched-chat", "2026-08-11T08:00:00.000Z", { width: 1180, height: 2556 });
  const media = [small, sticker, chat];
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust([small, sticker]));
  assert.deepEqual(composition.archiveDays.flatMap((day) => day.photos.map((p) => p.id)), ["small-but-real"],
    "below the hero floor but vouched: kept; vouched but undrawable: counted; unvouched: absent");
  assert.equal(composition.smallImageCount, 1, "the sticker is the only one withheld for its size");
  assert.equal(composition.totalPhotoCount, 1);
  assert.deepEqual(composition.archiveDaysVisible.flatMap((day) => day.photos.map((p) => p.id)), ["small-but-real"]);
  assert.equal(composition.archiveFoldedPhotoCount, 0, "first screen and full set agree");
  assert.equal(composition.archiveFoldedDayCount, 0);
});

test("text-only is a first-class moment, and a month can publish with zero representative photos", () => {
  const traces = [trace("t", "2025-06-20 00:00:00", ["家人转述张小年说了「我是谁？我在哪？」", "家人评论他的话有创意"])];
  const composition = buildMonthComposition(monthOf({ traces }, "2025-06"));
  assert.equal(composition.chapter.length, 1);
  const moment = composition.chapter[0];
  assert.equal(moment.kind, "text_led");
  assert.equal(moment.hero, undefined);
  assert.equal(moment.supporting.length, 0);
  assert.equal(composition.cover, undefined);
  assert.equal(composition.mode, "typography");
});

test("the chapter reads the month start to end; archive-count sentences and placeholders never render as life", () => {
  const traces = [
    trace("t-28", "2026-08-28 00:00:00", ["这一天留下了 10 张照片。", "晚上自己吃完半碗饭"]),
    trace("t-12", "2026-08-12 00:00:00", ["[media] path.jpg"]),
    trace("t-05", "2026-08-05 00:00:00", ["第一次自己扶着栏杆站了一会儿"]),
  ];
  const composition = buildMonthComposition(monthOf({ traces }, "2026-08"));
  assert.deepEqual(composition.chapter.map((m) => m.day), ["2026-08-05", "2026-08-28"], "ascending — a month is read, not scrolled backwards");
  assert.deepEqual(composition.chapter.map((m) => m.text).flat(), ["第一次自己扶着栏杆站了一会儿", "晚上自己吃完半碗饭"]);
  assert.deepEqual(readableEntries(["这一天留下了 3 张照片。"]), []);
});

test("a photo-only month becomes a weighted chronicle, not a wall: every vouched day shown, archive whole", () => {
  // Production 2026-08 shape: many photographed days, zero real words.
  const media = [];
  for (let day = 1; day <= 14; day += 1) {
    const count = day <= 10 ? 4 : 1; // ten strong days, four one-photo days
    for (let n = 0; n < count; n += 1) media.push(photo(`d${day}-${n}`, `2026-08-${String(day).padStart(2, "0")}T${String(8 + n * 2).padStart(2, "0")}:00:00.000Z`));
  }
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust(media));
  assert.equal(composition.chapter.length, 0, "no words exist; none are invented — UNKNOWN > INVENTED COPY");
  // B-17 (2026-09-06): a vouched, deliverable photo day is content — it is never capped out of the
  // chronicle and folded to a bare quiet-day line just because more than a handful exist in a month.
  assert.equal(composition.chronicle.length, 14, "every one of the 14 vouched photo days becomes a moment");
  assert.equal(composition.quietDays.length, 0, "nothing here is unvouched, so nothing folds to a quiet line");
  for (const moment of composition.chronicle) {
    assert.ok(moment.hero, "a reading moment is anchored by a vouched hero");
    assert.ok(moment.supporting.length <= MOMENT_SUPPORTING_MAX);
    const shownHere = 1 + moment.supporting.length;
    assert.ok(shownHere <= 3, `a day shows a scene, not a roll (got ${shownHere})`);
  }
  const archiveTotal = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  assert.equal(archiveTotal, media.length, "every deliverable drawable photo remains accessible in the archive layer");
  assert.deepEqual(composition.archiveDays.map((day) => day.day), [...composition.archiveDays.map((day) => day.day)].sort(), "archive reads ascending too");

  // T20-A3: 44 photos here — more than the first-screen budget — so archiveDaysVisible must be a
  // real subset, not everything, while archiveDays (checked above) stays the untouched full record.
  const visibleTotal = composition.archiveDaysVisible.reduce((sum, day) => sum + day.photos.length, 0);
  assert.ok(visibleTotal <= 24, `default first screen must not exceed the budget (got ${visibleTotal})`);
  assert.equal(visibleTotal + composition.archiveFoldedPhotoCount, archiveTotal, "visible + folded accounts for every photo — none silently dropped");
  assert.deepEqual(composition.archiveDaysVisible.map((day) => day.day), [...composition.archiveDaysVisible.map((day) => day.day)].sort(), "the visible slice still reads ascending");
});

test("a month within the archive first-screen budget shows everything, folds nothing", () => {
  const media = [photo("a", "2026-08-01T08:00:00.000Z"), photo("b", "2026-08-02T08:00:00.000Z")];
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust(media));
  assert.equal(composition.archiveFoldedPhotoCount, 0);
  assert.equal(composition.archiveFoldedDayCount, 0);
  assert.deepEqual(composition.archiveDaysVisible, composition.archiveDays);
});

test("burst grouping is temporal redundancy only: one representative reads, every frame stays", () => {
  const burst = [];
  for (let n = 0; n < 8; n += 1) burst.push(photo(`b${n}`, `2026-08-27T08:00:${String(n * 5).padStart(2, "0")}.000Z`));
  burst.push(photo("later", "2026-08-27T15:00:00.000Z"));
  const groups = burstGroups(burst.map((item) => ({ ...item, alt: "" })));
  assert.equal(groups.length, 2);
  assert.equal(groups[0].length, 8);
  const reps = burstRepresentatives(burst.map((item) => ({ ...item, alt: "" })));
  assert.deepEqual(reps.map((item) => item.id), ["b0", "later"]);
  // Gap just over the window starts a new group.
  const spaced = [photo("s0", "2026-08-27T08:00:00.000Z"), photo("s1", `2026-08-27T08:0${Math.floor((BURST_GAP_SECONDS + 30) / 60)}:${String((BURST_GAP_SECONDS + 30) % 60).padStart(2, "0")}.000Z`)];
  assert.equal(burstGroups(spaced.map((item) => ({ ...item, alt: "" }))).length, 2);
});

test("a trusted photo does NOT bind beside same-day trace text (T11 Part C, reversed 2026-09-10)", () => {
  // T11 Part C used to put a privileged same-day photo beside a day's words, arguing that trusted
  // provenance made it "not a caption-guessing exercise". Trusted provenance says the picture is
  // really of this child, from a source the family stands behind. It never said the picture shows
  // what the sentence says — and set directly under the words, that is what a reader takes it for.
  const media = [photo("m", "2026-08-05T08:00:00.000Z")];
  const traces = [trace("t", "2026-08-05 00:00:00", ["第一次自己扶着栏杆站了一会儿"])];
  const composition = buildMonthComposition(monthOf({ media, traces }, "2026-08"), trust(media));
  const textMoment = composition.chapter[0];
  assert.equal(textMoment.kind, "text_led");
  assert.equal(textMoment.hero, undefined, "the day's words read on their own");
  assert.deepEqual(textMoment.supporting, []);
  // Nothing is lost: the photograph is read on its own day, under 「这一天的照片」, below the words.
  // It is not also a chronicle moment — the day is already being read in the chapter, and showing
  // it twice was the old shape.
  assert.deepEqual(composition.chronicle, [], "a day already read in the chapter is not read again below");
  assert.deepEqual(composition.dayPhotoGroups.map((day) => [day.day, day.photos.map((p) => p.id)]), [["2026-08-05", ["m"]]]);
  assert.deepEqual(composition.archiveDays, [], "…and it is not left at the end of the month as well");
});

test("an unprivileged photo does not bind to a text moment", () => {
  // Without privilege, the old behavior holds: a text moment is text-only.
  const media = [photo("m", "2026-08-05T08:00:00.000Z")];
  const traces = [trace("t", "2026-08-05 00:00:00", ["第一次自己扶着栏杆站了一会儿"])];
  const noPriv = { confirmed: new Set(), trusted: new Set() };
  const composition = buildMonthComposition(monthOf({ media, traces }, "2026-08"), noPriv);
  const textMoment = composition.chapter[0];
  assert.equal(textMoment.kind, "text_led");
  assert.equal(textMoment.hero, undefined, "unvouched photo does not anchor a text moment");
});

test("a published memory's own lead is the month's face, above loose photography", () => {
  const lead = photo("lead", "2026-08-14T08:00:00.000Z");
  const loose = photo("loose", "2026-08-20T08:00:00.000Z");
  const media = [lead, loose];
  const events = [event("e", "2026-08-14 00:00:00+00", ["lead"], { heroMediaId: "lead" })];
  const composition = buildMonthComposition(monthOf({ media, events }, "2026-08"), trust(media));
  assert.equal(composition.mode, "memory");
  assert.equal(composition.cover.id, "lead");
  assert.equal(composition.chapter[0].kind, "memory_led");
  assert.equal(composition.chapter[0].memory.id, "e");
});

test("a same-day harvest cannot lend an event a face: no lead, text-only memory moment", () => {
  // Production case: 好想站起来的这一天 carries a same-day flight-booking screenshot bound by the
  // legacy rule organizer. What disqualifies it is not who bound it — it is that the screenshot
  // arrived in its own source and the story was written from other material, so nothing connects
  // the two but the date. Approved TEXT vouches for no picture either.
  const screenshot = photo("shot", "2025-08-11T08:00:00.000Z", { width: 1280, height: 1708 });
  const events = [event("stand", "2025-08-11 00:00:00+00", ["shot"], { sourceIds: ["chat-text-only"], heroMediaId: "shot", createdBy: "rule", organizerVersion: "rule-based-v1" })];
  const composition = buildMonthComposition(monthOf({ media: [screenshot], events }, "2025-08"));
  const moment = composition.chapter.find((m) => m.kind === "memory_led");
  assert.equal(moment.memory.lead, undefined, "the memory reads as text; its pictures stay in the evidence layer");
  assert.equal(composition.cover, undefined, "an unvouched screenshot never becomes the month's face");
});

test("composition is deterministic and read-only: same archive, same book; the chapter input is not mutated", () => {
  const media = [];
  for (let day = 1; day <= 9; day += 1) for (let n = 0; n < 3; n += 1) media.push(photo(`d${day}-${n}`, `2026-08-0${day}T${String(8 + n * 3).padStart(2, "0")}:00:00.000Z`));
  const traces = [trace("t", "2026-08-04 00:00:00", ["午睡后自己穿了鞋"])];
  const chapter = monthOf({ media, traces }, "2026-08");
  const before = JSON.stringify(chapter);
  const one = buildMonthComposition(chapter, trust(media));
  const two = buildMonthComposition(chapter, trust(media));
  assert.deepEqual(one, two);
  assert.equal(JSON.stringify(chapter), before, "archive truth untouched");
  // Same photos handed over in a different order produce the same composition.
  const shuffled = monthOf({ media: [...media].reverse(), traces }, "2026-08");
  assert.deepEqual(buildMonthComposition(shuffled, trust(media)), one);
});

test("/memory previews come from the composition: vouched pictures or none — never month.media.slice()", () => {
  const trusted = [photo("tp-1", "2026-08-27T08:00:00.000Z"), photo("tp-2", "2026-08-20T08:00:00.000Z")];
  const untrusted = [photo("wx-1", "2026-07-10T08:00:00.000Z")];
  const chapters = buildChapters({ events: [], traces: [], media: [...trusted, ...untrusted], birthDay: BIRTH });
  const index = buildMemoryIndex(chapters, DEFAULT_MEMORY_IA_POLICY, trust(trusted));
  const aug = index.years[0].months.find((month) => month.chapter.month === "2026-08");
  assert.deepEqual(aug.preview.map((item) => item.id), ["tp-1", "tp-2"], "newest vouched pictures");
  const jul = index.years[0].months.find((month) => month.chapter.month === "2026-07");
  assert.deepEqual(jul.preview, [], "an unvouched month shows type");
  assert.equal(jul.compositionMode, "typography");
});

test("no story on the month page carries a borrowed photo, and an associated lead still reads", () => {
  // Production 08-19「能跟着老师的音乐互动了」. Its hero was set to the NO_HERO_MEDIA_ID sentinel
  // because the bound picture — a daycare meal board — is not that story; the detail page honoured
  // it and the month page did not, because it borrowed the day's pictures whenever a memory had no
  // lead of its own. The borrow is gone entirely now, so this asserts both halves that matter: a
  // reviewed text-only story shows nothing, and the day's other story still shows the picture it
  // was actually written from.
  const excluded = photo("meal-board", "2026-08-19T03:00:00.000Z", { width: 1280, height: 1708 });
  const otherStorysPhoto = photo("other-story", "2026-08-19T09:00:00.000Z");
  const media = [excluded, otherStorysPhoto];
  const events = [
    event("reviewed-text-only", "2026-08-19 00:00:00+00", ["meal-board"], { heroMediaId: NO_HERO_MEDIA_ID }),
    event("normal-same-day", "2026-08-19 00:00:00+00", ["other-story"], { heroMediaId: "other-story" }),
  ];
  const composition = buildMonthComposition(monthOf({ media, events }, "2026-08"), trust(media));

  const reviewed = composition.chapter.find((moment) => moment.memory?.id === "reviewed-text-only");
  assert.equal(reviewed.memory.noPhoto, true, "the sentinel is carried into the composition layer");
  assert.equal(reviewed.memory.lead, undefined);
  assert.equal(reviewed.hero, undefined, "no borrowed hero on a story reviewed as text-only");
  assert.deepEqual(reviewed.supporting, [], "…and no borrowed thumbnails beside it either");
  // Belt and braces: no memory moment anywhere carries moment-level photography any more.
  for (const moment of composition.chapter) {
    assert.equal(moment.hero, undefined, `${moment.kind} moment must not borrow a hero`);
    assert.deepEqual(moment.supporting, [], `${moment.kind} moment must not borrow thumbnails`);
  }

  // The other event on the same day is untouched: one story saying "not this picture" is not the
  // day saying "no pictures".
  const normal = composition.chapter.find((moment) => moment.memory?.id === "normal-same-day");
  assert.equal(normal.memory.lead.id, "other-story", "the same day's other story keeps its own photo");

  // Nothing was deleted or hidden — the month still holds both pictures, now on their own day.
  assert.deepEqual(monthPhotoIds(composition).sort(), ["meal-board", "other-story"]);
});

test("a story with no associated photo is text-only, even when the day is full of trusted ones", () => {
  // The archive's ordinary shape: the story was written from chat text, the day's photographs came
  // in separately, and nothing records a relationship between them. That is not a licence to
  // illustrate — and it is not an accusation either. The pictures are untouched and stay in the
  // month's own photography, both as their own day and in the archive layer.
  const dayPhoto = photo("day-photo", "2026-08-20T03:00:00.000Z");
  const events = [event("no-associated-media", "2026-08-20 00:00:00+00", ["day-photo"], { sourceIds: ["chat-text-only"], heroMediaId: "day-photo" })];
  const composition = buildMonthComposition(monthOf({ media: [dayPhoto], events }, "2026-08"), trust([dayPhoto]));
  const moment = composition.chapter.find((item) => item.memory?.id === "no-associated-media");
  assert.equal(moment.memory.noPhoto, false, "no review decision was made here — evidence is simply missing");
  assert.equal(moment.memory.lead, undefined, "heroMediaId alone does not make a picture this story's");
  assert.equal(moment.hero, undefined);
  assert.deepEqual(moment.supporting, []);
  assert.deepEqual(monthPhotoIds(composition), ["day-photo"], "the photograph is still in the month");
  assert.deepEqual(composition.dayPhotoGroups.map((d) => d.day), ["2026-08-20"], "…read on its own day, outside the story");
});

test("privilege: a published story confirms only the pictures it was actually written from", () => {
  // mediaPrivilegeOf's `confirmed` half used to be "every media_id of an event whose organizer
  // version we trust", and that version was trusted because its bindings came from the same-day
  // picker. A picture cannot vouch for itself through a story it was only placed beside.
  const written = photo("written-from", "2026-08-21T03:00:00.000Z");
  const alongside = photo("same-day-only", "2026-08-21T04:00:00.000Z");
  const events = [event("e", "2026-08-21 00:00:00+00", ["written-from", "same-day-only"], { sourceIds: [`source-of-written-from`] })];
  const privilege = mediaPrivilegeOf(events, [written, alongside], []);
  assert.deepEqual([...privilege.confirmed], ["written-from"]);
  assert.deepEqual([...privilege.trusted], [], "no trusted raw sources were supplied");
});

test("everything the photo section counts as folded is actually reachable when expanded", () => {
  // The expander asks for "the days you have not shown me" by day key
  // (components/archive-expander.tsx). While the first screen filled its budget by slicing a day in
  // half, the rest of that day was counted in 还有 N 张 and then never requested — 27 pictures of
  // 2026-08 were unreachable by any route the page offered. Whole days only, so the two agree.
  const media = [];
  for (let d = 1; d <= 3; d += 1) {
    for (let n = 0; n < 20; n += 1) {
      media.push(photo(`d${d}-${n}`, `2026-08-0${d}T${String(6 + n).padStart(2, "0")}:00:00.000Z`));
    }
  }
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust(media));
  const all = composition.archiveDays.flatMap((day) => day.photos.map((p) => p.id));
  const shown = composition.archiveDaysVisible.flatMap((day) => day.photos.map((p) => p.id));
  const shownDays = new Set(composition.archiveDaysVisible.map((day) => day.day));
  // What the expander would deliver: every day it was not shown, whole.
  const expandable = composition.archiveDays.filter((day) => !shownDays.has(day.day)).flatMap((day) => day.photos.map((p) => p.id));
  assert.deepEqual([...shown, ...expandable].sort(), [...all].sort(), "no picture is counted but unreachable");
  assert.equal(composition.archiveFoldedPhotoCount, expandable.length, "and the number offered is the number delivered");
  assert.equal(composition.archiveFoldedDayCount, composition.archiveDays.length - composition.archiveDaysVisible.length);
  for (const day of composition.archiveDaysVisible) {
    const whole = composition.archiveDays.find((d) => d.day === day.day);
    assert.equal(day.photos.length, whole.photos.length, "a day on the first screen is shown whole");
  }
});

test("a video reaches the month's media section but can never illustrate a story", () => {
  // The first playable video (2026-09-10). A clip is vouched the same way a photograph is — by its
  // source — and it is drawn the same way: not as anyone's hero, because heroSized() only ever
  // answers true for type "photo", and not as a story's picture, because it shares no source with
  // one. It belongs to the day it was taken and to the month's own media.
  const clip = { ...photo("clip", "2026-08-14T09:00:00.000Z", { width: 720, height: 1280 }), type: "video" };
  const stillPhoto = photo("still", "2026-08-14T10:00:00.000Z");
  const media = [clip, stillPhoto];
  const events = [event("same-day-story", "2026-08-14 00:00:00+00", ["clip"], { sourceIds: ["written-from-chat"], heroMediaId: "clip" })];
  const composition = buildMonthComposition(monthOf({ media, events }, "2026-08"), trust(media));

  const story = composition.chapter.find((moment) => moment.memory?.id === "same-day-story");
  assert.equal(story.memory.lead, undefined, "a video named by heroMediaId is still not this story's");
  assert.equal(story.hero, undefined);

  const inAlbum = [...composition.dayPhotoGroups, ...composition.archiveDays].flatMap((day) => day.photos);
  assert.deepEqual(inAlbum.map((item) => item.id).sort(), ["clip", "still"], "both are the month's media");
  assert.equal(inAlbum.find((item) => item.id === "clip").type, "video", "…and the page can tell which is which");
  for (const moment of composition.chronicle) {
    assert.notEqual(moment.hero?.id, "clip", "a video is never a day's page-width hero");
  }
});

test("an unvouched video does not reach the media section either", () => {
  const clip = { ...photo("chat-clip", "2026-08-15T09:00:00.000Z", { width: 720, height: 1280 }), type: "video" };
  const composition = buildMonthComposition(monthOf({ media: [clip] }, "2026-08"), { confirmed: new Set(), trusted: new Set() });
  assert.deepEqual(composition.archiveDays, []);
});

// 「这一天的照片」 — a chapter day keeps its photographs on the day instead of at the end of the
// month. The reason is reading distance: measured on production 2026-08 before this, the eleven
// days that carry stories held 284 of the month's 549 photographs, and every one of them sat below
// the entire chronicle inside a section that ships folded.
test("a chapter day's photographs are read on that day, and are not also left in the month's photo section", () => {
  const media = [
    photo("story-day-1", "2026-08-19T02:00:00.000Z"),
    photo("story-day-2", "2026-08-19T09:00:00.000Z"),
    photo("quiet-day", "2026-08-06T05:00:00.000Z"),
  ];
  // The archive's ordinary shape: written from chat text, pictures arrived separately.
  const events = [event("story", "2026-08-19 00:00:00+00", [], { sourceIds: ["chat-text"] })];
  const composition = buildMonthComposition(monthOf({ media, events }, "2026-08"), trust(media));

  assert.deepEqual(composition.dayPhotoGroups.map((day) => [day.day, day.photos.map((p) => p.id)]),
    [["2026-08-19", ["story-day-1", "story-day-2"]]],
    "the story's day carries its own photographs, in the order the day happened");
  assert.deepEqual(composition.archiveDays.map((day) => day.day), ["2026-08-06"],
    "a day with no story of its own keeps its existing entry in 「这个月的照片」");

  // No picture is shown twice and none is stranded: the two surfaces partition the month.
  const grouped = composition.dayPhotoGroups.flatMap((day) => day.photos.map((p) => p.id));
  const archived = composition.archiveDays.flatMap((day) => day.photos.map((p) => p.id));
  assert.deepEqual([...grouped, ...archived].sort(), ["quiet-day", "story-day-1", "story-day-2"]);
  assert.equal(new Set([...grouped, ...archived]).size, 3, "no picture appears on both surfaces");
  assert.equal(composition.totalPhotoCount, 3, "the month counts every photograph, wherever it is read");

  // The expander's contract still holds over the narrowed archive: what it can deliver is exactly
  // what is not already on screen, so expanding cannot reveal a duplicate or miss a day.
  const visibleDays = new Set(composition.archiveDaysVisible.map((day) => day.day));
  const deliverable = composition.archiveDays.filter((day) => !visibleDays.has(day.day));
  assert.equal(composition.archiveFoldedDayCount, deliverable.length);
  assert.equal(composition.archiveFoldedPhotoCount, deliverable.reduce((sum, day) => sum + day.photos.length, 0));
});

test("a story that says it has no photograph still shows none, and the day group is not a way back in", () => {
  // noPhoto is a decision about the story, never about the day: the picture stays one of the
  // month's photographs and is read under the date, which is the only relation it actually has.
  const dayPhoto = photo("the-day", "2026-08-21T06:00:00.000Z");
  const events = [event("withdrawn", "2026-08-21 00:00:00+00", ["the-day"], { sourceIds: [sourceOf("the-day")], heroMediaId: NO_HERO_MEDIA_ID })];
  const composition = buildMonthComposition(monthOf({ media: [dayPhoto], events }, "2026-08"), trust([dayPhoto]));

  const moment = composition.chapter.find((item) => item.memory?.id === "withdrawn");
  assert.equal(moment.memory.noPhoto, true);
  assert.equal(moment.memory.lead, undefined, "an explicit withdrawal is respected even when the source matches");
  assert.equal(moment.hero, undefined);
  assert.deepEqual(moment.supporting, [], "nothing inside the story's card");
  assert.deepEqual(composition.dayPhotoGroups.map((d) => d.photos.map((p) => p.id)), [["the-day"]],
    "the day still shows the day's photograph, outside the card and under its own heading");
});

test("a photograph the month's photo section would withhold is not admitted by a day group either", () => {
  // Same gates, same set: grouping decides where a picture is read, never whether it may be.
  const unvouched = photo("from-a-chat-no-one-vouched-for", "2026-08-19T04:00:00.000Z");
  const tooSmall = photo("icon", "2026-08-19T05:00:00.000Z", { width: 20, height: 20 });
  const events = [event("story", "2026-08-19 00:00:00+00", [], { sourceIds: ["chat-text"] })];
  const composition = buildMonthComposition(
    monthOf({ media: [unvouched, tooSmall], events }, "2026-08"),
    trust([tooSmall]));

  assert.deepEqual(composition.dayPhotoGroups, [], "unvouched stays out, and a 20x20 icon is still undrawable");
  assert.deepEqual(composition.archiveDays, []);
  assert.equal(composition.smallImageCount, 1);
});
