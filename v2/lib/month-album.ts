import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { findMonth, type PhotoDay } from "@/lib/memory-chapters";
import { buildMonthComposition, dayAlbumFrom, type MonthComposition } from "@/lib/publication-moments";

// The month's album, read exactly as the month page composes it. Moved here unchanged from the
// former server actions (app/memory/[year]/[month]/actions.ts) when the album became a GET route —
// see lib/month-album-request.ts for why.
//
// Until 2026-09-13 the expander rebuilt the month from getMonthArchive(), a read scoped to one month
// that carries story bindings but NOT the subject checks. Composing without them is not a smaller
// version of the page — it is a different page: the day groups come out empty, so a subject-checked
// photograph the page reads under 「这一天的照片」 came back a second time when the album was
// expanded, and a checked picture that is not source-trusted was missing from the album altogether.
// Answering 「这一天的相册」 from that read would have repeated the same disagreement one tap away.
//
// So both reads compose from the same archive read the on-demand pages share
// (loadFamilyArchiveOnDemand: one getFamilyArchiveInput, 23.6 MB measured 2026-09-13, memoised for
// 300s and dropped by every refresh notice). A click therefore costs nothing when /, /memory or
// another album click has read the archive in the last five minutes, and at most one family read
// when nobody has — the same read a month page's own ISR re-render already pays. Never getStore().
async function monthComposition(year: string, month: string): Promise<MonthComposition | undefined> {
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(month)) return undefined;
  const { chapters, privilege, traceEvents, birthDay } = await loadFamilyArchiveOnDemand();
  const chapter = findMonth(chapters, `${year}-${month}`);
  return chapter ? buildMonthComposition(chapter, privilege, traceEvents, birthDay) : undefined;
}

// Every archive day (all photos) of the month, letting the expander filter to the hidden subset.
export async function monthArchiveDays(year: string, month: string): Promise<PhotoDay[]> {
  return (await monthComposition(year, month))?.archiveDays ?? [];
}

// The album's photographs for exactly one day of this month, or undefined.
export async function monthDayAlbum(year: string, month: string, day: string): Promise<PhotoDay | undefined> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day.slice(0, 7) !== `${year}-${month}`) return undefined;
  const composition = await monthComposition(year, month);
  return composition ? dayAlbumFrom(composition, day) : undefined;
}
