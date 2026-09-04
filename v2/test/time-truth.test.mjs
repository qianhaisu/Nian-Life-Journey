// Time truth: the front page, the growth notes and "现在" must live in the same real world as the
// memory timeline. Every case below runs the real read layer (composeFamilyArchive → buildHomeView)
// over a deterministic in-memory store, with "today" injected — no backend, no clock, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView } from "../lib/home-view.ts";
import { latestGrowthNote, recentGrowthNotes } from "../lib/growth-notes.ts";
import { buildChapters } from "../lib/memory-chapters.ts";
import { ageOn } from "../lib/time-signature.ts";
import { isRecent, latestActivityDay, monthsBetween, productToday, RECENT_ACTIVITY_MONTH_GAP, RECENT_CALENDAR_MONTH_GAP, selectHomeLead } from "../lib/time-truth.ts";

const BIRTH = "2025-01-03";
// 2026-09-02 10:00 in Asia/Shanghai.
const TODAY = new Date("2026-09-02T02:00:00Z");

function event(id, occurredAt, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", createdAt: `${occurredAt}T00:00:00.000Z`, ...extra };
}
function trace(id, occurredAt) {
  return { id, profileId: CANONICAL_PROFILE_ID, occurredAt, entries: [{ text: "平常的一天" }], sourceIds: [], scopes: ["family"], visibility: "family" };
}
function source(id, capturedAt, importedAt = capturedAt) {
  return { id, profileId: CANONICAL_PROFILE_ID, sourceType: "wechat_message", contentTypes: ["family"], contributorId: "contributor-dad", capturedAt, importedAt, mediaIds: [], sourceLabel: "wechat", visibility: "family", status: "organized" };
}
function photo(id, capturedAt) {
  return { id, profileId: CANONICAL_PROFILE_ID, kind: "photo", url: `/media/${id}.jpg`, alt: "", capturedAt, contentTypes: ["family"], contributorId: "contributor-dad", visibility: "family", sourceId: `${id}-source`, orientation: "landscape", derivatives: { original: `/media/${id}.jpg`, web: `/media/${id}.jpg`, thumb: `/media/${id}.jpg` } };
}
function store({ events = [], dailyTraces = [], rawSources = [], media = [], growthRecords = [], monthlySnapshot = null } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], mediaAssets: [], mediaLocations: [], connectorStates: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [],
    events, dailyTraces, rawSources, media, growthRecords, monthlySnapshot,
  };
}
// The page read: getAllEvents() is the publishable event list; the store is the backend view.
const home = (s, now = TODAY) => buildHomeView(composeFamilyArchive(s, s.events, now));
// The memory behind the cover, whether it is presented as recent or dated; undefined for a moment
// cover or an empty cover — the shape assertions below say which kind they expect.
const leadOf = (view) => (view.cover.kind === "memory" || view.cover.kind === "dated" ? view.cover.lead : undefined);

test("productToday is the Asia/Shanghai calendar day, never the UTC date", () => {
  assert.equal(productToday(new Date("2026-09-01T16:00:00Z")), "2026-09-02");
  assert.equal(productToday(new Date("2026-09-01T15:59:00Z")), "2026-09-01");
  assert.equal(monthsBetween("2025-08-11", "2026-09-02"), 13);
  assert.equal(monthsBetween("2026-08", "2026-09"), 1);
  assert.equal(monthsBetween("2026-09", "2026-08"), -1);
});

