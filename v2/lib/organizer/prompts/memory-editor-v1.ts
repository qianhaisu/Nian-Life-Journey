// Memory Editor prompt + tool schema (DeepSeek production path). Renders an EvidenceWindow as
// citable, id-tagged evidence and asks for a MemoryEditorVerdict — never narrative. The verdict is
// validated by contract.ts; nothing here may widen what the contract accepts.
//
// Design rule for this prompt: precision over recall. The Organizer's job is to REFUSE most family
// group-chat traffic. A window only survives Gate A when the child is the actual subject, and only
// survives Gate B when there is something a future reader would want back.
import type { EvidenceWindow } from "../evidence/types";

export const MEMORY_EDITOR_PROMPT_VERSION = "memory-editor-v1";

export const MEMORY_EDITOR_SYSTEM_PROMPT = `你是一个家庭记忆档案的“记忆编辑”。你的唯一任务是判断一段家庭聊天记录是否应该成为孩子的人生档案内容，并把可引用的事实抽取出来。

最高原则：**宁可漏掉，不可误收（precision over recall）**。这个档案属于一个孩子。把与他无关的成人事务写进他的人生档案，比漏掉一件小事严重得多。

你只输出结构化判断。你**绝对不能**写标题、故事、叙述、总结或任何抒情文字。

## 门禁 A：主体相关性（先判断，最重要）

对每个窗口先给出 subjectRelevanceDetail：

- explicit_child：文本中明确出现孩子的名字或确定指代（如“张年”“张小年”“小年”“崽”“宝宝”等），并且这句话描述的就是这个孩子。
- resolved_child：出现代词（他/她/娃），但**在同一个窗口内**有明确前文可以把代词解析到这个孩子。你必须能指出是哪一条 evidence 完成了这个解析，写进 subjectResolutionRef。
- family_context_only：确实是家庭事务，但主语不是这个孩子（成人的安排、夫妻沟通、家里的东西、给别人带东西等）。
- unrelated：成人工作、换班、通勤、社交、购物、外卖、转发文章、链接、家务、装修、Wi-Fi、酒店或位置分享、撤回消息等。
- insufficient_evidence：没有文字，或只有 [media]、[图片]、[视频]、[表情包]、文件路径等占位符，或语义无法确认主体。

**以下事实单独出现时，绝对不能证明内容与这个孩子有关：**
- 消息来自家庭群；
- 当天有孩子的照片；
- 只有“他/她”而没有可解析的前文；
- 只有位置、图片、表情、视频占位符或文件路径；
- 同一天别的消息提到过孩子；
- 发送者是孩子的亲属。

你没有视觉模型。**你不能因为存在一张图片就断言图片里是这个孩子。**

## 门禁 B：是否值得留下

只有通过门禁 A 的窗口才判断这一步。proposedAction 取值：

- life_event_candidate：至少满足一项——明确的新能力、第一次或阶段变化；孩子具体的语言、动作、习惯或偏好；围绕孩子的真实家庭互动；有可复述的具体场景细节；对未来回看有明显意义。
- daily_trace：与孩子相关但普通的小事。
- store_only：证据不足、无关、或只是占位符。
- attach_existing：与 priorContext 里某个已有事件是同一件事（必须给 proposedTargetId）。
- care_observation：健康或症状类，只记录原话，绝不诊断。

**通常不能成为 life_event_candidate：** 信息量不足的单句（如“带崽去吃饭”）；普通接送、日程、购物；只有照片没有可确认内容；重复消息；系统消息、撤回、位置、链接；与孩子没有明确关系的家庭群讨论。

不要为了“有内容”而升级。证据不足就 store_only。

## 事实抽取规则

- coreFacts[].statement 必须不超过 60 字，是聊天里**真实发生**的事，不能补写、不能推测情绪或动机或成长意义、不能把相邻但无关的消息拼成因果。
- 每条 fact 的 evidenceRefs 必须是下面证据清单里真实存在的 ref（格式 itemId#spanId）。编造 ref 会导致整条被丢弃。
- 转述别人说的话用 assertionKind="attributed_claim" 并填 claimant。
- quotableLines[].text 必须是聊天中**逐字**出现的原话，不能改写。
- 不做医疗、发育或心理诊断。不确认照片里的人物身份。不把模糊代词写成确定人物。
- prohibitedInferences 里列出你**刻意没有写**的推测。

worthinessDimensions 每个维度 0 到 3 分，非 0 分必须给 evidenceRefs。`;

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

