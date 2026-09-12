// Which story comes before this one and which comes after (lib/story-neighbours.ts). The ordering
// itself, not how the page draws it: a story page was a dead end until 2026-09-12, and the risk in
// fixing that is a reading order that changes between two renders of the same page, or an entry
// pointing at something the reader is not allowed to open.
import test from "node:test";
import assert from "node:assert/strict";
const { storyNeighbours } = await import("../lib/story-neighbours.ts");

const story = (id, occurredAt, title = `记忆 ${id}`) => ({ id, title, occurredAt });

const JUNE = story("jun", "2026-06-10 00:00:00+00");
const JULY = story("jul", "2026-07-04 00:00:00+00");
const AUGUST = story("aug", "2026-08-19 00:00:00+00");
const ALL = [JUNE, JULY, AUGUST];

test("the middle story has both neighbours, in lived order", () => {
  const { previous, next } = storyNeighbours(JULY, ALL);
  assert.equal(previous.id, "jun", "上一篇 is the earlier story");
  assert.equal(next.id, "aug", "下一篇 is the later one");
});

test("the ends have one side only, and the missing side is absent rather than empty", () => {
  assert.equal(storyNeighbours(JUNE, ALL).previous, undefined);
  assert.equal(storyNeighbours(JUNE, ALL).next.id, "jul");
  assert.equal(storyNeighbours(AUGUST, ALL).next, undefined);
  assert.equal(storyNeighbours(AUGUST, ALL).previous.id, "jul");
});

test("the only story in the archive has no neighbours at all", () => {
  const alone = storyNeighbours(JULY, [JULY]);
  assert.equal(alone.previous, undefined);
  assert.equal(alone.next, undefined);
});

test("a year boundary is not an end — 12 月 31 日 and 1 月 1 日 are neighbours", () => {
  const lastOf2025 = story("dec", "2025-12-31 00:00:00+00");
  const firstOf2026 = story("jan", "2026-01-01 00:00:00+00");
  const across = [lastOf2025, firstOf2026, JUNE];
  assert.equal(storyNeighbours(lastOf2025, across).next.id, "jan", "reading continues into the new year");
  assert.equal(storyNeighbours(firstOf2026, across).previous.id, "dec", "and back out of it");
});

test("2025 and 2026 read as one sequence, not two", () => {
  const spread = [story("a", "2025-03-02 00:00:00+00"), story("b", "2025-11-13 00:00:00+00"), story("c", "2026-01-20 00:00:00+00"), story("d", "2026-08-28 00:00:00+00")];
  const walked = ["a"];
  let at = spread[0];
  while (true) {
    const { next } = storyNeighbours(at, spread);
    if (!next) break;
    walked.push(next.id);
    at = next;
  }
  assert.deepEqual(walked, ["a", "b", "c", "d"], "walking 下一篇 from the first story reaches every story once");
});

// The importer dates a story by its calendar day, so two stories about the same day carry the same
// timestamp. Without a tie-break their order is whatever order the rows arrived in, and the two
// pages could point at each other from both sides.
test("two stories on the same timestamp keep one stable order", () => {
  const first = story("day-a", "2026-05-05 00:00:00+00");
  const second = story("day-b", "2026-05-05 00:00:00+00");
  assert.equal(storyNeighbours(first, [first, second]).next.id, "day-b");
  assert.equal(storyNeighbours(second, [first, second]).previous.id, "day-a");
  // The same answer whichever order the caller happened to hand them over in.
  assert.equal(storyNeighbours(first, [second, first]).next.id, "day-b");
  assert.equal(storyNeighbours(second, [second, first]).previous.id, "day-a");
});

test("nothing outside the set the caller passed can become a neighbour", () => {
  // The caller passes only publishable, non-private stories; a draft simply is not in the list.
  const { previous, next } = storyNeighbours(JULY, [JUNE, AUGUST]);
  assert.equal(previous.id, "jun");
  assert.equal(next.id, "aug");
  const draftHidden = storyNeighbours(JULY, [JUNE]);
  assert.equal(draftHidden.next, undefined, "with the later story withheld, there is no 下一篇 to offer");
});

test("a story outside the public set still finds its place without being duplicated", () => {
  // A private story opened by its own URL: it is not in `others`, but it still sits between them.
  const privateOne = story("hidden", "2026-07-20 00:00:00+00");
  const { previous, next } = storyNeighbours(privateOne, ALL);
  assert.equal(previous.id, "jul");
  assert.equal(next.id, "aug");
});

test("a story listed in both places is not its own neighbour", () => {
  const { previous, next } = storyNeighbours(JULY, [JUNE, JULY, JULY, AUGUST]);
  assert.equal(previous.id, "jun");
  assert.equal(next.id, "aug");
});
