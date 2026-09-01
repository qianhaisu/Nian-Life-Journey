// Evidence-pipeline evaluator (§10, §11). Replaces the old count-only evaluation.ts for this new
// pipeline: it reports proposed-vs-final action, degrade reasons, safety violations and a
// dedicated negative-fixture pass rate, not just "how many memories got created".
import { runPipeline } from "./pipeline";
import { MockMemoryEditorProvider } from "./mock-editor";
import { ORGANIZER_FIXTURES, NOW, SUBJECT, OTHER_CHILD_NAME, type OrganizerFixture } from "./fixtures";
import type { OrganizerOutcome } from "./contract";

export type FixtureRunResult = {
  id: string;
  description: string;
  proposedAction?: string;
  finalAction: OrganizerOutcome["action"];
  passed: boolean;
  forbiddenPhraseHit?: string;
  reviewRequirement?: string;
  reasonCodes: string[];
  degradeReason?: string;
  isNegative: boolean;
};

function outcomeText(outcome: OrganizerOutcome): string {
  if (outcome.action === "daily_trace") return outcome.traceLines.map((line) => line.text).join(" ");
  if (outcome.action === "life_event_candidate") return [...outcome.coreFacts.map((fact) => fact.statement), ...outcome.quotableLines.map((quote) => quote.text)].join(" ");
  if (outcome.action === "care_observation") return outcome.symptomsVerbatim.join(" ");
  return "";
}

function reviewRequirementOf(outcome: OrganizerOutcome): string | undefined {
  if (outcome.action === "life_event_candidate") return outcome.reviewRequirement;
  if (outcome.action === "care_observation") return outcome.reviewRequirement;
  return undefined;
}

export async function runFixture(fixture: OrganizerFixture): Promise<FixtureRunResult> {
  const provider = new MockMemoryEditorProvider({ subjectNames: [SUBJECT.primaryName, ...SUBJECT.aliases], otherChildNames: [OTHER_CHILD_NAME] });
  const result = await runPipeline(fixture.window, { subject: SUBJECT, provider, context: { ...fixture.context, now: NOW }, windowFingerprint: `fixture:${fixture.id}`, persist: false });
  const expected = Array.isArray(fixture.expectedAction) ? fixture.expectedAction : [fixture.expectedAction];
  const actionOk = expected.includes(result.outcome.action);
  const reviewOk = !fixture.expectedReview || reviewRequirementOf(result.outcome) === fixture.expectedReview;
  const text = outcomeText(result.outcome);
  const forbiddenHit = fixture.forbiddenPhrases?.find((pattern) => pattern.test(text));
  return {
    id: fixture.id, description: fixture.description, proposedAction: result.verdict?.proposedAction, finalAction: result.outcome.action,
    passed: actionOk && reviewOk && !forbiddenHit, forbiddenPhraseHit: forbiddenHit?.source, reviewRequirement: reviewRequirementOf(result.outcome), reasonCodes: result.reasonCodes, degradeReason: result.degradeReason, isNegative: Boolean(fixture.isNegative),
  };
}

export type EvaluationMetrics = {
  totalFixtures: number;
  passRate: number;
  negativeFixturePassRate: number;
  negativeFixtureFailures: string[];
  proposedFinalMismatchCount: number;
  degradeReasonCounts: Record<string, number>;
  reviewBurden: number;
  categoryDiversityActions: number;
};

export async function evaluateFixtures(fixtures: OrganizerFixture[] = ORGANIZER_FIXTURES): Promise<{ results: FixtureRunResult[]; metrics: EvaluationMetrics }> {
  const results = await Promise.all(fixtures.map(runFixture));
  const negatives = results.filter((result) => result.isNegative);
  const degradeReasonCounts: Record<string, number> = {};
  for (const result of results) for (const code of result.reasonCodes) degradeReasonCounts[code] = (degradeReasonCounts[code] ?? 0) + 1;
  const metrics: EvaluationMetrics = {
    totalFixtures: results.length,
    passRate: results.filter((result) => result.passed).length / results.length,
    negativeFixturePassRate: negatives.length ? negatives.filter((result) => result.passed).length / negatives.length : 1,
    negativeFixtureFailures: negatives.filter((result) => !result.passed).map((result) => result.id),
    proposedFinalMismatchCount: results.filter((result) => result.proposedAction && result.proposedAction !== result.finalAction).length,
    degradeReasonCounts,
    reviewBurden: results.filter((result) => result.reviewRequirement === "needs_review").length,
    categoryDiversityActions: new Set(results.map((result) => result.finalAction)).size,
  };
  return { results, metrics };
}
