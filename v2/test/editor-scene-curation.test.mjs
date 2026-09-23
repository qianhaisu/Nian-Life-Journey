import test from "node:test";
import assert from "node:assert/strict";
import { groupScenes, applySceneCuration, applyDailyCap, sceneKeyOf, SCENE_MAX_KEEP, DAY_MEDIA_CAP } from "../scripts/editor/scene-curation.mjs";

const m = (id, type, t) => ({ id, type, takenAt: `2025-12-04T${t}` });

test("groupScenes：相邻间隔 <= 10 分钟串成一个场景，超过就断开", () => {
  const items = [m("a", "photo", "09:00:00"), m("b", "photo", "09:05:00"), m("c", "photo", "09:20:00"), m("d", "photo", "09:25:00")];
  const groups = groupScenes(items);
  assert.deepEqual(groups.map((g) => g.map((x) => x.id)), [["a", "b"], ["c", "d"]]);
});

test("groupScenes：单张也是一个场景（长度 1）", () => {
  const groups = groupScenes([m("a", "photo", "09:00:00"), m("b", "photo", "11:00:00")]);
  assert.deepEqual(groups.map((g) => g.length), [1, 1]);
});

test("groupScenes：时间解析不出来的不合并（拿不准不合并）", () => {
  const groups = groupScenes([{ id: "a", type: "photo", takenAt: "bad" }, { id: "b", type: "photo", takenAt: "bad2" }]);
  assert.equal(groups.length, 2);
});

test("applySceneCuration：同一场景，deepseek 判定同场景就精选到 keep 里的照片", () => {
  const group = [m("a", "photo", "09:00:00"), m("b", "photo", "09:01:00"), m("c", "photo", "09:02:00"), m("d", "photo", "09:03:00")];
  const decisions = new Map([[sceneKeyOf(group), { sameScene: true, keep: ["b", "d", "a"] }]]);
  const out = applySceneCuration([group], decisions);
  assert.deepEqual(new Set(out.map((x) => x.id)), new Set(["b", "d", "a"]));
  assert.ok(out.length <= SCENE_MAX_KEEP);
});

test("applySceneCuration：不是同一场景（sameScene:false）就全部保留，不精选", () => {
  const group = [m("a", "photo", "09:00:00"), m("b", "photo", "09:01:00")];
  const decisions = new Map([[sceneKeyOf(group), { sameScene: false, keep: ["a"] }]]);
  const out = applySceneCuration([group], decisions);
  assert.deepEqual(new Set(out.map((x) => x.id)), new Set(["a", "b"]));
});

test("applySceneCuration：判不出来（没有 decision）也全部保留，不是拿不准就删", () => {
  const group = [m("a", "photo", "09:00:00"), m("b", "photo", "09:01:00")];
  const out = applySceneCuration([group], new Map());
  assert.deepEqual(new Set(out.map((x) => x.id)), new Set(["a", "b"]));
});

test("applySceneCuration：场景里有视频，视频必留，照片配额相应减 1", () => {
  const group = [m("a", "photo", "09:00:00"), m("v", "video", "09:01:00"), m("b", "photo", "09:02:00"), m("c", "photo", "09:03:00")];
  const decisions = new Map([[sceneKeyOf(group), { sameScene: true, keep: ["a", "b", "c"] }]]);
  const out = applySceneCuration([group], decisions);
  assert.ok(out.some((x) => x.type === "video"), "视频必须保留");
  assert.equal(out.filter((x) => x.type === "photo").length, SCENE_MAX_KEEP - 1, "有一段视频，照片最多 2 张");
});

test("applyDailyCap：总数不超过上限时原样返回（按时间排序）", () => {
  const items = [m("b", "photo", "10:00:00"), m("a", "photo", "09:00:00")];
  const out = applyDailyCap(items, [[items[0]], [items[1]]], { cap: DAY_MEDIA_CAP });
  assert.deepEqual(out.map((x) => x.id), ["a", "b"]);
});

test("applyDailyCap：场景数超过上限时轮流留代表，不会把后面的场景整个挤没", () => {
  // 15 个场景各 1 张，cap=12：应该留最早的 12 个场景各 1 张，而不是某几个场景独占全部名额
  const groups = Array.from({ length: 15 }, (_, i) => [m(`s${i}`, "photo", `${String(9 + Math.floor(i / 2)).padStart(2, "0")}:${String((i % 2) * 30).padStart(2, "0")}:00`)]);
  const curated = groups.flat();
  const out = applyDailyCap(curated, groups, { cap: 12 });
  assert.equal(out.length, 12);
  const kept = new Set(out.map((x) => x.id));
  for (let i = 0; i < 12; i++) assert.ok(kept.has(`s${i}`), `场景 s${i} 应该留下代表`);
});

test("applyDailyCap：一个场景留了多张、其它场景数量少时，轮空位给场景数少的让第二轮补齐大场景", () => {
  const big = [m("g1a", "photo", "09:00:00"), m("g1b", "photo", "09:01:00"), m("g1c", "video", "09:02:00")];
  const small = [m("g2", "photo", "10:00:00")];
  const groups = [big, small];
  const curated = [...big, ...small];
  const out = applyDailyCap(curated, groups, { cap: 2 });
  // 第一轮：g1a（场景1代表）、g2（场景2代表）—— 名额用完，场景1的其余两张这次轮不到
  assert.deepEqual(out.map((x) => x.id).sort(), ["g1a", "g2"].sort());
});
