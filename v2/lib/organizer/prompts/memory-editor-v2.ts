// Memory Editor v2 — provenance and worthiness as orthogonal axes.
//
// Why v2 exists. On real data v1's worthiness dimensions tracked conversational richness rather
// than significance: an ordinary 186-message day scored at or above the night the child first slept
// through unassisted, on every dimension. No routing threshold can repair that, because the
// information needed to tell those apart was never in the verdict.
//
// Two rules follow, and they are the whole design:
//
//  1. Provenance never buys worthiness. Knowing that 妈妈 said it firsthand, and that 雪姨 said it
//     too, raises confidence that it is TRUE. It says nothing about whether it MATTERED. After
//     identity enrichment every window in the archive scored high on firsthand evidence and
//     multi-speaker corroboration — negatives included — so any scheme that let provenance feed
//     worthiness simply lifted the noise with the signal.
//
//  2. A developmental transition must be evidenced, not assumed. "He slept until five" is a fact.
//     "For the first time" is a different claim, and it needs either a novelty marker in this window
//     or a prior baseline. The model records which, in `basis`, and a claim with basis="unknown"
//     cannot be scored as a transition. This is what stops a fluent invention of a milestone — the
//     single most damaging thing this stage can produce.
//
// v1 is untouched: the production publication ledger is keyed to memory-editor-v1 and every review
// row in it was written under that contract.
import type { EvidenceWindow } from "../evidence/types";

export const MEMORY_EDITOR_V2_PROMPT_VERSION = "memory-editor-v2";

export const MEMORY_EDITOR_V2_SYSTEM_PROMPT = `你是一个家庭记忆档案的“记忆编辑”。你判断一段家庭聊天是否值得进入一个孩子的人生档案，并抽取可引用的事实。

最高原则：**宁可漏掉，不可误收**。把与孩子无关的成人事务写进他的人生档案，比漏掉一件小事严重得多。

你只输出结构化判断。**绝对不能**写标题、故事、叙述、总结或抒情文字。

# 两条互相独立的轴

这是本次判断最重要的结构。**不要把它们混在一起。**

## 轴一：证据可信度（这件事是不是真的）

- subjectConfidence：能多确定这段话说的是这个孩子。
- evidenceConfidence：文字本身有多明确、多具体。
- attributionConfidence：能多确定是谁说的、谁做的。
- firsthandOrReported：说话人是亲眼所见（firsthand），还是转述别人（reported），还是两者都有（mixed）。
- corroboratingSpeakers：有几位不同的家人各自描述了这件事。

## 轴二：记忆价值（这件事值不值得多年后再看）

- developmentalTransition：孩子跨过了一个他以前做不到的门槛。
- newCapabilityOrIndependence：新的能力或更独立地完成一件事。
- distinctiveFamilyMoment：不寻常、独特、只此一次的家庭时刻。
- relationshipSignificance：孩子与家人之间真实的互动或关系意义。
- futureRecallValue：多年以后家人会想重新看到这一段。
- ordinaryRoutineCharacter：这件事有多日常、多例行（**分数越高越普通**）。

# 绝对规则：可信度不能变成价值

**证据强不等于值得记住。**

- “这是妈妈亲口说的”“爸爸和雪姨都说了”“证据等级高”“发言人是家人”——这些只能提高轴一，**绝对不能**提高轴二任何一项。
- 一段消息很多、事实很多、聊得很热闹，**不等于**重要。热闹的日常闲聊应该是 ordinaryRoutineCharacter 高分、其他价值维度低分。
- 反过来，一句平静、简短、只有一个人说的话，如果它记录了孩子第一次做到某件事，价值仍然很高。

# developmentalTransition 必须有依据

只有当你能指出依据时，developmentalTransition 才能给 2 分或 3 分。依据写在 developmentalTransition.basis：

- explicit_in_window：**这个窗口里**有明确的新变化标记。例如“第一次”“终于会了”“学会了”“以前不会现在会”“已经能自己…”“不满足于…了”“现在会…”。
- supported_by_prior_context：窗口本身没有明确标记，但下面提供的“既往观察”确立了之前的状态，可以看出这次发生了变化。
- unknown：既没有窗口内标记，也没有既往基线。

**basis=unknown 时，developmentalTransition 必须是 0 或 1，绝对不能是 2 或 3。**

不要因为一件事“听起来像发育里程碑”就当成第一次。以下都**不是** transition：
- “又长牙了”“又会…了”——“又”表示重复，不是新变化；
- “还不会叫妈”“还没学会拜拜”——明确说明**尚未**发生；
- 家人商量、打算、想象要做的事——没有真的发生；
- 你自己觉得这个年龄应该会了。

# 门禁 A：主体相关性（先判断）

subjectRelevanceDetail 取值：

- explicit_child：文本明确出现孩子的名字或确定指代，且这句话描述的就是他。
- resolved_child：出现代词（他/她/娃），但**同一窗口内**有明确前文可解析，必须写进 subjectResolutionRef。
- family_context_only：家庭事务，但主语不是这个孩子。
- unrelated：成人工作、换班、通勤、社交、购物、外卖、转发链接、家务、装修、Wi-Fi、位置分享、撤回消息等。
- insufficient_evidence：没有文字，或只有 [media]、[图片]、[视频]、[表情包]、文件路径等占位符。

**以下单独出现绝不能证明与孩子有关：** 消息来自家庭群；当天有孩子的照片；只有“他/她”而无可解析前文；只有占位符或文件路径；同一天别的消息提到过孩子；发送者是亲属。

你没有视觉模型。**不能因为存在图片就断言图片里是这个孩子。**

# 门禁 B：proposedAction

- life_event_candidate：轴二里有真实的、有依据的价值——尤其是有依据的 developmentalTransition、新能力、或独特的家庭时刻。
- daily_trace：与孩子有关但普通的一天，包括“普通但温馨”的时刻。**这是一个正常且体面的结果，不是失败。**
- store_only：证据不足、无关、只有占位符。
- attach_existing：与既往事件是同一件事（必须给 proposedTargetId）。
- care_observation：健康或症状类，只记录原话，绝不诊断。

不要为了“有内容”而升级。证据不足就 store_only；普通就 daily_trace。

# 事实抽取规则

- coreFacts[].statement 不超过 60 字，必须是聊天里**真实发生**的事，不补写、不推测情绪动机、不把相邻但无关的消息拼成因果。
- evidenceRefs 必须是证据清单中真实存在的 ref（itemId#spanId）。编造 ref 会导致整条被丢弃。
- 转述用 assertionKind="attributed_claim" 并填 claimant。
- quotableLines[].text 必须**逐字**出现，不能改写。
- 不做医疗、发育或心理诊断。不确认照片里的人物身份。不把模糊代词写成确定人物。
- prohibitedInferences 列出你**刻意没有写**的推测。

轴二每个维度 0 到 3 分，非 0 分必须给 evidenceRefs。`;

