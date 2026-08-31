import type { ContentType, MemoryWeight, OrganizerAction } from "@/lib/types";
import type { OrganizerContext, OrganizerDecision } from "./types";

export type PolicyResult = { decision: OrganizerDecision; unsupportedFactCount: number };

const explicitChange = /第一次|首次|开始|学会|主动|明显|里程碑|生日|旅行|first\s*time|milestone|birthday|travel/i;
const supportedFirstTime = /第一次|首次|first\s*time/i;
const medicalInference = /诊断|病因|治疗建议|用药建议|处方|药物剂量|diagnos|treatment recommendation|prescription/i;
const signalEvidence: Record<string, RegExp> = { language: /说|词|语言|表达|车车|language/i, motor: /跑|走|踢|爬|跳|追|球|motor/i, social: /一起|其他孩子|同伴|老师|主动|social/i, interest: /喜欢|专注|感兴趣|interest/i };
const highRiskFacts: Array<{ claim: RegExp; evidence: RegExp }> = [
  { claim: /开心|高兴|害怕|难过|兴奋|happy|excited|afraid/i, evidence: /开心|高兴|害怕|难过|兴奋|happy|excited|afraid/i },
  { claim: /公园|学校|医院|家里|教室|park|school|hospital|home|classroom/i, evidence: /公园|学校|医院|家里|教室|park|school|hospital|home|classroom/i },
  { claim: /因为|为了|想要|觉得|拒绝|because|wanted|thought|refused/i, evidence: /因为|为了|想要|觉得|拒绝|because|wanted|thought|refused/i },
];

const dateOf = (value: string) => value.slice(0, 10);

function textEvidence(context: OrganizerContext) {
  return context.sourceSummaries.map((source) => source.text ?? "").join("\n");
}

function archiveEvidence(context: OrganizerContext) {
  return context.sourceSummaries.map((source) => [source.text ?? "", source.sourceLabel, JSON.stringify(source.metadata ?? {})].join(" ")).join("\n");
}

function sourceTypes(context: OrganizerContext) {
  return new Set(context.sourceSummaries.flatMap((source) => source.contentTypes));
}

function hasStrongSignal(context: OrganizerContext) {
  const text = textEvidence(context);
  return explicitChange.test(text) || sourceTypes(context).has("milestone") || sourceTypes(context).has("travel");
}

function conservativeWeight(context: OrganizerContext, requested: MemoryWeight) {
  const types = sourceTypes(context);
  if (requested === "chapter" && !(types.has("travel") && (textEvidence(context).length > 0 || context.sourceSummaries.some((source) => Boolean(source.metadata?.location)))) ) return "highlight";
  if (requested === "highlight" && !hasStrongSignal(context)) return "memory";
  if (!hasStrongSignal(context) && requested !== "trace") return "memory";
  return requested;
}

function filteredSignals(context: OrganizerContext, signals: OrganizerDecision["growthSignals"]) {
  const text = textEvidence(context);
  return (signals ?? []).filter((signal) => {
    const evidence = signalEvidence[signal];
    return Boolean(evidence && evidence.test(text));
  });
}

function unsupportedFactCount(context: OrganizerContext, story: string | undefined) {
  if (!story) return 0;
  const evidence = archiveEvidence(context);
  return highRiskFacts.reduce((count, fact) => count + (fact.claim.test(story) && !fact.evidence.test(evidence) ? 1 : 0), 0);
}

function normalizeAction(action: OrganizerAction): OrganizerAction {
  return action === "merge_existing" ? "attach_existing" : action;
}

export function applyOrganizerPolicy(input: OrganizerDecision, context: OrganizerContext): PolicyResult {
  const decision: OrganizerDecision = { ...input, action: normalizeAction(input.action), contentTypes: [...new Set(input.contentTypes)], growthSignals: filteredSignals(context, input.growthSignals) };
  const text = textEvidence(context);
  const types = sourceTypes(context);
  const isHealth = types.has("health") || context.sourceSummaries.some((source) => source.sourceType === "medical_document" || source.sourceType === "checkup_document");
  if (isHealth) {
    if (medicalInference.test(`${decision.title ?? ""}\n${decision.shortStory ?? ""}`)) throw new Error("Policy rejected medical inference");
    return { unsupportedFactCount: 0, decision: { ...decision, action: "care_episode", contentTypes: ["health"], memoryWeight: "trace", title: undefined, shortStory: undefined, existingLifeEventId: undefined, growthSignals: undefined } };
  }
  if ((decision.title && medicalInference.test(decision.title)) || (decision.shortStory && medicalInference.test(decision.shortStory))) throw new Error("Policy rejected medical inference");
  if (supportedFirstTime.test(`${decision.title ?? ""}\n${decision.shortStory ?? ""}`) && !supportedFirstTime.test(text)) throw new Error("Policy rejected unsupported first-time claim");
  if (decision.shortStory && !text && context.representativeMediaCount === 0) throw new Error("Policy rejected narrative without evidence");
  if (decision.shortStory && !text && context.sourceSummaries.every((source) => source.mediaCount > 0)) throw new Error("Policy requires textual or reliable metadata evidence for generated narrative");
  const unsupported = unsupportedFactCount(context, decision.shortStory);
  if (unsupported > 0) throw new Error(`Policy rejected ${unsupported} unsupported fact(s)`);
  if (decision.action === "create_memory" && (!hasStrongSignal(context) || decision.confidence < 0.68) && !types.has("travel")) {
    return { unsupportedFactCount: unsupported, decision: { ...decision, action: "daily_trace", title: undefined, shortStory: undefined, memoryWeight: "trace", existingLifeEventId: undefined } };
  }
  if (decision.action === "attach_existing" && !decision.existingLifeEventId) throw new Error("Policy requires an existing memory for attachment");
  if (decision.action === "store_only") return { unsupportedFactCount: unsupported, decision: { ...decision, title: undefined, shortStory: undefined, existingLifeEventId: undefined, growthSignals: undefined, memoryWeight: "trace" } };
  if (decision.action === "daily_trace") return { unsupportedFactCount: unsupported, decision: { ...decision, title: undefined, shortStory: undefined, existingLifeEventId: undefined, growthSignals: undefined, memoryWeight: "trace" } };
  return { unsupportedFactCount: unsupported, decision: { ...decision, occurredAt: dateOf(decision.occurredAt), memoryWeight: conservativeWeight(context, decision.memoryWeight) } };
}
