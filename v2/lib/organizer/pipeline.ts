// Evidence pipeline orchestrator (§4 architecture): Recall → Memory Editor → Validator →
// MemoryCandidate. This is the ONLY place a caught error is handled, and it always resolves to a
// safe, narrative-free store_only outcome — never a different decision maker re-deciding the batch
// (that was the old ai.ts bug, §5.1).
import type { EvidenceWindow } from "./evidence/types";
import { passesRecall, type SubjectConfig } from "./recall";
import { validateMemoryEditorVerdict, CONTRACT_POLICY_VERSION, type MemoryEditorVerdict } from "./contract";
import type { OrganizerOutcome } from "./contract";
import { validate, VALIDATOR_VERSION, type ValidatorContext } from "./validator";
import { upsertMemoryCandidate, type MemoryCandidate } from "./candidate-store";
import { WINDOW_POLICY_VERSION } from "./evidence/window";

export type MemoryEditorProvider = { name: string; model?: string; organize(window: EvidenceWindow): Promise<{ verdict: unknown }> };

export type PipelineOptions = { subject: SubjectConfig; provider: MemoryEditorProvider; context: Omit<ValidatorContext, "modelVersion" | "now"> & { now?: string }; windowFingerprint: string; persist?: boolean };

export type PipelineResult = { window: EvidenceWindow; verdict?: MemoryEditorVerdict; outcome: OrganizerOutcome; degradeReason?: string; reasonCodes: string[]; skippedByRecall: boolean; candidate?: MemoryCandidate };

function safeErrorReason(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown_error";
  return message.slice(0, 160).replace(/[\r\n]/g, " ");
}

function failedOutcome(window: EvidenceWindow, degradeReason: string): OrganizerOutcome {
  return { action: "failed", sourceIds: window.items.map((item) => item.sourceId), windowId: window.windowId, policyVersion: CONTRACT_POLICY_VERSION, modelVersion: "n/a", selectionReason: "Safe degrade after pipeline error", worthinessScore: 0, degradeReason };
}

function storeOnlyOutcome(window: EvidenceWindow, reason: string): OrganizerOutcome {
  return { action: "store_only", sourceIds: window.items.map((item) => item.sourceId), windowId: window.windowId, policyVersion: CONTRACT_POLICY_VERSION, modelVersion: "n/a", selectionReason: reason, worthinessScore: 0 };
}

export async function runPipeline(window: EvidenceWindow, options: PipelineOptions): Promise<PipelineResult> {
  if (!passesRecall(window, options.subject)) {
    const outcome = storeOnlyOutcome(window, "did_not_pass_recall");
    return { window, outcome, reasonCodes: ["recall_filtered"], skippedByRecall: true };
  }

  let verdict: MemoryEditorVerdict | undefined;
  try {
    const response = await options.provider.organize(window);
    verdict = validateMemoryEditorVerdict(response.verdict, window);
  } catch (error) {
    // Provider or contract failure: degrade THIS window's decision to a safe outcome. Do not
    // reach for a different decision maker that could still create a LifeEvent (§5.1).
    const outcome = failedOutcome(window, safeErrorReason(error));
    const candidate = options.persist === false ? undefined : await upsertMemoryCandidate({ profileId: window.profileId, conversationId: window.conversationId, windowId: window.windowId, windowFingerprint: options.windowFingerprint, sourceIds: window.items.map((item) => item.sourceId), proposedAction: "unknown", outcome, degradeReason: outcome.degradeReason, reasonCodes: ["provider_or_contract_error"], promptVersion: WINDOW_POLICY_VERSION });
    return { window, outcome, degradeReason: outcome.degradeReason, reasonCodes: ["provider_or_contract_error"], skippedByRecall: false, candidate };
  }

  try {
    // Spread, never whitelist. This line used to enumerate five fields, which silently dropped
    // `supportedPriorSourceIds` on its way to the validator: H8 path B then saw an empty supplied
    // set and rejected every longitudinal transition claim as "unverified", including one where the
    // model had cited three real, correct baselines it genuinely had been shown. A field added to
    // ValidatorContext must reach the validator by default, not by remembering to extend a list.
    const validatorContext: ValidatorContext = { ...options.context, now: options.context.now ?? new Date().toISOString(), modelVersion: options.provider.model ?? options.provider.name };
    const result = validate(window, verdict, validatorContext);
    const candidate = options.persist === false ? undefined : await upsertMemoryCandidate({ profileId: window.profileId, conversationId: window.conversationId, windowId: window.windowId, windowFingerprint: options.windowFingerprint, sourceIds: window.items.map((item) => item.sourceId), proposedAction: verdict.proposedAction, outcome: result.outcome, degradeReason: result.degradeReason, reasonCodes: result.reasonCodes, promptVersion: WINDOW_POLICY_VERSION });
    return { window, verdict, outcome: result.outcome, degradeReason: result.degradeReason, reasonCodes: result.reasonCodes, skippedByRecall: false, candidate };
  } catch (error) {
    const outcome = failedOutcome(window, safeErrorReason(error));
    const candidate = options.persist === false ? undefined : await upsertMemoryCandidate({ profileId: window.profileId, conversationId: window.conversationId, windowId: window.windowId, windowFingerprint: options.windowFingerprint, sourceIds: window.items.map((item) => item.sourceId), proposedAction: verdict.proposedAction, outcome, degradeReason: outcome.degradeReason, reasonCodes: ["validator_error"], promptVersion: WINDOW_POLICY_VERSION });
    return { window, verdict, outcome, degradeReason: outcome.degradeReason, reasonCodes: ["validator_error"], skippedByRecall: false, candidate };
  }
}

export { VALIDATOR_VERSION };
