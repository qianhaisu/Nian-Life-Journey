// Central-fact relevance.
//
// Subject relevance asks "is this about the child". That is not enough. "他三点半喝的奶" is about
// the child and supports nothing; "我还蛮喜欢看他哭的" is about the child and is not evidence that
// he learned to stand. An event has one central fact — the new ability or the specific scene it
// exists to record — and every source kept on that event has to support THAT.
//
// The judgement is a model call (below, in the script that uses this) because it is semantic. What
// lives here is the deterministic part: choosing the central fact, and clamping what the model is
// allowed to hand back.
import { classifyCareTopics } from "./care-topics";

const MILESTONE_TOPIC = /第一次|首次|学会|会爬|会走|会站|扶墙站|站起来|开口|会说|叫爸爸|叫妈妈|自己吃|自己走|迈步|翻身|独坐|里程碑/;

// A central fact has to be something that happened. A message imagining, planning or proposing
// something is not the event, however vividly it is phrased — "我想象了一个画面…让他自己吃" contains
// 自己吃 and is not evidence that he ate by himself.
const HYPOTHETICAL = /想象|如果|要不要|以后|打算|准备|计划|建议|不如|应该会|可能会|等他/;

export type CoreFactLike = { statement: string; evidenceRefs: string[] };

// The central fact is the new ability when there is one, because that is what earned the event its
// LifeEvent status in the first place (see care-topics.ts). Otherwise it is the first stated fact,
// which the Memory Editor orders by salience.
export function selectCentralFact<T extends CoreFactLike>(facts: T[]): T | undefined {
  if (facts.length === 0) return undefined;
  const actual = facts.filter((fact) => !HYPOTHETICAL.test(fact.statement));
  const pool = actual.length > 0 ? actual : facts;
  return pool.find((fact) => MILESTONE_TOPIC.test(fact.statement)) ?? pool[0];
}

export type SupportDecision = { sourceId: string; keep: boolean; reason: string };

// The model returns keep/drop per source. It may only speak about sources it was actually given,
// and a source it fails to mention is dropped rather than kept — an unjudged source is not
// supporting evidence.
export function reconcileSupport(candidateIds: string[], decisions: SupportDecision[], minKeep = 2, maxKeep = 12): { kept: string[]; resolved: SupportDecision[] } {
  const byId = new Map(decisions.filter((decision) => candidateIds.includes(decision.sourceId)).map((decision) => [decision.sourceId, decision]));
  const resolved = candidateIds.map((sourceId) => byId.get(sourceId) ?? { sourceId, keep: false, reason: "not_judged_by_model" });
  const kept = resolved.filter((decision) => decision.keep).map((decision) => decision.sourceId).slice(0, maxKeep);
  return { kept, resolved };
}

export function meetsMinimumSupport(kept: string[], minKeep = 2): boolean {
  return kept.length >= minKeep;
}

export { classifyCareTopics };