function renderItems(window: EvidenceWindow) {
  return window.items.map((item) => {
    const spanLines = item.spans.map((span) => `    - ref=${item.itemId}#${span.id} 文本="${item.text.slice(span.start, span.end).replace(/\s+/g, " ").trim()}"`).join("\n");
    const media = item.mediaRefs.length ? `\n    (附带 ${item.mediaRefs.length} 个媒体文件，内容未知)` : "";
    return `  [${item.sentAt}] 发送者角色=${item.senderRole} 证据等级=${item.tier}\n${spanLines || "    - (无文字)"}${media}`;
  }).join("\n");
}

function renderNeighbors(window: EvidenceWindow) {
  const render = (items: EvidenceWindow["items"]) => items.map((item) => `  [${item.sentAt}] ${item.senderRole}: ${item.text.replace(/\s+/g, " ").slice(0, 80)}`).join("\n");
  const before = window.neighbors.before.length ? `窗口之前（仅供理解上下文，不可作为 evidenceRef）:\n${render(window.neighbors.before)}` : "";
  const after = window.neighbors.after.length ? `窗口之后（仅供理解上下文，不可作为 evidenceRef）:\n${render(window.neighbors.after)}` : "";
  return [before, after].filter(Boolean).join("\n");
}

/**
 * A bounded, topic-linked baseline. Each line is an earlier observation on the SAME topic, so the
 * editor can tell "he slept until five" (a fact) from "he slept through for the first time" (a
 * transition) without being taught to assume novelty from an isolated sentence. Deliberately small:
 * broad context would just be another way of inviting invention.
 */
export type PriorObservation = { observedAt: string; topic: string; statement: string };

function renderPriorObservations(observations: PriorObservation[]) {
  if (!observations.length) return "  (无既往观察。没有基线时，不能仅凭这一句就判断是第一次。)";
  return observations.map((observation) => `  - [${observation.observedAt}] (${observation.topic}) ${observation.statement}`).join("\n");
}

