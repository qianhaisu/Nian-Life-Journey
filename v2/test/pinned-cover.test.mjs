// Pinned cover: content.coverMediaId overrides dynamic cover selection in buildMonthComposition.
// The pin must still pass the subject-check gate; a pinned id that is excluded or unchecked falls
// through to the dynamic fallback rather than hiding all covers.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, findMonth } from "../lib/memory-chapters.ts";
import { buildMonthComposition } from "../lib/publication-moments.ts";

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

test("pinnedCoverId with no matching photo in the month falls back gracefully", () => {
  const only = photo("only", "2026-08-10T08:00:00.000Z");
  const composition = buildMonthComposition(monthOf([only]), reviewed([only]), [], BIRTH, "nonexistent-id");
  assert.equal(composition.cover?.id, "only", "falls back to dynamic when pinned id not found");
});
