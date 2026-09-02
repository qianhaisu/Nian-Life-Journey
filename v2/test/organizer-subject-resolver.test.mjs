import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubjectBounded } from "../lib/organizer/subject-resolver.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";

const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "崽"] };
const MOTHER = senderDigestForDisplayName("阿静");
const FATHER = senderDigestForDisplayName("Ted");

const src = (o) => ({
  id: o.id, profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: o.sender ?? MOTHER,
  capturedAt: o.at, text: o.text, mediaIds: [], visibility: "family",
  metadata: { senderDigest: o.sender ?? MOTHER }, sourceLabel: "conv", contributorRole: undefined,
});
// A gap larger than the 45-minute rule splits windows, so the earlier messages become neighbours.
const build = (earlier, later) => {
  const windows = buildEvidenceWindows("conv", "p", [...earlier, ...later], { dailyTraces: [], lifeEvents: [] });
  return windows[windows.length - 1];
};
const opts = { singleChildHousehold: true, registry: FAMILY_REGISTRY };

test("a window naming the child resolves explicitly and cites the naming source", () => {
  const w = build([], [src({ id: "a", at: "2025-08-10T10:00:00+08:00", text: "张小年今天扶着墙站起来了" })]);
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "explicit");
  assert.deepEqual(r.supportingSourceIds, ["a"]);
});

test("a pronoun with a nearby antecedent and child-topic continuity resolves contextually", () => {
  const w = build(
    [src({ id: "ante", at: "2025-08-10T09:00:00+08:00", text: "张小年今天醒得早" })],
    [
      src({ id: "b1", at: "2025-08-10T11:00:00+08:00", text: "他现在好想站起来啊" }),
      src({ id: "b2", at: "2025-08-10T11:02:00+08:00", sender: FATHER, text: "各种扶墙站，手一撑，然后就起来了" }),
    ],
  );
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "contextually_resolved");
  assert.ok(r.signals.includes("explicit_antecedent_nearby"));
  assert.ok(r.supportingSourceIds.includes("ante"), "the antecedent must be auditable");
});

// The rule the product decision explicitly rejected.
test("a single-child household is never sufficient on its own", () => {
  const w = build(
    [src({ id: "ante", at: "2025-08-10T09:00:00+08:00", text: "张小年今天醒得早" })],
    [src({ id: "b1", at: "2025-08-10T11:00:00+08:00", text: "他到了没有" })],
  );
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "unresolved");
  assert.ok(r.blockers.includes("antecedent_without_corroboration"));
  assert.ok(r.signals.includes("single_child_household_prior"), "the prior may be recorded, just never decisive");
});

test("adult logistics with a pronoun and no antecedent stays unresolved", () => {
  const w = build([], [src({ id: "a", at: "2025-06-09T10:00:00+08:00", text: "他四点才能回来，你先吃" })]);
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "unresolved");
  assert.ok(r.blockers.includes("no_explicit_antecedent"));
});

test("a competing person in scope fails closed even with an antecedent and full corroboration", () => {
  const w = build(
    [src({ id: "ante", at: "2025-08-10T09:00:00+08:00", text: "张小年今天醒得早" })],
    [
      src({ id: "b1", at: "2025-08-10T11:00:00+08:00", text: "他和同学一起玩，喂了点辅食" }),
      src({ id: "b2", at: "2025-08-10T11:02:00+08:00", sender: FATHER, text: "哄睡了" }),
    ],
  );
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "unresolved");
  assert.deepEqual(r.blockers, ["competing_person_in_scope"]);
});

test("two verified caregivers continuing the discussion count as corroboration", () => {
  const w = build(
    [src({ id: "ante", at: "2025-08-10T09:00:00+08:00", text: "张小年醒了" })],
    [
      src({ id: "b1", at: "2025-08-10T11:00:00+08:00", text: "他今天特别有劲" }),
      src({ id: "b2", at: "2025-08-10T11:01:00+08:00", sender: FATHER, text: "是的，一直在动" }),
    ],
  );
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.ok(r.signals.includes("caregiver_continuity"));
  assert.equal(r.level, "contextually_resolved");
});

test("a window with no subject reference at all is unresolved, not resolved by neighbours", () => {
  const w = build(
    [src({ id: "ante", at: "2025-08-10T09:00:00+08:00", text: "张小年醒了" })],
    [src({ id: "b1", at: "2025-08-10T11:00:00+08:00", text: "快递到了吗" })],
  );
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "unresolved");
  assert.deepEqual(r.blockers, ["no_subject_reference"]);
});
