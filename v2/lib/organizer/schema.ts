import type { ContentType, MemoryWeight, OrganizerAction } from "@/lib/types";
import type { OrganizerContext, OrganizerDecision } from "./types";

export const ORGANIZER_DECISION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["action", "sourceIds", "existingLifeEventId", "occurredAt", "contentTypes", "memoryWeight", "title", "shortStory", "growthSignals", "careSignals", "confidence", "reason"],
  properties: {
    action: { type: "string", enum: ["create_memory", "merge_existing", "attach_existing", "daily_trace", "care_episode", "store_only"] },
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

const actions = new Set<OrganizerAction>(["create_memory", "merge_existing", "attach_existing", "daily_trace", "care_episode", "store_only"]);
const contentTypes = new Set<ContentType>(["daily", "daycare", "travel", "milestone", "growth", "language", "motor", "interest", "food", "sleep", "health", "family", "funny_moment"]);
const weights = new Set<MemoryWeight>(["trace", "memory", "highlight", "chapter"]);
const growthSignals = new Set(["language", "motor", "social", "interest"]);
const allowedKeys = new Set(Object.keys(ORGANIZER_DECISION_SCHEMA.properties));
const forbiddenKeys = /diagnos|etiolog|treatment|medication|prescription|medicalAdvice|causeOf/i;
const medicalInference = /诊断|病因|治疗建议|用药建议|处方|药物剂量|diagnos|treatment recommendation|prescription/i;
const firstTime = /第一次|首次|first\s*time/i;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function rejectForbiddenKeys(value: unknown, path = "decision"): string | undefined {
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const issue = rejectForbiddenKeys(value[index], `${path}[${index}]`);
      if (issue) return issue;
    }
    return undefined;
  }
  if (!object(value)) return undefined;
  for (const [key, child] of Object.entries(value)) {
    if (forbiddenKeys.test(key)) return `${path}.${key} is not allowed`;
    const issue = rejectForbiddenKeys(child, `${path}.${key}`);
    if (issue) return issue;
  }
  return undefined;
}

function validDate(value: unknown) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)) return false;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return false;
  const year = Number(match[1]); const month = Number(match[2]); const day = Number(match[3]);
  const calendarDate = new Date(Date.UTC(year, month - 1, day));
  const date = new Date(value);
  return !Number.isNaN(date.getTime()) && year >= 2000 && year <= 2200 && calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day;
}

function stringArray(value: unknown, set?: Set<string>, minimum = 1) {
  return Array.isArray(value) && value.length >= minimum && value.every((item) => typeof item === "string" && item.length <= 240 && (!set || set.has(item)));
}

