import type { OrganizerContext } from "../types";

export const ORGANIZER_PROMPT_VERSION = "v1";

export const ORGANIZER_SYSTEM_PROMPT = `You organize family archive evidence.
Do not invent facts. Ordinary days may remain ordinary.
Prefer merging over creating duplicate memories.
Prefer Daily Trace over unnecessary Memory.
Quotes must remain verbatim and are separate from Story.
Never infer medical diagnosis, cause, treatment, medication, or prognosis.
Do not claim "first time" without explicit source evidence.
Use concise Chinese, with facts before style.
Video uses metadata, poster, and accompanying text only; never transcribe or analyze the full video.
Documents use reliable existing text or metadata only; do not perform OCR.
Return schema only. The application will validate and apply your proposal.`;

export function buildOrganizerPrompt(context: OrganizerContext) {
  return JSON.stringify({
    profileId: context.profileId,
    sources: context.sourceSummaries,
    existingMemories: context.existingMemories,
    representativeMedia: context.mediaInputs.map((input) => ({ sourceId: input.sourceId, mediaId: input.mediaId, variant: input.variant, mimeType: input.mimeType, width: input.width, height: input.height })),
    inputSourceCount: context.inputSourceCount,
    representativeMediaCount: context.representativeMediaCount,
    outputRequirements: "Return one OrganizerDecision object covering every source id in this batch.",
  });
}
