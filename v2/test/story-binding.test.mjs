// The rule that decides whether a photograph may be shown as part of a story
// (lib/media/story-binding.ts), and the two reader-facing layers that ask it: a memory's lead and
// the event detail page's story layout. Every case below is a shape production actually holds —
// 523 of the archive's 524 bound stories are the "same day, nothing else" case.
import test from "node:test";
import assert from "node:assert/strict";
import { isStoryAssociated, storyAssociationBasis, storyAssociatedMedia, storyPhotoConfirmationsFrom, storyPhotoKey, STORY_PHOTO_REVIEW_KIND } from "../lib/media/story-binding.ts";
import { storyLayout } from "../lib/media/presentation.ts";
import { NO_HERO_MEDIA_ID } from "../lib/media/hero.ts";

const photo = (id, source, dims = { width: 1600, height: 1200 }) => ({
  id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image",
  takenAt: "2026-08-19T08:00:00.000Z", visibility: "family", rawSourceId: source, ...dims,
});

test("a picture is part of a story only when the story was written from the material it arrived in", () => {
  const event = { id: "ev", sourceIds: ["msg-1", "msg-2"] };
  assert.equal(isStoryAssociated(event, photo("a", "msg-2")), true);
  assert.equal(isStoryAssociated(event, photo("b", "msg-9")), false, "another message on the same day is not this story");
  assert.equal(isStoryAssociated(event, photo("c", undefined)), false, "a picture with no source cannot show anything");
  assert.equal(isStoryAssociated({ id: "ev", sourceIds: [] }, photo("d", "msg-1")), false, "a story written from nothing associates nothing");
});

// Basis B. A WeChat photograph arrives in its own message whose body is the exporter's `[media]`
// placeholder, so its own raw source is never something a story was written from. What the archive
// records is the message the Organizer bound the picture TO, and that message IS a source.
const bound = (mediaId, boundSourceId, tier = "confirmed") => ({
  organizerRun: { mediaBinding: { candidateCount: 1, refused: [], adopted: [{ mediaId, tier, boundSourceId, basis: `bound to ${boundSourceId}` }] } },
});

test("a picture bound to a sentence the story was written from is part of that story", () => {
  const event = { id: "ev", sourceIds: ["msg-said-something"], ...bound("pic", "msg-said-something") };
  // The placeholder the photo itself arrived in is NOT among the sources — that is the whole point.
  assert.equal(isStoryAssociated(event, photo("pic", "msg-placeholder")), true);
  assert.equal(storyAssociationBasis(event, photo("pic", "msg-placeholder")), "bound to msg-said-something");

  const elsewhere = { id: "ev", sourceIds: ["msg-said-something"], ...bound("pic", "msg-from-another-window") };
  assert.equal(isStoryAssociated(elsewhere, photo("pic", "msg-placeholder")), false,
    "a binding to a message this story never read is not this story's picture");
});

test("a picture with no binding record cannot reach a story through Basis B", () => {
  // Production shape, measured 2026-09-11: all 530 (published story, photograph) pairs come from the
  // same-day backfill and carry no mediaBinding at all. This is the test that keeps them out.
  const backfilled = { id: "ev", sourceIds: ["msg-1"], organizerRun: { organizerType: "rule" } };
  assert.equal(isStoryAssociated(backfilled, photo("same-day", "msg-other")), false);
  assert.equal(isStoryAssociated({ id: "ev", sourceIds: ["msg-1"] }, photo("same-day", "msg-other")), false);
  assert.equal(storyAssociationBasis({ id: "ev", sourceIds: ["msg-1"] }, photo("same-day", "msg-other")), undefined);
});

test("only a tier that may be narrated as depicting gets inside a story, and refused bindings never count", () => {
  // 2026-09-11 review decision. `strong_contextual` means "same speaker, same beat, deterministic
  // time bound" — near the story, not OF it. Anything printed inside the story card reads as
  // belonging to those words, so demoting it to a supporting frame would not have helped: it is out
  // of the card entirely and keeps its place in 「这一天的照片」.
  const sourceIds = ["msg-said-something"];
  assert.equal(isStoryAssociated({ id: "ev", sourceIds, ...bound("pic", "msg-said-something", "confirmed") }, photo("pic", "ph")), true);
  for (const tier of ["strong_contextual", "day_level", "month_level", "unbound", "invented_tier"]) {
    assert.equal(isStoryAssociated({ id: "ev", sourceIds, ...bound("pic", "msg-said-something", tier) }, photo("pic", "ph")), false, tier);
  }
  // The case that settled it: a real photograph of him, same speaker, 90 seconds, adopted by the
  // Writer — and no pacifier in the frame. It may not illustrate 「严重依赖奶嘴」.
  const pacifier = { id: "ev", sourceIds, ...bound("pic", "msg-said-something", "strong_contextual") };
  assert.deepEqual(storyAssociatedMedia(pacifier, [photo("pic", "ph")]), []);
  assert.equal(storyAssociationBasis(pacifier, photo("pic", "ph")), undefined);
  const refusedOnly = {
    id: "ev",
    sourceIds,
    organizerRun: { mediaBinding: { candidateCount: 1, adopted: [], refused: [{ mediaId: "pic", tier: "confirmed", reason: "policy" }] } },
  };
  assert.equal(isStoryAssociated(refusedOnly, photo("pic", "ph")), false, "a refused binding is not an adopted one");
});

