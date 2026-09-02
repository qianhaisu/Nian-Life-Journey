// Quality-gate unit tests. Fixtures here are synthetic and de-identified on purpose: real family
// chat text must never enter the repository, so these assert the RULES, not the corpus.
import test from "node:test";
import assert from "node:assert/strict";
import { coerceSubjectRelevance, coerceTemporalStatus, resolveSubject } from "../lib/organizer/deepseek-editor.ts";
import { containsTechnicalPlaceholder, decisionPublishes, indexReviews, isEventPublishable, isTracePublishable, requiresQualityReview } from "../lib/organizer/quality-review.ts";
import { extractQuotes, validateFamilyWriterOutput } from "../lib/organizer/family-writer.ts";
import { presentableEvidenceText, presentableSourceLabel } from "../lib/organizer/evidence-text.ts";
import { classifyCareTopics, qualifiesAsLifeEvent } from "../lib/organizer/care-topics.ts";
import { storyMinimumFor, STORY_PREFERRED_MIN, STORY_ABSOLUTE_MIN } from "../lib/organizer/family-writer.ts";
import { selectCentralFact, reconcileSupport, evidenceKindOf } from "../lib/organizer/central-fact.ts";

const SUBJECT = { primaryName: "张年", aliases: ["小年", "崽"] };

function windowWith(texts, neighborTexts = []) {
  return {
    windowId: "window:test",
    items: texts.map((text, index) => ({ itemId: `item-${index}`, text })),
    neighbors: { before: neighborTexts.map((text, index) => ({ itemId: `n-${index}`, text })), after: [] },
  };
}

test("Gate A maps the fine-grained relevance label onto the canonical enum", () => {
  const named = windowWith(["小年今天自己爬上了沙发"]);
  assert.equal(coerceSubjectRelevance({ subjectRelevanceDetail: "explicit_child" }, named, SUBJECT).subjectRelevance, "primary");
  assert.equal(coerceSubjectRelevance({ subjectRelevanceDetail: "family_context_only" }, named, SUBJECT).subjectRelevance, "unrelated");
  assert.equal(coerceSubjectRelevance({ subjectRelevanceDetail: "unrelated" }, named, SUBJECT).subjectRelevance, "unrelated");
  assert.equal(coerceSubjectRelevance({ subjectRelevanceDetail: "insufficient_evidence" }, named, SUBJECT).subjectRelevance, "ambiguous");
});

test("Gate A refuses a family_context_only window even when the model also claims it is primary", () => {
  const named = windowWith(["小年今天自己爬上了沙发"]);
  const result = coerceSubjectRelevance({ subjectRelevanceDetail: "family_context_only", subjectRelevance: "primary" }, named, SUBJECT);
  assert.equal(result.subjectRelevance, "unrelated");
  assert.equal(result.gateAReason, "gate_a_family_context_only");
});

test("Gate A refuses a resolved_child claim with no resolution reference", () => {
  const named = windowWith(["小年今天很开心", "他后来睡着了"]);
  const result = coerceSubjectRelevance({ subjectRelevanceDetail: "resolved_child" }, named, SUBJECT);
  assert.equal(result.subjectRelevance, "ambiguous");
  assert.equal(result.gateAReason, "gate_a_unresolved_pronoun");
});

test("Gate A refuses a window where nothing nearby names the child", () => {
  const pronounOnly = windowWith(["你们白天会给他喝一顿鲜奶是吗", "早点的时候会倒一点"]);
  for (const detail of ["explicit_child", "resolved_child"]) {
    const result = coerceSubjectRelevance({ subjectRelevanceDetail: detail, subjectResolutionRef: "item-0#span-0" }, pronounOnly, SUBJECT);
    assert.equal(result.subjectRelevance, "ambiguous", `${detail} must not pass with no antecedent anywhere`);
    assert.equal(result.gateAReason, "gate_a_no_name_in_window");
  }
});

