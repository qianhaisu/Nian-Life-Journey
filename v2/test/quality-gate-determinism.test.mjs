// The publication gate must not depend on the order rows come back from the database.
//
// Until 2026-09-13 indexReviews() was `for (…) index.set(key, decision)` over an unordered
// `select().from(contentQualityReviews)`. The unique index is (target_kind, target_id,
// prompt_version), so one artifact can legitimately hold several `life_event` rows, and which one
// won was whatever order Postgres happened to return. Production held exactly one such artifact —
// event-v2-eccbfb1e9acff375d66a9f230e74c402, approved 2026-09-05 then store_only 2026-09-11 — and
// it could have published on any given render.
//
// These tests fix the three properties that replaced it: recency decides, order never does, and a
// same-timestamp disagreement withholds instead of guessing.
import test from "node:test";
import assert from "node:assert/strict";
import {
  indexReviews,
  indexReviewsWithConflicts,
  describeReviewConflicts,
  isEventPublishable,
  isTracePublishable,
} from "../lib/organizer/quality-review.ts";

const row = (targetId, decision, reviewedAt, extra = {}) => ({
  id: `rev-${targetId}-${decision}-${reviewedAt ?? "none"}`,
  targetKind: "life_event",
  targetId,
  decision,
  reviewedAt,
  promptVersion: "test",
  policyVersion: "test",
  ...extra,
});

const aiEvent = (id) => ({ id, createdBy: "ai", organizerVersion: "deepseek-v6", visibility: "family" });

/** Every ordering of a small array — the only honest way to say "order never decides". */
function permutations(items) {
  if (items.length <= 1) return [items];
  const out = [];
  for (let i = 0; i < items.length; i += 1) {
    const rest = [...items.slice(0, i), ...items.slice(i + 1)];
    for (const tail of permutations(rest)) out.push([items[i], ...tail]);
  }
  return out;
}

test("row order never changes the answer, for every permutation", () => {
  const rows = [
    row("e1", "approved", "2026-09-05 16:49:54"),
    row("e1", "store_only", "2026-09-11 17:59:55"),
    row("e1", "needs_human_review", "2026-09-01 08:00:00"),
  ];
  const answers = new Set();
  for (const order of permutations(rows)) {
    answers.add(indexReviews(order).get("life_event:e1"));
  }
  assert.equal(answers.size, 1, `order changed the answer: ${[...answers].join(", ")}`);
  assert.equal([...answers][0], "store_only", "the most recent decision is the one that counts");
});

test("an older approved does not publish over a newer store_only", () => {
  const event = aiEvent("e1");
  const reviews = indexReviews([
    row("e1", "approved", "2026-09-05 16:49:54"),
    row("e1", "store_only", "2026-09-11 17:59:55"),
  ]);
  assert.equal(isEventPublishable(event, reviews), false);
});

test("and the reverse publishes: a newer approved supersedes an older store_only", () => {
  const event = aiEvent("e1");
  const reviews = indexReviews([
    row("e1", "store_only", "2026-09-05 16:49:54"),
    row("e1", "approved", "2026-09-11 17:59:55"),
  ]);
  assert.equal(isEventPublishable(event, reviews), true);
  // Reversing the array must not reverse the answer.
  const flipped = indexReviews([
    row("e1", "approved", "2026-09-11 17:59:55"),
    row("e1", "store_only", "2026-09-05 16:49:54"),
  ]);
  assert.equal(isEventPublishable(event, flipped), true);
});

test("the known double-row artifact resolves to its newer store_only and stays unpublished", () => {
  // Verbatim from RDS `nianlife` 2026-09-13: the only artifact of 845 carrying two `life_event`
  // rows, and the whole of the "212 approved rows / 211 approved artifacts" discrepancy.
  const id = "event-v2-eccbfb1e9acff375d66a9f230e74c402";
  const ledger = [
    { id: "r-a", targetKind: "life_event", targetId: id, decision: "approved", reviewedAt: "2026-09-05 16:49:54", promptVersion: "family-writer-v2-calibrated-r2.1", policyVersion: "quality-review-v1" },
    { id: "r-b", targetKind: "life_event", targetId: id, decision: "store_only", reviewedAt: "2026-09-11 17:59:55", promptVersion: "r11-downgrade-v1", policyVersion: "quality-review-v1" },
  ];
  for (const order of permutations(ledger)) {
    const reviews = indexReviews(order);
    assert.equal(reviews.get(`life_event:${id}`), "store_only");
    assert.equal(isEventPublishable(aiEvent(id), reviews), false, "the 2026-09-11 downgrade is what stands");
  }
});