export function validateOrganizerDecision(raw: unknown, context: OrganizerContext): OrganizerDecision {
  const forbiddenIssue = rejectForbiddenKeys(raw);
  if (forbiddenIssue) throw new Error(`Invalid organizer decision: ${forbiddenIssue}`);
  if (!object(raw)) throw new Error("Invalid organizer decision: expected an object");
  const unknownKey = Object.keys(raw).find((key) => !allowedKeys.has(key));
  if (unknownKey) throw new Error(`Invalid organizer decision: unknown field ${unknownKey}`);
  const value = raw as Record<string, unknown>;
  if (typeof value.action !== "string" || !actions.has(value.action as OrganizerAction)) throw new Error("Invalid organizer decision: action");
  if (!stringArray(value.sourceIds)) throw new Error("Invalid organizer decision: sourceIds");
  const decisionSourceIds = value.sourceIds as string[];
  if (decisionSourceIds.some((id) => !context.sourceSummaries.some((source) => source.id === id))) throw new Error("Invalid organizer decision: sourceIds");
  const expectedIds = new Set(context.sourceSummaries.map((source) => source.id));
  if (decisionSourceIds.length !== expectedIds.size || new Set(decisionSourceIds).size !== expectedIds.size || [...expectedIds].some((id) => !decisionSourceIds.includes(id))) throw new Error("Invalid organizer decision: sourceIds must cover the complete batch");
  if (!validDate(value.occurredAt)) throw new Error("Invalid organizer decision: occurredAt");
  const occurredDate = (value.occurredAt as string).slice(0, 10);
  const sourceDates = new Set(context.sourceSummaries.map((source) => source.capturedAt.slice(0, 10)));
  const existingDates = new Set(context.existingMemories.map((memory) => memory.occurredAt.slice(0, 10)));
  if (!sourceDates.has(occurredDate) && !existingDates.has(occurredDate)) throw new Error("Invalid organizer decision: occurredAt is outside the source context");
  if (!stringArray(value.contentTypes, contentTypes)) throw new Error("Invalid organizer decision: contentTypes");
  if (typeof value.memoryWeight !== "string" || !weights.has(value.memoryWeight as MemoryWeight)) throw new Error("Invalid organizer decision: memoryWeight");
  if (typeof value.confidence !== "number" || !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1) throw new Error("Invalid organizer decision: confidence");
  if (typeof value.reason !== "string" || value.reason.length > 500) throw new Error("Invalid organizer decision: reason");
  for (const field of ["title", "shortStory"] as const) if (value[field] !== undefined && value[field] !== null && (typeof value[field] !== "string" || value[field].length > (field === "title" ? 120 : 500))) throw new Error(`Invalid organizer decision: ${field}`);
  if (value.growthSignals !== undefined && value.growthSignals !== null && (!stringArray(value.growthSignals, growthSignals, 0))) throw new Error("Invalid organizer decision: growthSignals");
  if (value.careSignals !== undefined && value.careSignals !== null && (!stringArray(value.careSignals, undefined, 0))) throw new Error("Invalid organizer decision: careSignals");
  if (["attach_existing", "merge_existing"].includes(value.action as string)) {
    if (typeof value.existingLifeEventId !== "string" || !context.existingMemories.some((memory) => memory.id === value.existingLifeEventId)) throw new Error("Invalid organizer decision: existingLifeEventId");
  } else if (value.existingLifeEventId !== undefined && value.existingLifeEventId !== null) throw new Error("Invalid organizer decision: existingLifeEventId is only valid for attachment");
  if (value.action === "care_episode" && !((value.contentTypes as string[]).includes("health"))) throw new Error("Invalid organizer decision: care_episode must be health");
  if (["daily_trace", "store_only", "care_episode"].includes(value.action as string) && value.shortStory !== undefined && value.shortStory !== null) throw new Error("Invalid organizer decision: narrative is not allowed for this action");
  if (medicalInference.test(String(value.title ?? "")) || medicalInference.test(String(value.shortStory ?? ""))) throw new Error("Invalid organizer decision: medical inference");
  if (medicalInference.test(JSON.stringify(value.careSignals ?? []))) throw new Error("Invalid organizer decision: medical inference");
  if (firstTime.test(String(value.title ?? "")) || firstTime.test(String(value.shortStory ?? ""))) {
    const evidence = context.sourceSummaries.some((source) => firstTime.test(source.text ?? ""));
    if (!evidence) throw new Error("Invalid organizer decision: first-time claim lacks evidence");
  }
  return {
    action: value.action as OrganizerAction,
    sourceIds: [...(value.sourceIds as string[])],
    existingLifeEventId: (value.existingLifeEventId ?? undefined) as string | undefined,
    occurredAt: value.occurredAt as string,
    contentTypes: [...(value.contentTypes as ContentType[])],
    memoryWeight: value.memoryWeight as MemoryWeight,
    title: (value.title ?? undefined) as string | undefined,
    shortStory: (value.shortStory ?? undefined) as string | undefined,
    growthSignals: (value.growthSignals ?? undefined) as OrganizerDecision["growthSignals"],
    careSignals: (value.careSignals ?? undefined) as string[] | undefined,
    confidence: value.confidence as number,
    reason: value.reason as string,
  };
}
