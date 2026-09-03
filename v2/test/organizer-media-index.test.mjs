import test from "node:test";
import assert from "node:assert/strict";
import { buildMediaIndex } from "../lib/organizer/evidence/media-index.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";

// Media availability must come from media_locations, never from media_assets.archive_status, and
// "we did not look" must never be reported as "there is no copy".

const source = (id, opts = {}) => ({
  id, profileId: "profile-zhangnian", sourceType: "wechat", contentTypes: ["family"],
  contributorId: "contributor-system", capturedAt: opts.capturedAt ?? "2026-03-01T10:00:00.000Z",
  text: opts.text ?? "小年今天很开心", mediaIds: opts.mediaIds ?? [], sourceLabel: "conversation:test",
  visibility: "family", metadata: { senderDigest: "digest-a", recordOrdinal: 1 },
});
const build = (sources, mediaIndex) =>
  buildEvidenceWindows("conversation:test", "profile-zhangnian", sources, { dailyTraces: [], lifeEvents: [] }, mediaIndex ? { mediaIndex } : {});

// ---------------------------------------------------------------- the four production shapes

test("a working WeChat photo reports its derivative, provider, type and checksum", () => {
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:1", mediaAssetId: "asset-1", mediaType: "photo", mimeType: "image/jpeg", checksum: "sha256:" + "a".repeat(64), takenAt: "2026-03-01T10:00:00.000Z", provider: "wechat" }],
    [
      { mediaAssetId: "asset-1", provider: "wechat", variant: "original", status: "ready" },
      { mediaAssetId: "asset-1", provider: "hot", variant: "web", status: "ready" },
    ],
  );
  const entry = index.get("wechat-media:1");
  assert.equal(entry.derivative, "available");
  assert.equal(entry.original, "available");
  assert.equal(entry.provider, "wechat");
  assert.equal(entry.mediaType, "photo");
  assert.equal(entry.assetSha256, "a".repeat(64), "the sha256: prefix is stripped");
});

test("a photo with no hot derivative is unavailable for rendering but keeps its original", () => {
  // 25 WeChat assets are in exactly this state.
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:2", mediaAssetId: "asset-2", mediaType: "photo", provider: "wechat" }],
    [{ mediaAssetId: "asset-2", provider: "wechat", variant: "original", status: "ready" }],
  );
  const entry = index.get("wechat-media:2");
  assert.equal(entry.derivative, "unavailable");
  assert.equal(entry.original, "available");
});

test("a backfilled video is original-only: no derivative, no poster, still real", () => {
  // The 120 videos ingested this session. "Cannot play it yet" is not "it does not exist".
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:3", mediaAssetId: "asset-3", mediaType: "video", mimeType: "video/mp4", checksum: "b".repeat(64), takenAt: new Date("2025-05-22T01:15:14.000Z"), provider: "wechat" }],
    [{ mediaAssetId: "asset-3", provider: "wechat", variant: "original", status: "ready" }],
  );
  const entry = index.get("wechat-media:3");
  assert.equal(entry.mediaType, "video");
  assert.equal(entry.original, "available");
  assert.equal(entry.derivative, "unavailable");
  assert.equal(entry.takenAt, "2025-05-22T01:15:14.000Z");
});

test("an archived Quark photo reports quark as its provider, not hot", () => {
  const index = buildMediaIndex(
    [{ mediaId: "quark-media:1", mediaAssetId: "asset-q", mediaType: "photo", provider: null }],
    [
      { mediaAssetId: "asset-q", provider: "quark", variant: "original", status: "archived" },
      { mediaAssetId: "asset-q", provider: "hot", variant: "web", status: "ready" },
      { mediaAssetId: "asset-q", provider: "hot", variant: "thumbnail", status: "ready" },
    ],
  );
  const entry = index.get("quark-media:1");
  assert.equal(entry.provider, "quark", "hot storage is where a copy lives, not where it came from");
  assert.equal(entry.derivative, "available");
  assert.equal(entry.original, "available");
});

// ---------------------------------------------------------------- availability is not a guess

test("archive_status is never consulted — locations decide", () => {
  // Production has 904 WeChat assets stamped `awaiting_archive` that render perfectly. The row here
  // carries no status field at all, and availability is still correct, which is the point.
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:4", mediaAssetId: "asset-4", mediaType: "photo" }],
    [{ mediaAssetId: "asset-4", provider: "hot", variant: "web", status: "ready" }],
  );
  assert.equal(index.get("wechat-media:4").derivative, "available");
});

test("a failed or pending location does not count as available", () => {
  for (const status of ["archive_failed", "pending", "paused_auth_required"]) {
    const index = buildMediaIndex(
      [{ mediaId: "m", mediaAssetId: "a", mediaType: "photo" }],
      [{ mediaAssetId: "a", provider: "hot", variant: "web", status }],
    );
    assert.equal(index.get("m").derivative, "unavailable", `${status} must not be usable`);
  }
});

test("an asset with no locations at all is unavailable, not unknown", () => {
  const index = buildMediaIndex([{ mediaId: "m", mediaAssetId: "a", mediaType: "photo" }], []);
  assert.equal(index.get("m").derivative, "unavailable");
  assert.equal(index.get("m").original, "unavailable");
});

// ---------------------------------------------------------------- through the Evidence Builder

test("media absent from the index is unknown, and never a confident false", () => {
  // The regression this whole change exists for: hasHotDerivative was hardcoded false, so a caller
  // that supplied no index looked identical to one that had proven the media was missing.
  const [window] = build([source("src-1", { mediaIds: ["wechat-media:9"] })]);
  const [ref] = window.items[0].mediaRefs;
  assert.equal(ref.derivative, "unknown");
  assert.equal(ref.original, "unknown");
  assert.equal(ref.mediaType, undefined);
});

test("a supplied index reaches the evidence item intact", () => {
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:1", mediaAssetId: "asset-1", mediaType: "video", mimeType: "video/mp4", checksum: "c".repeat(64), provider: "wechat" }],
    [{ mediaAssetId: "asset-1", provider: "wechat", variant: "original", status: "ready" }],
  );
  const [window] = build([source("src-1", { mediaIds: ["wechat-media:1"] })], index);
  const [ref] = window.items[0].mediaRefs;
  assert.equal(ref.mediaId, "wechat-media:1");
  assert.equal(ref.mediaType, "video");
  assert.equal(ref.provider, "wechat");
  assert.equal(ref.assetSha256, "c".repeat(64));
  assert.equal(ref.original, "available");
  assert.equal(ref.derivative, "unavailable");
});

test("a text+video message still binds as confirmed — the tier does not read media type", () => {
  const index = buildMediaIndex(
    [{ mediaId: "wechat-media:1", mediaAssetId: "asset-1", mediaType: "video", provider: "wechat" }],
    [{ mediaAssetId: "asset-1", provider: "wechat", variant: "original", status: "ready" }],
  );
  const [window] = build([source("src-1", { text: "看他走路的样子", mediaIds: ["wechat-media:1"] })], index);
  const [binding] = window.mediaBindings;
  assert.equal(binding.tier, "confirmed");
  assert.equal(binding.mediaId, "wechat-media:1");
});
