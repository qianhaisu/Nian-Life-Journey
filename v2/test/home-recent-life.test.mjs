// The cover's second voice (lib/home-view.ts selectRecentLife): when no organized memory is
// recent but photographed life is, the front page answers "最近怎么样" with the newest days
// instead of a year-old story plus an apology. Runs the real read layer
// (composeFamilyArchive → buildHomeView) with an injected clock, like test/time-truth.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView, RECENT_LIFE_DAYS, RECENT_LIFE_PHOTOS_PER_DAY, selectRecentLife } from "../lib/home-view.ts";

const BIRTH = "2025-01-03";
// 2026-09-02 10:00 in Asia/Shanghai.
const TODAY = new Date("2026-09-02T02:00:00Z");

function event(id, occurredAt, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", ...extra };
}

// One deliverable photograph: media row + asset + ready web derivative.
function shot(id, takenAt, { deliverable = true, width = 1600, height = 1200 } = {}) {
  return {
    media: { id, profileId: CANONICAL_PROFILE_ID, mediaAssetId: `asset-${id}`, type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", width, height },
    asset: { id: `asset-${id}`, profileId: CANONICAL_PROFILE_ID, mediaType: "photo", mimeType: "image/jpeg", createdAt: takenAt },
    location: { id: `loc-${id}`, mediaAssetId: `asset-${id}`, provider: "hot", variant: deliverable ? "web" : "original", providerRef: `media/${id}/web`, status: deliverable ? "ready" : "awaiting_archive", createdAt: takenAt, updatedAt: takenAt },
  };
}

function store(shots, { events = [], rawSources = [] } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], connectorStates: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [],
    dailyTraces: [], growthRecords: [], monthlySnapshot: null,
    media: shots.map((item) => item.media), mediaAssets: shots.map((item) => item.asset), mediaLocations: shots.map((item) => item.location),
    events, rawSources,
  };
}

const home = (s, now = TODAY) => buildHomeView(composeFamilyArchive(s, s.events, now));

// The production shape of 2026-09-03: newest memory 2025-08, 100+ deliverable August 2026 photos.
function productionShape() {
  const shots = [];
  for (let day = 20; day <= 28; day += 1) {
    for (let n = 0; n < 3; n += 1) shots.push(shot(`p-${day}-${n}`, `2026-08-${day}T0${n + 2}:00:00.000Z`));
  }
  return store(shots, { events: [event("stand", "2025-08-11 00:00:00+00")] });
}

test("production shape: recent photographed days carry the cover, the stale memory moves below, no apology", () => {
  const view = home(productionShape());
  assert.ok(view.recentLife, "recent deliverable photography exists → life carries the cover");
  assert.equal(view.mark, "2026 年 8 月 · 最近");
  assert.equal(view.recentLife.month.month, "2026-08");
  assert.equal(view.recentLife.days.length, RECENT_LIFE_DAYS);
  assert.equal(view.recentLife.days[0].day, "2026-08-28", "newest day first");
  assert.ok(view.recentLife.days.every((day) => day.photos.length <= RECENT_LIFE_PHOTOS_PER_DAY));
  const first = view.recentLife.days[0].photos;
  assert.deepEqual(first.map((photo) => photo.id), ["p-28-0", "p-28-1", "p-28-2"], "within a day, pictures read in the order taken");
  assert.equal(view.recentLife.moreDayCount, 6, "9 photographed days, 3 on the cover");
  assert.equal(view.lead.memory.id, "stand", "the stale memory is still offered below the cover");
  assert.equal(view.laterLifeNote, undefined, "the newer life is on the page, not apologised for");
});

test("a recent memory always beats the contact sheet", () => {
  const s = productionShape();
  s.events.push(event("recent", "2026-08-20 00:00:00+00"));
  const view = home(s);
  assert.equal(view.recentLife, undefined);
  assert.equal(view.lead.memory.id, "recent");
  assert.equal(view.lead.recent, true);
});

test("old photography does not fake a recent cover, and the apology returns", () => {
  const s = store(
    [shot("old-1", "2025-08-12T08:00:00.000Z"), shot("old-2", "2025-08-13T08:00:00.000Z")],
    { events: [event("stand", "2025-08-11 00:00:00+00")], rawSources: [{ id: "s1", profileId: CANONICAL_PROFILE_ID, sourceType: "wechat", contentTypes: ["daily"], contributorId: "c", capturedAt: "2026-08-31T12:00:00Z", importedAt: "2026-08-31T12:00:00Z", mediaIds: [], sourceLabel: "wechat", visibility: "family", status: "organized" }] },
  );
  const view = home(s);
  assert.equal(view.recentLife, undefined, "2025 photos are not 最近 on 2026-09-02");
  assert.equal(view.laterLifeNote, "2026 年 8 月还有新的生活留在档案里，只是还没有整理成一段记忆。");
});

test("withheld photography cannot carry the cover", () => {
  const s = store([shot("w1", "2026-08-28T08:00:00.000Z", { deliverable: false }), shot("w2", "2026-08-27T08:00:00.000Z", { deliverable: false })]);
  assert.equal(home(s).recentLife, undefined, "undeliverable pictures are withheld from the cover like everywhere else");
});

test("sticker-sized images never make the cover", () => {
  const s = store([shot("tiny", "2026-08-28T08:00:00.000Z", { width: 90, height: 120 })]);
  const archive = composeFamilyArchive(s, [], TODAY);
  assert.equal(selectRecentLife(archive.chapters, archive.time), undefined);
});
