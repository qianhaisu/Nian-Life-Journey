import { applyOrganizerPolicy } from "./policy";
import { AIProviderError, MockAIProvider } from "./provider";
import { validateOrganizerDecision } from "./schema";
import type { ContentType } from "@/lib/types";
import type { AIProvider, AIProviderResponse, OrganizerContext, OrganizerDecision, ProviderUsage } from "./types";

type EvaluationFixture = { id: string; description: string; expectedActions: OrganizerDecision["action"][]; context: OrganizerContext };

function context(input: Pick<OrganizerContext, "sourceSummaries" | "existingMemories"> & Partial<Pick<OrganizerContext, "representativeMediaCount">>): OrganizerContext {
  const sourceIds = input.sourceSummaries.map((source) => source.id);
  return { profileId: "synthetic-profile", sourceSummaries: input.sourceSummaries, existingMemories: input.existingMemories, mediaInputs: [], inputSourceCount: sourceIds.length, representativeMediaCount: input.representativeMediaCount ?? 0, generatedAt: "2026-08-28T00:00:00.000Z", organizationFingerprint: `synthetic-${sourceIds.join("-")}` };
}
const photo = (id: string, count = 1, contentTypes: ContentType[] = ["daily", "family"]) => ({ id, sourceType: "family_photo" as const, contentTypes, contributorId: "synthetic-parent", capturedAt: "2026-08-28T10:00:00.000Z", sourceLabel: "Synthetic photos", mediaCount: count, media: [] });

export const AI_ORGANIZER_EVALUATION_FIXTURES: EvaluationFixture[] = [
  { id: "ordinary-daycare", description: "12 daycare photos plus an ordinary teacher note", expectedActions: ["daily_trace"], context: context({ sourceSummaries: [{ ...photo("eval-ordinary-photos", 12, ["daycare", "daily"]), sourceType: "daycare_photo" }, { ...photo("eval-ordinary-note", 0, ["daycare", "daily"]), sourceType: "daycare_note", text: "今天户外活动的时候喜欢追球。" }], existingMemories: [], representativeMediaCount: 6 }) },
  { id: "explicit-memory", description: "Teacher and parents independently record a concrete first-time change", expectedActions: ["create_memory"], context: context({ sourceSummaries: [{ ...photo("eval-milestone-photos", 12, ["daycare", "motor", "growth"]), sourceType: "daycare_photo" }, { ...photo("eval-milestone-teacher", 0, ["daycare", "motor"]), sourceType: "daycare_note", text: "孩子第一次主动追着其他孩子一起踢球。" }, { ...photo("eval-milestone-parent", 0, ["family", "motor"]), sourceType: "parent_note", text: "晚上也记录了他今天主动追球的变化。" }], existingMemories: [], representativeMediaCount: 6 }) },
  { id: "attach-video", description: "A later video belongs to a same-day existing memory", expectedActions: ["attach_existing"], context: context({ sourceSummaries: [{ ...photo("eval-video", 0, ["motor", "family"]), sourceType: "family_video" }], existingMemories: [{ id: "eval-existing-ball", occurredAt: "2026-08-28", title: "托班追球", story: "老师记录了追球活动。", contentTypes: ["daycare", "motor"], memoryWeight: "memory", sourceCount: 2, visibility: "family" }] }) },
  { id: "ordinary-volume", description: "18 ordinary sources remain compact", expectedActions: ["daily_trace", "store_only"], context: context({ sourceSummaries: [{ ...photo("eval-volume", 18, ["daily", "family"]) }], existingMemories: [], representativeMediaCount: 6 }) },
  { id: "one-sentence", description: "A short parent note becomes a lightweight memory", expectedActions: ["create_memory"], context: context({ sourceSummaries: [{ ...photo("eval-one-sentence", 0, ["language", "family"]), sourceType: "parent_note", text: "今天开始一直说“车车”。" }], existingMemories: [] }) },
  { id: "travel", description: "Travel sources with a location and parent note form one larger memory", expectedActions: ["create_memory"], context: context({ sourceSummaries: [{ ...photo("eval-travel-photos", 20, ["travel", "family"]), metadata: { location: "宁波东钱湖" } }, { ...photo("eval-travel-note", 0, ["travel", "family"]), sourceType: "parent_note", text: "今天去了宁波东钱湖，在雨里看了很久的湖面。" }], existingMemories: [], representativeMediaCount: 6 }) },
  { id: "medical", description: "Medical metadata and a parent fact become a private care episode", expectedActions: ["care_episode"], context: context({ sourceSummaries: [{ ...photo("eval-medical-pdf", 0, ["health"]), sourceType: "medical_document", sourceLabel: "Synthetic medical PDF", metadata: { filename: "checkup.pdf", type: "application/pdf" } }, { ...photo("eval-medical-note", 0, ["health"]), sourceType: "parent_note", text: "家长记录检查日期和医生原始说明。" }], existingMemories: [] }) },
  { id: "uncertain-image", description: "An ordinary image without supporting context is retained only", expectedActions: ["store_only", "daily_trace"], context: context({ sourceSummaries: [{ ...photo("eval-uncertain-image", 1, ["daily", "family"]) }], existingMemories: [], representativeMediaCount: 0 }) },
];

