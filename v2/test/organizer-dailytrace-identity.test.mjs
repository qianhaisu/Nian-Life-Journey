// DailyTrace artifact identity vs. calendar-day presentation grouping.
//
// The repository half of this contract is pinned in test/repository-contract.test.mjs (it needs a
// real backend). This file pins the two consequences that decide whether the evidence organizer can
// be cut over at all:
//
//   1. the publication state a merge would have handed the new artifact, and
//   2. that the read layer still shows one day as one day once several artifacts share it.
//
// The numbers in the comments come from the read-only production audit in
// scripts/organizer-trace-provenance-audit.mjs, run 2026-09-03.
import test from "node:test";
import assert from "node:assert/strict";
import { indexReviews, isTracePublishable, requiresQualityReview } from "../lib/organizer/quality-review.ts";
import { buildChapters } from "../lib/memory-chapters.ts";

const PROFILE_ID = "profile-zhangnian";
const DAY = "2025-05-27";

const trace = (id, overrides = {}) => ({
  id, profileId: PROFILE_ID, occurredAt: `${DAY}T12:00:00`, entries: [], sourceIds: [],
  scopes: ["family"], visibility: "family", organizationFingerprint: `fp-${id}`, ...overrides,
});
const ruleTrace = (id, overrides = {}) => trace(id, { organizerRun: { organizerType: "rule", organizerVersion: "rule-v2" }, ...overrides });
const evidenceTrace = (id, overrides = {}) => trace(id, { organizerRun: { organizerType: "ai", organizerVersion: "evidence-v6" }, ...overrides });
const review = (targetId, decision) => ({ targetKind: "daily_trace", targetId, decision });

test("a rule trace with no ledger row is hidden, and that is the only thing hiding it", () => {
  // 101 of 171 production traces are in exactly this state.
  const legacy = ruleTrace("trace-legacy");
  assert.equal(requiresQualityReview(legacy), true);
  assert.equal(isTracePublishable(legacy, indexReviews([])), false);
});

test("REGRESSION: overwriting a legacy trace's organizerRun with an AI run publishes it", () => {
  // This is the merge that persistDailyTrace() used to perform, expressed as its effect on the
  // publication gate. It is asserted rather than described so that anyone reintroducing a
  // day-based merge sees precisely what they are turning back on.
  const legacy = ruleTrace("trace-legacy", { entries: ["legacy entry"] });
  const reviews = indexReviews([]);
  assert.equal(isTracePublishable(legacy, reviews), false);

  const afterMerge = { ...legacy, organizerRun: { organizerType: "ai", organizerVersion: "evidence-v6" } };
  assert.equal(
    isTracePublishable(afterMerge, reviews),
    true,
    "a merged legacy row publishes itself: rule provenance was the whole gate",
  );
});

test("REGRESSION: merging into an approved legacy trace publishes unreviewed evidence entries", () => {
  // 33 production traces carry an `approved` row. The merge kept the legacy row's id, so the
  // ledger lookup still hit `approved` while the entries were new and unreviewed.
  const legacy = ruleTrace("trace-approved", { entries: ["reviewed entry"] });
  const reviews = indexReviews([review("trace-approved", "approved")]);
  assert.equal(isTracePublishable(legacy, reviews), true);

  const afterMerge = { ...legacy, entries: [...legacy.entries, "unreviewed evidence entry"] };
  assert.equal(isTracePublishable(afterMerge, reviews), true);
  assert.ok(afterMerge.entries.includes("unreviewed evidence entry"), "…carrying content nobody approved");
});

test("a separate evidence artifact inherits no review state from the day's legacy trace", () => {
  const legacy = ruleTrace("trace-legacy");
  const evidence = evidenceTrace("trace-evidence");
  const reviews = indexReviews([review("trace-legacy", "approved")]);

  assert.equal(isTracePublishable(legacy, reviews), true, "the legacy artifact keeps its approval");
  assert.equal(
    reviews.get(`daily_trace:${evidence.id}`),
    undefined,
    "the new artifact has its own ledger key, so the approval cannot reach it",
  );
});

test("an explicit gating row holds an evidence trace back even though AI provenance fails open", () => {
  // AI-derived content is not fail-closed: with no ledger row at all, an evidence trace publishes.
  // That is why canary-created artifacts must be written together with a gating row.
  const evidence = evidenceTrace("trace-evidence");
  assert.equal(requiresQualityReview(evidence), false);
  assert.equal(isTracePublishable(evidence, indexReviews([])), true, "no row means published — the fail-open");
  assert.equal(isTracePublishable(evidence, indexReviews([review("trace-evidence", "needs_human_review")])), false);
});

test("several trace artifacts on one day render as one day", () => {
  const traces = [
    ruleTrace("trace-legacy", { entries: ["legacy entry"] }),
    evidenceTrace("trace-evidence", { entries: ["evidence entry"] }),
  ];
  const chapters = buildChapters({ events: [], traces, media: [], birthDay: "2025-01-01" });
  const traceDays = chapters.flatMap((year) => year.months ?? []).flatMap((month) => month.traceDays ?? []);
  const onDay = traceDays.filter((item) => item.day === DAY);
  assert.equal(onDay.length, 1, "the family sees one 2025-05-27, not two");
  assert.deepEqual(onDay[0].entries.sort(), ["evidence entry", "legacy entry"]);
});
