// 照片展示隔离 (总指挥, 2026-09-13).
//
// The fault: publishing an approved paragraph of TEXT moved photographs. A day that acquired words
// became a chapter day, and a chapter day's pictures were lifted out of 「这个月的照片」 — an album a
// family opens on purpose — into 「这一天的照片」, which is default reading. The only gate they passed
// on the way was `isPrivileged`, whose `trusted` half is a statement about the SOURCE: which album
// or which confirmed group the file arrived from. `lib/trusted-photo-sources.ts` says so itself —
// "Source trust says who the picture came from, never what is in it".
//
// Measured across R1–R4 (release-ready/exposure-ledger.json): 85 photographs entered the initial
// HTML and 211 became reachable, on the strength of 133 approved paragraphs of text. Of the 601
// photographs in the whole eight-batch set, 2 carry a subject check. Approving words is not a
// review of pictures.
//
// THE RULE, per display purpose, neither substituting for the other:
//   · a story's picture        — an approved `media_binding` for THAT (story, photograph) pair;
//   · a day group, a cover, a
//     preview tile, a section
//     opening                  — an approved `media_subject_check` for that photograph;
//   · 「这个月的照片」          — unchanged; the standalone album keeps the authorisation it had.
//
// The property these tests exist to hold: PUBLISHING TEXT MOVES NO PHOTOGRAPH. Everything that
// fails a gate stays in the album it was already in, at the same day, under the same source
// authorisation, reachable by the same expander. Nothing is hidden, rejected or deleted.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";
import { checkedPhotoIdsFrom } from "../lib/media/story-binding.ts";

const BIRTH = "2025-01-03";
const sourceOf = (mediaId) => `source-of-${mediaId}`;
const photo = (id, takenAt, dims = { width: 1600, height: 1200 }) =>
  ({ id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", rawSourceId: sourceOf(id), ...dims });
const event = (id, occurredAt, mediaIds = [], extra = {}) =>
  ({ id, profileId: "p", title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds, sourceIds: mediaIds.map(sourceOf), growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra });
const monthOf = (input, month) => findMonth(buildChapters({ events: [], traces: [], media: [], birthDay: BIRTH, ...input }), month);
// Source trust for every picture; a subject check only for the ones named.
const privilegeOf = (media, lookedAt = []) => ({
  confirmed: new Set(),
  trusted: new Set(media.map((item) => item.id)),
  checked: new Set(lookedAt.map((item) => item.id)),
});
const slotsOf = (composition) => ({
  story: composition.chapter.map((moment) => moment.memory?.lead?.id).filter(Boolean),
  dayGroup: composition.dayPhotoGroups.flatMap((day) => day.photos.map((item) => item.id)),
  album: composition.archiveDays.flatMap((day) => day.photos.map((item) => item.id)),
  cover: composition.cover?.id,
  preview: composition.preview.map((item) => item.id),
  chronicleHeroes: composition.chronicle.map((moment) => moment.hero?.id).filter(Boolean),
});

// The whole point, stated once as a before/after: the SAME archive, the same pictures, the only
// difference being that one day acquired published words.
test("publishing a story moves no photograph — same pictures, same slots, before and after", () => {
  const media = [
    photo("morning", "2026-08-19T02:00:00.000Z"),
    photo("noon", "2026-08-19T05:00:00.000Z"),
    photo("another-day", "2026-08-24T05:00:00.000Z"),
  ];
  const before = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media));
  const after = buildMonthComposition(
    monthOf({ media, events: [event("published", "2026-08-19 00:00:00+00", [])] }, "2026-08"),
    privilegeOf(media));

  const a = slotsOf(after), b = slotsOf(before);
  for (const slot of ["story", "dayGroup", "album", "cover", "preview"]) {
    assert.deepEqual(a[slot], b[slot], `the words arrived; the ${slot} slot did not change`);
  }
  // The chronicle is the one slot publishing does touch, and only ever downwards: a day whose words
  // are now in the chapter is no longer also a photo moment further down the page (that rule
  // predates this change — see composeMonth's `candidates`). Asserted as a subset rather than as
  // equality so it cannot silently start ADDING a picture, which is the direction that would matter.
  assert.ok(a.chronicleHeroes.every((id) => b.chronicleHeroes.includes(id)),
    "publishing may retire a photo moment, never create one");
  assert.deepEqual(b.chronicleHeroes.filter((id) => !a.chronicleHeroes.includes(id)), ["morning"],
    "…and what it retired is the day that now reads as a story instead");
  assert.deepEqual(after.dayPhotoGroups, [], "nothing was lifted into default reading");
  assert.deepEqual(after.archiveDays.flatMap((day) => day.photos.map((item) => item.id)).sort(),
    ["another-day", "morning", "noon"], "every photograph is still in the album, on its own day");
  assert.equal(after.chapter.some((moment) => moment.memory?.id === "published"), true, "and the words themselves are published");
});

