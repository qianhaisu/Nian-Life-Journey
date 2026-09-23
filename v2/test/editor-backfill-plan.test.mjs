import test from "node:test";
import assert from "node:assert/strict";
import { planBackfill, dayTarget, attachEvents } from "../scripts/editor/backfill-plan.mjs";
import { applyRewrites } from "../scripts/editor/regen-month.mjs";
import { validateMonthContent } from "../lib/month-content.ts";

// 2026-09-23：审核通过的新事件自动进月页。合成数据。
const day = (d, extra = {}) => ({ day: d, kind: "story", title: `${d}的标题`, paragraphs: ["正文。"], firstScreenMediaIds: ["m1"], expandedMediaIds: ["m1"], eventIds: ["old"], sourceIds: ["s-old"], _source: "machine", ...extra });
const contents = () => new Map([["2025-12", { schema: "nianlife.month-content/1", month: "2025-12", days: [day("2025-12-04"), day("2025-12-05", { _source: undefined }), day("2025-12-06", { _source: "human" })] }]]);
const ev = (id, d, extra = {}) => ({ id, day: d, review: "approved", mediaIds: [], sourceKeys: [], ...extra });

test("每条事件的去向", () => {
  const { decisions } = planBackfill({
    contents: contents(),
    editorialDropped: new Set(["e-dropped"]),
    citedKeysByDay: new Map([["2025-12-04", new Set(["k1", "k2"])]]),
    events: [
      ev("e-pre", "2024-12-30"),
      ev("e-dropped", "2025-12-04"),
      ev("e-wait", "2025-12-04", { review: "needs_human_review" }),
      ev("e-noreview", "2025-12-04", { review: null }),
      ev("e-dup", "2025-12-04", { sourceKeys: ["k1", "k2", "k9"] }),
      ev("e-new-text", "2025-12-04", { sourceKeys: ["k7"] }),
      ev("e-unmarked", "2025-12-05"),
      ev("e-human", "2025-12-06"),
      ev("e-newday", "2025-12-07"),
    ],
  });
  assert.deepEqual(Object.fromEntries(decisions.map((d) => [d.id, d.action])), {
    "e-pre": "skip:prebirth", "e-dropped": "skip:editorial", "e-wait": "skip:not-approved", "e-noreview": "skip:not-approved",
    "e-dup": "attach", "e-new-text": "rewrite", "e-unmarked": "blocked:protected", "e-human": "blocked:protected", "e-newday": "new-day",
  });
});

test("同一天多条事件合并成一次；有一条要重写就整天重写，被 attach 的也挂上", () => {
  const { days } = planBackfill({
    contents: contents(), citedKeysByDay: new Map([["2025-12-04", new Set(["k1"])]]),
    events: [ev("a", "2025-12-04", { sourceKeys: ["k1"] }), ev("b", "2025-12-04", { sourceKeys: ["k5"], mediaIds: ["n1", "n2"] })],
  });
  assert.equal(days.length, 1);
  assert.deepEqual(days[0], { day: "2025-12-04", month: "2025-12", action: "rewrite", eventIds: ["a", "b"], mediaIds: ["n1", "n2"] });
});

test("dayTarget：旧照片在前、新照片接后面，事件取并集；新的一天首屏取前三张", () => {
  const t = dayTarget(day("2025-12-04"), { day: "2025-12-04", eventIds: ["b"], mediaIds: ["m1", "n1"] });
  assert.deepEqual(t.expandedMediaIds, ["m1", "n1"]);
  assert.deepEqual(t.firstScreenMediaIds, ["m1"]);
  assert.deepEqual(t.eventIds, ["old", "b"]);
  const fresh = dayTarget(null, { day: "2025-12-07", eventIds: ["c"], mediaIds: ["x1", "x2", "x3", "x4"] }, { ageLabel: "0岁11个月" });
  assert.deepEqual(fresh.firstScreenMediaIds, ["x1", "x2", "x3"]);
});

test("attach 只挂事件 id，文字照片不动；受保护的天拒绝", () => {
  const c = contents().get("2025-12");
  const next = attachEvents(c, "2025-12-04", ["e-dup"]);
  const d = next.days[0];
  assert.deepEqual(d.eventIds, ["old", "e-dup"]);
  assert.deepEqual({ ...d, eventIds: undefined, eventId: undefined }, { ...c.days[0], eventIds: undefined, eventId: undefined });
  assert.throws(() => attachEvents(c, "2025-12-06", ["x"]), /受保护/);
  assert.throws(() => attachEvents(c, "2025-12-05", ["x"]), /受保护/);
});

test("applyRewrites：新写的一天带上新照片和事件，整个月仍能通过应用的校验；受保护的天抛错", () => {
  const base = contents().get("2025-12");
  const r = { day: "2025-12-07", ok: true, decision: { kind: "story", title: "新的一天", paragraphs: [{ text: "他在玩。", sources: ["s1"] }] }, sourceIds: ["s-new"], evidence: { quotes: [], persons: [] }, eventIds: ["c"], expandedMediaIds: ["x1"], firstScreenMediaIds: ["x1"] };
  const next = applyRewrites(base, [r], { now: "2026-09-23T00:00:00Z" });
  const d = next.days.find((x) => x.day === "2025-12-07");
  assert.deepEqual([d.eventIds, d.expandedMediaIds, d._source], [["c"], ["x1"], "machine"]);
  assert.ok(validateMonthContent(next, "2025-12"));
  assert.throws(() => applyRewrites(base, [{ ...r, day: "2025-12-06" }]), /受保护/);
});