test("a neighbouring message may resolve a pronoun, and is still never citable", () => {
  const resolved = windowWith(["他今天自己翻身了", "翻了好几次"], ["小年今天精神特别好"]);
  assert.equal(resolveSubject(resolved, SUBJECT), "in_neighbor");
  const verdict = coerceSubjectRelevance({ subjectRelevanceDetail: "resolved_child", subjectResolutionRef: "n-0#span-0" }, resolved, SUBJECT);
  assert.equal(verdict.subjectRelevance, "primary");
  // Neighbours resolve identity only. They are not part of window.items, which is the only thing
  // the contract validates an evidenceRef against, so they can never be cited, linked or displayed.
  assert.equal(resolved.items.some((item) => item.itemId.startsWith("n-")), false);
});

test("a competing person makes a bare pronoun unresolvable", () => {
  const contested = windowWith(["他today玩得很开心", "哥哥也一起玩了"], ["小年今天去了托班"]);
  assert.equal(resolveSubject(contested, SUBJECT), "contested");
  const verdict = coerceSubjectRelevance({ subjectRelevanceDetail: "resolved_child", subjectResolutionRef: "n-0#span-0" }, contested, SUBJECT);
  assert.equal(verdict.subjectRelevance, "ambiguous");
  assert.equal(verdict.gateAReason, "gate_a_competing_person");
});

test("a name in the window itself still outranks neighbour resolution", () => {
  assert.equal(resolveSubject(windowWith(["小年今天自己爬上了沙发"], ["无关的话"]), SUBJECT), "in_window");
  assert.equal(resolveSubject(windowWith(["他今天很开心"]), SUBJECT), "none");
});

test("Gate A fails closed when the relevance label is missing or unknown", () => {
  const named = windowWith(["小年今天自己爬上了沙发"]);
  assert.equal(coerceSubjectRelevance({}, named, SUBJECT).subjectRelevance, "ambiguous");
  assert.equal(coerceSubjectRelevance({ subjectRelevanceDetail: "something_new" }, named, SUBJECT).gateAReason, "gate_a_missing_detail");
});

test("only an approved review publishes", () => {
  assert.equal(decisionPublishes("approved"), true);
  for (const decision of ["downgrade_to_daily_trace", "store_only", "rejected_unrelated", "needs_human_review", undefined]) {
    assert.equal(decisionPublishes(decision), false, `${decision} must not publish`);
  }
});

test("rule-derived artifacts are fail closed and human ones are untouched", () => {
  const ruleEvent = { id: "e1", createdBy: "rule", organizerVersion: "rule-v2", visibility: "family" };
  const humanEvent = { id: "e2", createdBy: "user", visibility: "family" };
  const ruleTrace = { id: "t1", organizerRun: { organizerType: "rule" } };

  const empty = indexReviews([]);
  assert.equal(requiresQualityReview(ruleEvent), true);
  assert.equal(requiresQualityReview(humanEvent), false);
  assert.equal(isEventPublishable(ruleEvent, empty), false, "unreviewed rule event must stay hidden");
  assert.equal(isEventPublishable(humanEvent, empty), true, "human content must not be caught by the gate");
  assert.equal(isTracePublishable(ruleTrace, empty), false);

  const approved = indexReviews([{ targetKind: "life_event", targetId: "e1", decision: "approved" }]);
  assert.equal(isEventPublishable(ruleEvent, approved), true);
  const rejected = indexReviews([{ targetKind: "life_event", targetId: "e1", decision: "rejected_unrelated" }]);
  assert.equal(isEventPublishable(ruleEvent, rejected), false);
});

test("technical placeholders are detected in every form seen in production", () => {
  for (const text of ["[media]", "[视频文件](media/videos/x.mp4)", "[图片]", "[表情包]", "undefined cm · undefined kg", "Quark 照片初始化 · 10 media", "https://example.com/a"]) {
    assert.equal(containsTechnicalPlaceholder(text), true, `${text} must be detected`);
  }
  assert.equal(containsTechnicalPlaceholder("小年第一次自己走到了门口"), false);
  assert.equal(containsTechnicalPlaceholder(undefined), false);
});