export function buildMemoryEditorPrompt(window: EvidenceWindow, subject: { primaryName: string; aliases: string[] }) {
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

## 已存在的事件（用于 attach_existing 与去重判断）
${priorEvents}

请先执行门禁 A，再执行门禁 B，然后调用 emit_verdict 输出结构化判断。occurredAtProposal.value 用 YYYY-MM-DD 格式。`;
}

const dimension = { type: "object", properties: { score: { type: "integer", enum: [0, 1, 2, 3] }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["score", "evidenceRefs"] } as const;

export const MEMORY_EDITOR_TOOL_NAME = "emit_verdict";

export const MEMORY_EDITOR_TOOL_SCHEMA = {
  type: "object",
  properties: {
    subjectRelevanceDetail: { type: "string", enum: ["explicit_child", "resolved_child", "family_context_only", "unrelated", "insufficient_evidence"], description: "门禁 A 的细分判断" },
    subjectRelevance: { type: "string", enum: ["primary", "mentioned", "unrelated", "ambiguous"], description: "explicit_child 或 resolved_child 映射为 primary；family_context_only 或 unrelated 映射为 unrelated；insufficient_evidence 映射为 ambiguous" },
    subjectResolutionRef: { type: "string", description: "resolved_child 时，完成代词解析的那条 evidenceRef" },
    subjectIds: { type: "array", items: { type: "string" } },
    temporalStatus: { type: "string", enum: ["past", "present", "planned", "uncertain"] },
    occurredAtProposal: { type: "object", properties: { value: { type: "string" }, basis: { type: "string", enum: ["sent_at", "exif", "explicit_text"] }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["value", "basis", "evidenceRefs"] },
    coreFacts: { type: "array", items: { type: "object", properties: { statement: { type: "string", description: "不超过 60 字，聊天中真实发生的事" }, assertionKind: { type: "string", enum: ["raw_fact", "attributed_claim"] }, claimant: { type: "string" }, claimantRole: { type: "string" }, evidenceRefs: { type: "array", items: { type: "string" } } }, required: ["statement", "assertionKind", "evidenceRefs"] } },
    quotableLines: { type: "array", items: { type: "object", properties: { text: { type: "string", description: "逐字原话" }, speakerRole: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "speakerRole", "evidenceRef"] } },
    emotionalAnchor: { type: "object", properties: { text: { type: "string" }, evidenceRef: { type: "string" } }, required: ["text", "evidenceRef"] },
    worthinessDimensions: { type: "object", properties: { milestone: dimension, change: dimension, futureRecall: dimension, relationship: dimension, emotion: dimension, everydayTexture: dimension } },
    duplicateCandidates: { type: "array", items: { type: "object", properties: { targetId: { type: "string" }, targetKind: { type: "string", enum: ["life_event", "daily_trace"] }, similarity: { type: "number" }, basis: { type: "array", items: { type: "string" } } }, required: ["targetId", "targetKind", "similarity", "basis"] } },
    uncertainty: { type: "object", properties: { time: { type: "string", enum: ["low", "medium", "high"] }, subject: { type: "string", enum: ["low", "medium", "high"] }, semantics: { type: "string", enum: ["low", "medium", "high"] } }, required: ["time", "subject", "semantics"] },
    sensitivityFlags: { type: "array", items: { type: "string", enum: ["health", "other_child", "third_party", "location_precise"] } },
    prohibitedInferences: { type: "array", items: { type: "string" } },
    proposedAction: { type: "string", enum: ["store_only", "daily_trace", "life_event_candidate", "attach_existing", "care_observation"] },
    proposedTargetId: { type: "string" },
    selectionReason: { type: "string", description: "不超过 120 字，说明为什么这样判断" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
  },
  required: ["subjectRelevanceDetail", "subjectRelevance", "subjectIds", "temporalStatus", "occurredAtProposal", "coreFacts", "quotableLines", "worthinessDimensions", "duplicateCandidates", "uncertainty", "sensitivityFlags", "prohibitedInferences", "proposedAction", "selectionReason", "confidence"],
} as const;
