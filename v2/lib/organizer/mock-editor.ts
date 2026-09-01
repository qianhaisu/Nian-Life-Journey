// Synthetic-only Memory Editor provider (§7.2). Produces a MemoryEditorVerdict from window text
// using the same kind of deterministic signal detection a real model would be asked to output —
// used by the evaluator and the shadow runner. No network call, no real provider is wired here.
import type { EvidenceWindow } from "./evidence/types";
import type { CoreFact, MemoryEditorProposedAction, MemoryEditorVerdict, QuotableLine, SensitivityFlag } from "./contract";

const HEDGE_WORDS = /可能|好像|听说|据说|大概|应该是|估计|似乎|我觉得/;
const PLANNED_WORDS = /明天|下周|打算|准备|约了|待会|下次|计划/;
const NEGATION_WORDS = /没去|取消|改天|没有去/;
const QUOTE_PATTERN = /[""「」]([^""「」]{1,40})[""「」]/;
const MILESTONE_WORDS = /第一次|首次|开始|学会|主动/;
const CHANGE_WORDS = /以前|之前.*现在|自己.*了/;
const EMOTION_WORDS = /开心|高兴|害怕|难过|兴奋|哭|笑/;
const REPORTED_SPEECH = /医生说|老师说|说可能/;

export type MockEditorContext = { subjectNames: string[]; otherChildNames?: string[] };

function firstSpanRef(window: EvidenceWindow, predicate: (text: string) => boolean): string | undefined {
  for (const item of window.items) for (const span of item.spans) { const text = item.text.slice(span.start, span.end); if (predicate(text)) return `${item.itemId}#${span.id}`; }
  return undefined;
}

function allSpanRefs(window: EvidenceWindow): string[] { return window.items.flatMap((item) => item.spans.map((span) => `${item.itemId}#${span.id}`)); }

function buildFacts(window: EvidenceWindow): CoreFact[] {
  const facts: CoreFact[] = [];
  for (const item of window.items) {
    for (const span of item.spans) {
      const text = item.text.slice(span.start, span.end).trim();
      if (!text) continue;
      const isHedged = HEDGE_WORDS.test(text);
      const isReported = REPORTED_SPEECH.test(text);
      facts.push({ statement: text.slice(0, 60), assertionKind: isHedged || isReported ? "attributed_claim" : "raw_fact", claimant: isHedged || isReported ? item.senderRole : undefined, claimantRole: item.senderRole, evidenceRefs: [`${item.itemId}#${span.id}`] });
    }
  }
  return facts.slice(0, 6);
}