// Lets a caller (e.g. a real-Gemini evaluation script) narrow a run to specific fixture ids without
// touching fixture content, expected actions, or the quality gate. Undefined/empty selection returns
// every fixture, unchanged from calling evaluateAIOrganizer() with no filter at all.
export function selectEvaluationFixtures(ids?: string): EvaluationFixture[] {
  const requested = (ids ?? "").split(",").map((id) => id.trim()).filter(Boolean);
  if (requested.length === 0) return AI_ORGANIZER_EVALUATION_FIXTURES;
  const validIds = AI_ORGANIZER_EVALUATION_FIXTURES.map((fixture) => fixture.id);
  const unknown = requested.filter((id) => !validIds.includes(id));
  if (unknown.length > 0) throw new Error(`Unknown evaluation fixture id(s): ${unknown.join(", ")}. Valid ids: ${validIds.join(", ")}`);
  return AI_ORGANIZER_EVALUATION_FIXTURES.filter((fixture) => requested.includes(fixture.id));
}

export type EvaluationResult = {
  id: string;
  description: string;
  action: OrganizerDecision["action"] | "fallback";
  proposedAction?: string;
  expectedActions: OrganizerDecision["action"][];
  passed: boolean;
  unsupportedFactCount: number;
  confidence?: number;
  story?: string;
  proposedConfidence?: number;
  proposedStory?: string;
  reason?: string;
  latencyMs: number;
  usage?: ProviderUsage;
  fallback: boolean;
  error?: string;
};

function reportFields(value: unknown) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    proposedAction: typeof record.action === "string" ? record.action : undefined,
    proposedConfidence: typeof record.confidence === "number" ? record.confidence : undefined,
    proposedStory: typeof record.shortStory === "string" ? record.shortStory : undefined,
  };
}

export async function evaluateAIOrganizer(provider: AIProvider = new MockAIProvider(), fixtures: EvaluationFixture[] = AI_ORGANIZER_EVALUATION_FIXTURES) {
  const results: EvaluationResult[] = [];
  for (const fixture of fixtures) {
    const startedAt = Date.now();
    let response: AIProviderResponse | undefined;
    try {
      response = await provider.organize(fixture.context);
      const latencyMs = Date.now() - startedAt;
      const validated = validateOrganizerDecision(response.decision, fixture.context);
      const evaluated = applyOrganizerPolicy(validated, fixture.context);
      results.push({ id: fixture.id, description: fixture.description, action: evaluated.decision.action, expectedActions: fixture.expectedActions, passed: fixture.expectedActions.includes(evaluated.decision.action), unsupportedFactCount: evaluated.unsupportedFactCount, confidence: evaluated.decision.confidence, story: evaluated.decision.shortStory, reason: evaluated.decision.reason, latencyMs, usage: response.usage, fallback: false });
    } catch (error) {
      const latencyMs = Date.now() - startedAt;
      const rejectedDecision = response?.decision ?? (error instanceof AIProviderError ? error.decision : undefined);
      results.push({ id: fixture.id, description: fixture.description, action: "fallback", ...reportFields(rejectedDecision), expectedActions: fixture.expectedActions, passed: false, unsupportedFactCount: 0, latencyMs, usage: response?.usage, fallback: true, error: error instanceof Error ? error.message : "AI provider failed" });
    }
  }
  const stories = results.filter((result) => !result.fallback && (result.story?.length ?? 0) > 0);
  return {
    results,
    metrics: {
      memoryCount: results.filter((result) => result.action === "create_memory").length,
      dailyTraceCount: results.filter((result) => result.action === "daily_trace").length,
      mergeAccuracy: results.filter((result) => result.expectedActions.includes("attach_existing")).filter((result) => result.action === "attach_existing").length,
      duplicateCount: 0,
      unsupportedFactCount: results.reduce((sum, result) => sum + result.unsupportedFactCount, 0),
      averageStoryLength: stories.length ? stories.reduce((sum, result) => sum + (result.story?.length ?? 0), 0) / stories.length : 0,
      fallbackCount: results.filter((result) => result.fallback).length,
      averageLatencyMs: results.length ? results.reduce((sum, result) => sum + result.latencyMs, 0) / results.length : 0,
      firstTimeHallucinationCount: results.filter((result) => result.error?.toLowerCase().includes("first-time") || result.error?.includes("首次")).length,
      medicalDiagnosisInferenceCount: results.filter((result) => result.error?.toLowerCase().includes("medical inference") || result.error?.includes("医疗推断")).length,
      ordinaryDaycareOvergenerationCount: results.filter((result) => result.id === "ordinary-daycare" && (result.action === "create_memory" || result.proposedAction === "create_memory")).length,
      mergeCaseCount: results.filter((result) => result.expectedActions.includes("attach_existing")).length,
    },
  };
}
