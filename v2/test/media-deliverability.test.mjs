// Publication eligibility vs archive truth for pictures (lib/media/deliverability.ts).
//
// visibility=family says the household may see a picture; a `ready` hot derivative says a page can
// actually deliver it. These tests pin the production failure modes found on 2026-09-03: 164 of
// 1153 media rows (all 121 videos among them) had no ready derivative and would have been silently
// counted-but-invisible; and 2026-02, whose 20 photos were all withheld, must not lose its chapter
// when other life evidence exists. Nothing in the read path may rewrite the rows either — withheld
// is not missing.
import test from "node:test";
import assert from "node:assert/strict";
import { deliverableMediaIds, publishableMedia } from "../lib/media/deliverability.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { findMonth } from "../lib/memory-chapters.ts";

const PROFILE = "profile-zhangnian"; // CANONICAL_PROFILE_ID — rows of any other id are scoped out

function media(id, overrides = {}) {
  return { id, profileId: PROFILE, mediaAssetId: `asset-${id}`, type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt: "2026-02-10T08:00:00.000Z", visibility: "family", width: 1920, height: 1080, ...overrides };
}
function asset(id, overrides = {}) {
  return { id: `asset-${id}`, profileId: PROFILE, mediaType: "photo", mimeType: "image/jpeg", createdAt: "2026-02-10T08:00:00.000Z", ...overrides };
}
function location(id, variant, status, overrides = {}) {
  return { id: `loc-${id}-${variant}`, mediaAssetId: `asset-${id}`, provider: "hot", variant, providerRef: `media/${id}/${variant}`, status, createdAt: "2026-02-10T08:00:00.000Z", updatedAt: "2026-02-10T08:00:00.000Z", ...overrides };
}
function trace(id, occurredAt) {
  return { id, profileId: PROFILE, occurredAt, entries: ["托班户外活动"], sourceIds: [], scopes: ["family"], visibility: "family" };
}

function buildStore({ mediaRows = [], assets = [], locations = [], traces = [] } = {}) {
  return {
    profile: { id: PROFILE, displayName: "张年", birthDate: "2025-01-03", timezone: "Asia/Shanghai", bio: "", visibility: "family" },
    contributors: [], media: mediaRows, mediaAssets: assets, mediaLocations: locations, connectorStates: [],
    rawSources: [], events: [], dailyTraces: traces, growthRecords: [], careRecords: [], careEpisodes: [],
    monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], qualityReviews: [], links: [],
  };
}

test("ready web or ready thumbnail publishes a photo; a pending-only asset does not", () => {
  const rows = [media("web-ok"), media("thumb-ok"), media("pending")];
  const assets = [asset("web-ok"), asset("thumb-ok"), asset("pending", { archiveStatus: "awaiting_archive" })];
  const locations = [
    location("web-ok", "web", "ready"),
    location("thumb-ok", "thumbnail", "ready"),
    // the production shape of the 164: an original waiting for archive, no derivative at all
    location("pending", "original", "awaiting_archive"),
  ];
  const ids = deliverableMediaIds({ media: rows, mediaAssets: assets, mediaLocations: locations });
  assert.deepEqual([...ids].sort(), ["thumb-ok", "web-ok"]);
});

test("a video with no ready poster is not published or counted; one with a poster is", () => {
  const rows = [media("vid-bare", { type: "video" }), media("vid-poster", { type: "video" })];
  const assets = [asset("vid-bare", { mediaType: "video" }), asset("vid-poster", { mediaType: "video" })];
  const locations = [
    // the production shape of the 121 videos: a ready ORIGINAL exists, but originals are never page URLs
    location("vid-bare", "original", "ready", { provider: "wechat" }),
    location("vid-poster", "poster", "ready"),
  ];
  const archive = composeFamilyArchive(buildStore({ mediaRows: rows, assets, locations }), []);
  const month = findMonth(archive.chapters, "2026-02");
  assert.equal(month.videoCount, 1, "only the deliverable video is counted");
  assert.equal(month.withheldMediaCount, 1);
  assert.deepEqual(archive.media.map((item) => item.id), ["vid-poster"]);
});

