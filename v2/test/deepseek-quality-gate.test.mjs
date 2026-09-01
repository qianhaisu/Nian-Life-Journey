// Quality-gate unit tests. Fixtures here are synthetic and de-identified on purpose: real family
// chat text must never enter the repository, so these assert the RULES, not the corpus.
import test from "node:test";
import assert from "node:assert/strict";
import { coerceSubjectRelevance } from "../lib/organizer/deepseek-editor.ts";
import { containsTechnicalPlaceholder, decisionPublishes, indexReviews, isEventPublishable, isTracePublishable, requiresQualityReview } from "../lib/organizer/quality-review.ts";
import { extractQuotes, validateFamilyWriterOutput } from "../lib/organizer/family-writer.ts";
import { presentableEvidenceText, presentableSourceLabel } from "../lib/organizer/evidence-text.ts";
import { classifyCareTopics, qualifiesAsLifeEvent } from "../lib/organizer/care-topics.ts";

const SUBJECT = { primaryName: "张年", aliases: ["小年", "崽"] };

function windowWith(texts) {
  return { windowId: "window:test", items: texts.map((text, index) => ({ itemId: `item-${index}`, text })) };
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

test("Gate A refuses any window that never names the child, whatever the model says", () => {
  const pronounOnly = windowWith(["你们白天会给他喝一顿鲜奶是吗", "早点的时候会倒一点"]);
  for (const detail of ["explicit_child", "resolved_child"]) {
    const result = coerceSubjectRelevance({ subjectRelevanceDetail: detail, subjectResolutionRef: "item-0#span-0" }, pronounOnly, SUBJECT);
    assert.equal(result.subjectRelevance, "ambiguous", `${detail} must not pass without a name in the window`);
    assert.equal(result.gateAReason, "gate_a_no_name_in_window");
  }
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
