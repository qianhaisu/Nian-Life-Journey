// 张年's page as a growth record (lib/about-view.ts, 2026-09-12): the four parts Teddy set out,
// and the two rules that keep them from overstating what the archive knows —
//   · 「没有明确后续，不判定康复，不把旧状态写成当前状态」: every health line is dated and carries the
//     status IT had that day; the page never states a current one;
//   · 「没有首次证据不能称第一次」: an unlocked experience exists only where an approved story's own
//     title says 第一天 / 第一次 / 第一步 / 首次.
import test from "node:test";
import assert from "node:assert/strict";
import { CANONICAL_PROFILE_ID } from "../lib/db/config.ts";
import { composeFamilyArchive } from "../lib/family-archive.ts";
import { buildAboutView, healthGroups, learnedGroups, measureTracks, unlockedExperiences } from "../lib/about-view.ts";
import { buildChapters } from "../lib/memory-chapters.ts";

const BIRTH = "2025-01-03";
const TODAY = new Date("2026-09-12T02:00:00Z");

function event(id, occurredAt, title, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, title, story: "一段真实的故事。", occurredAt, people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra };
}
function growth(id, kind, observedAt, note, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, kind, observedAt, note, source: "parent", visibility: "family", ...extra };
}
function care(id, observedAt, title, note, extra = {}) {
  return { id, profileId: CANONICAL_PROFILE_ID, kind: "health_observation", observedAt, status: "观察中", title, note, source: "parent", visibility: "family", ...extra };
}
function store({ events = [], growthRecords = [], careRecords = [] } = {}) {
  return {
    profile: { id: CANONICAL_PROFILE_ID, displayName: "张年", birthDate: BIRTH, timezone: "Asia/Shanghai", visibility: "family" },
    contributors: [], media: [], mediaAssets: [], mediaLocations: [], connectorStates: [], rawSources: [], dailyTraces: [], careEpisodes: [], monthlyFocusGoals: [], organizerRuns: [], organizerJobs: [], chatImportTasks: [], links: [], qualityReviews: [], monthlySnapshots: [],
    events, growthRecords, careRecords,
  };
}

// The four titles production actually holds that say a first, plus ordinary days around them.
const FIRSTS = [
  event("walk", "2025-12-25", "小年年迈出独立走路的第一步"),
  event("nursery", "2026-02-26", "乳儿班第一天，生活丰富愉快"),
  event("daycare", "2026-03-03", "小年第一天去晚托班"),
  event("blanket", "2026-05-21", "第一天自己盖被睡着"),
];
const ORDINARY = [
  event("noodles", "2026-08-25", "妈妈觉得他吃饭太着急"),
  event("ball", "2026-08-28", "吃着饭睡着了，会说ball了"),
];

test("解锁的体验 is only what an approved title itself calls a first, oldest first", () => {
  const chapters = buildChapters({ events: [...ORDINARY, ...FIRSTS], traces: [], media: [], birthDay: BIRTH });
  const unlocked = unlockedExperiences(chapters, BIRTH);
  assert.deepEqual(unlocked.map((item) => item.id), ["walk", "nursery", "daycare", "blanket"], "unlocks read in the order they happened");
  assert.equal(unlocked[0].dateLabel, "2025 年 12 月 25 日");
  assert.equal(unlocked[0].ageLabel, "11 个月", "both clocks on every line (原则二)");
  // 会说ball了 is a real change and an ordinary day's story; it is NOT promoted to a milestone here.
  assert.ok(!unlocked.some((item) => item.id === "ball"));
  assert.ok(!unlocked.some((item) => item.id === "noodles"));
});

test("身高体重: the newest of each kind with the day it was measured, and the whole curve kept", () => {
  const records = [
    growth("h1", "height", "2026-03-01 00:00:00", "体检量的", { value: 82, unit: "cm" }),
    growth("h2", "height", "2026-08-01 00:00:00", "体检量的", { value: 86.5, unit: "cm" }),
    growth("w1", "weight", "2026-07-15 00:00:00", "体检量的", { value: 11.2, unit: "kg" }),
  ];
  const tracks = measureTracks(records, BIRTH);
  assert.deepEqual(tracks.map((track) => track.kind), ["height", "weight"]);
  assert.equal(tracks[0].latest.value, 86.5);
  assert.equal(tracks[0].latest.signature.dateLabel, "2026 年 8 月 1 日");
  assert.equal(tracks[0].history.length, 2, "the history is the curve, not just the newest point");
  // The two kinds are measured on different days and each keeps its own.
  assert.equal(tracks[1].latest.signature.dateLabel, "2026 年 7 月 15 日");
  assert.deepEqual(measureTracks([], BIRTH), [], "no measurement, no block — never an empty card");
});

