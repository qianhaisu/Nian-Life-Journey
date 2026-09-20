import test from "node:test";
import assert from "node:assert/strict";
import { pickAutoApprovals, MAX_AUTO_APPROVALS, AUTO_REVIEWER } from "../scripts/editor/reminders-plan.mjs";

// 2026-09-20：每周提醒的自动批准（Teddy 明确决定「夜里提取 + 夜里批准」）。全部合成数据。
// 最要紧的是「绝不碰人已经做过的审核决定」和「数量异常时整批留给人」。

const BATCH = "upcoming-20260921000000";
const row = (over = {}) => ({ id: "i1", title: "带张年去打疫苗", status: "open", note: "", reviewDecision: "needs_human_review", extractionBatchId: BATCH, ...over });

test("本批新建、待审核、正常的条目会被批准", () => {
  const r = pickAutoApprovals([row({ id: "a" }), row({ id: "b", status: "tentative" }), row({ id: "c", status: "done" })], BATCH);
  assert.deepEqual(r.approve, ["a", "b", "c"]);
  assert.deepEqual(r.hold, []);
});

test("绝不碰人已经批准或驳回的条目——夜里不能覆盖手工做过的审核", () => {
  const r = pickAutoApprovals([
    row({ id: "human-approved", reviewDecision: "approved" }),
    row({ id: "human-rejected", reviewDecision: "rejected" }),
    row({ id: "fresh" }),
  ], BATCH);
  assert.deepEqual(r.approve, ["fresh"]);
  assert.ok(!r.hold.some((h) => h.id.startsWith("human")), "也不该出现在 hold 里：它们根本不在这次的处理范围");
});

test("不是本批的条目不碰（旧批次的待审核留给人，不被夜里顺手批掉）", () => {
  const r = pickAutoApprovals([row({ id: "old", extractionBatchId: "upcoming-20260912165343" }), row({ id: "new" })], BATCH);
  assert.deepEqual(r.approve, ["new"]);
});

test("标题为空、状态不认识的不批准，并说明原因", () => {
  const r = pickAutoApprovals([row({ id: "e", title: "  " }), row({ id: "s", status: "weird" }), row({ id: "ok" })], BATCH);
  assert.deepEqual(r.approve, ["ok"]);
  assert.match(r.hold.find((h) => h.id === "e").reason, /标题为空/);
  assert.match(r.hold.find((h) => h.id === "s").reason, /状态不认识/);
});

test("命中敏感兜底的不批准，留给人看（钱款、证件号等不能直接上首页）", () => {
  const r = pickAutoApprovals([
    row({ id: "money", title: "转账给保姆" }),
    row({ id: "id", title: "补办身份证" }),
    row({ id: "note", note: "记得带红包" }),
    row({ id: "ok", title: "带张年去打疫苗" }),
  ], BATCH);
  assert.deepEqual(r.approve, ["ok"]);
  assert.deepEqual(r.hold.map((h) => h.id).sort(), ["id", "money", "note"]);
  assert.match(r.hold[0].reason, /敏感/);
});

test("一晚批准数量超过上限就一条都不批——数量异常本身就是要看的信号", () => {
  const many = Array.from({ length: MAX_AUTO_APPROVALS + 1 }, (_, i) => row({ id: `x${i}` }));
  const r = pickAutoApprovals(many, BATCH);
  assert.equal(r.tooMany, true);
  assert.deepEqual(r.approve, []);
  assert.equal(r.hold.length, MAX_AUTO_APPROVALS + 1);
  // 刚好等于上限则正常批准
  const atLimit = pickAutoApprovals(many.slice(0, MAX_AUTO_APPROVALS), BATCH);
  assert.equal(atLimit.tooMany, false);
  assert.equal(atLimit.approve.length, MAX_AUTO_APPROVALS);
});

test("没有本批条目时什么也不做", () => {
  assert.deepEqual(pickAutoApprovals([], BATCH), { approve: [], hold: [], tooMany: false });
});

test("审核人标记是固定的、可审计的", () => {
  assert.equal(AUTO_REVIEWER, "auto-nightly");
});
