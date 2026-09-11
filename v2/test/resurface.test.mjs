// 原则六 · Bring the Past Back. The module either states a relation the calendar really holds, or
// it is not on the page. These check both halves, and that a month-old relation is never written as
// a day-old one — "去年同月不能写成一年前的今天" (Teddy, 2026-09-11).
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters } from "../lib/memory-chapters.ts";
import { echoGroupsFrom, resurface, sameDayLastYear } from "../lib/resurface.ts";

const BIRTH = "2025-01-03";
const TODAY = "2026-09-11";

function event(id, occurredAt, extra = {}) {
  return {
    id, profileId: "p", title: `记忆 ${id}`, story: "那天他做了一件真的发生过的事。", occurredAt,
    people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [],
    eventType: "moment", memoryWeight: "trace", scopes: ["family"], visibility: "family", keptInYearbook: false, ...extra,
  };
}
const chaptersOf = (events) => buildChapters({ events, traces: [], media: [], birthDay: BIRTH });

test("a year ago to the day is said as 去年的今天", () => {
  const chapters = chaptersOf([event("anniversary", "2025-09-11 00:00:00+00"), event("other", "2025-09-04 00:00:00+00")]);
  const hit = resurface(chapters, TODAY);
  assert.equal(hit.relation, "去年的今天");
  assert.equal(hit.kind, "day");
  assert.equal(hit.memory.id, "anniversary");
});

test("a year ago that month is said as the month, never as a day", () => {
  // occurred_at is day-precision (数据 track, 2026-09-11: every row is 00:00:00 UTC), so the only
  // honest thing to say about a story from 九月 but not from the 11th is that it is from 九月.
  const chapters = chaptersOf([event("mid-month", "2025-09-04 00:00:00+00"), event("far-off", "2025-03-02 00:00:00+00")]);
  const hit = resurface(chapters, TODAY);
  assert.equal(hit.relation, "去年的 9 月");
  assert.equal(hit.kind, "month");
  assert.equal(hit.memory.id, "mid-month");
  assert.ok(!hit.relation.includes("今天"), "a month-wide relation may not borrow the word 今天");
});

test("nothing that month a year ago means no module at all — no placeholder, no 暂无", () => {
  const chapters = chaptersOf([event("elsewhere", "2025-03-02 00:00:00+00"), event("recent", "2026-08-21 00:00:00+00")]);
  assert.equal(resurface(chapters, TODAY), undefined);
});

test("the story already on the page is not also 忽然想起", () => {
  const chapters = chaptersOf([event("only-one", "2025-09-04 00:00:00+00")]);
  assert.equal(resurface(chapters, TODAY, new Set(["only-one"])), undefined);
});

test("a milestone surfaces before an ordinary day, and a date after today never surfaces", () => {
  const chapters = chaptersOf([
    event("ordinary", "2025-09-10 00:00:00+00"),
    event("milestone", "2025-09-02 00:00:00+00", { memoryWeight: "chapter" }),
    event("not-yet", "2026-12-25 00:00:00+00"),
  ]);
  const hit = resurface(chapters, TODAY);
  assert.equal(hit.memory.id, "milestone", "原则五: weight decides which of two true relations is shown");
  assert.equal(resurface(chapters, "2025-09-05")?.memory.id, undefined, "a year before 2025 has nothing, and 2026-12-25 is not the past");
});

test("同月同日 crosses the year boundary as plain string arithmetic", () => {
  assert.equal(sameDayLastYear("2026-01-01"), "2025-01-01");
  assert.equal(sameDayLastYear("2026-02-29"), "2025-02-29", "a date the previous year never had simply matches nothing");
});

// A GROUP — 同一种成长变化的前后 / 第一次 vs 现在 (原则六's own list). Which stories belong to one
// group is never computed from titles or tags: somebody read them and recorded it in the ledger.
const groupRow = (key, eventId, label) => ({
  targetKind: "echo_group", targetId: `${key}|${eventId}`, provider: "nianlife-preview",
  promptVersion: "echo-group-v1", reasonCodes: [label], decision: "needs_human_review",
});

test("a recorded group is read as the change it is, oldest stage first, and beats the calendar", () => {
  const chapters = chaptersOf([
    event("late", "2026-09-02 00:00:00+00"),
    event("early", "2025-11-13 00:00:00+00"),
    event("middle", "2026-08-28 00:00:00+00"),
    event("calendar-hit", "2025-09-12 00:00:00+00"),
  ]);
  const groups = echoGroupsFrom([groupRow("speech", "late", "开口说话"), groupRow("speech", "early", "开口说话"), groupRow("speech", "middle", "开口说话")]);
  const hit = resurface(chapters, TODAY, new Set(), groups);
  assert.equal(hit.kind, "echo");
  assert.equal(hit.relation, "开口说话");
  assert.deepEqual(hit.stages.map((s) => s.id), ["early", "middle", "late"]);
  assert.ok(hit.stages.every((s) => s.signature.ageLabel), "两个时钟: every stage carries its age, which is what makes the distance readable");
});

test("a group whose stages are not published cannot surface: fewer than two readable, no group", () => {
  const chapters = chaptersOf([event("only-published", "2025-11-13 00:00:00+00")]);
  const groups = echoGroupsFrom([
    groupRow("sleep", "only-published", "自己睡"),
    groupRow("sleep", "still-a-draft", "自己睡"),
  ]);
  assert.equal(resurface(chapters, TODAY, new Set(), groups), undefined, "a draft is not a stage on the family's page, and one stage is not a relation");
});

test("malformed or foreign ledger rows never become a group", () => {
  assert.deepEqual(echoGroupsFrom([
    { targetKind: "echo_group", targetId: "no-pipe", provider: "nianlife-preview", promptVersion: "echo-group-v1", reasonCodes: ["x"] },
    { targetKind: "echo_group", targetId: "k|e", provider: "someone-else", promptVersion: "echo-group-v1", reasonCodes: ["x"] },
    { targetKind: "echo_group", targetId: "k|e", provider: "nianlife-preview", promptVersion: "echo-group-v1", reasonCodes: [] },
    { targetKind: "media_binding", targetId: "k|e", provider: "nianlife-preview", promptVersion: "echo-group-v1", reasonCodes: ["x"] },
  ]), []);
});

test("with no groups recorded the front page falls back to the calendar, exactly as before", () => {
  const chapters = chaptersOf([event("mid-month", "2025-09-04 00:00:00+00")]);
  assert.equal(resurface(chapters, TODAY, new Set(), []).relation, "去年的 9 月");
});
