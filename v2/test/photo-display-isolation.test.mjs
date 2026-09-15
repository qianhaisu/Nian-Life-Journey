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
  // Nobody has opened any of these — the shape 556 of the archive's 569 default-visible pictures
  // are in. This is the case the guarantee is about: approving a paragraph of text must not move a
  // picture nobody has reviewed.
  const before = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media));
  const after = buildMonthComposition(
    monthOf({ media, events: [event("published", "2026-08-19 00:00:00+00", [])] }, "2026-08"),
    privilegeOf(media));

  const a = slotsOf(after), b = slotsOf(before);
  for (const slot of ["story", "dayGroup", "album", "cover", "preview", "chronicleHeroes"]) {
    assert.deepEqual(a[slot], b[slot], `the words arrived; the ${slot} slot did not change`);
  }

  // The other half, stated rather than left implicit: a picture somebody HAS opened does move — out
  // of the album and up beside the words of its own day. That is the day group's whole purpose, and
  // it is a move a person authorised by looking at the picture, not one the text bought.
  const checkedBefore = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media, media));
  const checkedAfter = buildMonthComposition(
    monthOf({ media, events: [event("published", "2026-08-19 00:00:00+00", [])] }, "2026-08"),
    privilegeOf(media, media));
  assert.deepEqual(slotsOf(checkedBefore).dayGroup, [], "before the words there is no day group at all");
  assert.deepEqual(slotsOf(checkedAfter).dayGroup, ["morning", "noon"], "after them, that day's reviewed pictures read beside them");
  assert.ok(!slotsOf(checkedAfter).album.includes("morning"), "and they are not also left in the album");
  assert.deepEqual(after.dayPhotoGroups, [], "nothing was lifted into default reading");
  assert.deepEqual(after.archiveDays.flatMap((day) => day.photos.map((item) => item.id)).sort(),
    ["another-day", "morning", "noon"], "every photograph is still in the album, on its own day");
  assert.equal(after.chapter.some((moment) => moment.memory?.id === "published"), true, "and the words themselves are published");
});

// 纯照片日的版面头图 (`photo_led`) WAS left ungated in the first pass, on the reasoning that it is
// not created by publishing. The reasoning held; the measurement behind it did not. The residual was
// reported as 265 pictures because it counted heroes only — the thumbnails beside them are 327 more,
// none subject-checked, all default-visible, never counted. 242 + 327 with zero overlap, so 556 of
// 569 unreviewed. 总指挥 revised the decision on the corrected number and both are now gated
// (photoLedMoment filters candidates before selection).
//
// This invariant is kept anyway, because it is what makes the gating safe to reason about: the hero
// set after publishing is always a SUBSET of the hero set before.
//
// The mechanism, in composeMonth: a chronicle candidate is `photoDaysAsc.filter(day =>
// !chapterDays.has(day.day))`. Publishing only ever adds to `chapterDays`, so it can only remove
// candidates. Asserted over several days at once, including days that gain words and days that do
// not, so a future change that starts minting heroes on published days fails here.
test("publishing can retire a photo-led hero but can never mint one", () => {
  const days = ["2026-08-04", "2026-08-11", "2026-08-18", "2026-08-25"];
  const media = days.flatMap((day, i) => [
    photo(`${day}-a`, `${day}T02:00:00.000Z`),
    photo(`${day}-b`, `${day}T0${i + 3}:00:00.000Z`),
  ]);
  const heroesOf = (events) => new Set(buildMonthComposition(monthOf({ media, events }, "2026-08"), privilegeOf(media, media))
    .chronicle.map((moment) => moment.hero?.id).filter(Boolean));

  const before = heroesOf([]);
  assert.ok(before.size > 0, "the unpublished month really does carry photo-led heroes");

  // Publish one day, then two, then all four: the set only ever shrinks.
  let previous = before;
  for (let n = 1; n <= days.length; n += 1) {
    const events = days.slice(0, n).map((day, i) => event(`story-${i}`, `${day} 00:00:00+00`, []));
    const now = heroesOf(events);
    assert.ok([...now].every((id) => before.has(id)), `publishing ${n} day(s) minted a hero that did not exist before`);
    assert.ok(now.size <= previous.size, `publishing ${n} day(s) grew the hero set`);
    previous = now;
  }
  assert.ok(previous.size < before.size, "…and publishing every photographed day really did retire some");
});

