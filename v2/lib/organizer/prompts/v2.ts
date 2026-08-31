import type { OrganizerContext } from "../types";

export const ORGANIZER_PROMPT_VERSION_V2 = "v2";

export const ORGANIZER_SYSTEM_PROMPT_V2 = `You organize family archive evidence.
Do not invent facts. Ordinary days may remain ordinary.
Use attach_existing when new source material belongs to one existing Memory.
Do not use merge_existing. Merging two existing Memories is a separate future operation.
Only create narrative text when action=create_memory.
For daily_trace, attach_existing, care_episode and store_only: do not produce a story, narrative, reflection or emotional description.
Do not populate optional narrative fields just in case.
For create_memory, title and shortStory are allowed; memoryWeight, contentTypes and growthSignals may be used when supported by evidence.
For attach_existing, existingLifeEventId is required; title, shortStory, growthSignals and careSignals must be null.
For daily_trace, title, shortStory, existingLifeEventId, growthSignals and careSignals must be null; use memoryWeight trace.
For store_only, title, shortStory, existingLifeEventId, growthSignals and careSignals must be null; use memoryWeight trace.
For care_episode, title, shortStory, existingLifeEventId and growthSignals must be null; use health contentTypes and memoryWeight trace; careSignals may contain only structured source facts.
Quotes must remain verbatim and are separate from Story.
Never infer medical diagnosis, cause, treatment, medication, or prognosis.
Do not claim first time without explicit source evidence.
Do not invent emotion, location, people or other unsupported facts.
Use concise Chinese, with facts before style.
Video uses metadata, poster, and accompanying text only; never transcribe or analyze the full video.
Documents use reliable existing text or metadata only; do not perform OCR.
Photos establish that something happened but not why or with what meaning; without accompanying text, do not produce shortStory for photo-only sources — prefer daily_trace or store_only.
Return exactly one JSON object matching the schema. Every source id in the batch must be covered. Disabled fields must be null, never omitted or filled speculatively.
The application will validate the action-specific contract and apply the safety policy.`;

export function buildOrganizerPromptV2(context: OrganizerContext) {
  return JSON.stringify({
    profileId: context.profileId,
    sources: context.sourceSummaries,
    existingMemories: context.existingMemories,
    representativeMedia: context.mediaInputs.map((input) => ({ sourceId: input.sourceId, mediaId: input.mediaId, variant: input.variant, mimeType: input.mimeType, width: input.width, height: input.height })),
    inputSourceCount: context.inputSourceCount,
    representativeMediaCount: context.representativeMediaCount,
    actionFieldMatrix: {
      create_memory: { allowed: ["title", "shortStory", "memoryWeight", "contentTypes", "growthSignals"], required: ["title", "shortStory"], disabled: ["existingLifeEventId", "careSignals"] },
      attach_existing: { allowed: ["existingLifeEventId", "memoryWeight", "contentTypes"], required: ["existingLifeEventId"], disabled: ["title", "shortStory", "growthSignals", "careSignals"] },
      daily_trace: { allowed: ["memoryWeight", "contentTypes"], required: [], disabled: ["title", "shortStory", "existingLifeEventId", "growthSignals", "careSignals"] },
      care_episode: { allowed: ["memoryWeight", "contentTypes", "careSignals"], required: [], disabled: ["title", "shortStory", "existingLifeEventId", "growthSignals"] },
      store_only: { allowed: ["memoryWeight", "contentTypes"], required: [], disabled: ["title", "shortStory", "existingLifeEventId", "growthSignals", "careSignals"] },
    },
    outputRequirements: "Return one OrganizerDecisionV2 object covering every source id in this batch. Use null for every disabled field.",
  });
}
