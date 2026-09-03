// "Who is 张年 right now" selectors (lib/memory-chapters.ts): the portrait must be the newest
// deliverable photograph of him, not the newest *memory's* photo (thirteen months older in
// production), and the recent ordinary-day notes must be about the child, not about the archive.
import test from "node:test";
import assert from "node:assert/strict";
import { buildChapters, latestLeadPhoto, recentTraceNotes } from "../lib/memory-chapters.ts";

const BIRTH = "2025-01-03";

function photo(id, takenAt, dims = { width: 1600, height: 1200 }) {
  return { id, profileId: "p", type: "photo", src: `/api/media/${id}`, alt: "WeChat image", takenAt, visibility: "family", ...dims };
}
function event(id, occurredAt, mediaIds) {
  return { id, profileId: "p", title: `记忆 ${id}`, story: "一段故事。", occurredAt, people: [], tags: [], contentTypes: ["daily"], mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: "moment", memoryWeight: "memory", scopes: ["family"], visibility: "family", keptInYearbook: false };
}
function trace(id, occurredAt, entries) {
  return { id, profileId: "p", occurredAt, entries, sourceIds: [], scopes: ["family"], visibility: "family" };
}

test("the portrait is the newest photograph, even when the newest memory is a year older", () => {
  const old = photo("old", "2025-08-11T08:00:00.000Z");
  const media = [old, photo("new-sticker", "2026-08-28T07:00:00.000Z", { width: 90, height: 120 }), photo("new-real", "2026-08-28T08:00:00.000Z")];
  const chapters = buildChapters({ events: [event("stand", "2025-08-11 00:00:00+00", ["old"])], traces: [], media, birthDay: BIRTH });
  assert.equal(latestLeadPhoto(chapters).id, "new-real", "newest hero-sized photo wins; the sticker never does");
});

test("with no newer photography the memory lead still answers", () => {
  const media = [photo("old", "2025-08-11T08:00:00.000Z")];
  const chapters = buildChapters({ events: [event("stand", "2025-08-11 00:00:00+00", ["old"])], traces: [], media, birthDay: BIRTH });
  assert.equal(latestLeadPhoto(chapters).id, "old");
});

test("recent trace notes are about the child; archive-counting sentences are display-filtered, rows untouched", () => {
  const traces = [
    trace("t1", "2026-08-28 00:00:00", ["这一天留下了 10 张照片。", "新增一个词：车车"]),
    trace("t2", "2026-08-27 00:00:00", ["晚上自己吃完半碗饭"]),
    trace("t3", "2026-08-14 00:00:00", ["在窗边看了很久的车"]),
  ];
  const chapters = buildChapters({ events: [], traces, media: [], birthDay: BIRTH });
  const notes = recentTraceNotes(chapters, 3);
  assert.deepEqual(notes.map((note) => note.entry), ["新增一个词：车车", "晚上自己吃完半碗饭", "在窗边看了很久的车"]);
  assert.equal(notes[0].day, "2026-08-28");
  assert.deepEqual(traces[0].entries, ["这一天留下了 10 张照片。", "新增一个词：车车"], "the stored trace still carries every entry");
});