test("a photo-led day draws only subject-checked pictures — hero and every thumbnail beside it", () => {
  const day = "2026-08-19";
  const looked = photo("opened-hero", `${day}T02:00:00.000Z`);
  const lookedThumb = photo("opened-thumb", `${day}T06:00:00.000Z`);
  const unlooked = [photo("unopened-a", `${day}T09:00:00.000Z`), photo("unopened-b", `${day}T12:00:00.000Z`)];
  const media = [looked, lookedThumb, ...unlooked];
  const c = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media, [looked, lookedThumb]));

  const moment = c.chronicle.find((m) => m.kind === "photo_led");
  assert.equal(moment.hero.id, "opened-hero");
  assert.deepEqual(moment.supporting.map((s) => s.id), ["opened-thumb"], "thumbnails carry the same approval the hero does");
  // The unchecked ones are not hidden — they are in the album, on their own day, as before.
  assert.deepEqual(c.archiveDays.flatMap((d) => d.photos.map((p) => p.id)).sort(),
    ["opened-thumb", "unopened-a", "unopened-b", "opened-hero"].sort());
});

// The order the filter runs in, which is the difference between "this day has no approved
// photograph" and "its approved photograph was standing behind another one".
test("a checked photograph behind an unchecked one in the same burst still becomes the hero", () => {
  const day = "2026-08-19";
  // Same burst: seconds apart, both hero-sized. The unchecked one is FIRST, so it is what
  // burstRepresentatives would have picked out of the unfiltered day.
  const unchecked = photo("first-in-burst-unchecked", `${day}T02:00:00.000Z`);
  const checked = photo("second-in-burst-checked", `${day}T02:00:10.000Z`);
  const media = [unchecked, checked];
  const c = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media, [checked]));

  const moment = c.chronicle.find((m) => m.kind === "photo_led");
  assert.ok(moment, "the day is not lost just because an unchecked frame led its burst");
  assert.equal(moment.hero.id, "second-in-burst-checked");
  assert.ok(!moment.supporting.some((s) => s.id === "first-in-burst-unchecked"));
});

test("no qualifying picture: the day keeps its date and its album, and nothing stands in", () => {
  const day = "2026-08-19";
  const media = [photo("a", `${day}T02:00:00.000Z`), photo("b", `${day}T09:00:00.000Z`)];
  // Source-trusted, none opened — the 556-picture shape.
  const c = buildMonthComposition(monthOf({ media }, "2026-08"), privilegeOf(media));

  assert.deepEqual(c.chronicle.filter((m) => m.kind === "photo_led"), [], "no hero, and no thumbnails either");
  assert.equal(c.cover, undefined, "and no trusted picture is promoted to stand in for one");
  assert.deepEqual(c.preview, []);
  // 独立相册可达性不变：the day is still there, whole, with its own date.
  assert.deepEqual(c.archiveDays.map((d) => d.day), [day]);
  assert.deepEqual(c.archiveDays[0].photos.map((p) => p.id).sort(), ["a", "b"]);
  assert.equal(c.totalPhotoCount, 2, "the month still counts them as its photographs");
  // The day is named in the quiet-day line so a reader is told where its pictures are.
  assert.deepEqual(c.quietDays.map((q) => q.day), [day]);
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

// The expander is not a second, looser door. `lib/month-album.ts` (the GET album route) returns
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

// R8, the second coldhot photograph. Both of that story's pictures are 「非 trusted」 with no subject
// check: an approved `media_binding` is their only warrant, and `privilege.confirmed` is a flat set
// of mediaIds rather than of pairs. So the binding used to admit them to the month's album as
// standalone photographs — including the 3120×4160 one the story does not draw at all.
test("a story binding does not become independent album entry for the pictures it approved", () => {
  const drawn = photo("coldhot-drawn", "2026-09-07T05:00:00.000Z", { width: 1280, height: 1707 });
  const notDrawn = photo("coldhot-not-drawn", "2026-09-07T06:00:00.000Z", { width: 3120, height: 4160 });
  const media = [drawn, notDrawn];
  // Neither is source-trusted and neither has been opened — exactly production's shape for these two.
  const privilege = { confirmed: new Set([drawn.id, notDrawn.id]), trusted: new Set(), checked: new Set() };
  const composition = buildMonthComposition(
    monthOf({
      media,
      events: [event("coldhot-story", "2026-09-07 00:00:00+00", [drawn.id, notDrawn.id], { heroMediaId: drawn.id })],
      photoConfirmations: new Set([`coldhot-story|${drawn.id}`, `coldhot-story|${notDrawn.id}`]),
    }, "2026-09"),
    privilege);

  const moment = composition.chapter.find((item) => item.memory?.id === "coldhot-story");
  assert.equal(moment.memory.lead?.id, "coldhot-drawn", "the approved story display is kept");
  assert.deepEqual(composition.archiveDays, [], "the binding does not put either picture in 这个月的照片");
  assert.deepEqual(composition.dayPhotoGroups, [], "nor in 这一天的照片");
  assert.equal(composition.cover, undefined, "nor make one the month's face");
  assert.deepEqual(composition.preview, []);
  assert.equal(composition.totalPhotoCount, 0, "the album counts neither, because neither is one of its photographs");
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
