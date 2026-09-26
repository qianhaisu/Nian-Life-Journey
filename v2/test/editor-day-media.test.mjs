import test from "node:test";
import assert from "node:assert/strict";
import { aggregateDayMedia, FIRST_SCREEN_SLOTS, FIRST_SCREEN_LIFE_SLOTS } from "../scripts/editor/day-media.mjs";

const at = (i) => `2025-01-16T${String(8 + i).padStart(2, "0")}:00:00`;
const p = (id, i, over = {}) => ({ id, type: "photo", takenAt: at(i), allowed: true, ...over });

test("首屏按时间取前 6 张；展开清单以首屏开头", () => {
  const items = Array.from({ length: 10 }, (_, i) => p(`p${i}`, i));
  const r = aggregateDayMedia(items);
  assert.deepEqual(r.firstScreenMediaIds, ["p0", "p1", "p2", "p3", "p4", "p5"]);
  assert.equal(r.expandedMediaIds.length, 10);
  assert.deepEqual(r.expandedMediaIds.slice(0, FIRST_SCREEN_SLOTS), r.firstScreenMediaIds);
});
test("生活场景照拍得晚也要进首屏：顶掉首屏末尾的人像，保持时间顺序（Teddy 2026-09-27：不能只藏在折叠区）", () => {
  const items = [...Array.from({ length: 8 }, (_, i) => p(`face${i}`, i)), p("meal", 9, { family: true }), p("road", 10, { family: true }), p("home", 11, { family: true })];
  const r = aggregateDayMedia(items);
  assert.equal(r.firstScreenMediaIds.length, FIRST_SCREEN_SLOTS);
  assert.deepEqual(r.firstScreenMediaIds.filter((id) => ["meal", "road", "home"].includes(id)), ["meal", "road"], `首屏留 ${FIRST_SCREEN_LIFE_SLOTS} 格给生活场景`);
  assert.deepEqual(r.firstScreenMediaIds, ["face0", "face1", "face2", "face3", "meal", "road"]);
  assert.ok(r.firstScreenMediaIds.every((id) => r.expandedMediaIds.includes(id)));
  assert.equal(r.expandedMediaIds.length, 11, "只挪首屏，一张都不少");
});
test("生活场景照本来就在首屏 / 没有生活场景照：行为不变", () => {
  const early = [p("meal", 0, { family: true }), ...Array.from({ length: 7 }, (_, i) => p(`face${i}`, i + 1))];
  assert.deepEqual(aggregateDayMedia(early).firstScreenMediaIds, ["meal", "face0", "face1", "face2", "face3", "face4"]);
  const none = Array.from({ length: 7 }, (_, i) => p(`face${i}`, i));
  assert.deepEqual(aggregateDayMedia(none).firstScreenMediaIds, ["face0", "face1", "face2", "face3", "face4", "face5"]);
});
test("视频规则不受影响：有视频至少一格视频，再补生活场景", () => {
  const items = [...Array.from({ length: 8 }, (_, i) => p(`face${i}`, i)), p("clip", 9, { type: "video" }), p("meal", 10, { family: true })];
  const r = aggregateDayMedia(items);
  assert.ok(r.firstScreenMediaIds.includes("clip")); assert.ok(r.firstScreenMediaIds.includes("meal"));
  assert.equal(r.firstScreenMediaIds.length, FIRST_SCREEN_SLOTS);
});