test("Basis B filters, it never adds back a photograph a person took away", () => {
  // Round 6 retracted three pictures by removing them from the event's media_ids. The binding record
  // still names them. Association only ever filters what the event still lists, so they stay gone.
  const event = { id: "ev", sourceIds: ["msg-said-something"], heroMediaId: "kept", ...bound("retracted", "msg-said-something") };
  const stillListed = [photo("kept", "msg-said-something")];
  assert.deepEqual(storyAssociatedMedia(event, stillListed).map((item) => item.id), ["kept"]);

  // And the other way a person says no: the sentinel still wins over a provable binding.
  const withdrawn = { id: "ev", sourceIds: ["msg-said-something"], heroMediaId: NO_HERO_MEDIA_ID, ...bound("pic", "msg-said-something") };
  const layout = storyLayout(storyAssociatedMedia(withdrawn, [photo("pic", "ph")]), withdrawn.heroMediaId);
  assert.equal(layout.hero, undefined);
});

test("size, recency, order and heroMediaId are not association, in any combination", () => {
  // The exact signals lib/publication-moments.ts's pickDayPhotos used to select on. Each one is
  // present here at full strength and the picture is still not this story's.
  const event = { id: "ev", sourceIds: ["the-message-the-story-came-from"], heroMediaId: "big-first-newest" };
  const candidate = photo("big-first-newest", "some-other-message", { width: 4032, height: 3024 });
  assert.equal(isStoryAssociated(event, candidate), false);
  assert.deepEqual(storyAssociatedMedia(event, [candidate]), []);
});

test("storyAssociatedMedia keeps the reader's order and drops only the unassociated", () => {
  const event = { id: "ev", sourceIds: ["s1", "s3"] };
  const media = [photo("one", "s1"), photo("two", "s2"), photo("three", "s3")];
  assert.deepEqual(storyAssociatedMedia(event, media).map((item) => item.id), ["one", "three"]);
});

test("the detail page's story layer: associated pictures lay out, the rest never reach it", () => {
  // Mirrors app/events/[id]/page.tsx — storyLayout over the associated subset, not over everything
  // the event's media_ids happen to list.
  const event = { id: "ev", sourceIds: ["s-hero"], heroMediaId: "hero" };
  const media = [photo("hero", "s-hero"), photo("same-day", "s-other"), photo("also-same-day", "s-other-2")];
  const layout = storyLayout(storyAssociatedMedia(event, media), event.heroMediaId);
  assert.equal(layout.hero.id, "hero");
  assert.deepEqual(layout.supporting, [], "the same-day pictures are not supporting frames of this story");
  assert.equal(layout.remaining, 0, "and they are not counted as this story's either");

  // With nothing associated, the story is a text page — not a page that reaches for the nearest photo.
  const unassociated = { id: "ev", sourceIds: ["s-text"], heroMediaId: "same-day" };
  const bare = storyLayout(storyAssociatedMedia(unassociated, media), unassociated.heroMediaId);
  assert.equal(bare.hero, undefined);
  assert.deepEqual(bare.supporting, []);
});

test("a reviewed text-only story stays text-only even when it does have an associated picture", () => {
  // The two gates answer different questions and the review decision wins: noPhoto says a human
  // looked and said no, association says the archive can prove a connection. Proof does not
  // override the decision.
  const event = { id: "ev", sourceIds: ["s-hero"], heroMediaId: NO_HERO_MEDIA_ID };
  const layout = storyLayout(storyAssociatedMedia(event, [photo("hero", "s-hero")]), event.heroMediaId);
  assert.equal(layout.hero, undefined);
  assert.deepEqual(layout.supporting, []);
});

// BASIS C — a review-ledger row saying somebody opened the picture and recorded that it belongs.
// The review of 2026-09-11 asked for proof of three things: only an exactly matching pair is let
// through; noPhoto, retraction and visibility keep winning; and the row is not disguised as
// Organizer history or as a person's confirmation.
const reviewRow = (eventId, mediaId, extra = {}) => ({
  targetKind: STORY_PHOTO_REVIEW_KIND,
  targetId: `${eventId}|${mediaId}`,
  decision: "approved",
  provider: "claude-code",
  model: "claude-opus-5",
  reasonCodes: ["agent_visual_check"],
  ...extra,
});

