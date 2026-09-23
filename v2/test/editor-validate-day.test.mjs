import test from "node:test";
import assert from "node:assert/strict";
import { validateDayText, quotesOf, normalizeForQuote, UNCONFIRMED_NAMES, VAGUE_PERSON, personMentions, attributedLabel } from "../scripts/editor/validate-day.mjs";
import { unconfirmedNames, registeredLabels, labelForSender, KINSHIP_TERMS } from "../scripts/editor/identity-rules.mjs";
import { FAMILY_REGISTRY } from "../lib/organizer/family-registry.ts";
import { senderDigestForDisplayName } from "../lib/organizer/identity.ts";

// 2026-09-20：「每晚自动整理」的守门人。全部用合成文字，不含任何真实家人内容。
// 这一组锁的是最容易悄悄漏掉的地方：引语必须原字、必须出在被引用的那几条里、真实姓名连引号里也不行。
// 2026-09-23：加上引语归属（说话人 = 原消息发送人）、点名证据、含糊指人写法、称谓白名单来自注册表。

const day = (paragraphs, title = "一个标题") => ({ day: "2026-09-18", title, paragraphs });
const src = (speaker, text, id = `s-${speaker}-${text.length}`) => ({ id, speaker, text });
const SRC = [src("老师", "今天他自己爬上了小滑梯，还笑了"), src("妈妈", "真听话[捂脸]")];

test("引语在被引用的原消息里逐字找得到、说话人也对就通过", () => {
  assert.deepEqual(validateDayText(day(["老师说「今天他自己爬上了小滑梯」。"]), SRC).errors, []);
});

test("引语编造或改写一个字就拦下", () => {
  const { errors } = validateDayText(day(["老师说「今天他自己爬上了大滑梯」。"]), SRC);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /引语找不到来源/);
});

test("引语必须出在被引用的那几条里：别的消息里有也不算", () => {
  const { errors } = validateDayText(day(["妈妈说「真听话」。"]), [SRC[0]]);
  assert.match(errors.join(), /引语找不到来源/);
});

test("比对口径：表情、空白、转义符、中英文标点差异不影响", () => {
  assert.deepEqual(validateDayText(day(["妈妈说「真听话」。"]), [src("妈妈", "真 听话[捂脸]")]).errors, []);
  assert.deepEqual(validateDayText(day(["爸爸说「好！」。"]), [src("爸爸", "好!")]).errors, []);
  assert.equal(normalizeForQuote("a\\[b\\]"), "a[b]".replace(/\[[^\]\s]{1,8}\]/g, ""), "转义的方括号先还原再当表情去掉");
});

test("省略号节选：每一段都要在同一条来源里", () => {
  assert.deepEqual(validateDayText(day(["雪姨说「自己吃饭……还要了第二碗」。"]), [src("雪姨", "今天他自己吃饭，吃得很香，还要了第二碗")]).errors, []);
  const split = [src("雪姨", "今天他自己吃饭"), src("雪姨", "吃得很香还要了第二碗")];
  assert.match(validateDayText(day(["雪姨说「自己吃饭……还要了第二碗」。"]), split).errors.join(), /引语找不到来源/);
});

test("引号不配对就拦下", () => {
  assert.match(validateDayText(day(["老师说「今天他自己爬上了小滑梯"]), SRC).errors.join(), /引号不配对/);
});

// ── 引语归属 ────────────────────────────────────────────────────────────────

test("引语归属：写成外公说、原消息其实是外婆发的 → 拦下，并说出真正的发送人", () => {
  const sources = [src("外婆", "小年年，今天晚上穿新衣服特别帅气")];
  const { errors } = validateDayText(day(["外公说「今天晚上穿新衣服特别帅气」。"]), sources);
  assert.match(errors.join(), /引语归属不对.*写成外公说的，原消息发送人是外婆/);
  assert.deepEqual(validateDayText(day(["外婆说「今天晚上穿新衣服特别帅气」。"]), sources).errors, []);
});

test("引语归属：未登记的人发的话，不能归到任何称谓名下", () => {
  const { errors } = validateDayText(day(["妈妈说「他没感觉」。"]), [src(null, "他没感觉")]);
  assert.match(errors.join(), /原消息发送人是未登记的人/);
});