test("a day group carries the photographs somebody opened, and only those", () => {
  const looked = photo("opened-and-recorded", "2026-08-19T02:00:00.000Z");
  const unlooked = photo("nobody-opened-this", "2026-08-19T05:00:00.000Z");
  const media = [looked, unlooked];
  const composition = buildMonthComposition(
    monthOf({ media, events: [event("published", "2026-08-19 00:00:00+00", [])] }, "2026-08"),
    privilegeOf(media, [looked]));

  assert.deepEqual(composition.dayPhotoGroups.flatMap((day) => day.photos.map((item) => item.id)), ["opened-and-recorded"]);
  assert.deepEqual(composition.archiveDays.flatMap((day) => day.photos.map((item) => item.id)), ["nobody-opened-this"],
    "the unchecked one is not hidden — it stays in the album, on its own day");
  // Both are still the month's photographs. Isolation is about WHERE, never about withholding.
  assert.equal(composition.totalPhotoCount, 2);
});

// The expander is not a second, looser door. `app/memory/[year]/[month]/actions.ts` returns
// `archiveDays` verbatim and `components/day-photos.tsx` mounts the rest of a group's `photos`, so
// a gate applied only to the first six would be cosmetic — the rest arrives on click.
test("the gate holds past the first screen: a day group's expanded remainder is checked too", () => {
  const day = "2026-08-19";
  const many = Array.from({ length: 14 }, (_, i) =>
    photo(`p-${String(i).padStart(2, "0")}`, `${day}T0${(i % 9) + 1}:00:00.000Z`));
  const lookedAt = [many[0], many[9], many[13]];
  const composition = buildMonthComposition(
    monthOf({ media: many, events: [event("published", `${day} 00:00:00+00`, [])] }, "2026-08"),
    privilegeOf(many, lookedAt));

  const grouped = composition.dayPhotoGroups.flatMap((d) => d.photos.map((item) => item.id));
  assert.deepEqual(grouped.sort(), lookedAt.map((item) => item.id).sort(),
    "the whole group — not just the first six — is subject-checked");
  assert.equal(grouped.length, 3, "and it is the three that were opened, out of fourteen");
  const album = composition.archiveDays.flatMap((d) => d.photos.map((item) => item.id));
  assert.equal(album.length, 11, "the other eleven are in the album");
  assert.equal(new Set([...grouped, ...album]).size, 14, "nothing is lost between the two");
});

// R8's case, and the reason the two kinds of evidence are read separately.
// `event-r10-20260907-coldhot` carries an approved `media_binding` for its two photographs and no
// `media_subject_check` for either. A binding says "this picture belongs to these words"; it does
// not say "this is a photograph of this child, fit to be the month's face".
test("a reviewed story binding illustrates its story and still may not become the month's cover", () => {
  const bound = photo("coldhot", "2026-09-07T05:00:00.000Z", { width: 1280, height: 1707 });
  const media = [bound];
  const composition = buildMonthComposition(
    monthOf({
      media,
      events: [event("coldhot-story", "2026-09-07 00:00:00+00", ["coldhot"], { heroMediaId: "coldhot" })],
      photoConfirmations: new Set(["coldhot-story|coldhot"]),
    }, "2026-09"),
    privilegeOf(media));

  const moment = composition.chapter.find((item) => item.memory?.id === "coldhot-story");
  assert.equal(moment.memory.lead?.id, "coldhot", "the binding was reviewed, so the story shows its picture");
  assert.equal(composition.cover, undefined, "…and the same picture is not the month's face");
  assert.deepEqual(composition.preview, [], "nor a preview tile on an index");
  assert.equal(composition.mode, "memory", "the month is carried by its words, not by a guessed picture");
});

