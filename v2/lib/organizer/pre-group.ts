import type { RawSource } from "@/lib/types";

const maxGapMs = 3 * 60 * 60 * 1000;

function familyOf(source: RawSource) {
  if (source.sourceType === "medical_document" || source.sourceType === "checkup_document" || source.contentTypes.includes("health")) return "medical";
  if (source.sourceType.startsWith("daycare")) return "daycare";
  if (source.sourceType === "family_photo" || source.sourceType === "family_video" || source.sourceType === "chat_screenshot") return "media";
  return "note";
}

function compatible(a: RawSource, b: RawSource) {
  const families = new Set([familyOf(a), familyOf(b)]);
  if (families.has("medical") && families.size > 1) return false;
  return families.size === 1 || (families.has("daycare") && families.has("note")) || (families.has("media") && families.has("note"));
}

export function preGroupSources(sources: RawSource[]) {
  const sorted = [...sources].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt) || a.id.localeCompare(b.id));
  const groups: RawSource[][] = [];
  for (const source of sorted) {
    const last = groups.at(-1);
    const previous = last?.at(-1);
    const sameDay = previous?.capturedAt.slice(0, 10) === source.capturedAt.slice(0, 10);
    const close = previous ? Math.abs(Date.parse(source.capturedAt) - Date.parse(previous.capturedAt)) <= maxGapMs : false;
    if (last && previous && sameDay && close && compatible(previous, source)) last.push(source);
    else groups.push([source]);
  }
  return groups;
}