test("Basis C lets through exactly the pair that was reviewed, and nothing adjacent to it", () => {
  const confirmations = storyPhotoConfirmationsFrom([reviewRow("story-a", "pic-1")]);
  assert.deepEqual([...confirmations], [storyPhotoKey("story-a", "pic-1")]);

  const storyA = { id: "story-a", sourceIds: [] };
  const storyB = { id: "story-b", sourceIds: [] };
  assert.equal(isStoryAssociated(storyA, photo("pic-1", "unrelated-msg"), confirmations), true);
  assert.equal(isStoryAssociated(storyA, photo("pic-2", "unrelated-msg"), confirmations), false,
    "another photograph under the same story was not reviewed");
  assert.equal(isStoryAssociated(storyB, photo("pic-1", "unrelated-msg"), confirmations), false,
    "the same photograph under another story was not reviewed");
  assert.equal(storyAssociationBasis(storyA, photo("pic-1", "x"), confirmations),
    "a reviewer opened this picture and recorded that it belongs to this story");
});

test("a ledger row only confirms when it is the right kind, approved, and names exactly two halves", () => {
  const story = { id: "story-a", sourceIds: [] };
  const passes = (rows) => isStoryAssociated(story, photo("pic-1", "x"), storyPhotoConfirmationsFrom(rows));

  assert.equal(passes([reviewRow("story-a", "pic-1")]), true, "the shape that should work");
  assert.equal(passes([reviewRow("story-a", "pic-1", { targetKind: "life_event" })]), false, "wrong kind");
  for (const decision of ["needs_human_review", "rejected", "store_only", "", undefined, null, "APPROVED"]) {
    assert.equal(passes([reviewRow("story-a", "pic-1", { decision })]), false, `decision ${String(decision)}`);
  }
  // A malformed target_id must never become a wildcard.
  for (const targetId of ["story-a", "story-a|", "|pic-1", "story-a|pic-1|extra", "", null, undefined]) {
    assert.equal(passes([{ ...reviewRow("x", "y"), targetId }]), false, `targetId ${String(targetId)}`);
  }
});

test("Basis C does not override noPhoto, a retraction, or a private picture", () => {
  const confirmations = storyPhotoConfirmationsFrom([reviewRow("story-a", "pic-1"), reviewRow("story-a", "taken-back")]);

  // noPhoto: a reviewed story that says no photograph belongs still shows none.
  const noPhoto = { id: "story-a", sourceIds: [], heroMediaId: NO_HERO_MEDIA_ID };
  const layout = storyLayout(storyAssociatedMedia(noPhoto, [photo("pic-1", "x")], confirmations), noPhoto.heroMediaId);
  assert.equal(layout.hero, undefined, "the sentinel outranks a confirmation");
  assert.deepEqual(layout.supporting, []);

  // Retraction: the confirmed picture was taken out of media_ids, so it is never in the input at
  // all. Association filters what the event still lists and can never add one back.
  const story = { id: "story-a", sourceIds: [] };
  const stillListed = [photo("pic-1", "x")];
  assert.deepEqual(storyAssociatedMedia(story, stillListed, confirmations).map((i) => i.id), ["pic-1"],
    "the retracted 'taken-back' is confirmed and still absent, because the event no longer lists it");

  // Visibility: a private row is filtered upstream (lib/family-archive.ts, app/events/[id]/page.tsx)
  // and never reaches here, so a confirmation cannot resurrect one either.
  const visible = [photo("pic-1", "x")].filter((item) => item.visibility !== "private");
  const hidden = [{ ...photo("pic-1", "x"), visibility: "private" }].filter((item) => item.visibility !== "private");
  assert.equal(storyAssociatedMedia(story, visible, confirmations).length, 1);
  assert.equal(storyAssociatedMedia(story, hidden, confirmations).length, 0);
});

test("a confirmation is a ledger row, not Organizer history and not a person's word", () => {
  // The row carries its own provenance columns; this module reads none of them, so it can neither
  // launder an agent check into an Organizer result nor present it as a human confirmation.
  const row = reviewRow("story-a", "pic-1");
  assert.equal(row.provider, "claude-code");
  assert.equal(row.model, "claude-opus-5");
  assert.deepEqual(row.reasonCodes, ["agent_visual_check"]);

  // And it stays out of the Organizer's own record: an event with a confirmation still has no
  // mediaBinding, and Basis B still refuses it on its own terms.
  const story = { id: "story-a", sourceIds: ["msg-said-something"] };
  assert.equal(story.organizerRun, undefined);
  assert.equal(isStoryAssociated(story, photo("pic-1", "placeholder")), false, "without the ledger, nothing");
  assert.equal(isStoryAssociated(story, photo("pic-1", "placeholder"), storyPhotoConfirmationsFrom([row])), true);
});