test("a subject check earns the cover; source trust never does", () => {
  const looked = photo("opened-and-recorded", "2026-08-19T02:00:00.000Z");
  const merelyTrusted = photo("from-the-family-album", "2026-08-24T02:00:00.000Z");
  const media = [looked, merelyTrusted];

  const sourceOnly = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media));
  assert.equal(sourceOnly.cover, undefined, "a trusted album is not a look at the picture");
  assert.deepEqual(sourceOnly.preview, []);
  assert.equal(sourceOnly.mode, "typography", "a month with nothing checked shows type, never a guess");

  const withCheck = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media, [looked]));
  assert.equal(withCheck.cover?.id, "opened-and-recorded");
  assert.deepEqual(withCheck.preview.map((item) => item.id), ["opened-and-recorded"], "the preview strip asks the same question of every tile");
  assert.equal(withCheck.mode, "photography");
});

// The ledger reader itself. Production holds 34 approved `media_subject_check` rows and no
// rejections today (data track, 2026-09-13), so this changes nothing now — it decides whether a
// withdrawal written tomorrow is honoured. `storyPhotoConfirmationsFrom()` has always taken the
// latest decision; this side of the same ledger used to count every approval forever.
test("a withdrawn subject check stops counting — the latest decision wins", () => {
  const rows = [
    { id: "r1", targetKind: "media_subject_check", targetId: "kept", decision: "approved", reviewedAt: "2026-09-01 10:00:00" },
    { id: "r2", targetKind: "media_subject_check", targetId: "taken-back", decision: "approved", reviewedAt: "2026-09-01 10:00:00" },
    { id: "r3", targetKind: "media_subject_check", targetId: "taken-back", decision: "rejected", reviewedAt: "2026-09-11 09:00:00" },
    // A later approval restores it, the same way any other ledger row would.
    { id: "r4", targetKind: "media_subject_check", targetId: "restored", decision: "rejected", reviewedAt: "2026-09-01 10:00:00" },
    { id: "r5", targetKind: "media_subject_check", targetId: "restored", decision: "approved", reviewedAt: "2026-09-12 09:00:00" },
    // Wrong kind, and a pair id filed under this kind: neither is evidence about a photograph.
    { id: "r6", targetKind: "media_binding", targetId: "story|other", decision: "approved", reviewedAt: "2026-09-11 09:00:00" },
    { id: "r7", targetKind: "media_subject_check", targetId: "story|pair-shaped", decision: "approved", reviewedAt: "2026-09-11 09:00:00" },
  ];
  assert.deepEqual([...checkedPhotoIdsFrom(rows)].sort(), ["kept", "restored"]);
});

test("an unchecked photograph is withheld from display, never from the archive", () => {
  const unlooked = photo("nobody-opened-this", "2026-08-19T05:00:00.000Z");
  const composition = buildMonthComposition(
    monthOf({ media: [unlooked], events: [event("published", "2026-08-19 00:00:00+00", [])] }, "2026-08"),
    privilegeOf([unlooked]));

  assert.equal(composition.totalPhotoCount, 1, "the month still counts it");
  assert.deepEqual(composition.archiveDays.map((day) => day.day), ["2026-08-19"], "under its own date");
  assert.equal(composition.smallImageCount, 0, "it is not being withheld for its size");
  // Not a rejection and not a deletion: the row is untouched and the album still opens on it.
  assert.equal(composition.archiveDays[0].photos[0].id, "nobody-opened-this");
});