test("引语没写说话人就拦下；同一句里接着的第二句引语沿用前一个说话人", () => {
  assert.match(validateDayText(day(["中午问「这是被咬了吗」。"]), [src("妈妈", "这是被咬了吗")]).errors.join(), /没有写明是谁说的/);
  const sources = [src("妈妈", "痛吗"), src("雪姨", "他没感觉"), src("雪姨", "早上看到的")];
  assert.deepEqual(validateDayText(day(["妈妈问「痛吗」，雪姨说「他没感觉」，「早上看到的」。"]), sources).errors, []);
});

test("「爸爸问雪姨「…」」：说话人是带说话动词的那个，不是最近的称谓", () => {
  const text = "爸爸问雪姨「睡了吗」。";
  assert.equal(attributedLabel(text, text.indexOf("「")), "爸爸");
  assert.deepEqual(validateDayText(day([text]), [src("爸爸", "睡了吗"), src("雪姨", "刚睡着")]).errors, []);
  assert.equal(personMentions(text).find((m) => m.label === "雪姨").role, "addressee");
});

test("引语依据落账：每一句都记下来源 id 与发送人", () => {
  const { evidence } = validateDayText(day(["雪姨说「可开心了」。"]), [src("雪姨", "可开心了", "m-1")]);
  assert.deepEqual(evidence.quotes, [{ where: "第 1 段", quote: "可开心了", label: "雪姨", sourceId: "m-1", senderLabel: "雪姨" }]);
});

// ── 点名证据 ────────────────────────────────────────────────────────────────

test("照片里的人：没有任何消息提到外婆，就不能写外婆抱着他", () => {
  const { errors } = validateDayText(day(["外婆抱着他坐在沙发上。"]), [src("妈妈", "看看今天的照片")]);
  assert.match(errors.join(), /点名了外婆在场.*只凭照片外貌不算/);
});

test("照片里的人：配文或当天消息点名了（包括口语叫法），就放行并记下依据", () => {
  const { errors, evidence } = validateDayText(day(["奶奶抱着他在楼下晒太阳。"]), [src("爸爸", "奶奶今天到杭州了", "m-9")]);
  assert.deepEqual(errors, []);
  assert.equal(evidence.persons[0].basis, "mention");
  assert.equal(evidence.persons[0].sourceId, "m-9");
  assert.deepEqual(validateDayText(day(["外婆抱着他。"]), [src("妈妈", "姥姥抱着呢")]).errors, [], "姥姥 = 外婆的口语叫法");
});

test("「妈妈发来/拍下」要有妈妈自己发的消息；只有别人发的不行", () => {
  assert.deepEqual(validateDayText(day(["妈妈发来一段视频，他在跳舞。"]), [src("妈妈", "看他跳舞")]).errors, []);
  assert.match(validateDayText(day(["妈妈发来一段视频，他在跳舞。"]), [src("爸爸", "看他跳舞，妈妈拍的")]).errors.join(), /妈妈发来\/拍下/);
});

test("personMentions：区分说话、发送、在场", () => {
  const roles = personMentions("妈妈问「痛吗」，爸爸发来照片，奶奶抱着他。").map((m) => `${m.label}:${m.role}`);
  assert.deepEqual(roles, ["妈妈:speech", "爸爸:send", "奶奶:presence"]);
  assert.deepEqual(personMentions("大兵老师说他很乖").map((m) => m.label), ["大兵老师"], "长称谓优先，不会再拆出「老师」");
});

// ── 含糊写法 ────────────────────────────────────────────────────────────────

test("含糊的指人写法全部拦下（引号外）", () => {
  const cases = ["有人发现他脚底有个小点。", "有人发来一张照片。", "有人拿着玩具逗他。", "那边说他睡了。", "家里有人在逗他。", "大人抱着他。", "一旁的人在笑。", "一位戴眼镜的男士抱着他。", "一位年长的女士在旁边。"];
  for (const text of cases) assert.match(validateDayText(day([text]), SRC).errors.join(), /含糊的指人写法/, text);
  assert.equal(VAGUE_PERSON.length >= 6, true);
  // 「没有人」不是指人；引号里的原话也不管
  assert.doesNotMatch(validateDayText(day(["他一个人玩，没有人打扰。"]), SRC).errors.join(), /含糊/);
  assert.deepEqual(validateDayText(day(["妈妈说「有人在吗」。"]), [src("妈妈", "有人在吗")]).errors, []);
});

