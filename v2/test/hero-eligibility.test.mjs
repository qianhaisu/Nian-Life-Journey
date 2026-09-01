import test from "node:test";
import assert from "node:assert/strict";
import { isHeroEligible, heroCandidates, selectHeroMedia, isThumbnailEligible, THUMBNAIL_MIN_SIDE } from "../lib/media/hero.ts";

function photo(id, width, height, overrides = {}) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: id, takenAt: "2026-01-01T00:00:00.000Z", visibility: "family", width, height, ...overrides };
}

test("isHeroEligible rejects unknown dimensions", () => {
  assert.equal(isHeroEligible(photo("a", 0, 0)), false);
  assert.equal(isHeroEligible({ ...photo("a", 800, 800), width: undefined }), false);
  assert.equal(isHeroEligible(undefined), false);
});

test("isHeroEligible rejects images below the short-side floor (WeChat thumbnail-scale originals)", () => {
  // Matches production case: wechat-media:1c8818a2... at 90x120 (short side 90 < 480).
  assert.equal(isHeroEligible(photo("a", 90, 120)), false);
});

test("isHeroEligible rejects images below the long-side floor even with a wide short side", () => {
  assert.equal(isHeroEligible(photo("a", 500, 600)), false);
});

test("isHeroEligible rejects non-photo media (video posters, documents)", () => {
  assert.equal(isHeroEligible(photo("a", 1280, 1706, { type: "video" })), false);
  assert.equal(isHeroEligible(photo("a", 1280, 1706, { type: "document" })), false);
});

test("isHeroEligible accepts a photo at or above both floors", () => {
  assert.equal(isHeroEligible(photo("a", 1280, 1706)), true);
  assert.equal(isHeroEligible(photo("a", 720, 480)), true);
});

test("heroCandidates prefers heroMediaId when it qualifies, keeps the rest in order", () => {
  const candidates = [photo("a", 1000, 1000), photo("b", 1200, 900), photo("c", 900, 1200)];
  const result = heroCandidates("b", candidates);
  assert.deepEqual(result.map((item) => item.id), ["b", "a", "c"]);
});

test("heroCandidates falls back past a tiny heroMediaId to the next eligible sibling", () => {
  // Matches production case: event-0226c115's heroMediaId (c4f5e72e..., 67x120) is too small;
  // its sibling photos are equally tiny in this fixture except "big".
  const candidates = [photo("tiny-hero", 67, 120), photo("tiny-sibling", 90, 120), photo("big", 1280, 1706)];
  const result = heroCandidates("tiny-hero", candidates);
  assert.deepEqual(result.map((item) => item.id), ["big"]);
});

test("heroCandidates returns an empty list when no photo in the event qualifies", () => {
  const candidates = [photo("a", 90, 120), photo("b", 20, 20)];
  assert.deepEqual(heroCandidates("a", candidates), []);
});

test("selectHeroMedia returns undefined (not a thrown error or a tiny image) when nothing qualifies", () => {
  assert.equal(selectHeroMedia("a", [photo("a", 90, 120)]), undefined);
});

test("thumbnail eligibility rejects sticker- and icon-sized media", () => {
  // Sizes taken from what the WeChat import actually produced.
  assert.equal(isThumbnailEligible(photo("icon", 20, 20)), false);
  assert.equal(isThumbnailEligible(photo("sticker", 67, 120)), false);
  assert.equal(isThumbnailEligible(photo("sticker-wide", 120, 55)), false);
  assert.equal(isThumbnailEligible(photo("just-under", 159, 400)), false);
  assert.equal(isThumbnailEligible(photo("at-floor", THUMBNAIL_MIN_SIDE, THUMBNAIL_MIN_SIDE)), true);
  assert.equal(isThumbnailEligible(photo("real", 1080, 1440)), true);
  assert.equal(isThumbnailEligible(undefined), false);
  assert.equal(isThumbnailEligible(photo("unknown", undefined, undefined)), false);
});

test("thumbnail floor is lower than the hero floor", () => {
  const midsize = photo("midsize", 300, 300);
  assert.equal(isThumbnailEligible(midsize), true, "usable in a grid cell");
  assert.equal(isHeroEligible(midsize), false, "but not at full page width");
});