test("family writer output must sit inside the length bounds", () => {
  const evidence = ["小年今天自己扶着墙站起来了，站了好一会儿。妈妈说他已经不满足于坐着了。"];
  const short = validateFamilyWriterOutput({ title: "小年扶墙站起来了", story: "他站了一会儿。", quotableLines: [], evidenceTexts: evidence });
  assert.equal(short.ok, false);
  assert.ok(short.issues.some((issue) => issue.startsWith("story_length_")));

  const longTitle = validateFamilyWriterOutput({ title: "小年今天在家里自己扶着墙壁慢慢站了起来真的很棒", story: "x".repeat(0) + "小年扶着墙站了起来，站了好一会儿才坐下。妈妈说他已经不满足于坐着了，家里人都围过来看他。这天他一共站起来了好几次。", quotableLines: [], evidenceTexts: evidence });
  assert.equal(longTitle.ok, false);
  assert.ok(longTitle.issues.some((issue) => issue.startsWith("title_length_")));
});

test("family writer output must not contain clichés or technical text", () => {
  const evidence = ["小年今天自己扶着墙站起来了。"];
  const story = "小年扶着墙站了起来，站了好一会儿才坐下。这一天值得被记住，家里人都围过来看他站着的样子，谁也没有去扶他一把。";
  const result = validateFamilyWriterOutput({ title: "小年扶墙站起来了", story, quotableLines: [], evidenceTexts: evidence });
  assert.equal(result.ok, false);
  assert.ok(result.issues.some((issue) => issue.startsWith("cliche:")));

  const technical = validateFamilyWriterOutput({ title: "小年扶墙站起来了", story: "小年扶着墙站了起来，站了好一会儿才坐下。[视频文件](media/videos/a.mp4) 家里人都围过来看他站着的样子，谁也没有扶他。", quotableLines: [], evidenceTexts: evidence });
  assert.equal(technical.ok, false);
  assert.ok(technical.issues.includes("technical_placeholder"));
});

test("a quote that does not appear verbatim in the evidence is rejected", () => {
  const evidence = ["小年今天自己扶着墙站起来了，站了好一会儿。"];
  const invented = validateFamilyWriterOutput({
    title: "小年扶墙站起来了",
    story: "小年扶着墙站了起来，站了好一会儿才坐下。妈妈在旁边说「他真是个小天才」，家里人都围过来看他站着的样子。",
    quotableLines: [], evidenceTexts: evidence,
  });
  assert.equal(invented.ok, false);
  assert.ok(invented.issues.some((issue) => issue.startsWith("unsupported_quote:")));

  const supported = validateFamilyWriterOutput({
    title: "小年扶墙站起来了",
    story: "小年扶着墙站了起来，站了好一会儿才慢慢坐下去。妈妈在旁边说「站了好一会儿」，家里人都围过来看他站着的样子，谁也没有伸手去扶他一把，就那样看着他自己稳住。",
    quotableLines: [{ text: "站了好一会儿" }], evidenceTexts: evidence,
  });
  assert.equal(supported.ok, true, JSON.stringify(supported.issues));
});

test("extractQuotes finds every quoting style the writer may emit", () => {
  assert.deepEqual(extractQuotes("他说「车车」然后指着窗外。"), ["车车"]);
  assert.deepEqual(extractQuotes("他说“车车”。"), ["车车"]);
  assert.deepEqual(extractQuotes("没有引号。"), []);
});

test("evidence text drops exporter plumbing but keeps the real message", () => {
  assert.equal(presentableEvidenceText("[视频文件](media/videos/20250812_061636_3430.mp4)"), "");
  assert.equal(presentableEvidenceText("[media]"), "");
  assert.equal(presentableEvidenceText("[表情包]"), "");
  assert.equal(presentableEvidenceText('"hxx\." 撤回了一条消息'), "");
  assert.equal(presentableEvidenceText('你邀请"$names$"加入了群聊  $revoke$'), "");
  assert.equal(presentableEvidenceText("4条聊天记录"), "");
  assert.equal(presentableEvidenceText(undefined), "");
});