test("the recency contract: not left behind by newer activity, not too far behind today (tunable policy)", () => {
  assert.equal(RECENT_ACTIVITY_MONTH_GAP, 1);
  assert.equal(RECENT_CALENDAR_MONTH_GAP, 2);
  const ref = { today: "2026-09-02", activityDay: "2026-08-31" };
  assert.equal(isRecent("2026-08-20", ref), true);
  assert.equal(isRecent("2026-07-28", ref), true, "one month behind activity is still recent");
  assert.equal(isRecent("2026-06-30", ref), false, "two months behind activity is not");
  assert.equal(isRecent("2025-08-11", ref), false);
  assert.equal(isRecent(undefined, ref), false);
  // No activity known: only today counts.
  assert.equal(isRecent("2026-07-01", { today: "2026-09-02" }), true);
  assert.equal(isRecent("2026-06-01", { today: "2026-09-02" }), false);
  // Life paused: nothing newer exists, but a memory cannot stay "最近" forever.
  assert.equal(isRecent("2026-08-20", { today: "2027-01-10", activityDay: "2026-08-31" }), false);
});

test("latestActivityDay is life time: capturedAt, never importedAt; deleted sources do not count", () => {
  const day = latestActivityDay({
    rawSources: [source("s1", "2023-03-04T02:00:00Z", "2026-09-01T00:00:00Z"), source("s2", "2026-08-31T15:00:00Z"), { ...source("s3", "2026-09-30T00:00:00Z"), deletedAt: "2026-09-30T01:00:00Z" }],
    dailyTraces: [trace("t1", "2026-08-28")],
    events: [event("e1", "2025-08-11")],
  });
  assert.equal(day, "2026-08-31");
});

test("Case 1 — 2025-08 and 2026-08 memories on 2026-09-02: the cover is 2026-08 and may say 最近", () => {
  const s = store({ events: [event("old", "2025-08-11"), event("new", "2026-08-20")], rawSources: [source("s", "2026-08-31T10:00:00Z")] });
  const view = home(s);
  assert.equal(view.cover.kind, "memory");
  assert.equal(leadOf(view).memory.id, "new");
  assert.equal(leadOf(view).recent, true);
  assert.equal(view.mark, "2026 年 8 月 · 最近");
  assert.equal(view.laterLifeNote, undefined);
});

test("Case 2 — a text-only 2026-08 memory beats a 2025-08 memory with a photo: old photos cannot pose as recent", () => {
  const pic = photo("p", "2025-08-11T03:00:00Z");
  const s = store({ events: [event("old-photo", "2025-08-11", { mediaIds: ["p"], memoryWeight: "highlight" }), event("new-text", "2026-08-20")], media: [pic] });
  const view = home(s);
  assert.equal(view.cover.kind, "memory");
  assert.equal(leadOf(view).memory.id, "new-text");
  assert.equal(leadOf(view).memory.lead, undefined, "the recent lead has no photo and does not borrow one");
  assert.equal(leadOf(view).recent, true);
});

test("Case 3 — latest trace 2026-08-31, latest worthy memory 2026-08-20: the memory is recent and leads", () => {
  const s = store({ events: [event("m", "2026-08-20")], dailyTraces: [trace("t", "2026-08-31")] });
  const archive = composeFamilyArchive(s, s.events, TODAY);
  assert.equal(archive.time.today, "2026-09-02");
  assert.equal(archive.time.traceDay, "2026-08-31");
  assert.equal(archive.time.memoryDay, "2026-08-20");
  assert.equal(archive.time.activityDay, "2026-08-31");
  const view = buildHomeView(archive);
  assert.equal(view.cover.kind, "memory");
  assert.equal(leadOf(view).memory.id, "m");
  assert.equal(leadOf(view).recent, true);
  // The latest month is August (traces included) even though the lead memory is 08-20.
  assert.equal(view.thisMonth.month, "2026-08");
  assert.equal(view.thisMonth.traceDays.length, 1);
});

