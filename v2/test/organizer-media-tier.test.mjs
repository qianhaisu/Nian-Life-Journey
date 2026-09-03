import test from "node:test";
import assert from "node:assert/strict";
import { bindMedia, BINDING_THRESHOLD } from "../lib/organizer/evidence/media-binding.ts";
import { tierForRule, mayNarrateAsDepicting, mayAttachToMemory } from "../lib/organizer/evidence/media-tier.ts";

// Media binding tiers. The question these pin is not "how confident" but "may the Writer say this
// picture shows this moment" — and only a `confirmed` binding ever licenses that.
//
// Two tiers are declared and deliberately never produced here: day_level and month_level exist so
// that cross-source binding (Quark photo <-> WeChat story), when it is built, cannot quietly borrow
// strong_contextual. Same date is not enough; same month is not enough.

let seq = 0;
function item(text, opts = {}) {
  seq += 1;
  return {
    itemId: `item:${String(seq).padStart(24, "0")}`, sourceId: `src-${seq}`,
    sentAt: opts.sentAt ?? "2026-03-01T10:00:00.000Z",
    senderRole: "speaker-a", senderDigest: opts.senderDigest ?? "digest-a",
    text, contentTypes: ["daily"],
    mediaRefs: (opts.mediaIds ?? []).map((mediaId) => ({ mediaId, hasHotDerivative: opts.hasHotDerivative ?? false })),
    locator: { document: "d", recordOrdinal: seq }, spans: [], tier: "firsthand_observation",
  };
}
const at = (base, seconds) => new Date(Date.parse(base) + seconds * 1000).toISOString();
const T0 = "2026-03-01T10:00:00.000Z";

// ---------------------------------------------------------------- 1 & 2: same message

test("text and photo in the SAME WeChat message is confirmed", () => {
  const [binding] = bindMedia([item("小年今天自己站起来了。", { mediaIds: ["m1"] })]);
  assert.equal(binding.rule, "same_message_mixed");
  assert.equal(binding.tier, "confirmed");
  assert.equal(binding.confidence, 1);
  assert.ok(mayNarrateAsDepicting(binding.tier), "a same-message photo may be narrated as depicting");
  assert.match(binding.basis, /same message/);
});

test("a same-message binding is tier-driven, not type-driven — video would bind identically", () => {
  // There are currently ZERO videos in the archive: 122 WeChat messages reference a video file and
  // none produced a MediaAsset. This pins that the RULE does not inspect media type, so an ingested
  // video in a mixed message would reach `confirmed` by the same path a photo does — and records
  // that the tier is what changes, never the medium.
  const [binding] = bindMedia([item("看他走路的样子", { mediaIds: ["video-asset-1"] })]);
  assert.equal(binding.tier, "confirmed");
  assert.equal(binding.mediaId, "video-asset-1");
});

// ---------------------------------------------------------------- 3: adjacent stays below confirmed

test("adjacent same-speaker media is strong_contextual and never confirmed", () => {
  for (const [label, items] of [
    ["after", [item("", { mediaIds: ["m1"], sentAt: T0 }), item("刚睡醒的样子", { sentAt: at(T0, 30) })]],
    ["before", [item("刚睡醒的样子", { sentAt: T0 }), item("", { mediaIds: ["m1"], sentAt: at(T0, 30) })]],
  ]) {
    const [binding] = bindMedia(items);
    assert.equal(binding.tier, "strong_contextual", `${label}: adjacent media must not be confirmed`);
    assert.ok(binding.confidence >= BINDING_THRESHOLD, `${label}: still strong enough to attach`);
    assert.equal(mayNarrateAsDepicting(binding.tier), false, `${label}: may not be narrated as depicting`);
    assert.ok(mayAttachToMemory(binding.tier), `${label}: may still be attached`);
  }
});

test("a cross-speaker deictic guess is not attachable at all", () => {
  const items = [
    item("", { mediaIds: ["m1"], sentAt: T0, senderDigest: "digest-a" }),
    item("这个好可爱", { sentAt: at(T0, 60), senderDigest: "digest-b" }),
  ];
  const [binding] = bindMedia(items);
  assert.equal(binding.rule, "cross_sender_indicator_120s");
  assert.equal(binding.tier, "unbound", "0.55 is below threshold and a different speaker besides");
  assert.equal(mayAttachToMemory(binding.tier), false);
});

test("media with nothing near it is unbound", () => {
  const [binding] = bindMedia([item("", { mediaIds: ["m1"] })]);
  assert.equal(binding.tier, "unbound");
  assert.equal(binding.boundItemId, undefined);
  assert.equal(mayAttachToMemory(binding.tier), false);
});

test("a far-apart same-speaker message does not bind", () => {
  const items = [item("", { mediaIds: ["m1"], sentAt: T0 }), item("今天天气不错", { sentAt: at(T0, 600) })];
  const [binding] = bindMedia(items);
  assert.equal(binding.tier, "unbound", "10 minutes later is not the same conversational beat");
});

// ---------------------------------------------------------------- 4, 5, 6: day and month

test("day_level and month_level exist, and neither may be narrated or attached", () => {
  // The tiers a same-day Quark photo and a same-month photo must land in when cross-source binding
  // is built. Pinned now so that work cannot reach for strong_contextual instead.
  for (const tier of ["day_level", "month_level"]) {
    assert.equal(mayNarrateAsDepicting(tier), false, `${tier} must never be narrated as depicting`);
    assert.equal(mayAttachToMemory(tier), false, `${tier} must never be attached to a Memory`);
  }
});

test("bindMedia never produces a day_level or month_level binding today", () => {
  // Windows are built per conversation and Quark photos are family_photo sources in their own
  // conversation, so no cross-source binding exists yet. If this ever fails, cross-source binding
  // was added and needs its own safety review.
  const items = [item("小年今天很开心", { mediaIds: ["m1"] }), item("", { mediaIds: ["m2"], sentAt: at(T0, 5000) })];
  for (const binding of bindMedia(items)) {
    assert.ok(!["day_level", "month_level"].includes(binding.tier), `unexpected cross-source tier ${binding.tier}`);
  }
});

// ---------------------------------------------------------------- tier integrity

test("an unrecognised rule fails closed to unbound", () => {
  assert.equal(tierForRule("some_rule_nobody_classified"), "unbound");
  assert.equal(tierForRule(""), "unbound");
});

test("every binding carries a tier and a basis", () => {
  const items = [
    item("小年今天自己站起来了。", { mediaIds: ["m1"] }),
    item("", { mediaIds: ["m2"], sentAt: at(T0, 5000) }),
  ];
  for (const binding of bindMedia(items)) {
    assert.ok(binding.tier, "no binding may exist without a tier");
    assert.ok(binding.basis && binding.basis.length > 0, "no binding may exist without a basis");
  }
});

test("only confirmed is narratable, and narratable implies attachable", () => {
  const tiers = ["confirmed", "strong_contextual", "day_level", "month_level", "unbound"];
  assert.deepEqual(tiers.filter(mayNarrateAsDepicting), ["confirmed"]);
  for (const tier of tiers) {
    if (mayNarrateAsDepicting(tier)) assert.ok(mayAttachToMemory(tier), `${tier} narratable but not attachable`);
  }
});
