import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubjectBounded } from "../lib/organizer/subject-resolver.ts";
import { buildEvidenceWindows } from "../lib/organizer/evidence/window.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { subjectGateFor, CARE_CONVERSATIONS, DAYCARE_CONVERSATION } from "../lib/organizer/subject-gate.ts";
import { needsSecondLook, withSecondLook } from "../lib/organizer/deepseek-editor.ts";
import { MEMORY_EDITOR_V4_PROMPT_VERSION, MEMORY_EDITOR_V4_SYSTEM_PROMPT } from "../lib/organizer/prompts/memory-editor-v4.ts";

// 2026-09-23 第四轮主体判断抽查：60 个被判「与张年无关」的窗口里 15 个误拒（25%）。
// 三条规律各有一条测试：照护群里照护者不点名的汇报；未登记的会话 id 落到 private；模型判无关压过了确定性核对。
const SUBJECT = { primaryName: "张年", aliases: ["张小年", "小年", "崽"] };
const NANNY = senderDigestForDisplayName("hxx.");
const MOTHER = senderDigestForDisplayName("阿静");
const CARE = "conversation:4f8670546dd34b592448554d"; // 作战部队 JSON
const src = (conv, o) => ({ id: o.id, profileId: "p", sourceType: "wechat", contentTypes: ["family"], contributorId: o.sender, capturedAt: o.at, text: o.text, mediaIds: [], visibility: "family", metadata: { senderDigest: o.sender }, sourceLabel: conv });
const win = (conv, items) => { const w = buildEvidenceWindows(conv, "p", items.map((o) => src(conv, o)), { dailyTraces: [], lifeEvents: [] }); return w[w.length - 1]; };
const opts = { singleChildHousehold: true, registry: FAMILY_REGISTRY };

test("照护群里雪姨不点名的汇报：解析为他（caregiver_report_in_care_conversation）", () => {
  const w = win(CARE, [{ id: "n1", at: "2025-08-13T13:05:29+08:00", sender: NANNY, text: "他再过段时间就爬上去了" }, { id: "m1", at: "2025-08-13T13:06:00+08:00", sender: MOTHER, text: "指日可待" }]);
  const r = resolveSubjectBounded(w, SUBJECT, opts);
  assert.equal(r.level, "contextually_resolved");
  assert.deepEqual(r.signals, ["caregiver_report_in_care_conversation"]);
  assert.deepEqual(r.supportingSourceIds, ["n1"]);
});

test("同样的话在私聊里、或出自非照护者，都不这样解析", () => {
  const priv = win("conversation:0567a44e538fc41f22b57097", [{ id: "n1", at: "2025-08-13T13:05:29+08:00", sender: NANNY, text: "他再过段时间就爬上去了" }]);
  assert.equal(resolveSubjectBounded(priv, SUBJECT, opts).level, "unresolved");
  const mom = win(CARE, [{ id: "m1", at: "2025-08-13T13:05:29+08:00", sender: MOTHER, text: "他今天好累" }]);
  assert.equal(resolveSubjectBounded(mom, SUBJECT, opts).level, "unresolved");
});

test("有别的孩子在场（哥哥、同学……）时照护者的「他」仍不解析", () => {
  const w = win(CARE, [{ id: "n1", at: "2025-08-13T13:05:29+08:00", sender: NANNY, text: "他跟哥哥抢玩具" }]);
  assert.equal(resolveSubjectBounded(w, SUBJECT, opts).level, "unresolved");
});

test("会话登记：作战部队 JSON 是 group、星辰星班切片是 all、完全重复的乳儿班旧 id 排除", () => {
  assert.equal(subjectGateFor(CARE).policy, "group");
  assert.equal(subjectGateFor("conversation:f4f28678abd80b3e391c0885").policy, "all");
  assert.equal(subjectGateFor("conversation:d64551c8e1cea882635e3969").policy, "excluded");
  assert.ok(CARE_CONVERSATIONS.has(DAYCARE_CONVERSATION) && CARE_CONVERSATIONS.has(CARE));
  assert.ok(!CARE_CONVERSATIONS.has("conversation:0567a44e538fc41f22b57097"), "私聊不是照护群");
});

test("模型判无关、确定性核对却找到了他：复核一次；核对也没找到就不复核", () => {
  const found = { level: "explicit", signals: ["named_in_window"], blockers: [], supportingSourceIds: ["a"] };
  assert.equal(needsSecondLook("gate_a_family_context_only", found), true);
  assert.equal(needsSecondLook("gate_a_unrelated", found), true);
  assert.equal(needsSecondLook(undefined, found), false);
  assert.equal(needsSecondLook("gate_a_unrelated", { ...found, level: "unresolved" }), false);
  const body = withSecondLook(JSON.stringify({ model: "deepseek-flash", messages: [{ role: "user", content: "原提示" }] }), found);
  const parsed = JSON.parse(body);
  assert.equal(parsed.model, "deepseek-flash");
  assert.match(parsed.messages[0].content, /^原提示[\s\S]*复核：[\s\S]*来源 a/);
});

test("提示词 v4.2：召回优先，写明照护者汇报与名字出现在成人闲聊里的情形", () => {
  assert.equal(MEMORY_EDITOR_V4_PROMPT_VERSION, "memory-editor-v4.2");
  assert.doesNotMatch(MEMORY_EDITOR_V4_SYSTEM_PROMPT, /宁可漏掉，不可误收/);
  assert.match(MEMORY_EDITOR_V4_SYSTEM_PROMPT, /照护者（雪姨、托班老师）在照护群里不点名说「他」/);
  assert.match(MEMORY_EDITOR_V4_SYSTEM_PROMPT, /家里的猫也叫/);
});
