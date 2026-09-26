// Pinned cover: content.coverMediaId overrides dynamic cover selection in buildMonthComposition.
// The pin must still pass the subject-check gate; a pinned id that is excluded or unchecked falls
// through to the dynamic fallback rather than hiding all covers.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMonthComposition, pinnedCoverAllowed } from "../lib/publication-moments.ts";

const BIRTH = "2025-01-03";

function photo(id, takenAt = "2026-08-15T08:00:00.000Z", dims = { width: 1600, height: 1200 }) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "", takenAt, visibility: "family", rawSourceId: `src-${id}`, ...dims };
}

const monthOf = (media, month = "2026-08") =>
  findMonth(buildChapters({ events: [], traces: [], media, birthDay: BIRTH }), month);

const reviewed = (media) => ({
  confirmed: new Set(),
  trusted: new Set(media.map((m) => m.id)),
  checked: new Set(media.map((m) => m.id)),
});

test("pinnedCoverId selects a specific photo as cover when it is subject-checked", () => {
  const early = photo("early", "2026-08-05T08:00:00.000Z");
  const late  = photo("late",  "2026-08-25T08:00:00.000Z");
  // Without pinning, dynamic selection takes newest-first → "late".
  const unpinned = buildMonthComposition(monthOf([early, late]), reviewed([early, late]));
  assert.equal(unpinned.cover?.id, "late", "dynamic cover is newest-first");

  // With pinning, "early" wins even though it is older.
  const pinned = buildMonthComposition(monthOf([early, late]), reviewed([early, late]), [], BIRTH, "early");
  assert.equal(pinned.cover?.id, "early", "pinned cover overrides dynamic selection");
});

test("pinnedCoverId is silently dropped when the photo is not subject-checked, falling back to dynamic", () => {
  const checked   = photo("checked",   "2026-08-20T08:00:00.000Z");
  const unchecked = photo("unchecked", "2026-08-05T08:00:00.000Z");
  // Only "checked" has been reviewed.
  const privilege = { confirmed: new Set(), trusted: new Set([checked.id, unchecked.id]), checked: new Set([checked.id]) };
  const composition = buildMonthComposition(monthOf([checked, unchecked]), privilege, [], BIRTH, "unchecked");
  assert.equal(composition.cover?.id, "checked", "falls back to dynamic when pin is not subject-checked");
});

test("pinnedCoverId is silently dropped when the photo is excluded, falling back to dynamic", () => {
  const keeper  = photo("keeper",  "2026-08-10T08:00:00.000Z");
  const excluded = photo("excluded", "2026-08-20T08:00:00.000Z");
  const privilege = {
    confirmed: new Set(),
    trusted: new Set([keeper.id, excluded.id]),
    checked: new Set([keeper.id, excluded.id]),
    excluded: new Set([excluded.id]),
  };
  const composition = buildMonthComposition(monthOf([keeper, excluded]), privilege, [], BIRTH, "excluded");
  assert.equal(composition.cover?.id, "keeper", "falls back to dynamic when pinned photo is excluded");
});

// 2026-09-27 (Teddy: 记忆页 2024 年月份缺封面; Codex review: no source-trust bypass). A pre-birth month gets
// its cover exactly like any other: the pregnancy review writes `media_subject_check = approved`, which
// is what `checked` reads. Source trust alone never stands in for a review — the 12 月 withdrawals were
// the family's own originals.
test("pre-birth month: a pinned photo becomes the cover only when it is subject-checked (pregnancy review), never on source trust alone", () => {
  const belly = photo("belly", "2024-12-10T08:00:00.000Z");
  const other = photo("other", "2024-12-20T08:00:00.000Z");
  const trustedOnly = { confirmed: new Set(), trusted: new Set([belly.id, other.id]), checked: new Set() };
  assert.equal(buildMonthComposition(monthOf([belly, other], "2024-12"), trustedOnly, [], BIRTH, "belly").cover, undefined, "trusted but unreviewed → no cover");
  assert.equal(pinnedCoverAllowed(belly, trustedOnly, "2024-12"), false);
  const reviewedBelly = { confirmed: new Set(), trusted: new Set([belly.id, other.id]), checked: new Set([belly.id]) };
  const pinned = buildMonthComposition(monthOf([belly, other], "2024-12"), reviewedBelly, [], BIRTH, "belly");
  assert.equal(pinned.cover?.id, "belly");
  assert.deepEqual(pinned.preview.map((p) => p.id), ["belly"], "the strip holds only checked pictures");
  assert.equal(pinnedCoverAllowed(belly, reviewedBelly, "2024-12"), true);
});
test("an excluded pin (the 12 月 withdrawals) stays withdrawn even if it was once checked", () => {
  const withdrawn = photo("withdrawn", "2024-12-01T08:00:00.000Z");
  const privilege = { confirmed: new Set(), trusted: new Set([withdrawn.id]), checked: new Set([withdrawn.id]), excluded: new Set([withdrawn.id]) };
  assert.equal(buildMonthComposition(monthOf([withdrawn], "2024-12"), privilege, [], BIRTH, "withdrawn").cover, undefined);
  assert.equal(pinnedCoverAllowed(withdrawn, privilege, "2024-12"), false);
});
test("a pin must be a photo of the same month: a checked photo from another month is refused as this month's cover", () => {
  const nov = photo("nov", "2024-11-28T08:00:00.000Z");
  const dec = photo("dec", "2024-12-10T08:00:00.000Z");
  const privilege = { confirmed: new Set(), trusted: new Set([nov.id, dec.id]), checked: new Set([nov.id, dec.id]) };
  assert.equal(pinnedCoverAllowed(nov, privilege, "2024-12"), false, "checked, but taken in 2024-11");
  assert.equal(pinnedCoverAllowed(nov, privilege, "2024-11"), true);
  assert.equal(pinnedCoverAllowed(dec, privilege, "2024-12"), true);
  // Shanghai wall clock decides the month: 2024-11-30 23:30 UTC is already 12 月 1 日 in Shanghai.
  const edge = photo("edge", "2024-11-30T23:30:00.000Z");
  assert.equal(pinnedCoverAllowed(edge, { ...privilege, checked: new Set([edge.id]) }, "2024-12"), true);
  assert.equal(pinnedCoverAllowed(edge, { ...privilege, checked: new Set([edge.id]) }, "2024-11"), false);
  // Inside the composition the pin is looked up among this month's own pictures, so a foreign id falls back.
  const composition = buildMonthComposition(monthOf([dec], "2024-12"), privilege, [], BIRTH, "nov");
  assert.equal(composition.cover?.id, "dec");
});

test("pinnedCoverId with no matching photo in the month falls back gracefully", () => {
  const only = photo("only", "2026-08-10T08:00:00.000Z");
  const composition = buildMonthComposition(monthOf([only]), reviewed([only]), [], BIRTH, "nonexistent-id");
  assert.equal(composition.cover?.id, "only", "falls back to dynamic when pinned id not found");
});
