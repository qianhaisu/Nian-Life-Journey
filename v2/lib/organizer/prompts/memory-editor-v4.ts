// Memory Editor v4.
//
// One change from v3, and it is categorical rather than numeric. v3 rescued the crawling day with
// `newCapabilityOrIndependence >= 2` and, by the same mechanism at the same threshold, promoted an
// ordinary meal. "He did something" and "he can now do something" are different claims; no score on
// a single axis separates them. v4 makes the editor name which kind of thing it saw:
//
//   developmental_ability   — a meaningful ability
//   meaningful_independence — doing himself what used to need an adult
//   ordinary_action         — he did a thing
//
// Only the first two are capability at all. Scoring an ordinary action highly no longer promotes it.
//
// Gate A is also no longer decided here: a bounded Subject Resolver runs first, deterministically,
// and its result is what the pipeline trusts. The prompt still reports what it thinks, but a window
// the resolver could not resolve cannot be promoted on the model's say-so.
import type { EvidenceWindow } from "../evidence/types";
import type { SelectedPriorObservation } from "../prior-observations";
import { renderItems, renderNeighbors, renderPriorObservations } from "./memory-editor-v3";

export const MEMORY_EDITOR_V4_PROMPT_VERSION = "memory-editor-v4";

export const MEMORY_EDITOR_V4_SYSTEM_PROMPT = `你是一个家庭记忆档案的“记忆编辑”。你判断一段家庭聊天是否值得进入一个孩子的人生档案，并抽取可引用的事实。

最高原则：**宁可漏掉，不可误收**。把与孩子无关的成人事务写进他的人生档案，比漏掉一件小事严重得多。

你只输出结构化判断。**绝对不能**写标题、故事、叙述、总结或抒情文字。

# 两条互相独立的轴

## 轴一：证据可信度（这件事是不是真的）
- subjectConfidence / evidenceConfidence / attributionConfidence
- firsthandOrReported：亲眼所见 / 转述 / 两者都有
- corroboratingSpeakers：几位不同的家人各自描述了这件事

## 轴二：记忆价值（这件事值不值得多年后再看）
- developmentalTransition：跨过了一个他以前做不到的门槛（严格，见下）
- newCapabilityOrIndependence：**能力**，而不是“做了一件事”（见下，最重要）
- distinctiveFamilyMoment：不寻常、独特的家庭时刻
- relationshipSignificance：孩子与家人之间真实的互动或关系意义
- futureRecallValue：多年以后家人会想重新看到这一段
- noDistinctiveMemorySignal：这一段**完全没有**任何值得记住的信号（布尔值）

# 绝对规则一：可信度不能变成价值

“这是妈妈亲口说的”“爸爸和雪姨都说了”“证据等级高”——只能提高轴一，**绝对不能**提高轴二任何一项。
消息多、事实多、聊得热闹，**不等于**重要。

# 绝对规则二：能力 ≠ 做了一件事（本版本最重要）

newCapabilityOrIndependence 必须同时给出 kind：

- developmental_ability：一项**有发育意义的能力**。
  例：自己会爬；扶着站起来；自己走；会叫爸爸妈妈；会用勺；能自己坐稳。
- meaningful_independence：**以前需要大人代劳，现在他自己完成**。
  例：自己吃完一顿；自己入睡不用哄；自己爬上沙发。
- ordinary_action：他做了一件普通的事，没有体现新能力或独立性。
  例：吃了西红柿鸡蛋面；下楼散步；玩玩具；被抱去洗澡；吃辅食吃得满身都是。
- none：窗口里没有关于他能力或行为的内容。

**ordinary_action 无论打几分都不会被当作能力。** 普通的一天依然可以因为“独特的家庭时刻”或“关系意义”被保留，但不能因为“他吃了面”被当作能力。

判断方法：问自己「这句话说明他**能**做什么了吗？」
- 「放在床上他就自己会爬」→ 能，developmental_ability。
- 「他吃的身上和餐椅全是面」→ 只说明他在吃，ordinary_action。

# 绝对规则三：能力 ≠ 第一次

「他自己会爬」「他能自己吃了」是 **能力** 的证据，**不是** developmentalTransition 的证据。
**绝对不能**因为出现「会」「自己」「能」就推断这是第一次。
一个能力即使档案没有拍到它第一次发生，仍然值得记住——这时 kind 给 developmental_ability，developmentalTransition 给 0，这是**正确**答案。

# developmentalTransition 的依据（严格）

只有能指出依据时才能给 2 分或 3 分。依据写进 transitionSupport：

- explicit_in_window：**这个窗口里**有明确变化标记：「第一次」「以前不会现在会」「终于」「不满足于…了」「原来…现在…」。
- supported_by_prior_context：窗口没有标记，但下面「既往观察」里有**明确更早的基线**说明他之前做不到或做法不同，而这个窗口显示了新状态。
  - 必须在 transitionSupport.priorEvidence 里逐条写出所引用既往观察的 sourceId；
  - 必须在 transitionSupport.currentEvidenceRefs 里给出本窗口显示新状态的 ref；
  - 只能引用下面真实列出的既往观察。编造 sourceId 会导致整个 transition 被作废。
- unknown：两者都没有。**basis=unknown 时 developmentalTransition 必须是 0 或 1。**

以下都**不是** transition：「又长牙了」（重复）；「还不会叫妈」（尚未发生）；家人商量或想象的事；你觉得这个年龄应该会了。

# noDistinctiveMemorySignal

只有当这一段**完全没有**任何值得记住的信号时才为 true（纯日程、纯家务、纯闲聊）。
只要有一点点关于孩子的具体内容，就是 false。这个字段不扣分，只用来区分“普通的一天”和“什么都没有”。

# 门禁 A：主体相关性

subjectRelevanceDetail 取值：
- explicit_child：文本明确出现孩子的名字或确定指代。
- resolved_child：出现代词，但有明确前文可解析，写进 subjectResolutionRef。
- family_context_only：家庭事务，但主语不是这个孩子。
- unrelated：成人工作、换班、通勤、社交、购物、外卖、转发链接、家务、装修、Wi-Fi、位置分享、撤回消息等。
- insufficient_evidence：没有文字，或只有占位符。

**以下单独出现绝不能证明与孩子有关：** 消息来自家庭群；当天有孩子的照片；只有占位符或文件路径；同一天别的消息提到过孩子；发送者是亲属。

你没有视觉模型。**不能因为存在图片就断言图片里是这个孩子。**

# 门禁 B：proposedAction

- life_event_candidate：有依据的 transition、明确的 developmental_ability / meaningful_independence、或独特的家庭时刻。
- daily_trace：与孩子有关但普通的一天，包括“普通但温馨”的时刻。**这是正常且体面的结果。**
- store_only：证据不足、无关、只有占位符。
- attach_existing：与既往事件是同一件事（必须给 proposedTargetId）。
- care_observation：健康或症状类，只记录原话，绝不诊断。

# 事实抽取规则

- coreFacts[].statement 不超过 60 字，必须是聊天里**真实发生**的事，不补写、不推测情绪动机、不把相邻但无关的消息拼成因果。
- evidenceRefs 必须是证据清单中真实存在的 ref（itemId#spanId）。
- 转述用 assertionKind="attributed_claim" 并填 claimant。
- quotableLines[].text 必须**逐字**出现。
- 不做医疗、发育或心理诊断。不确认照片里的人物身份。不把模糊代词写成确定人物。
- prohibitedInferences 列出你**刻意没有写**的推测。

轴二每个打分维度 0 到 3 分，非 0 分必须给 evidenceRefs。`;

