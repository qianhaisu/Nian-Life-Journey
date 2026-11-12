import test from "node:test";
import assert from "node:assert/strict";
import { validateDayText, validateLiteraryStyle, quotesOf, normalizeForQuote, UNCONFIRMED_NAMES, VAGUE_PERSON, personMentions, attributedLabel } from "../scripts/editor/validate-day.mjs";
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

test("本人的文字自述算在场证据（self-report）；只发了照片、没有正文的不算", () => {
  const ok = validateDayText(day(["奶奶到杭州了，陪他在楼下玩。"]), [src("奶奶", "到杭州了", "m-5")]);
  assert.deepEqual(ok.errors, []);
  assert.equal(ok.evidence.persons[0].basis, "self-report");
  assert.match(validateDayText(day(["妈妈抱着他站在窗边。"]), [src("妈妈", "", "m-6")]).errors.join(), /点名了妈妈在场/);
});

test("说话动词更宽：总结、提议、担心，以及称谓和「说」之间隔着几个字", () => {
  for (const text of ["妈妈笑着总结「好」。", "外婆提议「好」。", "奶奶又担心「好」。", "爸爸看着一张照片说「好」。"]) {
    const label = text.slice(0, 2);
    assert.deepEqual(validateDayText(day([text]), [src(label, "好")]).errors, [], text);
  }
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

test("quotesOf：嵌套只取最外层，且弯引号“”与直角引号「」同样受逐字来源与说话人核验约束", () => {
  assert.deepEqual(quotesOf("他说「你说『好』」然后走了"), ["你说『好』"]);
  assert.deepEqual(quotesOf("他说「你说「好」吧」"), ["你说「好」吧"]);
  assert.deepEqual(quotesOf("老师说：“今天他自己爬上了小滑梯”"), ["今天他自己爬上了小滑梯"]);
  assert.deepEqual(validateDayText(day(["老师说：“今天他自己爬上了小滑梯”。"]), SRC).errors, []);
  assert.match(validateDayText(day(["老师说：“今天他自己爬上了大滑梯”。"]), SRC).errors.join(), /引语找不到来源/, "弯引号绝不能绕过逐字核验");
  assert.match(validateDayText(day(["妈妈说：“今天他自己爬上了小滑梯”。"]), SRC).errors.join(), /引语归属不对/, "弯引号绝不能绕过说话人归属核验");
});

test("validateLiteraryStyle：拦截空泛套话、聊天室转播腔与机械四段式排班表，但不误伤原话引语", () => {
  assert.ok(validateLiteraryStyle(day(["这一天留下了满满的幸福。"])).length > 0);
  assert.ok(validateLiteraryStyle(day(["老师发来几张照片，记录成长的足迹。"])).length > 0);
  assert.ok(validateLiteraryStyle(day([
    "早上，他喝了奶。上午，他去公园。中午，他吃了面。下午，他睡了一觉。晚上，他看绘本。",
  ])).some((e) => e.includes("按时间段机械罗列")));
  assert.deepEqual(
    validateLiteraryStyle(day(["奶奶说「满满的幸福」。"])),
    [],
    "家人原话里的词在引号内不误伤",
  );
});

// ── 2026-11-12：STYLE.zhang.md 第二版逐条对齐测试 ────────────────────────────

test("照片说明书腔：叙述中全部拦下，引号与书名号内放行", () => {
  const banned = [
    "照片里他捧着一只黄杯子。",
    "画面中小年正蹲在草地上。",
    "镜头里能看到一排彩球。",
    "视频里他跑得很快。",
    "有一张他双手捧着杯子。",
    "一张里他在低头捡树叶。",
    "另一张里他已经站起来了。",
    "这张照片拍在午饭后。",
  ];
  for (const line of banned) {
    const errs = validateLiteraryStyle(day([line]));
    assert.ok(errs.some((e) => e.includes("照片说明书腔")), `应拦截照片说明书腔：${line}`);
  }
  assert.deepEqual(validateLiteraryStyle(day(["妈妈说「这张照片拍得好」，桌上摆着《画面中的世界》。"])), []);
});

test("群聊转播腔补漏：发来照片/视频/一段、又发来、陆续发来、传来好消息、叙述点赞全部拦下，引号与书名号内放行", () => {
  const banned = [
    "妈妈发来几张照片。",
    "下午爸爸发来一段小视频。",
    "老师发来消息报平安。",
    "傍晚妈妈又发来两张。",
    "家里人陆续发来问候。",
    "午后传来了好消息。",
    "爸爸分享了一段视频。",
    "奶奶在群里说他长高了。",
    "家人群里聊起他学走路的事。",
    "有一条留言写道真棒。",
    "这通电话通话时长十分钟。",
    "爷爷看完给小年点赞。",
  ];
  for (const line of banned) {
    const errs = validateLiteraryStyle(day([line]));
    assert.ok(errs.some((e) => e.includes("群聊转播腔")), `应拦截群聊转播腔：${line}`);
  }
  // 合规：引号里原话「必须点赞」与普通「视频传回家里」不误杀
  assert.deepEqual(validateLiteraryStyle(day(["视频传回家里，爷爷评语最短，「必须点赞」，旁边放着《点赞中国》。"])), []);
});

test("编辑旁白：这里把、不必写成、值得记下的是全部拦下，引号内放行", () => {
  const banned = [
    "这里把两段合在一起记。",
    "小磕碰不必写成大事。",
    "这件事不必被写成转折。",
    "值得记下的是他自己拿稳了勺子。",
  ];
  for (const line of banned) {
    const errs = validateLiteraryStyle(day([line]));
    assert.ok(errs.some((e) => e.includes("编辑旁白")), `应拦截编辑旁白：${line}`);
  }
  assert.deepEqual(validateLiteraryStyle(day(["爸爸说「值得记下的是今天」。"])), []);
});

test("育儿套话清单：与 STYLE.zhang.md 第五节 17 项完全同步，引号与书名号内放行", () => {
  const cliches = [
    "成长的足迹", "成长的印记", "满满的", "岁月静好", "快乐成长", "健康快乐",
    "元气满满", "未来可期", "治愈", "仪式感", "小小的身体有大大的能量",
    "见证成长", "时光飞逝", "美好的一天", "充实的一天", "快乐的一天", "温馨的画面",
  ];
  for (const term of cliches) {
    const errs = validateLiteraryStyle(day([`午后在院子里玩耍，真是${term}。`]));
    assert.ok(errs.some((e) => e.includes("育儿套话")), `应拦截育儿套话：${term}`);
  }
  assert.deepEqual(validateLiteraryStyle(day(["外婆说「祝宝宝健康快乐」，书架上有本《岁月静好》。"])), []);
});

test("引语数量上限：单段超过 2 处或全篇超过 4 处即报错；合规 ≤2 / ≤4 放行", () => {
  const overSingle = day(["妈妈说「好」，爸爸说「行」，奶奶说「棒」。"]);
  assert.ok(validateLiteraryStyle(overSingle).some((e) => e.includes("第 1 段: 引语超量")));

  const overTotal = day([
    "妈妈说「早安」。爸爸说「出发」。",
    "奶奶说「吃饭」。爷爷说「真香」。",
    "外婆说「午睡吧」。",
  ]);
  assert.ok(validateLiteraryStyle(overTotal).some((e) => e.includes("整体: 引语超量")));

  const withinLimit = day([
    "妈妈说「早安」。爸爸说「出发」。",
    "奶奶说「吃饭」。爷爷说「真香」。",
  ]);
  assert.deepEqual(validateLiteraryStyle(withinLimit), []);
});

test("跨日无依据断言：叙述中无来源的「终于」「比以前」拦下，来源或引号中有依据则放行", () => {
  assert.match(validateDayText(day(["他终于自己把鞋穿上了。"]), SRC).errors.join(), /「终于」/);
  assert.deepEqual(validateDayText(day(["他终于自己把鞋穿上了。"]), [src("妈妈", "今天终于自己把鞋穿上了")]).errors, []);
  assert.deepEqual(validateDayText(day(["妈妈说「终于睡着了」。"]), [src("妈妈", "终于睡着了")]).errors, []);

  assert.match(validateDayText(day(["他今天走得比以前稳多了。"]), SRC).errors.join(), /跨日比较/);
  assert.deepEqual(validateDayText(day(["他今天走得比以前稳多了。"]), [src("妈妈", "今天走得比以前稳多了")]).errors, []);
});

test("STYLE.zhang.md 第九节示范：『合格的写法』完整通过，『要淘汰的写法』被拦下并报出照片说明书腔、转播腔和引语超量", () => {
  const demoSources = [
    { id: "demo-1", speaker: "外公", text: "今天去游泳池玩水了，凉快。" },
    { id: "demo-2", speaker: "爷爷", text: "小年年下水玩必须点赞" },
    { id: "demo-3", speaker: "奶奶", text: "带个游泳圈自己就会游。" },
    { id: "demo-4", speaker: "奶奶", text: "宝宝第一次这么喜欢水" },
  ];

  const goodEntry = {
    day: "2026-07-18",
    title: "水总是从杯底漏走",
    paragraphs: [
      "泳池浅水区的水刚到他腿上。小年站在里头，一点不慌，像个来视察的。",
      "池边码着一摞彩色套杯，他伸手够下来一只黄色的，杯底全是小孔。舀起一杯水，水立刻哗哗地从孔里漏回池子。再舀，再漏。这一下午他大概弄明白了一件事：水是留不住的，但可以一直舀下去。",
      "一捧水花溅到脸上，他眯了一下眼，张着嘴笑了。",
      "视频传回家里，几位老人隔着屏幕各下了结论。奶奶说「宝宝第一次这么喜欢水」，还出了个主意：「带个游泳圈自己就会游。」爷爷的评语最短，「必须点赞」。",
    ],
  };
  const goodRes = validateDayText(goodEntry, demoSources, { literary: true });
  assert.deepEqual(goodRes.errors, [], `第九节合格示范必须零报错通过，实际报错：${goodRes.errors.join(" | ")}`);
  assert.equal(goodRes.evidence.quotes.length, 3);
  assert.equal(goodRes.evidence.quotes[2].label, "爷爷");

  // 第九节原文「要淘汰的写法」（原样 + 填入对应引语两种形态都必须同时报出三类违规）
  const badLiteral = day([
    "他在泳池浅水区玩了一场水。有一张他双手捧着黄色带孔的杯子……下午外公说「……」，爷爷说「……」，奶奶说「……」。妈妈又发来一段……",
  ]);
  const badLiteralErrs = validateLiteraryStyle(badLiteral).join(" | ");
  assert.match(badLiteralErrs, /照片说明书腔/);
  assert.match(badLiteralErrs, /群聊转播腔/);
  assert.match(badLiteralErrs, /引语超量/);

  const badWithQuotes = {
    day: "2026-07-18",
    title: "玩水的一天",
    paragraphs: [
      "他在泳池浅水区玩了一场水。有一张他双手捧着黄色带孔的杯子。下午外公说「今天去游泳池玩水了，凉快。」，爷爷说「小年年下水玩必须点赞」，奶奶说「宝宝第一次这么喜欢水」。妈妈又发来一段视频。",
    ],
  };
  const badFullErrs = validateDayText(badWithQuotes, [...demoSources, { id: "demo-5", speaker: "妈妈", text: "[视频]" }], { literary: true }).errors.join(" | ");
  assert.match(badFullErrs, /照片说明书腔/);
  assert.match(badFullErrs, /群聊转播腔/);
  assert.match(badFullErrs, /引语超量/);
});
