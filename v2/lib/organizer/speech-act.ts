// Deterministic speech-act, polarity and content-bearing analysis of a single evidence span.
//
// Why this exists: the Memory Editor contract can only label a claim `raw_fact` or
// `attributed_claim`, and BOTH are assertions. There was no way to say "this span is a question".
// So in HV2-N03 the interrogative 「会自己站了？」 became an attributed factual claim that the child
// could stand, and that claim alone produced a STRONG `developmental_ability` signal. Nothing
// downstream ever looked at the span it cited.
//
// The classification below keys ONLY on grammatical function words and punctuation — interrogative
// particles, A-not-A constructions, question pronouns, irrealis markers, negation markers and the
// closed class of discourse backchannels. It never inspects what the sentence is *about*. There is
// deliberately no rule for standing, walking, talking or any other capability: a layer that had to
// learn each capability separately would be the keyword special-casing this replaces.
export type SpeechAct = "assertion" | "question" | "plan_or_hypothetical" | "directive";
export type Polarity = "affirmative" | "negated";

export type SpanAnalysis = {
  speechAct: SpeechAct;
  polarity: Polarity;
  /**
   * False for the closed class of discourse particles (对/真的/嗯/好的…) that carry no proposition
   * of their own — they inherit one from the turn they answer. A backchannel can confirm a
   * proposition but can never SUPPLY one, which is why 「真的」 cannot ground a capability claim
   * whose only other support is a question.
   */
  contentBearing: boolean;
  /** Which markers fired. Auditable: a grounding decision must be explainable after the fact. */
  markers: string[];
  /** The span text after stripping exporter escaping and sticker/media tokens. */
  normalized: string;
};