export function buildMemoryEditorPromptV4(
  window: EvidenceWindow,
  subject: { primaryName: string; aliases: string[] },
  priorObservations: SelectedPriorObservation[] = [],
) {
  const priorEvents = window.priorContext.lifeEvents.length
    ? window.priorContext.lifeEvents.map((event) => `  - id=${event.id} 日期=${event.occurredAt.slice(0, 10)} 标题=${event.title ?? "(无)"}`).join("\n")
    : "  (无)";
  return `## 档案主体
姓名：${subject.primaryName}
可接受的指代：${[subject.primaryName, ...subject.aliases].join("、")}

## 窗口信息
windowId: ${window.windowId}
活动日期: ${window.activityDate}
时间范围: ${window.timeRange.from} → ${window.timeRange.to}
消息数: ${window.stats.messageCount}，媒体数: ${window.stats.imageCount}，发送者数: ${window.stats.senderCount}

## 证据清单（只有这里列出的 ref 可以被引用）
${renderItems(window)}

${renderNeighbors(window)}

## 既往观察（判断 developmentalTransition 的基线；引用时必须写 sourceId）
${renderPriorObservations(priorObservations)}

## 已存在的事件（用于 attach_existing 与去重判断）
${priorEvents}

请先执行门禁 A，再分别评估两条轴，然后调用 emit_verdict_v4。occurredAtProposal.value 用 YYYY-MM-DD 格式。`;
}

export const MEMORY_EDITOR_V4_TOOL_NAME = "emit_verdict_v4";

const confidence = { type: "string", enum: ["high", "medium", "low"] } as const;
const worthDimension = {
  type: "object",
  properties: { score: { type: "integer", enum: [0, 1, 2, 3] }, evidenceRefs: { type: "array", items: { type: "string" } } },
  required: ["score", "evidenceRefs"],
} as const;

