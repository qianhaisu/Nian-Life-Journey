// The cover's second voice (lib/home-view.ts selectRecentMoment): when no organized memory is
// recent but recent published life exists, the front page answers "最近怎么样" with ONE moment —
// a text-led day or one strong photographed day with a visual center — never a contact sheet of
// days × photos. Runs the real read layer (composeFamilyArchive → buildHomeView) with an injected
// clock, like test/time-truth.test.mjs.
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView } from "../lib/home-view.ts";

const BIRTH = "2025-01-03";
// 2026-09-02 10:00 in Asia/Shanghai.
const TODAY = new Date("2026-09-02T02:00:00Z");

function event(id, occurredAt, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", ...extra };
}

// One deliverable photograph: media row + asset + ready web derivative. `trusted` mirrors the
// production Quark album import: the media row points at a family_photo RawSource.
function shot(id, takenAt, { deliverable = true, width = 1600, height = 1200, trusted = true } = {}) {
  return {
    media: { id, profileId: CANONICAL_PROFILE_ID, mediaAssetId: `asset-${id}`, rawSourceId: trusted ? `raw-${id}` : undefined, type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", width, height },
    asset: { id: `asset-${id}`, profileId: CANONICAL_PROFILE_ID, mediaType: "photo", mimeType: "image/jpeg", createdAt: takenAt },
    location: { id: `loc-${id}`, mediaAssetId: `asset-${id}`, provider: "hot", variant: deliverable ? "web" : "original", providerRef: `media/${id}/web`, status: deliverable ? "ready" : "awaiting_archive", createdAt: takenAt, updatedAt: takenAt },
    rawSource: trusted ? { id: `raw-${id}`, profileId: CANONICAL_PROFILE_ID, sourceType: "family_photo", contentTypes: ["family"], contributorId: "c", capturedAt: takenAt, importedAt: takenAt, mediaIds: [id], sourceLabel: "Quark 相册", visibility: "family", status: "organized" } : undefined,
  };
}

function store(shots, { events = [], rawSources = [], dailyTraces = [] } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], connectorStates: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [],
    dailyTraces, growthRecords: [], monthlySnapshots: [],
    media: shots.map((item) => item.media), mediaAssets: shots.map((item) => item.asset), mediaLocations: shots.map((item) => item.location),
    events, rawSources: [...rawSources, ...shots.map((item) => item.rawSource).filter(Boolean)],
  };
}

const home = (s, now = TODAY) => buildHomeView(composeFamilyArchive(s, s.events, now));

// The production shape of 2026-09: newest memory 2025-08, 100+ deliverable trusted August 2026 photos.
function productionShape() {
  const shots = [];
  for (let day = 20; day <= 28; day += 1) {
    for (let n = 0; n < 3; n += 1) shots.push(shot(`p-${day}-${n}`, `2026-08-${day}T0${n + 2}:00:00.000Z`));
  }
  return store(shots, { events: [event("stand", "2025-08-11 00:00:00+00")] });
}

test("production shape: ONE recent photographed day carries the cover with a hero; the stale memory moves below, no apology", () => {
  const view = home(productionShape());
  assert.equal(view.cover.kind, "moment", "recent trusted photography exists → one moment carries the cover");
  const { moment, moreDayCount } = view.cover.cover;
  assert.equal(moment.kind, "photo_led");
  assert.equal(moment.day, "2026-08-28", "the newest strong day, not three days of grid");
  assert.ok(moment.hero, "the cover has a visual center");
  assert.ok(moment.supporting.length <= 2, "a few supporting frames, not a wall");
  assert.equal(moreDayCount, 8, "9 photographed days, 1 on the cover");
  assert.equal(view.mark, "2026 年 8 月 · 最近");
  assert.equal(view.pastLead.memory.id, "stand", "the stale memory is still offered below the cover");
  assert.equal(view.laterLifeNote, undefined, "the newer life is on the page, not apologised for");
});

test("a recent memory always beats the photo moment", () => {
  const s = productionShape();
  s.events.push(event("recent", "2026-08-20 00:00:00+00"));
  const view = home(s);
  assert.equal(view.cover.kind, "memory");
  assert.equal(view.cover.lead.memory.id, "recent");
});

test("a recent text-led day (published trace with real words) outranks a strong photo day", () => {
  const s = productionShape();
  s.dailyTraces.push({ id: "t", profileId: CANONICAL_PROFILE_ID, occurredAt: "2026-08-25 00:00:00", entries: ["晚上自己吃完了半碗饭", "这一天留下了 3 张照片。"], sourceIds: [], scopes: ["family"], visibility: "family" });
  const view = home(s);
  assert.equal(view.cover.kind, "moment");
  assert.equal(view.cover.cover.moment.kind, "text_led");
  assert.deepEqual(view.cover.cover.moment.text, ["晚上自己吃完了半碗饭"], "real words lead; archive-count sentences never render as life");
});

test("old photography does not fake a recent cover, and the apology returns", () => {
  const s = store(
    [shot("old-1", "2025-08-12T08:00:00.000Z"), shot("old-2", "2025-08-13T08:00:00.000Z")],
    { events: [event("stand", "2025-08-11 00:00:00+00")], rawSources: [{ id: "s1", profileId: CANONICAL_PROFILE_ID, sourceType: "wechat", contentTypes: ["daily"], contributorId: "c", capturedAt: "2026-08-31T12:00:00Z", importedAt: "2026-08-31T12:00:00Z", mediaIds: [], sourceLabel: "wechat", visibility: "family", status: "organized" }] },
  );
  const view = home(s);
  assert.equal(view.cover.kind, "dated", "2025 photos are not 最近 on 2026-09-02");
  assert.equal(view.laterLifeNote, "2026 年 8 月还有新的生活留在档案里，只是还没有整理成一段记忆。");
});

test("withheld photography cannot carry the cover", () => {
  const s = store([shot("w1", "2026-08-28T08:00:00.000Z", { deliverable: false }), shot("w2", "2026-08-27T08:00:00.000Z", { deliverable: false })]);
  assert.equal(home(s).cover.kind, "empty", "undeliverable pictures are withheld from the cover like everywhere else");
});

test("sticker-sized images never make the cover", () => {
  const s = store([shot("tiny", "2026-08-28T08:00:00.000Z", { width: 90, height: 120 })]);
  assert.equal(home(s).cover.kind, "empty");
});

test("untrusted, unbound chat images cannot be the cover's hero — the cover falls back rather than guess", () => {
  const s = store(
    [shot("wx-1", "2026-08-28T08:00:00.000Z", { trusted: false }), shot("wx-2", "2026-08-27T09:00:00.000Z", { trusted: false })],
    { events: [event("stand", "2025-08-11 00:00:00+00")] },
  );
  const view = home(s);
  assert.equal(view.cover.kind, "dated", "big but unvouched pictures do not become the face of 最近");
});

test("a burst cannot dominate the cover: twelve rapid frames lend one representative", () => {
  const shots = [];
  for (let n = 0; n < 12; n += 1) shots.push(shot(`burst-${n}`, `2026-08-28T08:00:${String(n * 4).padStart(2, "0")}.000Z`));
  const view = home(store(shots, { events: [event("stand", "2025-08-11 00:00:00+00")] }));
  assert.equal(view.cover.kind, "moment");
  const { moment } = view.cover.cover;
  assert.ok(moment.hero, "the burst is represented");
  assert.equal(moment.supporting.length, 0, "one scene, one frame — the rest stay in the archive");
  assert.equal(moment.morePhotoCount, 11);
});