test("evidence text unescapes WeChat markdown without losing content", () => {
  assert.equal(presentableEvidenceText("@hxx\. 我带崽去吃劳了"), "@hxx. 我带崽去吃劳了");
  assert.equal(presentableEvidenceText("今天去公司 周三在家\[皱眉\]"), "今天去公司 周三在家[皱眉]");
  assert.equal(presentableEvidenceText("小年今天自己扶着墙站起来了"), "小年今天自己扶着墙站起来了");
});

test("evidence text keeps the caption when a message mixes words and a media placeholder", () => {
  assert.equal(presentableEvidenceText("张小年今天吃面 [图片]"), "张小年今天吃面");
  assert.equal(presentableEvidenceText("[视频文件](media/videos/a.mp4) 他自己会爬了"), "他自己会爬了");
});

test("service SMS and links never reach a published evidence layer", () => {
  assert.equal(presentableEvidenceText("【某某医院】尊敬的张年：某某医院向您发送了《满意度调查问卷》，点击 https://example.com/s 填写"), "");
  assert.equal(presentableEvidenceText("您的验证码是 123456"), "");
  assert.equal(presentableEvidenceText("看看这个 https://example.com/article 挺好的"), "看看这个 挺好的");
});

test("internal identifiers are not shown as a source label", () => {
  assert.equal(presentableSourceLabel("conversation:856b8ec2b8f3ec2871782ca6"), "");
  assert.equal(presentableSourceLabel("wechat-import:abc123"), "");
  assert.equal(presentableSourceLabel("e383c80ad7e302109b1fef036b2c5762"), "");
  assert.equal(presentableSourceLabel("托班老师记录"), "托班老师记录");
  assert.equal(presentableSourceLabel(undefined), "");
});

test("care topics beat milestone wording: a first is still constipation", () => {
  const constipation = classifyCareTopics([
    "张年白天拉了一个很大的大便，很臭",
    "张年中午用力很久想拉屎，但掀开裤子没有拉出来",
    "家人称这是张年人生首次便秘",
    "张年七个月大，家人计划带他去做体检",
  ]);
  assert.equal(constipation.careCount, 4);
  assert.equal(constipation.milestoneCount, 0, "首次 must not promote a care topic");
  assert.equal(constipation.careDominated, true);
  assert.equal(constipation.qualifiesAsLifeEvent, false);
});

test("teething, scalp scratching and sleep scheduling are care, not life events", () => {
  for (const statements of [
    ["张年今天开始抓头，抓得很用力，头部被抓得发红", "家人计划明天用婴儿油给张年去头垢", "张年抓头主要在快睡着时"],
    ["家人决定把辅食排敏时间缩短到两天", "张小年最近牙疼爱哭唧唧", "家人觉得比上次出牙好多了"],
    ["家人今天开始做年年的睡眠记录", "家人计划晚上十点不弄醒年年直接喂奶", "年年六点半喝奶洗了澡后睡着了"],
  ]) {
    assert.equal(qualifiesAsLifeEvent(statements), false, statements[0]);
  }
});

test("a real new ability still qualifies even next to a care detail", () => {
  assert.equal(qualifiesAsLifeEvent([
    "把崽放在床上他自己就会爬，只是没录下来",
    "下楼拿张小年的尿不湿时，他很开心，脚一直在踹",
    "他三点半喝的奶",
  ]), true, "会爬 is a milestone and 尿不湿 is a nappy, not a care event");

  assert.equal(qualifiesAsLifeEvent([
    "崽现在很想站起来，会各种扶墙站，手一撑就起来了",
    "崽已经不满足于坐了",
  ]), true);
});

test("everyday texture with no care content at all still qualifies", () => {
  assert.equal(qualifiesAsLifeEvent([
    "张小年今天吃面，吃的是西红柿鸡蛋面",
    "张小年吃面时把面和身上、餐椅弄得全是面",
  ]), true);
});