test("健康问题: grouped by episode, every line dated with the status it had that day, no current status anywhere", () => {
  const records = [
    care("c1", "2026-07-20 00:00:00", "感冒两周没好", "去医院检查过，精神食欲正常", { careEpisodeId: "ep-1", lifeEventId: "event-x" }),
    care("c2", "2026-08-02 00:00:00", "感冒好转", "咳嗽少了", { careEpisodeId: "ep-1", status: "已稳定" }),
    care("c3", "2026-08-21 00:00:00", "鼻涕有点多", "老师反馈鼻子下面有点红"),
    care("hidden", "2026-08-25 00:00:00", "不该出现的记录", "私密", { visibility: "private" }),
  ];
  const groups = healthGroups(records, BIRTH);
  assert.deepEqual(groups.map((group) => group.key), ["c3", "ep-1"], "groups ordered by their newest record");
  const episode = groups.find((group) => group.key === "ep-1");
  assert.equal(episode.title, "感冒好转", "the group is titled from its newest record, how the family last described it");
  assert.deepEqual(episode.lines.map((line) => [line.dateLabel, line.status]), [["2026 年 8 月 2 日", "已稳定"], ["2026 年 7 月 20 日", "观察中"]]);
  assert.equal(episode.lines[1].eventHref, "/events/event-x", "the record links back to its day (原则八)");
  // The shape itself carries no verdict: nothing here can print 「已经好了」.
  assert.deepEqual(Object.keys(episode).sort(), ["key", "lines", "title"]);
  assert.ok(!groups.some((group) => group.lines.some((line) => line.id === "hidden")), "private records never reach the page");
});

test("学会了什么: grouped by kind in reading order, capped per kind, private excluded", () => {
  const records = [
    growth("l1", "language", "2026-08-28 00:00:00", "会说 ball"),
    growth("l2", "language", "2026-09-02 00:00:00", "喊出「粥粥」", { lifeEventId: "event-y" }),
    growth("m1", "motor", "2026-05-21 00:00:00", "自己盖被子"),
    growth("s1", "sleep", "2026-06-01 00:00:00", "午睡能睡两小时"),
    growth("p1", "personality", "2026-06-02 00:00:00", "不给就皱眉", { visibility: "private" }),
  ];
  const groups = learnedGroups(records, BIRTH);
  assert.deepEqual(groups.map((group) => group.kind), ["language", "motor", "sleep"], "语言和动作先读，私密的那条整组都不出现");
  assert.deepEqual(groups[0].notes.map((note) => note.note), ["喊出「粥粥」", "会说 ball"], "newest first inside a kind");
  assert.equal(groups[0].title, "说话", "a plain noun, not 「最近常说」 — this page is the whole record");
  assert.equal(groups[0].notes[0].eventHref, "/events/event-y");
  assert.equal(groups[0].notes[0].ageLabel, "1 岁 7 个月");
});

test("production shape 2026-09-12: basics and 解锁的体验 render, the three empty parts render nothing", () => {
  const s = store({ events: [...ORDINARY, ...FIRSTS] });
  const view = buildAboutView(composeFamilyArchive(s, s.events, TODAY));
  assert.equal(view.basics.age, "1 岁 8 个月");
  assert.equal(view.basics.birthLabel, "2025 年 1 月 3 日");
  assert.deepEqual(view.measures, [], "growth_records is empty in production — no 身高体重 block");
  assert.deepEqual(view.health, [], "care_records is empty in production — no 健康问题 block");
  assert.deepEqual(view.learned, [], "no observed growth rows — no 学会了什么 block");
  assert.equal(view.unlocked.length, 4, "and the part that does have evidence is on the page");
});
