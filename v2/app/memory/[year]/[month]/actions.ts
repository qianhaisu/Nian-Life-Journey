"use server";

import { loadFamilyArchive } from "@/lib/family-archive";
import { findMonth, type PhotoDay } from "@/lib/memory-chapters";
import { buildMonthComposition } from "@/lib/publication-moments";

// Called by ArchiveExpander when the user expands the full archive for a month.
// Returns every archive day (all photos), letting the client filter to the hidden subset.
export async function getFullArchiveDays(year: string, month: string): Promise<PhotoDay[]> {
  const { chapters, privilege } = await loadFamilyArchive();
  const chapter = findMonth(chapters, `${year}-${month}`);
  if (!chapter) return [];
  const composition = buildMonthComposition(chapter, privilege);
  return composition.archiveDays;
}
