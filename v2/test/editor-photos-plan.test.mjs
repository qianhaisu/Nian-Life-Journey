import test from "node:test";
import assert from "node:assert/strict";
import { decidePhoto, pickPhotos, mergeDayMedia, batchLooksBroken, spread } from "../scripts/editor/photos-plan.mjs";

const life = { kind: "life", child_present: true, reference_child: "yes", face_visible: true, children_count: 1, main_child_size: "large", other_children_identifiable: false, sensitive: "none" };

test("清楚的张年单人照放行", () => assert.equal(decidePhoto(life).decision, "approved"));
test("班级合影（别的孩子入镜）在认出张年时放行", () => {
  const d = decidePhoto({ ...life, children_count: 6, other_children_identifiable: true });
  assert.equal(d.decision, "approved"); assert.equal(d.preset, "withkids");
});
test("保守项不松：认不出/太小/背对/洗澡/医疗/别的孩子", () => {
  for (const o of [{ reference_child: "uncertain" }, { reference_child: "no" }, { main_child_size: "small" }, { face_visible: false }, { sensitive: "nudity_or_bath" }, { sensitive: "health" }, { sensitive: "finance" }])
    assert.equal(decidePhoto({ ...life, ...o }).decision, "needs_human_review", JSON.stringify(o));
});
test("截图/文档/物品/无孩子 → 不上页面；出错 → 留给人", () => {
  for (const k of ["screenshot", "document", "object", "collage"]) assert.equal(decidePhoto({ ...life, kind: k }).decision, "store_only");
  assert.equal(decidePhoto({ ...life, child_present: false }).decision, "store_only");
  assert.equal(decidePhoto({ error: "x" }).decision, "needs_human_review");
  assert.equal(decidePhoto(undefined).decision, "needs_human_review");
});
test("pickPhotos：只取窗口内、未见过的，按日期排，受上限", () => {
  const rows = [{ id: "a", takenDay: "2026-09-18" }, { id: "b", takenDay: "2026-07-01" }, { id: "c", takenDay: "2026-09-15" }, { id: "d", takenDay: "2026-09-16" }];
  const got = pickPhotos(rows, { today: "2026-09-20", seen: { d: { status: "held" } }, max: 5 });
  assert.deepEqual(got.map((r) => r.id), ["c", "a"]);
  assert.equal(pickPhotos(rows, { today: "2026-09-20", seen: {}, max: 1 }).length, 1);
});
test("spread 均匀取样且保持顺序", () => {
  assert.deepEqual(spread([1, 2, 3], 5), [1, 2, 3]);
  const s = spread(Array.from({ length: 20 }, (_, i) => i), 4);
  assert.deepEqual(s, [0, 5, 10, 15]);
});
const content = { days: [{ day: "2026-09-18", expandedMediaIds: ["x"], firstScreenMediaIds: [] }, { day: "2026-09-19", expandedMediaIds: [], firstScreenMediaIds: [] }] };
test("mergeDayMedia：只加不删，原有顺序不动，不改入参", () => {
  const before = JSON.stringify(content);
  const r = mergeDayMedia(content, "2026-09-18", ["x", "y", "z"]);
  assert.deepEqual(r.content.days[0].expandedMediaIds, ["x", "y", "z"]);
  assert.deepEqual(r.added, ["y", "z"]);
  assert.equal(JSON.stringify(content), before);
  assert.ok(r.content.days[0].firstScreenMediaIds.every((id) => r.content.days[0].expandedMediaIds.includes(id)));
});
test("mergeDayMedia：没有这一天/没有新增 → null；上限 12", () => {
  assert.equal(mergeDayMedia(content, "2026-09-25", ["a"]), null);
  assert.equal(mergeDayMedia(content, "2026-09-18", ["x"]), null);
  const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
  assert.equal(mergeDayMedia(content, "2026-09-19", many).content.days[1].expandedMediaIds.length, 12);
});
test("batchLooksBroken：样本够而一张不放行 → 不可信", () => {
  assert.equal(batchLooksBroken(Array.from({ length: 50 }, () => ({ ...life, reference_child: "uncertain" }))).broken, true);
  assert.equal(batchLooksBroken(Array.from({ length: 50 }, () => ({ error: "x" }))).broken, true);
  assert.equal(batchLooksBroken([life, life]).broken, false);
});