test("Case 4 — production shape: activity in 2026-08, newest worthy memory 2025-08 → the memory stays but nothing says 最近", () => {
  const s = store({
    events: [event("stand", "2025-08-11 00:00:00+00", { memoryWeight: "memory" }), event("noodles", "2025-08-05 00:00:00+00")],
    dailyTraces: [trace("t1", "2026-08-12 00:00:00"), trace("t2", "2026-08-28 00:00:00")],
    rawSources: [source("s", "2026-08-31T12:00:00Z")],
  });
  const view = home(s);
  assert.equal(view.cover.kind, "dated", "no recent memory and no recent presentable moment: the cover is the dated memory, never a photo wall");
  assert.equal(leadOf(view).memory.id, "stand", "still the family's newest real memory, ordered by life time");
  assert.equal(leadOf(view).recent, false);
  assert.equal(view.mark, `2025 年 8 月 · 当时 ${ageOn(BIRTH, "2025-08-11")}`);
  assert.ok(!view.mark.includes("最近"));
  assert.equal(view.laterLifeNote, "2026 年 8 月还有新的生活留在档案里，只是还没有整理成一段记忆。");
  // "这个月" section is the latest month with anything, and it is August 2026, not 2025.
  assert.equal(view.thisMonth.month, "2026-08");
  assert.equal(view.thisMonth.memories.length, 0);
  assert.equal(view.thisMonth.traceDays.length, 2);
  assert.equal(view.thisMonth.ageLabel, "1 岁 7 个月");
});

test("Case 5 — the current month (2026-09) is empty: an August memory is still recent, not stale", () => {
  const s = store({ events: [event("aug", "2026-08-20")], dailyTraces: [trace("t", "2026-08-28")] });
  const view = home(s);
  assert.equal(view.cover.kind, "memory");
  assert.equal(leadOf(view).recent, true);
  assert.equal(view.mark, "2026 年 8 月 · 最近");
  assert.equal(view.thisMonth.month, "2026-08");
});

test("Case 6 — a MonthlySnapshot for 2025-08 never overrides a newer 2026-08 memory, and never leads by itself", () => {
  const snapshot = { id: "snapshot-2025-08", profileId: CANONICAL_PROFILE_ID, month: "2025-08", summary: "这个月他学会了翻身。", highlights: ["翻身"], visibility: "family" };
  const withNewer = home(store({ events: [event("old", "2025-08-11"), event("new", "2026-08-20")], monthlySnapshot: snapshot }));
  assert.equal(leadOf(withNewer).memory.id, "new");
  assert.equal(withNewer.summary, undefined, "the snapshot is about 2025-08, the latest month is 2026-08");
  // A snapshot with no published memory in its month is not shown at all (quality-review gate),
  // and a snapshot alone does not make a month "this month".
  const seedOnly = home(store({ events: [event("old", "2025-08-11")], dailyTraces: [trace("t", "2026-08-28")], monthlySnapshot: { ...snapshot, month: "2026-08" } }));
  assert.equal(seedOnly.summary, undefined);
  assert.equal(leadOf(seedOnly).recent, false);
  // Shown only when it is the latest month's own summary and memories stand behind it.
  const honest = home(store({ events: [event("new", "2026-08-20")], monthlySnapshot: { ...snapshot, month: "2026-08" } }));
  assert.equal(honest.summary, "这个月他学会了翻身。");
});

test("Case 7 — a late-imported old chat (createdAt/importedAt 2026, occurredAt 2023) never jumps to 最近", () => {
  const late = event("late-2023", "2023-03-04", { createdAt: "2026-09-01T12:00:00.000Z", createdBy: "rule", memoryWeight: "highlight" });
  const s = store({
    events: [late, event("aug", "2026-08-20", { createdAt: "2026-08-20T00:00:00.000Z" })],
    rawSources: [source("chat", "2023-03-04T02:00:00Z", "2026-09-01T12:00:00Z")],
  });
  const view = home(s);
  assert.equal(leadOf(view).memory.id, "aug", "life time (occurredAt) wins over ingestion time (createdAt)");
  const chapters = composeFamilyArchive(s, s.events, TODAY).chapters;
  assert.deepEqual(chapters.map((year) => year.year), ["2026", "2023"]);
  // Same order even if the backend returned rows newest-created-first.
  const reversed = composeFamilyArchive({ ...s, events: [...s.events].reverse() }, [...s.events].reverse(), TODAY);
  assert.equal(leadOf(buildHomeView(reversed)).memory.id, "aug");
  // And when the late import is the only memory, it is shown but dated, never recent.
  const only = home(store({ events: [late], rawSources: s.rawSources, dailyTraces: [trace("t", "2026-08-28")] }));
  assert.equal(leadOf(only).memory.id, "late-2023");
  assert.equal(leadOf(only).recent, false);
  assert.ok(!only.mark.includes("最近"));
});