export function mockMemoryEditor(window: EvidenceWindow, context: MockEditorContext): MemoryEditorVerdict {
  const text = window.items.map((item) => item.text).join("\n");
  const names = context.subjectNames.length ? context.subjectNames : ["他"];
  const mentionsSubject = names.some((name) => text.includes(name)) || /他|她/.test(text);
  const otherChildMentioned = (context.otherChildNames ?? []).some((name) => text.includes(name));
  const isHealth = window.items.some((item) => item.contentTypes.includes("health"));
  const isPlanned = PLANNED_WORDS.test(text) && !NEGATION_WORDS.test(text);
  const isHedgedOnly = HEDGE_WORDS.test(text) && !MILESTONE_WORDS.test(text.replace(HEDGE_WORDS, ""));

  // A family conversation defaults to being about the tracked child (real messages routinely omit
  // an explicit pronoun) unless another named child is mentioned without the subject, or there is
  // no usable content at all — those are the only cases the mock treats as unclear.
  const subjectRelevance: MemoryEditorVerdict["subjectRelevance"] = otherChildMentioned && !mentionsSubject ? "ambiguous" : text.trim().length === 0 ? "unrelated" : "primary";
  const facts = subjectRelevance === "ambiguous" || subjectRelevance === "unrelated" ? [] : buildFacts(window);
  const quoteRef = firstSpanRef(window, (candidate) => QUOTE_PATTERN.test(candidate));
  const quotableLines: QuotableLine[] = quoteRef ? [{ text: (QUOTE_PATTERN.exec(spanTextByRef(window, quoteRef)) ?? [])[1] ?? "", speakerRole: "child", evidenceRef: quoteRef }] : [];
  const emotionRef = firstSpanRef(window, (candidate) => EMOTION_WORDS.test(candidate));

  const sensitivityFlags: SensitivityFlag[] = [];
  if (isHealth) sensitivityFlags.push("health");
  if (otherChildMentioned) sensitivityFlags.push("other_child");

  const dims: MemoryEditorVerdict["worthinessDimensions"] = {};
  if (MILESTONE_WORDS.test(text)) dims.milestone = { score: 2, evidenceRefs: [firstSpanRef(window, (c) => MILESTONE_WORDS.test(c)) ?? allSpanRefs(window)[0]].filter(Boolean) as string[] };
  if (CHANGE_WORDS.test(text)) dims.change = { score: 2, evidenceRefs: [allSpanRefs(window)[0]].filter(Boolean) as string[] };
  if (quotableLines.length) dims.relationship = { score: 2, evidenceRefs: [quoteRef!] };
  if (emotionRef) dims.emotion = { score: 1, evidenceRefs: [emotionRef] };
  dims.futureRecall = { score: facts.length ? 2 : 0, evidenceRefs: facts.length ? [facts[0].evidenceRefs[0]] : [] };
  dims.everydayTexture = { score: facts.length && !MILESTONE_WORDS.test(text) ? 2 : 0, evidenceRefs: facts.length ? [facts[0].evidenceRefs[0]] : [] };

  // A window with an explicit milestone/change signal or a verbatim quote is proposed as a
  // candidate for a person to look at; everything else with usable facts is an ordinary trace.
  const hasStrongSignal = (dims.milestone?.score ?? 0) >= 2 || (dims.change?.score ?? 0) >= 2 || quotableLines.length > 0;
  const proposedAction: MemoryEditorProposedAction = isHealth ? "care_observation" : facts.length === 0 ? "store_only" : hasStrongSignal ? "life_event_candidate" : "daily_trace";

  return {
    windowId: window.windowId,
    subjectRelevance,
    subjectIds: subjectRelevance === "primary" ? ["subject-a"] : [],
    temporalStatus: isPlanned ? "planned" : "past",
    occurredAtProposal: { value: window.timeRange.from, basis: "sent_at", evidenceRefs: [allSpanRefs(window)[0]].filter(Boolean) as string[] },
    coreFacts: isHedgedOnly && !isHealth ? facts.map((fact) => ({ ...fact, assertionKind: "attributed_claim" as const, claimant: fact.claimant ?? "来源" })) : facts,
    quotableLines,
    emotionalAnchor: emotionRef ? { text: spanTextByRef(window, emotionRef), evidenceRef: emotionRef } : undefined,
    worthinessDimensions: dims,
    duplicateCandidates: [],
    uncertainty: { time: "low", subject: subjectRelevance === "ambiguous" ? "high" : "low", semantics: isHedgedOnly ? "medium" : "low" },
    sensitivityFlags,
    prohibitedInferences: isHealth ? ["diagnosis", "cause", "treatment", "prognosis"] : [],
    proposedAction,
    proposedTargetId: undefined,
    selectionReason: "synthetic mock verdict",
    confidence: 0.7,
  };
}

function spanTextByRef(window: EvidenceWindow, ref: string) { const [itemId, spanId] = ref.split("#"); const item = window.items.find((candidate) => candidate.itemId === itemId); const span = item?.spans.find((candidate) => candidate.id === spanId); return item && span ? item.text.slice(span.start, span.end) : ""; }

export class MockMemoryEditorProvider {
  readonly name = "mock-memory-editor";
  constructor(private readonly context: MockEditorContext) {}
  async organize(window: EvidenceWindow): Promise<{ verdict: unknown }> { return { verdict: mockMemoryEditor(window, this.context) }; }
}
