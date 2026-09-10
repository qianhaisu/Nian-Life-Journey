// The rule that decides whether a photograph may be shown as part of a story
// (lib/media/story-binding.ts), and the two reader-facing layers that ask it: a memory's lead and
// the event detail page's story layout. Every case below is a shape production actually holds —
// 523 of the archive's 524 bound stories are the "same day, nothing else" case.
import test from "node:test";
import assert from "node:assert/strict";
import { isStoryAssociated, storyAssociatedMedia } from "../lib/media/story-binding.ts";
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