test("the lead is deterministic across row order: same-day memories break ties by weight, then id", () => {
  const a = event("b-memory", "2026-08-20");
  const b = event("a-highlight", "2026-08-20", { memoryWeight: "highlight" });
  const c = event("c-memory", "2026-08-20");
  for (const order of [[a, b, c], [c, b, a], [b, c, a]]) {
    const chapters = buildChapters({ events: order, traces: [], media: [], birthDay: BIRTH });
    assert.deepEqual(chapters[0].months[0].memories.map((m) => m.id), ["a-highlight", "b-memory", "c-memory"]);
    assert.equal(selectHomeLead(chapters, { today: "2026-09-02" }).memory.id, "a-highlight");
  }
});

test("trace-weight events cannot carry the LEAD, but a recent one carries the fallback MOMENT cover (T18)", () => {
  const chapters = buildChapters({ events: [event("folded", "2026-08-25", { memoryWeight: "trace" }), event("real", "2026-08-10")], traces: [], media: [], birthDay: BIRTH });
  // Weight still decides the LEAD: a real (memory-weight) story always wins it over a folded one.
  assert.equal(selectHomeLead(chapters, { today: "2026-09-02" }).memory.id, "real");
  // T18, 2026-09-04: with nothing lead-worthy competing, a recent trace-weight event — T7's
  // everyday output — must still carry the page as its "最近的一天" fallback moment. The bug this
  // pins: the front page was instead falling through to an untethered photo-only day, or to
  // nothing at all, even though the child's own newest written words existed and were recent.
  const view = home(store({ events: [event("folded", "2026-08-25", { memoryWeight: "trace" })] }));
  assert.equal(view.cover.kind, "moment");
  assert.equal(view.cover.cover.moment.kind, "memory_led");
  assert.equal(view.cover.cover.moment.memory.id, "folded");
  assert.equal(leadOf(view), undefined);
  assert.ok(view.mark.includes("最近"));
});

test("a trace-weight event too old to be recent falls through to the quiet empty cover, not an invented one", () => {
  const view = home(store({ events: [event("old-folded", "2025-01-10", { memoryWeight: "trace" })] }));
  assert.equal(view.cover.kind, "empty");
  assert.equal(leadOf(view), undefined);
});

test("growth notes: 最近 wording only while the note is recent; the front page drops a stale change entirely", () => {
  const records = [
    { id: "g-old", profileId: CANONICAL_PROFILE_ID, kind: "motor", note: "会扶着站", observedAt: "2025-08-01", visibility: "family" },
    { id: "g-new", profileId: CANONICAL_PROFILE_ID, kind: "language", note: "会说车车", observedAt: "2026-08-28", visibility: "family" },
  ];
  const ref = { today: "2026-09-02", activityDay: "2026-08-31" };
  const notes = recentGrowthNotes(records, BIRTH, 4, ref);
  assert.deepEqual(notes.map((n) => [n.id, n.label, n.recent]), [["g-new", "最近常说", true], ["g-old", "那时学会", false]]);
  assert.equal(latestGrowthNote(records, BIRTH, ref).id, "g-new");
  assert.equal(latestGrowthNote([records[0]], BIRTH, ref), undefined);
  const view = home(store({ events: [event("m", "2026-08-20")], growthRecords: [records[0]] }));
  assert.equal(view.change, undefined);
});