// ── 称谓白名单来自注册表 ────────────────────────────────────────────────────

test("未确认称谓 = 亲属词表 − 注册表称呼；校验器里没有第二份手写名单", () => {
  const labels = new Set(registeredLabels());
  assert.deepEqual(UNCONFIRMED_NAMES, KINSHIP_TERMS.filter((t) => !labels.has(t)));
  for (const registered of ["外婆", "外公", "爷爷", "奶奶", "雪姨"]) assert.ok(!UNCONFIRMED_NAMES.includes(registered), registered);
  for (const unregistered of ["小雪", "干妈", "小姨", "阿姨", "保姆", "园长"]) assert.ok(UNCONFIRMED_NAMES.includes(unregistered), unregistered);
});

test("从注册表删掉一个人，他的称谓自动变成不许出现", () => {
  const without = { participants: FAMILY_REGISTRY.participants.filter((p) => p.narrativeLabel !== "外婆") };
  assert.ok(unconfirmedNames(without).includes("外婆"));
});

test("未确认称谓：引号外拦下，引号里（别人原话的一部分）放行", () => {
  for (const name of UNCONFIRMED_NAMES) {
    assert.match(validateDayText(day([`${name}给他喂饭。`]), SRC).errors.join(), /注册表里没有的称谓/, name);
  }
  assert.deepEqual(validateDayText(day(["妈妈说「小雪来接他了」。"]), [src("妈妈", "小雪来接他了")]).errors, []);
});

test("外婆 = 鹿城  筱薇（双空格，Teddy 2026-09-23 再次确认）；单空格是另一个 digest，不解析", () => {
  assert.equal(labelForSender(senderDigestForDisplayName("鹿城  筱薇"), "conversation:any"), "外婆");
  assert.equal(labelForSender(senderDigestForDisplayName("鹿城 筱薇"), "conversation:any"), null);
});

test("限定会话的条目只在确认过的会话里解析：外公在别的会话里是未登记", () => {
  const laosu = senderDigestForDisplayName("老苏");
  assert.equal(labelForSender(laosu, "conversation:77348fd4007b65a8c3dc680f"), "外公");
  assert.equal(labelForSender(laosu, "conversation:not-confirmed"), null);
  assert.equal(labelForSender(laosu, undefined), null);
});

test("真实姓名连引号里也不行，必须换成称呼", () => {
  const { errors } = validateDayText(day(["妈妈说「张三你来一下」。"]), [src("妈妈", "张三你来一下")], { realNames: ["张三"] });
  assert.match(errors.join(), /真实姓名/);
  assert.deepEqual(validateDayText(day(["妈妈说「张三你来一下」。"]), [src("妈妈", "张三你来一下")]).errors, []);
});

test("技术字样、无来源的「第一次」、不符的岁数", () => {
  assert.match(validateDayText(day(["这是微信群里发的。"]), SRC).errors.join(), /技术字样/);
  assert.match(validateDayText(day(["他第一次自己爬上滑梯。"]), SRC).errors.join(), /「第一次」/);
  assert.deepEqual(validateDayText(day(["他第一次自己爬上滑梯。"]), [src("老师", "他第一次自己爬上滑梯")]).errors, [], "来源里就这么说就放行");
  assert.match(validateDayText(day(["他已经两岁了。"]), SRC).errors.join(), /岁数/);
});

test("标题也要过关，不只正文", () => {
  assert.match(validateDayText(day(["正文没问题。"], "微信里的一天"), SRC).errors.join(), /标题: 正文含工程/);
  assert.match(validateDayText(day(["正文没问题。"], "外婆来看他"), SRC).errors.join(), /标题: 点名了外婆/);
});

test("一天既没标题也没正文是错的", () => {
  assert.match(validateDayText({ day: "2026-09-18", title: null, paragraphs: [] }, SRC).errors.join(), /既没有标题也没有正文/);
});

test("quotesOf：嵌套只取最外层", () => {
  assert.deepEqual(quotesOf("他说「你说『好』」然后走了"), ["你说『好』"]);
  assert.deepEqual(quotesOf("他说「你说「好」吧」"), ["你说「好」吧"]);
});
