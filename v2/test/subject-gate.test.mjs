// The gate that decides which chat messages may become a record of a child's life. Every case here
// is drawn from something production actually published or nearly published.
import test from "node:test";
import assert from "node:assert/strict";
import { subjectGateFor, passesSubjectGate, isEmptyMessage, namesSubject } from "../lib/organizer/subject-gate.ts";

const NURSERY = "conversation:2109e1e89306b57b8334d349";
const MAIN = "conversation:a673c0e0563be6ecf1867094";
const MOTHER = "conversation:0567a44e538fc41f22b57097";

const item = (text, senderDigest = "d-mother", over = {}) => ({
  itemId: `i-${Math.random().toString(36).slice(2)}`, sourceId: `s-${text.slice(0, 6)}-${senderDigest}`,
  sentAt: "2026-05-01T02:00:00.000Z", senderRole: "妈妈", senderDigest, text,
  contentTypes: ["daily"], mediaRefs: [], locator: { document: "d.json", recordOrdinal: 1 }, spans: [], tier: "firsthand_observation", ...over,
});
const windowOf = (items) => ({ windowId: "w", conversationId: "c", profileId: "p", activityDate: "2026-05-01", items, neighbors: { before: [], after: [] }, mediaBindings: [], stats: { messageCount: items.length, imageCount: 0 }, timeRange: { from: items[0]?.sentAt ?? "2026-05-01T00:00:00.000Z", to: "2026-05-01T23:59:59.000Z" } });

test("a conversation nobody has classified is treated as a private chat, never as a family group", () => {
  // Getting this default wrong in the other direction publishes a stranger's day.
  assert.equal(subjectGateFor("conversation:something-new").policy, "private");
  assert.equal(subjectGateFor(NURSERY).policy, "all");
  assert.equal(subjectGateFor(MAIN).policy, "group");
  assert.equal(subjectGateFor(MOTHER).policy, "private");
});

test("in the nursery group everything counts, because the group exists for one child", () => {
  const gate = subjectGateFor(NURSERY);
  const w = windowOf([item("今天午觉睡了两个小时", "d-teacher"), item("下午加餐吃了半个香蕉", "d-teacher")]);
  const verdict = passesSubjectGate(w, gate);
  assert.equal(verdict.passes, true);
  assert.equal(verdict.kept.length, 2);
  assert.equal(verdict.rejected.length, 0);
});

test("a private chat keeps only what names him, and never resolves a bare pronoun", () => {
  // Production 2026-01: "你几点下班" became a record of his life. So did a used-car negotiation.
  const gate = subjectGateFor(MOTHER);
  const w = windowOf([
    item("你几点下班"),
    item("19款17万公里也报价11万", "d-father"),
    item("我们还是要多训训价", "d-father"),
    item("张小年今天午觉睡了两个小时"),
    item("他今天很乖"),
  ]);
  const verdict = passesSubjectGate(w, gate);
  assert.deepEqual(verdict.kept.map((i) => i.text), ["张小年今天午觉睡了两个小时"]);
  assert.equal(verdict.rejected.length, 4);
  assert.ok(!verdict.kept.some((i) => i.text.includes("报价")), "the car negotiation is not his life");
  assert.ok(!verdict.kept.some((i) => i.text === "他今天很乖"), "a bare pronoun between two adults is not resolvable here");
});

test("in a group, a naming message carries the same speaker's next lines, and stops at anyone else", () => {
  const gate = subjectGateFor(MAIN);
  const w = windowOf([
    item("小年今天自己走了两步", "d-nanny"),
    item("走了三四步就坐下了", "d-nanny"),
    item("我这边会议改到五点", "d-father"),
    item("还是那个价格", "d-nanny"),
  ]);
  const verdict = passesSubjectGate(w, gate);
  assert.deepEqual(verdict.kept.map((i) => i.text), ["小年今天自己走了两步", "走了三四步就坐下了"]);
  assert.ok(verdict.rejected.some((i) => i.text === "我这边会议改到五点"), "another speaker interrupts the run");
  assert.ok(verdict.rejected.some((i) => i.text === "还是那个价格"), "…and the run does not resume afterwards");
});

test("two people sharing a narrative label do not inherit each other's eligibility", () => {
  // Every nursery account reads as 老师. One teacher naming him must not make a different teacher's
  // unrelated message eligible, so the run is keyed by speaker identity, not by the label shown.
  const gate = subjectGateFor(MAIN);
  const w = windowOf([
    item("年年今天午睡很好", "d-teacher-a", { senderRole: "老师" }),
    item("明天记得带被子来", "d-teacher-b", { senderRole: "老师" }),
  ]);
  const verdict = passesSubjectGate(w, gate);
  assert.deepEqual(verdict.kept.map((i) => i.text), ["年年今天午睡很好"]);
});

test("placeholders and stickers never pass, in any conversation", () => {
  for (const text of ["[media]", "[图片]", "[语音通话] 01:57", "[表情包]", "https://example.com/x", "   ", "😀😀"]) {
    assert.equal(isEmptyMessage(text), true, `${JSON.stringify(text)} carries no claim`);
  }
  const verdict = passesSubjectGate(windowOf([item("[media]", "d-teacher"), item("[语音通话] 01:57", "d-teacher")]), subjectGateFor(NURSERY));
  assert.equal(verdict.passes, false, "even where every message is eligible, empty ones are not material");
  assert.equal(verdict.kept.length, 0);
});

test("a placeholder breaks a group run rather than extending it", () => {
  const gate = subjectGateFor(MAIN);
  const w = windowOf([item("小年今天笑了", "d-nanny"), item("[表情包]", "d-nanny"), item("你到家了吗", "d-nanny")]);
  const verdict = passesSubjectGate(w, gate);
  assert.deepEqual(verdict.kept.map((i) => i.text), ["小年今天笑了"]);
});

test("naming is by what the family actually calls him, not only his full name", () => {
  for (const name of ["张年", "张小年", "小年", "年年", "崽崽", "宝宝", "宝贝"]) {
    assert.equal(namesSubject(`今天${name}吃了两碗`), true, name);
  }
  assert.equal(namesSubject("今天他吃了两碗"), false, "a pronoun is not a name");
});

test("a window with nothing eligible is dropped before any model is called", () => {
  const verdict = passesSubjectGate(windowOf([item("你几点下班"), item("我在开会")]), subjectGateFor(MOTHER));
  assert.equal(verdict.passes, false, "no model call, no page, no cost");
});
