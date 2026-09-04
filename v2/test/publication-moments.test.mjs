// The Editorial Composition Layer (lib/publication-moments.ts): archive truth in, reading order
// out. These are the product invariants of P1-A2 — sizes and shapes below are real production
// cases (20x20 WeChat icons, 67x120 sticker thumbs, 21x16 and 45x81 fragments, a 120x67 hero,
// months of 100+ photos against zero published words), not convenient fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMemoryIndex } from "../lib/memory-index.ts";
import { DEFAULT_MEMORY_IA_POLICY } from "../lib/memory-ia-policy.ts";
import {
  BURST_GAP_SECONDS, CHRONICLE_MOMENTS_MAX, MOMENT_SUPPORTING_MAX,
  buildMonthComposition, burstGroups, burstRepresentatives, readableEntries,
} from "../lib/publication-moments.ts";

const BIRTH = "2025-01-03";

function photo(id, takenAt, dims = { width: 1600, height: 1200 }) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", ...dims };
}
function trace(id, occurredAt, entries) {
  return { id, profileId: "p", occurredAt, entries, sourceIds: [], scopes: ["family"], visibility: "family" };
}
function event(id, occurredAt, mediaIds = [], extra = {}) {
  return { id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra };
}
const trust = (media) => ({ confirmed: new Set(), trusted: new Set(media.map((item) => item.id)) });
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
  assert.equal(composition.archiveDays.flatMap((day) => day.photos).length, 2, "…but every picture stays reachable in the archive");
  assert.match(composition.narration ?? "", /还没有人确认过/, "…and the page says where they are and that no one has confirmed them");
});

test("a month that has words keeps the strict rule: unvouched pictures stay out of the reading layer", () => {
  const media = [photo("wx-big", "2025-10-14T08:00:00.000Z"), photo("wx-2", "2025-10-14T10:00:00.000Z")];
  const traces = [trace("t", "2025-10-20 00:00:00", ["晚上自己扶着沙发站了一会儿"])];
  const composition = buildMonthComposition(monthOf({ media, traces }, "2025-10"));
  assert.deepEqual(composition.chapter.map((m) => m.kind), ["text_led"]);
  assert.deepEqual(composition.chronicle, [], "the month can speak for itself, so uncertain pictures stay in the archive");
  assert.deepEqual(composition.quietDays.map((day) => day.day), ["2025-10-14"]);
  assert.equal(composition.archiveDays.flatMap((day) => day.photos).length, 2);
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

test("a photo-only month becomes a weighted chronicle, not a wall: bounded moments, quiet days folded, archive whole", () => {
  // Production 2026-08 shape: many photographed days, zero real words.
  const media = [];
  for (let day = 1; day <= 14; day += 1) {
    const count = day <= 10 ? 4 : 1; // ten strong days, four one-photo days
    for (let n = 0; n < count; n += 1) media.push(photo(`d${day}-${n}`, `2026-08-${String(day).padStart(2, "0")}T${String(8 + n * 2).padStart(2, "0")}:00:00.000Z`));
  }
  const composition = buildMonthComposition(monthOf({ media }, "2026-08"), trust(media));
  assert.equal(composition.chapter.length, 0, "no words exist; none are invented — UNKNOWN > INVENTED COPY");
  assert.ok(composition.chronicle.length <= CHRONICLE_MOMENTS_MAX);
  assert.equal(composition.quietDays.length, 14 - composition.chronicle.length, "the rest of the days fold to lines, they do not disappear");
  for (const moment of composition.chronicle) {
    assert.ok(moment.hero, "a reading moment is anchored by a vouched hero");
    assert.ok(moment.supporting.length <= MOMENT_SUPPORTING_MAX);
    const shownHere = 1 + moment.supporting.length;
    assert.ok(shownHere <= 3, `a day shows a scene, not a roll (got ${shownHere})`);
  }
  const archiveTotal = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  assert.equal(archiveTotal, media.length, "every deliverable drawable photo remains accessible in the archive layer");
  assert.deepEqual(composition.archiveDays.map((day) => day.day), [...composition.archiveDays.map((day) => day.day)].sort(), "archive reads ascending too");
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

test("a trusted photo binds beside its trace text when they share a day (T11 Part C)", () => {
  // T11 Part C, 2026-09-04: privileged (trusted/confirmed) photos now appear beside same-day text
  // moments. Provenance is the binding — daycare photos are trusted because every image there is
  // of 张年, so showing them beside the day's text is not a caption-guessing exercise.
  const media = [photo("m", "2026-08-05T08:00:00.000Z")];
  const traces = [trace("t", "2026-08-05 00:00:00", ["第一次自己扶着栏杆站了一会儿"])];
  const composition = buildMonthComposition(monthOf({ media, traces }, "2026-08"), trust(media));
  const textMoment = composition.chapter[0];
  assert.equal(textMoment.kind, "text_led");
  assert.equal(textMoment.hero?.id, "m", "privileged same-day photo binds to text moment");
  assert.equal(textMoment.supporting.length, 0);
  // The photograph also keeps its chronicle place — chronicle excludes only memory days.
  assert.deepEqual(composition.chronicle.map((moment) => [moment.day, moment.hero.id]), [["2026-08-05", "m"]]);
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

test("a rule-organizer event cannot lend its harvested media a face: no lead, text-only memory moment", () => {
  // Production case: 好想站起来的这一天 carries a same-day flight-booking screenshot bound by the
  // legacy rule organizer. Approved TEXT does not vouch the pictures.
  const screenshot = photo("shot", "2025-08-11T08:00:00.000Z", { width: 1280, height: 1708 });
  const events = [event("stand", "2025-08-11 00:00:00+00", ["shot"], { heroMediaId: "shot", createdBy: "rule", organizerVersion: "rule-based-v1" })];
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
