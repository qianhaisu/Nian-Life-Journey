import type { ContentType, MemoryWeight, OrganizerAction } from "@/lib/types";
import { validateOrganizerDecision } from "./schema";
import type { OrganizerContext, OrganizerDecision } from "./types";

export const ORGANIZER_DECISION_SCHEMA_V2 = {
  type: "object",
  additionalProperties: false,
  required: ["action", "sourceIds", "existingLifeEventId", "occurredAt", "contentTypes", "memoryWeight", "title", "shortStory", "growthSignals", "careSignals", "confidence", "reason"],
  properties: {
    action: { type: "string", enum: ["create_memory", "attach_existing", "daily_trace", "care_episode", "store_only"] },
    sourceIds: { type: "array", items: { type: "string" }, minItems: 1 },
    existingLifeEventId: { anyOf: [{ type: "string" }, { type: "null" }] },
    occurredAt: { type: "string" },
    contentTypes: { type: "array", items: { type: "string" }, minItems: 1 },
    memoryWeight: { type: "string", enum: ["trace", "memory", "highlight", "chapter"] },
    title: { anyOf: [{ type: "string" }, { type: "null" }] },
    shortStory: { anyOf: [{ type: "string" }, { type: "null" }] },
    growthSignals: { anyOf: [{ type: "array", items: { type: "string", enum: ["language", "motor", "social", "interest"] } }, { type: "null" }] },
    careSignals: { anyOf: [{ type: "array", items: { type: "string" } }, { type: "null" }] },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    reason: { type: "string" },
  },
} as const;

const V2_ACTIONS = new Set<OrganizerAction>(["create_memory", "attach_existing", "daily_trace", "care_episode", "store_only"]);

function absent(value: string | string[] | undefined) {
  return value === undefined;
}

function requireText(value: string | undefined, field: string) {
  if (!value?.trim()) throw new Error(`Invalid organizer decision: ${field} is required for create_memory`);
}

function rejectNarrativeFields(decision: OrganizerDecision, fields: Array<"title" | "shortStory" | "growthSignals" | "careSignals" | "existingLifeEventId">) {
  for (const field of fields) {
    const value = decision[field];
    if (!absent(value as string | string[] | undefined)) throw new Error(`Invalid organizer decision: ${field} is disabled for ${decision.action}`);
  }
}

export function validateOrganizerDecisionV2(raw: unknown, context: OrganizerContext): OrganizerDecision {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Error("Invalid organizer decision: expected an object");
  const value = raw as Record<string, unknown>;
  const missingField = ORGANIZER_DECISION_SCHEMA_V2.required.find((field) => !Object.prototype.hasOwnProperty.call(value, field));
  if (missingField) throw new Error(`Invalid organizer decision: missing required field ${missingField}`);
  const proposedAction = value.action;
  if (proposedAction === "merge_existing") throw new Error("Invalid organizer decision: merge_existing is not allowed in v2");
  if (typeof proposedAction !== "string" || !V2_ACTIONS.has(proposedAction as OrganizerAction)) throw new Error("Invalid organizer decision: action");
  const decision = validateOrganizerDecision(raw, context);
  if (!V2_ACTIONS.has(decision.action)) throw new Error("Invalid organizer decision: action");
  if (decision.action === "create_memory") {
    requireText(decision.title, "title");
    requireText(decision.shortStory, "shortStory");
    rejectNarrativeFields(decision, ["existingLifeEventId", "careSignals"]);
  } else if (decision.action === "attach_existing") {
    if (!decision.existingLifeEventId) throw new Error("Invalid organizer decision: existingLifeEventId is required for attach_existing");
    rejectNarrativeFields(decision, ["title", "shortStory", "growthSignals", "careSignals"]);
  } else if (decision.action === "daily_trace") {
    if (decision.memoryWeight !== "trace") throw new Error("Invalid organizer decision: daily_trace requires trace memoryWeight");
    rejectNarrativeFields(decision, ["title", "shortStory", "existingLifeEventId", "growthSignals", "careSignals"]);
  } else if (decision.action === "store_only") {
    if (decision.memoryWeight !== "trace") throw new Error("Invalid organizer decision: store_only requires trace memoryWeight");
    rejectNarrativeFields(decision, ["title", "shortStory", "existingLifeEventId", "growthSignals", "careSignals"]);
  } else if (decision.action === "care_episode") {
    if (!decision.contentTypes.includes("health" as ContentType)) throw new Error("Invalid organizer decision: care_episode must be health");
    if (decision.memoryWeight !== "trace") throw new Error("Invalid organizer decision: care_episode requires trace memoryWeight");
    rejectNarrativeFields(decision, ["title", "shortStory", "existingLifeEventId", "growthSignals"]);
  }
  return decision;
}

export type OrganizerDecisionV2Action = Exclude<OrganizerAction, "merge_existing">;
export type OrganizerDecisionV2MemoryWeight = MemoryWeight;