test("a same-timestamp disagreement withholds and is reported, rather than being guessed", () => {
  const { index, conflicts } = indexReviewsWithConflicts([
    row("e1", "approved", "2026-09-11 17:59:55"),
    row("e1", "store_only", "2026-09-11 17:59:55"),
  ]);
  assert.equal(index.get("life_event:e1"), "needs_human_review", "a tie must never resolve to approved");
  assert.equal(isEventPublishable(aiEvent("e1"), index), false);
  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].decisions, ["approved", "store_only"]);
  assert.equal(conflicts[0].reviewedAt, "2026-09-11 17:59:55");
  assert.equal(conflicts[0].resolved, "needs_human_review");
  assert.match(describeReviewConflicts(conflicts)[0], /conflicting decisions/);
});

test("a tie is only a conflict when the decisions actually differ after normalization", () => {
  // Two rows, same instant, both meaning "not published" — trace_eligible is not in the union and
  // normalizes to needs_human_review, so there is nothing here for a human to arbitrate.
  const { index, conflicts } = indexReviewsWithConflicts([
    row("e1", "trace_eligible", "2026-09-11 17:59:55"),
    row("e1", "needs_human_review", "2026-09-11 17:59:55"),
  ]);
  assert.equal(index.get("life_event:e1"), "needs_human_review");
  assert.deepEqual(conflicts, [], "identical meaning is not a conflict");

  // Two identical approvals at the same instant are likewise not a conflict.
  const same = indexReviewsWithConflicts([
    row("e2", "approved", "2026-09-11 17:59:55"),
    row("e2", "approved", "2026-09-11 17:59:55"),
  ]);
  assert.equal(same.index.get("life_event:e2"), "approved");
  assert.deepEqual(same.conflicts, []);
});

test("a timestamped decision outranks one that recorded no time, in either array order", () => {
  const withTime = row("e1", "store_only", "2026-09-11 17:59:55");
  const without = row("e1", "approved", undefined);
  for (const order of [[withTime, without], [without, withTime]]) {
    assert.equal(indexReviews(order).get("life_event:e1"), "store_only");
  }
});

test("target_kind stays isolated: no other ledger kind can publish a life_event", () => {
  const event = aiEvent("e9");
  // queue169 is the 2026-09-13 review pass over 169 drafts. Its verdicts are recorded against their
  // own target_kind precisely so they cannot be mistaken for publication approvals.
  const reviews = indexReviews([
    { id: "q1", targetKind: "life_event_queue169", targetId: "e9", decision: "adopt_original", reviewedAt: "2026-09-13 00:40:43", promptVersion: "queue169-commander-2026-09-13", policyVersion: "x" },
    { id: "q2", targetKind: "life_event_queue169", targetId: "e9", decision: "approved", reviewedAt: "2026-09-13 00:40:44", promptVersion: "queue169-commander-2026-09-13b", policyVersion: "x" },
    { id: "t1", targetKind: "life_event_trace", targetId: "e9", decision: "trace_eligible", reviewedAt: "2026-09-13 00:40:43", promptVersion: "a6-trace-layer-v1", policyVersion: "x" },
    { id: "m1", targetKind: "media_binding", targetId: "e9|some-photo", decision: "approved", reviewedAt: "2026-09-13 00:40:43", promptVersion: "x", policyVersion: "x" },
  ]);
  assert.equal(reviews.get("life_event:e9"), undefined, "no life_event key was created");
  assert.equal(isEventPublishable(event, reviews), false, "AI content with no life_event row stays closed");
});

test("a daily_trace decision and a life_event decision with the same id do not cross", () => {
  const reviews = indexReviews([
    row("x1", "approved", "2026-09-11 10:00:00"),
    { id: "d1", targetKind: "daily_trace", targetId: "x1", decision: "store_only", reviewedAt: "2026-09-12 10:00:00", promptVersion: "x", policyVersion: "x" },
  ]);
  assert.equal(isEventPublishable(aiEvent("x1"), reviews), true);
  assert.equal(isTracePublishable({ id: "x1", createdBy: "ai", organizerRun: { organizerType: "ai" } }, reviews), false);
});

test("the no-row rule is unchanged: rule/AI content fails closed, human content does not", () => {
  const empty = indexReviews([]);
  assert.equal(isEventPublishable({ id: "r1", createdBy: "rule", organizerVersion: "rule-v2" }, empty), false);
  assert.equal(isEventPublishable({ id: "a1", createdBy: "ai" }, empty), false);
  assert.equal(isEventPublishable({ id: "h1", createdBy: "user" }, empty), true);
});