test("an empty fact list never qualifies", () => {
  assert.equal(qualifiesAsLifeEvent([]), false);
  assert.equal(classifyCareTopics([]).careDominated, false);
});

test("a milestone claim the evidence never makes is rejected", () => {
  const evidence = ["张小年今天吃面，吃的是西红柿鸡蛋面", "吃的身上和餐椅全是面"];
  const invented = validateFamilyWriterOutput({
    title: "张小年第一次吃西红柿鸡蛋面",
    story: "张小年今天吃面，吃得身上和餐椅全是面，家人商量以后给他铺一张一次性地垫，让他坐在地上自己吃，吃完再带去洗澡。",
    quotableLines: [], evidenceTexts: evidence,
  });
  assert.equal(invented.ok, false);
  assert.ok(invented.issues.some((issue) => issue.startsWith("unsupported_milestone_claim:")), JSON.stringify(invented.issues));

  const supported = validateFamilyWriterOutput({
    title: "张小年第一次吃西红柿鸡蛋面",
    story: "家人说这是他第一次吃西红柿鸡蛋面，他吃得身上和餐椅全是面，家人商量以后给他铺一张一次性地垫，让他坐在地上自己吃，吃完再带去洗澡换衣服。",
    quotableLines: [], evidenceTexts: [...evidence, "这是他第一次吃西红柿鸡蛋面"],
  });
  assert.equal(supported.ok, true, JSON.stringify(supported.issues));
});

test("an out-of-enum temporalStatus degrades to uncertain instead of failing the verdict", () => {
  assert.deepEqual(coerceTemporalStatus("past"), { temporalStatus: "past", coerced: false });
  assert.deepEqual(coerceTemporalStatus("uncertain"), { temporalStatus: "uncertain", coerced: false });
  for (const bad of ["mixed", "ongoing", "", undefined, null, 3]) {
    assert.deepEqual(coerceTemporalStatus(bad), { temporalStatus: "uncertain", coerced: true }, String(bad));
  }
});

test("the story floor follows the evidence instead of forcing padding", () => {
  const sparse = ["他现在好想站起来啊", "各种扶墙站", "手一撑", "然后就起来了", "已经不满足于坐了"];
  assert.ok(storyMinimumFor(sparse) < STORY_PREFERRED_MIN, "sparse evidence lowers the floor");
  assert.ok(storyMinimumFor(sparse) >= STORY_ABSOLUTE_MIN, "but never below the absolute floor");
  const result = validateFamilyWriterOutput({
    title: "扶墙站起来的崽",
    story: "崽现在很想站起来，会「各种扶墙站」，「手一撑」「然后就起来了」。家人说他「已经不满足于坐了」。",
    quotableLines: [], evidenceTexts: sparse,
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));

  // Rich evidence keeps the usual 60-character floor.
  const rich = Array.from({ length: 12 }, () => "张小年今天吃了西红柿鸡蛋面还弄得到处都是");
  assert.equal(storyMinimumFor(rich), STORY_PREFERRED_MIN);
  assert.ok(validateFamilyWriterOutput({ title: "张小年吃面了", story: "他吃了面。", quotableLines: [], evidenceTexts: rich })
    .issues.some((i) => i.startsWith("story_length_")));
});

test("the central fact is something that happened, not something imagined", () => {
  const facts = [
    { statement: "张小年今天吃面", evidenceRefs: [] },
    { statement: "我想象了一个画面。光溜溜的张小年坐在地垫上，这个面放在他面前让他自己吃。", evidenceRefs: [] },
  ];
  assert.equal(selectCentralFact(facts).statement, "张小年今天吃面", "an imagined scene is not the event");

  const withMilestone = [
    { statement: "这两天都没有爬行训练的视频了", evidenceRefs: [] },
    { statement: "放在床上他就自己会爬，就没录下来", evidenceRefs: [] },
  ];
  assert.equal(selectCentralFact(withMilestone).statement, "放在床上他就自己会爬，就没录下来", "the new ability wins");
  assert.equal(selectCentralFact([]), undefined);
});

