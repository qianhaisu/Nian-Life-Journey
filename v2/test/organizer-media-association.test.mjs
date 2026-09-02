import test from "node:test";
import assert from "node:assert/strict";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { crossSourceTier, mayAttachToLifeEvent, mayAppearInDayBrowsing, partitionWindowMedia, tierForBinding } from "../lib/organizer/evidence/media-association.ts";

const src = (o) => ({ id: o.id, profileId: "p", sourceType: o.sourceType ?? "wechat", contentTypes: ["family"], contributorId: "contributor-system", capturedAt: o.capturedAt, text: o.text ?? "", mediaIds: o.mediaIds ?? [], visibility: "family", metadata: { senderDigest: o.sender ?? "d1" }, sourceLabel: "conv", contributorRole: undefined });

test("a photo sent with its own text is confirmed and may be the memory's media", () => {
  assert.equal(tierForBinding({ confidence: 1, rule: "same_message_mixed" }), "confirmed");
  assert.ok(mayAttachToLifeEvent("confirmed"));
});

test("same-speaker media seconds away is strong contextual and still attachable", () => {
  assert.equal(tierForBinding({ confidence: 0.85, rule: "same_sender_after_90s" }), "strong_contextual");
  assert.equal(tierForBinding({ confidence: 0.75, rule: "same_sender_before_60s" }), "strong_contextual");
  assert.ok(mayAttachToLifeEvent("strong_contextual"));
});

test("a weak cross-sender guess is day level and must never be attached to the story", () => {
  assert.equal(tierForBinding({ confidence: 0.55, rule: "cross_sender_indicator_120s" }), "day_level");
  assert.equal(tierForBinding({ confidence: 0, rule: "unbound" }), "day_level");
  assert.equal(mayAttachToLifeEvent("day_level"), false);
  assert.ok(mayAppearInDayBrowsing("day_level"), "day-level media stays browsable");
});

// The requirement this file exists for: a separately-uploaded photo can never be promoted by a date
// match, however exact the date is.
test("cross-source media never rises above day level, whatever the timestamps say", () => {
  assert.equal(crossSourceTier({ mediaCapturedAt: "2026-08-20T09:00:00Z", eventOccurredAt: "2026-08-20T21:00:00Z" }), "day_level");
  assert.equal(crossSourceTier({ mediaCapturedAt: "2026-08-03T09:00:00Z", eventOccurredAt: "2026-08-20T09:00:00Z" }), "month_level");
  assert.equal(crossSourceTier({ mediaCapturedAt: "2026-07-30T09:00:00Z", eventOccurredAt: "2026-08-20T09:00:00Z" }), "unbound");
  assert.equal(mayAttachToLifeEvent(crossSourceTier({ mediaCapturedAt: "2026-08-20T09:00:00Z", eventOccurredAt: "2026-08-20T21:00:00Z" })), false);
  assert.equal(mayAttachToLifeEvent("month_level"), false);
});

// Two unrelated moments on one day is the case a date match gets loudly wrong: the evening photo
// must not become media for the morning story.
test("two unrelated moments on the same day keep their media apart", () => {
  const sources = [
    src({ id: "morning-text", capturedAt: "2026-08-20T09:00:00+08:00", text: "他在公园自己爬上去了", mediaIds: ["photo-park"] }),
    src({ id: "evening-text", capturedAt: "2026-08-20T20:00:00+08:00", text: "晚上在家吃辅食", mediaIds: ["photo-dinner"] }),
  ];
  const windows = buildEvidenceWindows("conv-two-moments", "p", sources, { dailyTraces: [], lifeEvents: [] });
  assert.equal(windows.length, 2, "an 11-hour gap must not be one event");
  const morning = partitionWindowMedia(windows[0].mediaBindings);
  const evening = partitionWindowMedia(windows[1].mediaBindings);
  assert.deepEqual(morning.eventMedia.map((m) => m.mediaId), ["photo-park"]);
  assert.deepEqual(evening.eventMedia.map((m) => m.mediaId), ["photo-dinner"]);
  // Neither window can reach the other's media at all, so a same-day cross-attach is impossible.
  assert.equal(morning.eventMedia.some((m) => m.mediaId === "photo-dinner"), false);
});

test("partitioning keeps weakly-bound media out of the event but still reports it", () => {
  const { eventMedia, dayLevelMedia } = partitionWindowMedia([
    { mediaId: "m-strong", confidence: 1, rule: "same_message_mixed" },
    { mediaId: "m-weak", confidence: 0.55, rule: "cross_sender_indicator_120s" },
    { mediaId: "m-none", confidence: 0, rule: "unbound" },
  ]);
  assert.deepEqual(eventMedia.map((m) => m.mediaId), ["m-strong"]);
  assert.deepEqual(dayLevelMedia.map((m) => m.mediaId), ["m-weak", "m-none"]);
});
