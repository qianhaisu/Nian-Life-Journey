// The rule that decides whether a photograph may be shown as part of a story
// (lib/media/story-binding.ts), and the two reader-facing layers that ask it: a memory's lead and
// the event detail page's story layout. Every case below is a shape production actually holds —
// 523 of the archive's 524 bound stories are the "same day, nothing else" case.
import test from "node:test";
import assert from "node:assert/strict";
import { isStoryAssociated, storyAssociationBasis, storyAssociatedMedia } from "../lib/media/story-binding.ts";
import { storyLayout } from "../lib/media/presentation.ts";
import { NO_HERO_MEDIA_ID } from "../lib/media/hero.ts";

const photo = (id, source, dims = { width: 1600, height: 1200 }) => ({
  id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image",
  takenAt: "2026-08-19T08:00:00.000Z", visibility: "family", rawSourceId: source, ...dims,
});

test("a picture is part of a story only when the story was written from the material it arrived in", () => {
  const event = { sourceIds: ["msg-1", "msg-2"] };
  assert.equal(isStoryAssociated(event, photo("a", "msg-2")), true);
  assert.equal(isStoryAssociated(event, photo("b", "msg-9")), false, "another message on the same day is not this story");
  assert.equal(isStoryAssociated(event, photo("c", undefined)), false, "a picture with no source cannot show anything");
  assert.equal(isStoryAssociated({ sourceIds: [] }, photo("d", "msg-1")), false, "a story written from nothing associates nothing");
});

// Basis B. A WeChat photograph arrives in its own message whose body is the exporter's `[media]`
// placeholder, so its own raw source is never something a story was written from. What the archive
// records is the message the Organizer bound the picture TO, and that message IS a source.
const bound = (mediaId, boundSourceId, tier = "confirmed") => ({
  organizerRun: { mediaBinding: { candidateCount: 1, refused: [], adopted: [{ mediaId, tier, boundSourceId, basis: `bound to ${boundSourceId}` }] } },
});

test("a picture bound to a sentence the story was written from is part of that story", () => {
  const event = { sourceIds: ["msg-said-something"], ...bound("pic", "msg-said-something") };
  // The placeholder the photo itself arrived in is NOT among the sources — that is the whole point.
  assert.equal(isStoryAssociated(event, photo("pic", "msg-placeholder")), true);
  assert.equal(storyAssociationBasis(event, photo("pic", "msg-placeholder")), "bound to msg-said-something");

  const elsewhere = { sourceIds: ["msg-said-something"], ...bound("pic", "msg-from-another-window") };
  assert.equal(isStoryAssociated(elsewhere, photo("pic", "msg-placeholder")), false,
    "a binding to a message this story never read is not this story's picture");
});

test("a picture with no binding record cannot reach a story through Basis B", () => {
  // Production shape, measured 2026-09-11: all 530 (published story, photograph) pairs come from the
  // same-day backfill and carry no mediaBinding at all. This is the test that keeps them out.
  const backfilled = { sourceIds: ["msg-1"], organizerRun: { organizerType: "rule" } };
  assert.equal(isStoryAssociated(backfilled, photo("same-day", "msg-other")), false);
  assert.equal(isStoryAssociated({ sourceIds: ["msg-1"] }, photo("same-day", "msg-other")), false);
  assert.equal(storyAssociationBasis({ sourceIds: ["msg-1"] }, photo("same-day", "msg-other")), undefined);
});

test("the tier table decides what may be attached, and refused bindings never count", () => {
  const sourceIds = ["msg-said-something"];
  for (const tier of ["confirmed", "strong_contextual"]) {
    assert.equal(isStoryAssociated({ sourceIds, ...bound("pic", "msg-said-something", tier) }, photo("pic", "ph")), true, tier);
  }
  for (const tier of ["day_level", "month_level", "unbound", "invented_tier"]) {
    assert.equal(isStoryAssociated({ sourceIds, ...bound("pic", "msg-said-something", tier) }, photo("pic", "ph")), false, tier);
  }
  const refusedOnly = {
    sourceIds,
    organizerRun: { mediaBinding: { candidateCount: 1, adopted: [], refused: [{ mediaId: "pic", tier: "confirmed", reason: "policy" }] } },
  };
  assert.equal(isStoryAssociated(refusedOnly, photo("pic", "ph")), false, "a refused binding is not an adopted one");
});