test("a family page never counts or lays out media the delivery route would 404", () => {
  const rows = [media("shown-1"), media("shown-2"), media("hidden", { takenAt: "2026-02-11T09:00:00.000Z" })];
  const assets = [asset("shown-1"), asset("shown-2"), asset("hidden")];
  const locations = [
    location("shown-1", "web", "ready"), location("shown-1", "thumbnail", "ready"),
    location("shown-2", "web", "ready"),
    location("hidden", "original", "awaiting_archive"),
  ];
  const archive = composeFamilyArchive(buildStore({ mediaRows: rows, assets, locations }), []);
  const month = findMonth(archive.chapters, "2026-02");
  assert.equal(month.photoCount, 2);
  assert.equal(month.withheldMediaCount, 1);
  assert.ok(month.photos.every((item) => item.id.startsWith("shown-")));
  assert.ok(month.photoDays.every((day) => day.photos.every((item) => item.id.startsWith("shown-"))), "photoDays carry deliverable pictures only");
  assert.equal(month.photoDays.length, 1, "the day whose only photo is withheld is not listed as photographed");
});

test("a month whose media is all withheld still exists when other life evidence exists", () => {
  const rows = [media("feb-1"), media("feb-2")];
  const assets = [asset("feb-1"), asset("feb-2")];
  const locations = [location("feb-1", "original", "awaiting_archive"), location("feb-2", "original", "awaiting_archive")];
  const archive = composeFamilyArchive(buildStore({ mediaRows: rows, assets, locations, traces: [trace("t1", "2026-02-10 00:00:00")] }), []);
  const month = findMonth(archive.chapters, "2026-02");
  assert.ok(month, "chapter existence is archive truth, not delivery state");
  assert.equal(month.traceDays.length, 1);
  assert.equal(month.photoCount, 0, "nothing undeliverable is counted");
  assert.equal(month.photos.length, 0);
  assert.equal(month.withheldMediaCount, 2, "withheld, not missing");
});

test("a photographed month with zero text evidence also exists", () => {
  const rows = [media("only-photos")];
  const assets = [asset("only-photos")];
  const locations = [location("only-photos", "web", "ready")];
  const archive = composeFamilyArchive(buildStore({ mediaRows: rows, assets, locations }), []);
  const month = findMonth(archive.chapters, "2026-02");
  assert.ok(month, "photographs alone are life evidence enough for a chapter");
  assert.equal(month.photoCount, 1);
});

test("private media never publishes, deliverable or not", () => {
  const rows = [media("private-1", { visibility: "private" })];
  const assets = [asset("private-1")];
  const locations = [location("private-1", "web", "ready")];
  const archive = composeFamilyArchive(buildStore({ mediaRows: rows, assets, locations }), []);
  assert.equal(archive.media.length, 0);
  assert.equal(findMonth(archive.chapters, "2026-02"), undefined, "a month only a private photo could form does not exist for the family");
  const published = publishableMedia({ media: rows, mediaAssets: assets, mediaLocations: locations });
  assert.equal(published.length, 0);
});

test("eligibility is read-only: store rows, statuses and archive-level totals are untouched", () => {
  const rows = [media("keep-1"), media("keep-2", { visibility: "private" }), media("keep-3", { type: "video" })];
  const assets = [asset("keep-1"), asset("keep-2"), asset("keep-3", { mediaType: "video", archiveStatus: "awaiting_archive" })];
  const locations = [location("keep-1", "web", "ready"), location("keep-2", "web", "ready"), location("keep-3", "original", "awaiting_archive")];
  const store = buildStore({ mediaRows: rows, assets, locations });
  const before = JSON.stringify({ media: store.media, mediaAssets: store.mediaAssets, mediaLocations: store.mediaLocations });
  composeFamilyArchive(store, []);
  deliverableMediaIds(store);
  publishableMedia(store);
  assert.equal(JSON.stringify({ media: store.media, mediaAssets: store.mediaAssets, mediaLocations: store.mediaLocations }), before, "no row, status, visibility or identity is modified");
  assert.equal(store.media.length, 3, "admin/archive views still see every row");
});
