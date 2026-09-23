import test from "node:test";
import assert from "node:assert/strict";
import { aggregateDayMedia } from "../scripts/editor/day-media.mjs";

const m = (id, type, t, allowed = true) => ({ id, type, takenAt: `2025-12-04T${t}:00+08:00`, allowed });

test("只收放行的，按拍摄时间排，去重", () => {
  const r = aggregateDayMedia([m("b", "photo", "12:00"), m("a", "photo", "09:00"), m("x", "photo", "10:00", false), m("a", "photo", "09:00")]);
  assert.deepEqual(r.expandedMediaIds, ["a", "b"]);
  assert.deepEqual(r.firstScreenMediaIds, ["a", "b"]);
});

test("当天有视频、前 6 张里没有：把最早的视频换进首屏最后一格，首屏仍按时间排", () => {
  const items = ["08", "09", "10", "11", "12", "13", "14"].map((h, i) => m(`p${i}`, "photo", `${h}:00`));
  items.push(m("v", "video", "20:00"));
  const r = aggregateDayMedia(items);
  assert.equal(r.firstScreenMediaIds.length, 6);
  assert.ok(r.firstScreenMediaIds.includes("v"));
  assert.deepEqual(r.firstScreenMediaIds, ["p0", "p1", "p2", "p3", "p4", "v"]);
  assert.deepEqual(r.expandedMediaIds.slice(0, 6), r.firstScreenMediaIds, "首屏是展开清单的开头");
  assert.equal(r.expandedMediaIds.length, 8);
});

test("首屏里已经有视频就不动；没有放行的媒体就是空", () => {
  const r = aggregateDayMedia([m("v", "video", "08:00"), m("p", "photo", "09:00")]);
  assert.deepEqual(r.firstScreenMediaIds, ["v", "p"]);
  assert.deepEqual(aggregateDayMedia([m("x", "photo", "08:00", false)]), { expandedMediaIds: [], firstScreenMediaIds: [] });
});