test("Basis B filters, it never adds back a photograph a person took away", () => {
  // Round 6 retracted three pictures by removing them from the event's media_ids. The binding record
  // still names them. Association only ever filters what the event still lists, so they stay gone.
  const event = { sourceIds: ["msg-said-something"], heroMediaId: "kept", ...bound("retracted", "msg-said-something") };
  const stillListed = [photo("kept", "msg-said-something")];
  assert.deepEqual(storyAssociatedMedia(event, stillListed).map((item) => item.id), ["kept"]);

  // And the other way a person says no: the sentinel still wins over a provable binding.
  const withdrawn = { sourceIds: ["msg-said-something"], heroMediaId: NO_HERO_MEDIA_ID, ...bound("pic", "msg-said-something") };
  const layout = storyLayout(storyAssociatedMedia(withdrawn, [photo("pic", "ph")]), withdrawn.heroMediaId);
  assert.equal(layout.hero, undefined);
});

test("size, recency, order and heroMediaId are not association, in any combination", () => {
  // The exact signals lib/publication-moments.ts's pickDayPhotos used to select on. Each one is
  // present here at full strength and the picture is still not this story's.
  const event = { sourceIds: ["the-message-the-story-came-from"], heroMediaId: "big-first-newest" };
  const candidate = photo("big-first-newest", "some-other-message", { width: 4032, height: 3024 });
  assert.equal(isStoryAssociated(event, candidate), false);
  assert.deepEqual(storyAssociatedMedia(event, [candidate]), []);
});

test("storyAssociatedMedia keeps the reader's order and drops only the unassociated", () => {
  const event = { sourceIds: ["s1", "s3"] };
  const media = [photo("one", "s1"), photo("two", "s2"), photo("three", "s3")];
  assert.deepEqual(storyAssociatedMedia(event, media).map((item) => item.id), ["one", "three"]);
});

test("the detail page's story layer: associated pictures lay out, the rest never reach it", () => {
  // Mirrors app/events/[id]/page.tsx — storyLayout over the associated subset, not over everything
  // the event's media_ids happen to list.
  const event = { sourceIds: ["s-hero"], heroMediaId: "hero" };
  const media = [photo("hero", "s-hero"), photo("same-day", "s-other"), photo("also-same-day", "s-other-2")];
  const layout = storyLayout(storyAssociatedMedia(event, media), event.heroMediaId);
  assert.equal(layout.hero.id, "hero");
  assert.deepEqual(layout.supporting, [], "the same-day pictures are not supporting frames of this story");
  assert.equal(layout.remaining, 0, "and they are not counted as this story's either");

  // With nothing associated, the story is a text page — not a page that reaches for the nearest photo.
  const unassociated = { sourceIds: ["s-text"], heroMediaId: "same-day" };
  const bare = storyLayout(storyAssociatedMedia(unassociated, media), unassociated.heroMediaId);
  assert.equal(bare.hero, undefined);
  assert.deepEqual(bare.supporting, []);
});

test("a reviewed text-only story stays text-only even when it does have an associated picture", () => {
  // The two gates answer different questions and the review decision wins: noPhoto says a human
  // looked and said no, association says the archive can prove a connection. Proof does not
  // override the decision.
  const event = { sourceIds: ["s-hero"], heroMediaId: NO_HERO_MEDIA_ID };
  const layout = storyLayout(storyAssociatedMedia(event, [photo("hero", "s-hero")]), event.heroMediaId);
  assert.equal(layout.hero, undefined);
  assert.deepEqual(layout.supporting, []);
});