export const MEMORY_EDITOR_V4_TOOL_SCHEMA = {
  type: "object",
  properties: {
    subjectRelevanceDetail: { type: "string", enum: ["explicit_child", "resolved_child", "family_context_only", "unrelated", "insufficient_evidence"] },
    subjectResolutionRef: { type: "string" },
    subjectRelevance: { type: "string", enum: ["primary", "mentioned", "unrelated", "ambiguous"] },
    subjectIds: { type: "array", items: { type: "string" } },
    temporalStatus: { type: "string", enum: ["past", "present", "planned", "uncertain"] },
    occurredAtProposal: {
      type: "object",
      properties: { value: { type: "string" }, basis: { type: "string", enum: ["sent_at", "exif", "explicit_text"] }, evidenceRefs: { type: "array", items: { type: "string" } } },
      required: ["value", "basis", "evidenceRefs"],
    },
    evidenceAxis: {
      type: "object",
      properties: {
        subjectConfidence: confidence, evidenceConfidence: confidence, attributionConfidence: confidence,
        firsthandOrReported: { type: "string", enum: ["firsthand", "reported", "mixed"] },
        corroboratingSpeakers: { type: "integer" },
      },
      required: ["subjectConfidence", "evidenceConfidence", "attributionConfidence", "firsthandOrReported", "corroboratingSpeakers"],
    },
    worthinessAxis: {
      type: "object",
      properties: {
        developmentalTransition: {
          type: "object",
          properties: { score: { type: "integer", enum: [0, 1, 2, 3] }, evidenceRefs: { type: "array", items: { type: "string" } } },
          required: ["score", "evidenceRefs"],
        },
        newCapabilityOrIndependence: {
          type: "object",
          properties: {
            score: { type: "integer", enum: [0, 1, 2, 3] },
            kind: { type: "string", enum: ["developmental_ability", "meaningful_independence", "ordinary_action", "none"] },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["score", "kind", "evidenceRefs"],
        },
        distinctiveFamilyMoment: worthDimension,
        relationshipSignificance: worthDimension,
        futureRecallValue: worthDimension,
        noDistinctiveMemorySignal: { type: "boolean" },
      },
      required: ["developmentalTransition", "newCapabilityOrIndependence", "distinctiveFamilyMoment", "relationshipSignificance", "futureRecallValue", "noDistinctiveMemorySignal"],
    },
    transitionSupport: {
      type: "object",
      properties: {
        basis: { type: "string", enum: ["explicit_in_window", "supported_by_prior_context", "unknown"] },
        priorEvidence: { type: "array", items: { type: "object", properties: { sourceId: { type: "string" }, observedAt: { type: "string" }, statement: { type: "string" } }, required: ["sourceId", "observedAt", "statement"] } },
        currentEvidenceRefs: { type: "array", items: { type: "string" } },
      },
      required: ["basis", "priorEvidence", "currentEvidenceRefs"],
    },
    coreFacts: {
      type: "array",
      items: {
        type: "object",
        properties: { statement: { type: "string" }, assertionKind: { type: "string", enum: ["raw_fact", "attributed_claim"] }, claimant: { type: "string" }, claimantRole: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } },
        required: ["statement", "assertionKind", "evidenceRefs"],
      },
    },
    quotableLines: { type: "array", items: { type: "object", properties: { text: { type: "string" }, speakerRole: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "speakerRole", "evidenceRef"] } },
    emotionalAnchor: { type: "object", properties: { text: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "evidenceRef"] },
    duplicateCandidates: { type: "array", items: { type: "object", properties: { targetId: { type: "string" }, targetKind: { type: "string", enum: ["life_event", "daily_trace"] }, similarity: { type: "number" }, basis: { type: "array", items: { type: "string" } } }, required: ["targetId", "targetKind", "similarity", "basis"] } },
    uncertainty: { type: "object", properties: { time: confidence, subject: confidence, semantics: confidence }, required: ["time", "subject", "semantics"] },
    sensitivityFlags: { type: "array", items: { type: "string", enum: ["health", "other_child", "third_party", "location_precise"] } },
    prohibitedInferences: { type: "array", items: { type: "string" } },
    proposedAction: { type: "string", enum: ["store_only", "daily_trace", "life_event_candidate", "attach_existing", "care_observation"] },
    proposedTargetId: { type: "string" },
    selectionReason: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "subjectRelevanceDetail", "subjectRelevance", "subjectIds", "temporalStatus", "occurredAtProposal",
    "evidenceAxis", "worthinessAxis", "transitionSupport", "coreFacts", "quotableLines", "duplicateCandidates",
    "uncertainty", "sensitivityFlags", "prohibitedInferences", "proposedAction", "selectionReason", "confidence",
  ],
} as const;