test("unjudged sources are dropped rather than kept", () => {
  const { kept, resolved } = reconcileSupport(["a", "b", "c"], [{ sourceId: "a", keep: true, reason: "ok" }]);
  assert.deepEqual(kept, ["a"]);
  assert.equal(resolved.find((r) => r.sourceId === "b").reason, "not_judged_by_model");
  // A source the model was never given cannot smuggle itself in.
  assert.deepEqual(reconcileSupport(["a"], [{ sourceId: "z", keep: true, reason: "x" }]).kept, []);
});

test("a quoted-reply header is exporter syntax and is not displayed", () => {
  assert.equal(presentableEvidenceText("> hxx\.: \[图片\]\n\n他没牙能吃吗"), "他没牙能吃吗");
  assert.equal(presentableEvidenceText("> 13372529311好奇星大兵老师: 可以的，小脸盆带一个\n\n好"), "好");
  // A normal message that merely contains a colon is untouched.
  assert.equal(presentableEvidenceText("他说：今天想吃面"), "他说：今天想吃面");
});

test("a quoted reply after a leading blank line still loses its blockquote", () => {
  // Exactly how the archive stores it: a leading blank line, then the blockquote carrying the name
  // and a copy of the quoted message, then the reply. The leading blank made an earlier version
  // stop scanning at line 0 and publish "> hxx.:" verbatim.
  const stored = "\n> hxx\\.: \\[图片\\]\n\n他没牙能吃吗\n";
  assert.equal(presentableEvidenceText(stored), "他没牙能吃吗");
  assert.equal(presentableEvidenceText("\n\n> 老师: 可以的\n\n好\n"), "好");
});

test("plans and imagined scenes are evidence of context, not of what happened", () => {
  assert.equal(evidenceKindOf("张小年今天吃面，吃的是西红柿鸡蛋面"), "observation");
  assert.equal(evidenceKindOf("吃的身上和餐椅全是面"), "observation");
  assert.equal(evidenceKindOf("我想象了一个画面。光溜溜的张小年坐在地垫上自己吃"), "hypothetical");
  assert.equal(evidenceKindOf("给他铺一张一次性地垫，以后吃这个就做地上"), "hypothetical");
});

test("a story built on a plan must frame it as a plan", () => {
  const evidence = ["张小年今天吃面", "计时半小时结束，带他去洗澡换纸尿裤，一次性地垫一卷扔掉"];
  const asFact = validateFamilyWriterOutput({
    title: "张小年吃西红柿鸡蛋面",
    story: "张小年今天吃面，吃得身上和餐椅全是面。计时半小时结束，带他去洗澡换纸尿裤，一次性地垫一卷扔掉，这一天就这样过去了。",
    quotableLines: [], evidenceTexts: evidence, hasHypotheticalEvidence: true,
  });
  assert.equal(asFact.ok, false);
  assert.ok(asFact.issues.includes("unframed_hypothetical"), JSON.stringify(asFact.issues));

  const framed = validateFamilyWriterOutput({
    title: "张小年吃西红柿鸡蛋面",
    story: "张小年今天吃面，吃得身上和餐椅全是面。家人已经商量好下次的流程：让他在地垫上自己吃一会儿，吃完就抱去洗澡换纸尿裤。",
    quotableLines: [], evidenceTexts: evidence, hasHypotheticalEvidence: true,
  });
  assert.equal(framed.ok, true, JSON.stringify(framed.issues));

  // With no hypothetical evidence in play the framing requirement does not apply.
  assert.equal(validateFamilyWriterOutput({
    title: "张小年吃西红柿鸡蛋面",
    story: "张小年今天吃面，吃得身上和餐椅全是面，家里人看着他把面糊得到处都是，谁也没有急着去擦，就让他自己吃完了这一碗。",
    quotableLines: [], evidenceTexts: evidence,
  }).ok, true);
});
