import test from "node:test";
import assert from "node:assert/strict";
import { validateDayText, quotesOf, normalizeForQuote, UNCONFIRMED_NAMES } from "../scripts/editor/validate-day.mjs";

// 2026-09-20：「每晚自动整理」的守门人。全部用合成文字，不含任何真实家人内容。
// 这一组锁的是最容易悄悄漏掉的地方：引语必须原字、必须出在被引用的那几条里、真实姓名连引号里也不行。

const day = (paragraphs, title = "一个标题") => ({ day: "2026-09-18", title, paragraphs });
const SRC = ["老师说：今天他自己爬上了小滑梯，还笑了", "妈妈：真听话[捂脸]"];

test("引语在被引用的原消息里逐字找得到就通过", () => {
  assert.deepEqual(validateDayText(day(["老师说「今天他自己爬上了小滑梯」。"]), SRC).errors, []);
});

test("引语编造或改写一个字就拦下", () => {
  const { errors } = validateDayText(day(["老师说「今天他自己爬上了大滑梯」。"]), SRC);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /引语找不到来源/);
});

test("引语必须出在被引用的那几条里：别的消息里有也不算", () => {
  // 「真听话」只在第二条里；如果调用方只把第一条当作来源，就该拦下
  const { errors } = validateDayText(day(["妈妈说「真听话」。"]), [SRC[0]]);
  assert.match(errors.join(), /引语找不到来源/);
});

test("比对口径：表情、空白、转义符、中英文标点差异不影响", () => {
  assert.deepEqual(validateDayText(day(["妈妈说「真听话」。"]), ["妈妈：真 听话[捂脸]"]).errors, []);
  assert.deepEqual(validateDayText(day(["他说「好！」。"]), ["他说：好!"]).errors, []);
  assert.equal(normalizeForQuote("a\\[b\\]"), "a[b]".replace(/\[[^\]\s]{1,8}\]/g, ""), "转义的方括号先还原再当表情去掉");
});

test("省略号节选：每一段都要在同一条来源里", () => {
  const src = ["今天他自己吃饭，吃得很香，还要了第二碗"];
  assert.deepEqual(validateDayText(day(["家里说「自己吃饭……还要了第二碗」。"]), src).errors, []);
  // 两段分别在两条不同的消息里，不算同一条
  const split = ["今天他自己吃饭", "吃得很香还要了第二碗"];
  assert.match(validateDayText(day(["家里说「自己吃饭……还要了第二碗」。"]), split).errors.join(), /引语找不到来源/);
});

test("引号不配对就拦下", () => {
  assert.match(validateDayText(day(["老师说「今天他自己爬上了小滑梯"]), SRC).errors.join(), /引号不配对/);
});

test("未确认称呼：引号外拦下，引号里（别人原话的一部分）放行", () => {
  for (const name of UNCONFIRMED_NAMES) {
    assert.match(validateDayText(day([`${name}说他吃得很好。`]), SRC).errors.join(), /未确认称呼/, name);
  }
  assert.deepEqual(validateDayText(day(["有人说「外婆来接他了」。"]), ["外婆来接他了"]).errors, []);
});

test("真实姓名连引号里也不行，必须换成称呼", () => {
  const { errors } = validateDayText(day(["妈妈说「张三你来一下」。"]), ["张三你来一下"], { realNames: ["张三"] });
  assert.match(errors.join(), /真实姓名/);
  // 没提供姓名清单时不误报
  assert.deepEqual(validateDayText(day(["妈妈说「张三你来一下」。"]), ["张三你来一下"]).errors, []);
});

test("技术字样、无来源的「第一次」、不符的岁数", () => {
  assert.match(validateDayText(day(["这是微信群里发的。"]), SRC).errors.join(), /技术字样/);
  assert.match(validateDayText(day(["他第一次自己爬上滑梯。"]), SRC).errors.join(), /「第一次」/);
  assert.deepEqual(validateDayText(day(["他第一次自己爬上滑梯。"]), ["他第一次自己爬上滑梯"]).errors, [], "来源里就这么说就放行");
  assert.match(validateDayText(day(["他已经两岁了。"]), SRC).errors.join(), /岁数/);
});

test("标题也要过关，不只正文", () => {
  assert.match(validateDayText(day(["正文没问题。"], "微信里的一天"), SRC).errors.join(), /标题: 正文含工程/);
});

test("一天既没标题也没正文是错的", () => {
  assert.match(validateDayText({ day: "2026-09-18", title: null, paragraphs: [] }, SRC).errors.join(), /既没有标题也没有正文/);
});

test("quotesOf：嵌套只取最外层", () => {
  assert.deepEqual(quotesOf("他说「你说『好』」然后走了"), ["你说『好』"]);
  assert.deepEqual(quotesOf("他说「你说「好」吧」"), ["你说「好」吧"]);
});
