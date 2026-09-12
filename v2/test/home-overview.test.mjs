// 近况概览 (lib/home-view.ts, 2026-09-12): the front page's second block must be about ONE month
// and must always say which period it covers — the fault it replaces was three blocks each choosing
// a month of their own, which on 2026-09-12 put August on top of a September that has three
// published stories of its own. Runs the real read layer (composeFamilyArchive → buildHomeView)
// over a deterministic store with an injected clock; no backend, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildHomeView } from "../lib/home-view.ts";

const BIRTH = "2025-01-03";
// 2026-09-12 10:00 in Asia/Shanghai — the day this was built, and the production shape of it.
const TODAY = new Date("2026-09-12T02:00:00Z");

function event(id, occurredAt, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, title: `记忆 ${id}`, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, createdBy: "user", ...extra };
}
function trace(id, occurredAt) {
  return { id, profileId: CANONICAL_PROFILE_ID, occurredAt, entries: ["平常的一天"], sourceIds: [], scopes: ["family"], visibility: "family" };
}
function snapshot(month, summary) {
  return { id: `snapshot-${month}`, profileId: CANONICAL_PROFILE_ID, month, summary, highlights: [], visibility: "family" };
}
function store({ events = [], dailyTraces = [], monthlySnapshots = [] } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], media: [], mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: [], growthRecords: [], careRecords: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [],
    events, dailyTraces, monthlySnapshots,
  };
}
const home = (s, now = TODAY) => buildHomeView(composeFamilyArchive(s, s.events, now));

// 2026-09 as production actually holds it: three published trace-weight days and no snapshot yet,
// under an August that has both memories and an approved snapshot.
function productionShape() {
  return store({
    events: [
      event("sep-03", "2026-09-03", { memoryWeight: "trace", title: "画画涂到脸上" }),
      event("sep-02", "2026-09-02", { memoryWeight: "trace", title: "喊出粥粥" }),
      event("sep-01", "2026-09-01", { memoryWeight: "trace", title: "英语课上跟读单词" }),
      event("aug-28", "2026-08-28", { title: "吃着饭睡着了" }),
    ],
    monthlySnapshots: [snapshot("2026-08", "- 入选了幼儿园毕业庆典节目\n- 突然变得爱看绘本")],
  });
}

test("the overview is September's own published days, and August's snapshot is never relabelled as September", () => {
  const view = home(productionShape());
  assert.equal(view.overview.month, "2026-09", "the overview is about the newest month that has lines to print");
  assert.equal(view.overview.summary, undefined, "September has no snapshot of its own, so none is quoted for it");
  assert.deepEqual(view.overview.facts.map((fact) => fact.id), ["sep-03", "sep-02", "sep-01"], "its own published days, newest first");
  assert.equal(view.overview.spanLabel, "2026 年 9 月 1 日 — 3 日 · 当时 1 岁 8 个月", "the period the lines really cover, both clocks");
  assert.equal(view.overview.recent, true);
  // August may only speak for August.
  assert.equal(view.priorReview.month, "2026-08");
  assert.equal(view.priorReview.label, "2026 年 8 月", "the page prints 「2026 年 8 月回顾」 from this");
  assert.match(view.priorReview.summary, /毕业庆典/);
  assert.equal(view.priorReview.href, "/memory/2026/08");
});

test("a fact line carries no age of its own: two clocks are read once per block", () => {
  const [fact] = home(productionShape()).overview.facts;
  assert.deepEqual(Object.keys(fact).sort(), ["dateLabel", "day", "id", "title"]);
  assert.equal(fact.dateLabel, "2026 年 9 月 3 日");
});

test("when the month has its own snapshot it is quoted, the span is the whole month, and no prior review appears", () => {
  const s = productionShape();
  s.monthlySnapshots.push(snapshot("2026-09", "- 开始跟读英语单词\n- 会喊出「粥粥」"));
  const view = home(s);
  assert.match(view.overview.summary, /跟读英语单词/);
  assert.equal(view.overview.spanLabel, "2026 年 9 月 · 当时 1 岁 8 个月", "a snapshot is written about a whole month, so the month is the period");
  assert.equal(view.priorReview, undefined, "the month speaks for itself; last month's review is not stacked under it");
});

test("a month that holds no lines steps back to the newest month that does, and says which month that is", () => {
  // September noticed as an ordinary day but never written up: it has a chapter and a URL, and
  // nothing for an overview to print. Stepping back must not read as a claim about September.
  const view = home(store({
    events: [event("aug-28", "2026-08-28", { title: "吃着饭睡着了" })],
    dailyTraces: [trace("t", "2026-09-05 00:00:00")],
    monthlySnapshots: [snapshot("2026-08", "- 突然变得爱看绘本")],
  }));
  assert.equal(view.thisMonth.month, "2026-09", "the newest month with anything in it is still September");
  assert.equal(view.overview.month, "2026-08", "but the overview is about the month it can actually print");
  assert.match(view.overview.spanLabel, /^2026 年 8 月/, "and it names that month rather than passing for September");
  assert.match(view.overview.summary, /绘本/);
});

test("an overview older than the recency contract is still shown, but not as 近况", () => {
  const view = home(productionShape(), new Date("2027-03-02T02:00:00Z"));
  assert.equal(view.overview.month, "2026-09");
  assert.equal(view.overview.recent, false, "the page must change its words rather than call a half-year-old month 近况");
});

test("with nothing published at all there is no overview to render — no heading, no 「暂无」", () => {
  const view = home(store({ dailyTraces: [trace("t", "2026-09-05 00:00:00")] }));
  assert.equal(view.overview, undefined);
  assert.equal(view.priorReview, undefined);
});
