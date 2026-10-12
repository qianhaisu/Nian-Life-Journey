import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { groupReminders } from "../lib/reminder-groups.ts";
import { syncTrips } from "../lib/travel/sync.ts";
import { tripRange } from "../lib/travel/model.ts";
import { buildMonthTimeline } from "../lib/month-timeline.ts";
import { buildChapters } from "../lib/memory-chapters.ts";
import { invalidateMonthContent } from "../lib/month-content.ts";
import { attachMemoryReading } from "../lib/home-memory-reading.ts";
import { loadTopicCache } from "../lib/home-memory-topics-load.ts";
import { captureEnabled } from "../lib/capture-access.ts";
import { readProductionContent, productionRevision } from "../scripts/editor/read-production-content.mjs";
import { inspectAutomation } from "../scripts/check-automation.mjs";

const reminder = (id, title, extras = {}) => ({ id, title, whenText: "9 月 25 日", whenDay: "2026-09-25", actionable: true, sources: [], ...extras });
test("same dated leave request is one row, preserving all source ids and evidence", () => {
  const source = { summary: "已审核来源" };
  const original = [reminder("z", "周五托班请假，那天不去托班", { sources: [source] }), reminder("a", "周五托班请假", { sources: [source], note: "补充说明" })];
  const group = groupReminders(original);
  assert.equal(group.length, 1); assert.equal(group[0].title, "周五托班请假");
  assert.deepEqual(group[0].aliasIds, ["a", "z"]); assert.equal(group[0].sources.length, 1);
  assert.equal(group[0].note, "补充说明"); assert.equal(original[0].id, "z");
});
test("different dates, pending plans, completed facts and different actions never collapse", () => {
  assert.equal(groupReminders([reminder("a", "托班请假"), reminder("b", "托班请假", { whenDay: "2026-09-26" }),
    reminder("c", "托班请假", { pendingConfirmation: true }), reminder("d", "托班请假", { actionable: false }), reminder("e", "预约托班")]).length, 5);
});
const day = (date, title, extra = {}) => ({ day: date, kind: "story", title, paragraphs: ["保留原文。"], firstScreenMediaIds: [], expandedMediaIds: [], ...extra });
const content = (days) => ({ schema: "nianlife.month-content/1", month: "2026-09", days });
test("published departures appear in travel; plans, relatives and curated overlaps do not inflate footprints", () => {
  const curated = [{ id: "manual", title: "已确认行程", from: "2026-09-01", to: "2026-09-03", placeIds: ["cn-zj-wenzhou"] }];
  const trips = syncTrips([content([day("2026-09-24", "中午坐了小马桶，晚上出发回温州过中秋"),
    day("2026-09-25", "准备出发回温州"), day("2026-09-26", "爸爸出发回温州"), day("2026-09-02", "到了温州")])], curated);
  const records = trips.filter((trip) => trip.id.startsWith("record-"));
  assert.equal(records.length, 1); assert.equal(records[0].from, "2026-09-24");
  assert.equal(records[0].to, records[0].from); assert.match(tripRange(records[0]), /出行记录/);
  assert.equal(trips.filter((trip) => trip.id === "manual").length, 1);
  assert.equal(trips.find((trip) => trip.id.startsWith("stay-"))?.from, "2025-03-15");
});
async function withContent(doc, run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nian-reading-")); const previous = process.env.MONTH_CONTENT_DIR;
  try { process.env.MONTH_CONTENT_DIR = dir; fs.writeFileSync(path.join(dir, "2026-09.json"), JSON.stringify(doc)); invalidateMonthContent(); await run(dir); }
  finally { if (previous === undefined) delete process.env.MONTH_CONTENT_DIR; else process.env.MONTH_CONTENT_DIR = previous; invalidateMonthContent(); fs.rmSync(dir, { recursive: true, force: true }); }
}
test("one day combines edited text and remaining published stories, with canonical URL and one age algorithm", async () => {
  const events = ["fragment-1", "fragment-2"].map((id) => ({ id, profileId: "p", title: `旧段落${id}`, story: `原文${id}`, occurredAt: "2026-09-02", people: [], tags: [], contentTypes: ["family"], mediaIds: [], sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false }));
  const archive = { chapters: buildChapters({ events, traces: [], media: [], birthDay: "2025-01-03" }), media: [], events, eventIdentities: events, traceEvents: [], birthDay: "2025-01-03", privilege: { confirmed: new Set(), trusted: new Set() } };
  await withContent(content([day("2026-09-02", "统一后的日子", { ageLabel: "1岁8个月", eventIds: ["fragment-1"] })]), async () => {
    const timeline = await buildMonthTimeline(archive, "2026", "09");
    assert.equal(timeline.byDay.size, 1);
    const entry = timeline.byDay.get("2026-09-02");
    assert.equal(entry.title, "统一后的日子"); assert.equal(entry.href, "/memory/2026/09/02");
    assert.equal(entry.ageLabel, "1 岁 7 个月"); assert.deepEqual(entry.eventIds, ["fragment-1", "fragment-2"]);
    assert.equal(entry.stories[0].title, "旧段落fragment-2");
  });
});
test("a midnight UTC slide opens its Shanghai day; unedited photos fall back to a real month", async () => {
  const archive = { chapters: [], media: [], eventIdentities: [], traceEvents: [], birthDay: "2025-01-03", privilege: { confirmed: new Set(), trusted: new Set() } };
  const memory = { slides: [{ key: "a", media: { takenAt: "2026-09-01T17:00:00Z" } }, { key: "b", media: { takenAt: "2020-01-01" } }] };
  await withContent(content([day("2026-09-02", "真的这一天")]), async () => {
    const [enriched] = await attachMemoryReading([memory], archive);
    assert.equal(enriched.slides[0].day, "2026-09-02"); assert.equal(enriched.slides[0].href, "/memory/2026/09/02");
    assert.equal(enriched.slides[1].href, undefined);
  });
});
test("a stale visual description cannot restore withdrawn pictures or their derived text", async () => {
  const archive = { chapters: [], media: [], events: [], eventIdentities: [], traceEvents: [], birthDay: "2025-01-03",
    privilege: { confirmed: new Set(), trusted: new Set(), excluded: new Set(["withdrawn-skin"]) } };
  await withContent(content([
    day("2026-09-01", "Description of the withdrawn image", { kind: "visual-description", expandedMediaIds: ["withdrawn-skin"], firstScreenMediaIds: ["withdrawn-skin"] }),
    day("2026-09-02", "Independent story remains", { expandedMediaIds: ["withdrawn-skin"], firstScreenMediaIds: ["withdrawn-skin"] }),
    day("2026-09-03", "Temporarily unavailable derivative", { kind: "visual-description", expandedMediaIds: ["not-ready"], firstScreenMediaIds: ["not-ready"] }),
  ]), async () => {
    const timeline = await buildMonthTimeline(archive, "2026", "09");
    assert.ok(!timeline.byDay.has("2026-09-01"));
    assert.ok(timeline.byDay.has("2026-09-02"));
    assert.ok(timeline.byDay.has("2026-09-03"));
    assert.deepEqual(timeline.byDay.get("2026-09-02").photos, []);
  });
});
test("merging an old approved story binding cannot override a later subject withdrawal", async () => {
  const photo = { id: "withdrawn-skin", profileId: "p", visibility: "family", type: "photo", takenAt: "2026-09-02", src: "/api/media/withdrawn-skin", width: 1200, height: 1200, sourceIds: ["source"] };
  const event = { id: "old-story", profileId: "p", title: "Independent story", story: "Original text stays.", occurredAt: "2026-09-02", people: [], tags: [], contentTypes: ["family"], mediaIds: [photo.id], sourceIds: ["source"], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false };
  const archive = { chapters: buildChapters({ events: [event], traces: [], media: [photo], birthDay: "2025-01-03", photoConfirmations: new Set([`${event.id}|${photo.id}`]) }), media: [photo], events: [event], eventIdentities: [event], traceEvents: [], birthDay: "2025-01-03", privilege: { confirmed: new Set(), trusted: new Set([photo.id]), excluded: new Set([photo.id]) } };
  assert.deepEqual(archive.chapters[0].months[0].memories[0].storyPhotos.map((item) => item.id), [photo.id]);
  await withContent(content([day("2026-09-03", "Another day")]), async () => {
    const timeline = await buildMonthTimeline(archive, "2026", "09");
    assert.ok(timeline.byDay.has("2026-09-02"));
    assert.deepEqual(timeline.byDay.get("2026-09-02").photos, []);
    assert.equal(timeline.byDay.get("2026-09-02").title, event.title);
  });
});
test("mounted nightly cache overrides initial release; corrupt publication fails closed", async () => {
  await withContent(content([day("2026-09-02", "日子")]), async (dir) => {
    const cache = { model: "reviewed-model", promptVersion: "v4", topics: { a: { topic: "其他" } } };
    fs.writeFileSync(path.join(dir, "photo-topics.json"), JSON.stringify(cache));
    assert.deepEqual(await loadTopicCache(undefined, { MONTH_CONTENT_DIR: dir }), cache);
    fs.writeFileSync(path.join(dir, "photo-topics.json"), "bad-json");
    assert.equal(await loadTopicCache(undefined, { MONTH_CONTENT_DIR: dir }), undefined);
  });
});
test("SSH errors cannot be interpreted as an empty production month", () => {
  assert.throws(() => readProductionContent("2026-09", "/unused", { ssh: "host", key: "key" }, () => ({ status: 255 })), /probe failed/);
  assert.equal(readProductionContent("2026-09", "/unused", { ssh: "host", key: "key" }, () => ({ status: 0, stdout: "ABSENT\n" })), null);
  assert.equal(productionRevision("2026-09"), "absent");
  assert.throws(() => readProductionContent("2026-09", "/unused", { ssh: "host", key: "key" }, (command) => command === "ssh" ? { status: 0, stdout: "PRESENT\n" } : { status: 1 }), /cannot start from an empty/);
});
test("automation evidence is unknown when missing and stale when expired; one failed stage fails the run", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "nian-ops-")); const now = Date.parse("2026-09-30T00:00:00Z");
  try {
    assert.equal(inspectAutomation(dir, now).status, "unknown"); fs.mkdirSync(path.join(dir, "editor/runs"), { recursive: true });
    const file = path.join(dir, "editor/runs/latest.json");
    fs.writeFileSync(file, JSON.stringify({ at: "2026-09-29T22:00:00Z", stages: { editor: 0, backfill: 1, reminders: 0, carousel: 0 } }));
    assert.equal(inspectAutomation(dir, now).status, "failed");
    fs.writeFileSync(file, JSON.stringify({ at: "2026-09-27T22:00:00Z", stages: { editor: 0, backfill: 0, reminders: 0, carousel: 0 } }));
    assert.equal(inspectAutomation(dir, now).status, "stale");
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
test("legacy capture capability is closed unless explicitly enabled", () => {
  assert.equal(captureEnabled({}), false); assert.equal(captureEnabled({ CAPTURE_ENABLED: "0" }), false); assert.equal(captureEnabled({ CAPTURE_ENABLED: "1" }), true);
});

test("deduplicated check aliases are inserted and cleared in one statement under the same profile", async () => {
  const { setUpcomingChecks } = await import("../lib/db/upcoming-checks-store.ts");
  const { PgDialect } = await import("drizzle-orm/pg-core");
  const calls = [];
  const db = {
    insert: () => ({ values: (values) => ({ onConflictDoNothing: async () => { calls.push({ insert: values }); } }) }),
    delete: () => ({ where: async (where) => { calls.push({ delete: new PgDialect().sqlToQuery(where) }); } }),
  };
  await setUpcomingChecks(["a", "b", "a"], true, { db, profileId: "fixture", title: "同一条提醒" });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].insert.map((row) => row.itemId), ["a", "b"]);
  assert.ok(calls[0].insert.every((row) => row.profileId === "fixture"));
  await setUpcomingChecks(["a", "b"], false, { db, profileId: "fixture" });
  assert.equal(calls.length, 2); assert.deepEqual(calls[1].delete.params, ["fixture", "a", "b"]);
  await assert.rejects(setUpcomingChecks([], false, { db }), /invalid check group/);
  assert.equal(calls.length, 2);
});
