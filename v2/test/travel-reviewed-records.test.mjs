import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeReviewedTravelRecords } from "../lib/travel/reviewed-records.ts";

const trip = { id: "codex-2026-09-xian", title: "回西安看爷爷奶奶", kind: "hometown", from: "2026-09-28", to: "2026-10-03",
 placeIds: ["cn-sn-xian"], summary: "在爷爷奶奶家住了几天。", evidence: ["已核对原始到达和离开消息"] };
const reviewed = { ...trip, reviewStatus: "approved", reviewedBy: "codex", visibility: "public", childPresent: true,
 reviewedAt: "2026-10-12T08:00:00Z", sourceFingerprints: [{ id: "wechat-message:canonical:test", sha256: "a".repeat(64) }] };
const month = (record) => ({ month: "2026-09", travelRecords: [record], days: [] });
const merge = (record, existing = []) => mergeReviewedTravelRecords([month(record)], existing, "2026-10-12");

test("confirmed cross-month stay replaces only its automatic day record", () => {
 const auto = { ...trip, id: "record-2026-09-28-cn-sn-xian", to: "2026-09-28", recordOnly: true };
 const curated = { ...auto, id: "curated", recordOnly: false };
 const result = merge(reviewed, [auto, curated]);
 assert.deepEqual(new Set(result.map((r) => r.id)), new Set([trip.id, "curated"]));
 assert.deepEqual(result.find((r) => r.id === "curated"), curated);
 assert.equal(result.find((r) => r.id === trip.id).sourceFingerprints, undefined);
});
test("plans, parent-only trips, private content and absent evidence cannot become travel", () => {
 for (const patch of [{ reviewStatus: "draft" }, { childPresent: false }, { visibility: "private" }, { reviewedBy: "unknown" },
 { sourceFingerprints: [] }, { sourceFingerprints: [{ id: "not-source", sha256: "a".repeat(64) }] }, { reviewedAt: "bad" }]) {
  assert.throws(() => merge({ ...reviewed, ...patch }));
 }
});
test("unknown place, invalid date, future journey and duplicate id fail closed", () => {
 for (const patch of [{ placeIds: ["unconfirmed-place"] }, { from: "2026-09-31" }, { to: "2026-10-13" }]) {
  assert.throws(() => merge({ ...reviewed, ...patch }));
 }
 assert.throws(() => merge(reviewed, [trip]));
 assert.throws(() => mergeReviewedTravelRecords([month(reviewed), month(reviewed)], [], "2026-10-12"));
 assert.throws(() => mergeReviewedTravelRecords([{ ...month(reviewed), month: "2026-10" }], [], "2026-10-12"));
});
test("existing travels remain equal when there are no new reviewed records", () => {
 assert.deepEqual(mergeReviewedTravelRecords([{ month: "2026-10", days: [] }], [trip], "2026-10-12"), [trip]);
});
