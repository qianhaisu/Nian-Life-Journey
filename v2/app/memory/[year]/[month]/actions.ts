"use server";

import { mediaPrivilegeOf } from "@/lib/family-archive";
import { getMonthArchive } from "@/lib/db/repository";
import { deliverableMediaIds } from "@/lib/media/deliverability";
import { buildChapters, findMonth, type PhotoDay } from "@/lib/memory-chapters";
import { buildMonthComposition } from "@/lib/publication-moments";

// Called by ArchiveExpander when the user expands the full archive for a month. Returns every
// archive day (all photos), letting the client filter to the hidden subset.
//
// P1-5: reads only this one month (lib/db/repository getMonthArchive), not loadFamilyArchive's
// whole-history getStore() — the archive expander fires on every click, so its read has to be
// proportional to one month, not to the whole profile's history (getOrganizerStore's doc comment
// in repository-interface.ts measured getStore() at real data volume: ~10 minutes / ~5 minutes
// observed here after the P1-5 column-pruning fix on top of it, still far past any click budget).
export async function getFullArchiveDays(year: string, month: string): Promise<PhotoDay[]> {
  const monthKey = `${year}-${month}`;
  const { birthDay, events, dailyTraces, media, mediaAssets, mediaLocations, rawSources } = await getMonthArchive(monthKey);
  const familyMedia = media.filter((item) => item.visibility !== "private");
  const deliverable = deliverableMediaIds({ media: familyMedia, mediaAssets, mediaLocations });
  const chapters = buildChapters({ events, traces: dailyTraces, media: familyMedia, deliverable, birthDay });
  const chapter = findMonth(chapters, monthKey);
  if (!chapter) return [];
  const privilege = mediaPrivilegeOf(events, familyMedia, rawSources);
  const composition = buildMonthComposition(chapter, privilege);
  return composition.archiveDays;
}
