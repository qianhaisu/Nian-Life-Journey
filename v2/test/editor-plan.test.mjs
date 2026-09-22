import test from "node:test";
import assert from "node:assert/strict";
import {
  pickDays, isReadable, sensitiveHits, extractJson, checkDecision, timeWordProblems, afterFailure, addDays, shanghaiToday,
  READY_LAG_DAYS, MAX_DAYS_PER_RUN, MAX_ATTEMPTS,
} from "../scripts/editor/plan.mjs";

// 2026-09-20：夜间编辑的决策层。全部合成数据。最要紧的是「什么时候不该写」。

const always = () => true;
const noneCovered = () => new Set();

test("shanghaiToday 不依赖机器时区：UTC 16:30 已经是上海的次日", () => {
  assert.equal(shanghaiToday(new Date("2026-09-19T16:30:00Z")), "2026-09-20");
  assert.equal(shanghaiToday(new Date("2026-09-19T15:59:00Z")), "2026-09-19");
});

test("只写「今天 − 1」及更早的日子，不写今天", () => {
  // 2026-09-21 已将延迟改为一天：今天 9/21，9/19 和 9/20 可写，9/21 不可写。
  const { write } = pickDays({ today: "2026-09-21", months: ["2026-09"], coveredDays: () => new Set(Array.from({ length: 18 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`)), hasMaterial: always, state: {} });
  assert.deepEqual(write, ["2026-09-19", "2026-09-20"]);
  assert.equal(READY_LAG_DAYS, 1);
});

test("9/20 夜间可处理已同步的 9/19，仍不处理 9/20 当天", () => {
  const covered = () => new Set(Array.from({ length: 18 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`));
  const { write } = pickDays({ today: "2026-09-20", months: ["2026-09"], coveredDays: covered, hasMaterial: always, state: {} });
  assert.deepEqual(write, ["2026-09-19"], "cutoff 是昨天 9/19，不处理今天");
});

test("已经有内容的日子绝不重写——手工编辑过的天不能被覆盖", () => {
  const { write } = pickDays({ today: "2026-09-30", months: ["2026-09"], coveredDays: () => new Set(["2026-09-05"]), hasMaterial: always, state: {} });
  assert.ok(!write.includes("2026-09-05"));
});

test("每晚最多写 MAX_DAYS_PER_RUN 天，最旧的先", () => {
  const { write } = pickDays({ today: "2026-09-30", months: ["2026-09"], coveredDays: noneCovered, hasMaterial: always, state: {} });
  assert.equal(write.length, MAX_DAYS_PER_RUN);
  assert.deepEqual(write, ["2026-09-01", "2026-09-02", "2026-09-03"]);
});

test("没有可读材料的日子不问模型，只记一笔", () => {
  const { write, skipped } = pickDays({ today: "2026-09-10", months: ["2026-09"], coveredDays: noneCovered, hasMaterial: (d) => d !== "2026-09-03", state: {} });
  assert.ok(!write.includes("2026-09-03"));
  assert.ok(skipped.some((s) => s.day === "2026-09-03" && /没有/.test(s.reason)));
});

test("held 的日子不再自动重试；skipped 的日子静默跳过", () => {
  const state = { "2026-09-02": { attempts: 3, status: "held" }, "2026-09-03": { attempts: 0, status: "skipped" } };
  const { write, skipped } = pickDays({ today: "2026-09-10", months: ["2026-09"], coveredDays: noneCovered, hasMaterial: always, state });
  assert.ok(!write.includes("2026-09-02") && !write.includes("2026-09-03"));
  assert.ok(skipped.some((s) => s.day === "2026-09-02" && /hold/.test(s.reason)));
  assert.ok(!skipped.some((s) => s.day === "2026-09-03"), "skipped 不再每晚喊一遍");
});

test("月初跨月：两个月都看，按日期先后", () => {
  const { write } = pickDays({ today: "2026-10-03", months: ["2026-10", "2026-09"], coveredDays: (m) => (m === "2026-09" ? new Set(Array.from({ length: 29 }, (_, i) => `2026-09-${String(i + 1).padStart(2, "0")}`)) : new Set()), hasMaterial: always, state: {} });
  assert.deepEqual(write, ["2026-09-30", "2026-10-01", "2026-10-02"]);
});

test("addDays 跨月跨年", () => {
  assert.equal(addDays("2026-09-30", 1), "2026-10-01");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
});

test("消息过滤：只删明显不是文字内容的，不做语义判断", () => {
  assert.equal(isReadable("[media]"), false);
  assert.equal(isReadable("[图片]"), false);
  assert.equal(isReadable("\\[表情包\\]"), false);
  assert.equal(isReadable('"阿静" 撤回了一条消息0'), false);
  assert.equal(isReadable("当前微信版本不支持展示该内容，请升级至最新版本。"), false);
  assert.equal(isReadable("> 好奇星大兵: 听到警报抱头，趴下 这么厉害吗"), false, "引用消息的副本");
  assert.equal(isReadable("   "), false);
  assert.equal(isReadable("今天他自己吃饭"), true);
  assert.equal(isReadable("真听话[捂脸]"), true, "带表情的文字要保留");
});

test("敏感内容兜底：命中就返回类别（交给人看，不发布）", () => {
  const hit = (paragraphs, title = "标题") => sensitiveHits({ title, paragraphs }).map((h) => h.category);
  assert.deepEqual(hit(["今天没事。"]), []);
  assert.ok(hit(["妈妈发了红包。"]).includes("钱款"));
  assert.ok(hit(["他今天拉了一次。"]).includes("排泄"));
  assert.ok(hit(["他今天拉了两次。"]).includes("排泄"));
  assert.ok(hit(["他又拉了。"]).includes("排泄"));
  assert.ok(hit(["拉了臭臭。"]).includes("排泄"));
  // 回归：「拉了」单独出现在别的语境不该命中（手补 9/18 时被「拉了防空警报」误伤）
  assert.deepEqual(hit(["杭州拉了防空警报。"]), []);
  assert.deepEqual(hit(["他拉了拉老师的手。"]), []);
  assert.deepEqual(hit(["妈妈把窗帘拉了起来。"]), []);
  assert.ok(hit(["爸爸妈妈吵架了。"]).includes("争执"));
  assert.ok(hit(["头上有一条疤。"]).includes("伤痕"));
  assert.ok(hit(["电话 13812345678"]).includes("证件号码"));
  assert.ok(hit(["正文没事"], "拉肚子").includes("排泄"), "标题也查");
});

test("extractJson：容忍前后加话、代码块、字符串里的大括号", () => {
  assert.deepEqual(extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(extractJson('好的，这是结果：\n```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('{"t":"含 } 和 { 的字符串","n":2} 后面还有话'), { t: "含 } 和 { 的字符串", n: 2 });
  assert.equal(extractJson("没有 JSON"), null);
  assert.equal(extractJson('{"a":'), null, "不完整的 JSON");
});

const KEYS = new Set(["s1", "s2", "s3"]);
const good = { decision: "write", kind: "story", title: "标题", paragraphs: [{ text: "第一段", sources: ["s1"] }] };

test("checkDecision：合规的 write 与 skip 通过", () => {
  assert.equal(checkDecision(good, KEYS).ok, true);
  assert.equal(checkDecision({ decision: "skip", reason: "只有大人的事务" }, KEYS).ok, true);
});

test("checkDecision：形状与篇幅不合就当失败，不凑合用", () => {
  const bad = (over) => checkDecision({ ...good, ...over }, KEYS);
  const para = (text, sources = ["s1"]) => ({ text, sources });
  assert.equal(checkDecision(null, KEYS).ok, false);
  assert.equal(checkDecision({ decision: "skip" }, KEYS).ok, false, "skip 必须有理由");
  assert.equal(checkDecision({ decision: "maybe" }, KEYS).ok, false);
  assert.equal(bad({ kind: "visual-description" }).ok, false, "夜间不写画面描述");
  assert.equal(bad({ title: "" }).ok, false);
  assert.equal(bad({ title: "字".repeat(31) }).ok, false);
  assert.equal(bad({ paragraphs: [] }).ok, false);
  assert.equal(bad({ paragraphs: [para("a"), para("")] }).ok, false);
  assert.equal(bad({ paragraphs: Array(7).fill(para("段")) }).ok, false);
  assert.equal(bad({ paragraphs: [para("字".repeat(901))] }).ok, false);
});

test("checkDecision：每一段都必须自己交代来源（整稿一个来源列表不再够用）", () => {
  const bad = (paragraphs) => checkDecision({ ...good, paragraphs }, KEYS);
  assert.equal(bad(["旧格式的字符串段落"]).ok, false, "字符串段落不收：没有来源");
  assert.match(bad([{ text: "有正文" }]).error, /第 1 段没有列出来源/);
  assert.match(bad([{ text: "有正文", sources: [] }]).error, /第 1 段没有列出来源/);
  assert.match(bad([{ text: "甲", sources: ["s1"] }, { text: "乙", sources: ["s9"] }]).error, /第 2 段.*不存在的短键：s9/);
  assert.equal(bad([{ text: "甲", sources: ["s1"] }, { text: "乙", sources: ["s2", "s3"] }]).ok, true);
});

test("时间词核对：这一段写的时段，要和这一段来源消息的时间对得上", () => {
  assert.deepEqual(timeWordProblems("上午妈妈叮嘱老师。", [9]), []);
  assert.deepEqual(timeWordProblems("上午妈妈叮嘱老师。", [18, 19]), ["上午"], "来源全在傍晚却写了上午");
  assert.deepEqual(timeWordProblems("晚上班级群里写了小结。", [19]), []);
  assert.deepEqual(timeWordProblems("晚上班级群里写了小结。", [9]), ["晚上"]);
  assert.deepEqual(timeWordProblems("上午叮嘱，下午又问。", [9, 13]), [], "一段里多个来源、多个时间词：各自有对得上的就行");
  assert.deepEqual(timeWordProblems("没有时间词的一段。", [3]), []);
  assert.deepEqual(timeWordProblems("上午发生了什么。", []), [], "没有来源时间就不核对，由「必须有来源」去拦");
});

test("时间词核对：边界两头故意放宽，只拦明显对不上的（不天天误拦）", () => {
  assert.deepEqual(timeWordProblems("中午问了一句。", [13]), [], "13:08 说中午可以接受");
  assert.deepEqual(timeWordProblems("下午问了一句。", [12]), [], "12 点说下午也不拦");
  assert.deepEqual(timeWordProblems("中午吃饭。", [21]), ["中午"]);
});

test("失败计数：连续失败 MAX_ATTEMPTS 次就 hold", () => {
  let s = afterFailure(undefined);
  assert.deepEqual(s, { attempts: 1, status: "retry" });
  for (let i = 1; i < MAX_ATTEMPTS; i += 1) s = afterFailure(s);
  assert.deepEqual(s, { attempts: MAX_ATTEMPTS, status: "held" });
});