export function buildMemoryEditorPromptV2(
  window: EvidenceWindow,
  subject: { primaryName: string; aliases: string[] },
  priorObservations: PriorObservation[] = [],
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

## 既往观察（用于判断 developmentalTransition 的基线，不能作为 evidenceRef）
${renderPriorObservations(priorObservations)}

## 已存在的事件（用于 attach_existing 与去重判断）
${priorEvents}

请先执行门禁 A，再分别评估两条轴，然后调用 emit_verdict_v2。occurredAtProposal.value 用 YYYY-MM-DD 格式。`;
}

export const MEMORY_EDITOR_V2_TOOL_NAME = "emit_verdict_v2";

const confidence = { type: "string", enum: ["high", "medium", "low"] } as const;
const worthDimension = {
  type: "object",
  properties: {
    score: { type: "integer", enum: [0, 1, 2, 3] },
    evidenceRefs: { type: "array", items: { type: "string" } },
  },
  required: ["score", "evidenceRefs"],
} as const;

export const MEMORY_EDITOR_V2_TOOL_SCHEMA = {
  type: "object",
  properties: {
    subjectRelevanceDetail: { type: "string", enum: ["explicit_child", "resolved_child", "family_context_only", "unrelated", "insufficient_evidence"] },
    subjectResolutionRef: { type: "string", description: "resolved_child 时必填：完成代词解析的那条 evidence ref" },
    subjectRelevance: { type: "string", enum: ["primary", "mentioned", "unrelated", "ambiguous"] },
    subjectIds: { type: "array", items: { type: "string" } },
    temporalStatus: { type: "string", enum: ["past", "present", "planned", "uncertain"] },
    occurredAtProposal: {
      type: "object",
      properties: { value: { type: "string" }, basis: { type: "string", enum: ["sent_at", "exif", "explicit_text"] }, evidenceRefs: { type: "array", items: { type: "string" } } },
      required: ["value", "basis", "evidenceRefs"],
    },

    // --- Axis 1: provenance / truth. Never feeds the worthiness score. ---
    evidenceAxis: {
      type: "object",
      properties: {
        subjectConfidence: confidence,
        evidenceConfidence: confidence,
        attributionConfidence: confidence,
        firsthandOrReported: { type: "string", enum: ["firsthand", "reported", "mixed"] },
        corroboratingSpeakers: { type: "integer" },
      },
      required: ["subjectConfidence", "evidenceConfidence", "attributionConfidence", "firsthandOrReported", "corroboratingSpeakers"],
    },

    // --- Axis 2: memory worthiness. ---
    worthinessAxis: {
      type: "object",
      properties: {
        developmentalTransition: {
          type: "object",
          properties: {
            score: { type: "integer", enum: [0, 1, 2, 3] },
            basis: { type: "string", enum: ["explicit_in_window", "supported_by_prior_context", "unknown"] },
            evidenceRefs: { type: "array", items: { type: "string" } },
          },
          required: ["score", "basis", "evidenceRefs"],
        },
        newCapabilityOrIndependence: worthDimension,
        distinctiveFamilyMoment: worthDimension,
        relationshipSignificance: worthDimension,
        futureRecallValue: worthDimension,
        ordinaryRoutineCharacter: worthDimension,
      },
      required: ["developmentalTransition", "newCapabilityOrIndependence", "distinctiveFamilyMoment", "relationshipSignificance", "futureRecallValue", "ordinaryRoutineCharacter"],
    },

    coreFacts: {
      type: "array",
      items: {
        type: "object",
        properties: {
          statement: { type: "string" },
          assertionKind: { type: "string", enum: ["raw_fact", "attributed_claim"] },
          claimant: { type: "string" },
          claimantRole: { type: "string" },
          evidenceRefs: { type: "array", items: { type: "string" } },
        },
        required: ["statement", "assertionKind", "evidenceRefs"],
      },
    },
    quotableLines: {
      type: "array",
      items: { type: "object", properties: { text: { type: "string" }, speakerRole: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "speakerRole", "evidenceRef"] },
    },
    emotionalAnchor: { type: "object", properties: { text: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "evidenceRef"] },
    duplicateCandidates: {
      type: "array",
      items: { type: "object", properties: { targetId: { type: "string" }, targetKind: { type: "string", enum: ["life_event", "daily_trace"] }, similarity: { type: "number" }, basis: { type: "array", items: { type: "string" } } }, required: ["targetId", "targetKind", "similarity", "basis"] },
    },
    uncertainty: {
      type: "object",
      properties: { time: confidence, subject: confidence, semantics: confidence },
      required: ["time", "subject", "semantics"],
    },
    sensitivityFlags: { type: "array", items: { type: "string", enum: ["health", "other_child", "third_party", "location_precise"] } },
    prohibitedInferences: { type: "array", items: { type: "string" } },
    proposedAction: { type: "string", enum: ["store_only", "daily_trace", "life_event_candidate", "attach_existing", "care_observation"] },
    proposedTargetId: { type: "string" },
    selectionReason: { type: "string" },
    confidence: { type: "number" },
  },
  required: [
    "subjectRelevanceDetail", "subjectRelevance", "subjectIds", "temporalStatus", "occurredAtProposal",
    "evidenceAxis", "worthinessAxis", "coreFacts", "quotableLines", "duplicateCandidates", "uncertainty",
    "sensitivityFlags", "prohibitedInferences", "proposedAction", "selectionReason", "confidence",
  ],
} as const;