// The WeChat exporter escapes markdown punctuation ("hxx\.", "\[发怒\]") and writes stickers, media
// and links as bracketed tokens. None of that is language, so it is removed before analysis.
export function normalizeSpanText(text: string): string {
  return text
    .replace(/\\([.\-_*[\]()#+!~`>])/g, "$1")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[\p{Extended_Pictographic}️‍]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Closed class of discourse backchannels / confirmation tokens. Matched on the WHOLE normalized
// span, never as a substring, so 「真的」 is a backchannel but 「他真的会走了」 is not.
const BACKCHANNEL = new Set([
  "真的", "真的吗", "真的假的", "对", "对啊", "对呀", "对的", "是", "是的", "是啊", "是呀",
  "嗯", "嗯嗯", "哦", "噢", "好", "好的", "好呀", "好吧", "行", "行吧", "可以", "可以可以",
  "没错", "确实", "收到", "ok", "okk", "okay", "好啊", "哈哈", "哈哈哈", "哈哈哈哈",
  "哈哈哈哈哈", "哈哈哈哈哈哈", "哈哈哈哈哈哈哈", "呵呵", "嘻嘻", "略略略", "666",
]);

function isBackchannel(normalized: string): boolean {
  const stripped = normalized.replace(/[。，,.!！?？~～、\s]/g, "").toLowerCase();
  if (!stripped) return false;
  if (BACKCHANNEL.has(stripped)) return true;
  // Reduplicated laughter/assent of arbitrary length ("哈哈哈哈…", "对对对") is the same closed class.
  return /^(哈){2,}$/.test(stripped) || /^(对){2,}$/.test(stripped) || /^(嗯){2,}$/.test(stripped);
}

// Sentence-final interrogative particles, A-not-A frames, and question pronouns. Grammar, not topic.
const TERMINAL_QUESTION_MARK = /[?？]\s*$/;
// 吗/呢 are interrogative particles. 吧 is NOT: its primary use is a suggestion or softener
// (「还是打疫苗吧」= let's just get the vaccine), and its genuinely question-like uses are the
// confirmation tags 对吧/是吧, which CONFIRMATION_TAG already covers.
const FINAL_PARTICLE = /(吗|呢)\s*[。.!！~～]*\s*$/;
const A_NOT_A = /(是不是|有没有|会不会|能不能|要不要|对不对|好不好|行不行|可不可以|去不去|想不想)/;
const QUESTION_PRONOUN = /(什么|啥|为什么|为啥|怎么|怎样|如何|哪里|哪儿|哪个|哪天|多少|几点|几个|干嘛|谁)/;
const CONFIRMATION_TAG = /(对吧|是吧|对不|好吗|是吗|可以吗|行吗)/;

// An indirect question is not a question: 「睁开眼睛看一下你有没有哄他」 REPORTS that he checks,
// it does not ask anything. A-not-A frames and question pronouns embedded under a
// complement-taking verb are therefore not matrix interrogatives. A terminal ？ still overrides
// this — an actual question mark ends the argument.
const COMPLEMENT_VERB = /(看看|看一下|看|问|知道|想知道|明白|确认|清楚|记得|说说|说|观察|检查|试试|猜)/;
function embeddedUnderComplementVerb(text: string, marker: RegExp): boolean {
  const match = marker.exec(text);
  if (!match) return false;
  return COMPLEMENT_VERB.test(text.slice(0, match.index));
}

// Irrealis: the event is projected, intended or conditional — it has not been observed to occur.
const FUTURE_TIME = /(明天|后天|大后天|下周|下个月|下礼拜|待会|等会|一会儿|回头|下次|以后|将来|改天)/;
const INTENTION = /(打算|准备|计划|想要|约了|预约|要去|打算着)/;
const CONDITIONAL = /(如果|假如|万一|要是|的话|等他|等她|等到|一旦)/;
const MODAL_PROJECTION = /(应该会|可能会|大概会|估计会|快要|就要|即将|不远了|离.{0,6}不远)/;

// Imperative / request frames.
const DIRECTIVE = /(^|[，,。.\s])(请|麻烦|帮我|帮忙|记得|别忘|不要忘|你去|你来)/;

// Negation and not-yet. Both make the state NOT an occurred capability, which is why polarity is
// tracked separately from speech act: 「小年不会自主入睡」 is a perfectly good asserted fact, it is
// simply not evidence of an acquired ability.
const NEGATION = /(不会|不能|不肯|不想|不敢|没有|还没|还不|尚未|未曾|从来不|从未|不再|没能|没法|无法)/;
const NOT_YET = /(还不会|还没有|还没|尚未|暂时不|目前还不)/;

export function analyzeSpan(text: string): SpanAnalysis {
  const normalized = normalizeSpanText(text);
  const markers: string[] = [];

  if (!normalized) {
    return { speechAct: "assertion", polarity: "affirmative", contentBearing: false, markers: ["empty_span"], normalized };
  }

  const contentBearing = !isBackchannel(normalized);
  if (!contentBearing) markers.push("backchannel");

  // Polarity is tested with A-not-A frames removed: the 没有 inside 「你有没有哄他」 is a
  // grammatical half of the frame, not a claim that nothing happened. Leaving it in reported a
  // plain report as a negated state.
  const forPolarity = normalized.replace(A_NOT_A, " ");
  let polarity: Polarity = "affirmative";
  if (NOT_YET.test(forPolarity)) { polarity = "negated"; markers.push("not_yet"); }
  else if (NEGATION.test(forPolarity)) { polarity = "negated"; markers.push("negation"); }

  // Question first: an interrogative frame overrides everything else it contains. 「会自己站了？」
  // must never be read as an assertion just because it also contains a capability verb.
  if (TERMINAL_QUESTION_MARK.test(normalized)) markers.push("terminal_question_mark");
  if (FINAL_PARTICLE.test(normalized)) markers.push("final_particle");
  if (A_NOT_A.test(normalized)) {
    if (embeddedUnderComplementVerb(normalized, A_NOT_A)) markers.push("embedded_a_not_a");
    else markers.push("a_not_a");
  }
  if (CONFIRMATION_TAG.test(normalized)) markers.push("confirmation_tag");
  if (QUESTION_PRONOUN.test(normalized)) {
    if (embeddedUnderComplementVerb(normalized, QUESTION_PRONOUN)) markers.push("embedded_question_pronoun");
    else markers.push("question_pronoun");
  }
  const questionMarkers = markers.filter((m) => m === "terminal_question_mark" || m === "final_particle" || m === "a_not_a" || m === "confirmation_tag" || m === "question_pronoun");
  if (questionMarkers.length > 0) {
    return { speechAct: "question", polarity, contentBearing, markers, normalized };
  }

  if (DIRECTIVE.test(normalized)) { markers.push("directive"); return { speechAct: "directive", polarity, contentBearing, markers, normalized }; }

  if (FUTURE_TIME.test(normalized)) markers.push("future_time");
  if (INTENTION.test(normalized)) markers.push("intention");
  if (CONDITIONAL.test(normalized)) markers.push("conditional");
  if (MODAL_PROJECTION.test(normalized)) markers.push("modal_projection");
  const irrealis = markers.filter((m) => m === "future_time" || m === "intention" || m === "conditional" || m === "modal_projection");
  if (irrealis.length > 0) {
    return { speechAct: "plan_or_hypothetical", polarity, contentBearing, markers, normalized };
  }

  return { speechAct: "assertion", polarity, contentBearing, markers, normalized };
}
