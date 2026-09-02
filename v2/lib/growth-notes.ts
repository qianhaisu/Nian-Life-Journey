import type { GrowthKind, GrowthRecord } from "@/lib/types";
import { timeSignatureFor, type TimeSignature } from "@/lib/time-signature";
import { isRecent, type RecencyReference } from "@/lib/time-truth";

// Growth records split into two kinds of fact: what 张年 has started doing (a note a parent would
// repeat to a grandparent) and what was measured (numbers that belong on a deeper page).
export const OBSERVED_KINDS: GrowthKind[] = ["language", "motor", "social", "interest", "personality", "food", "sleep"];
export const MEASURED_KINDS: GrowthKind[] = ["height", "weight"];

// "最近…" is a claim about now; it is only used while the note is recent under lib/time-truth.ts.
// An old note keeps its fact and gets the dated wording instead.
export const GROWTH_KIND_LABEL: Record<GrowthKind, string> = {
  language: "最近常说", motor: "最近学会", social: "最近的样子", interest: "最近喜欢", personality: "最近的脾气", food: "最近爱吃", sleep: "最近的睡眠", height: "身高", weight: "体重",
};
export const GROWTH_KIND_LABEL_DATED: Record<GrowthKind, string> = {
  language: "那时常说", motor: "那时学会", social: "那时的样子", interest: "那时喜欢", personality: "那时的脾气", food: "那时爱吃", sleep: "那时的睡眠", height: "身高", weight: "体重",
};

export type GrowthNote = { id: string; kind: GrowthKind; label: string; note: string; signature: TimeSignature; recent: boolean };

function toNote(record: GrowthRecord, birthDay: string | undefined, reference: RecencyReference | undefined): GrowthNote | undefined {
  const note = record.note?.trim();
  if (!note) return undefined;
  const signature = timeSignatureFor(record.observedAt, birthDay);
  if (!signature) return undefined;
  // Without a reference the caller has no "now" to compare against and the note is only a fact.
  const recent = reference ? isRecent(signature.day, reference) : false;
  return { id: record.id, kind: record.kind, label: (recent ? GROWTH_KIND_LABEL : GROWTH_KIND_LABEL_DATED)[record.kind], note, signature, recent };
}

// Newest observed notes (by observedAt — life time), private ones excluded, one per kind so
// "最近学会" and "最近常说" both get a line.
export function recentGrowthNotes(records: GrowthRecord[], birthDay?: string, limit = 4, reference?: RecencyReference): GrowthNote[] {
  const seen = new Set<GrowthKind>();
  const notes: GrowthNote[] = [];
  for (const record of [...records].filter((item) => item.visibility !== "private" && OBSERVED_KINDS.includes(item.kind)).sort((a, b) => b.observedAt.localeCompare(a.observedAt) || a.id.localeCompare(b.id))) {
    if (seen.has(record.kind)) continue;
    const note = toNote(record, birthDay, reference);
    if (!note) continue;
    seen.add(record.kind);
    notes.push(note);
    if (notes.length >= limit) break;
  }
  return notes;
}

// The one change the front page mentions. Undefined when there is nothing real to say — including
// when the newest note is no longer recent: "最近长大的一点" is not a place for an old fact.
export function latestGrowthNote(records: GrowthRecord[], birthDay: string | undefined, reference: RecencyReference): GrowthNote | undefined {
  const note = recentGrowthNotes(records, birthDay, 1, reference)[0];
  return note?.recent ? note : undefined;
}

export type Measurement = { id: string; kind: GrowthKind; value: number; unit: string; signature: TimeSignature };

export function measurements(records: GrowthRecord[], kind: GrowthKind, birthDay?: string): Measurement[] {
  return records
    .filter((item) => item.kind === kind && item.visibility !== "private" && typeof item.value === "number")
    .sort((a, b) => a.observedAt.localeCompare(b.observedAt))
    .flatMap((item) => { const signature = timeSignatureFor(item.observedAt, birthDay); return signature ? [{ id: item.id, kind: item.kind, value: item.value as number, unit: item.unit ?? "", signature }] : []; });
}
