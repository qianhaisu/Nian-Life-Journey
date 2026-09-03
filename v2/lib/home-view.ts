// What the front page says, decided in one place so it can be tested against fixtures on both
// backends. The page only lays this out. Every "最近" here is earned from lib/time-truth.ts; when
// the newest memory worth the cover is older than the archive's recent life, the cover keeps the
// memory but drops the claim.
import type { FamilyArchive } from "@/lib/family-archive";
import { latestGrowthNote, type GrowthNote } from "@/lib/growth-notes";
import { THUMBNAIL_MIN_SIDE } from "@/lib/media/hero";
import type { MonthChapter, PhotoDay, YearChapter } from "@/lib/memory-chapters";
import { formatMonth } from "@/lib/time-signature";
import { isRecent, monthsBetween, selectHomeLead, type HomeLead, type RecencyReference } from "@/lib/time-truth";

// The archive's answer to "最近怎么样" when no organized memory is recent but life demonstrably
// is: the newest photographed days, straight from the month's own photography. This is the normal
// state of the archive between organizer runs — in production, 108 deliverable pictures of August
// 2026 existed against zero published August memories, and the cover's only honest choices were a
// thirteen-month-old story or these days.
export type RecentLife = {
  month: MonthChapter;
  // Newest photographed days, each with a few pictures in the order the day happened.
  days: PhotoDay[];
  // Photographed days of the month beyond the ones shown.
  moreDayCount: number;
  monthHref: string;
};

export const RECENT_LIFE_DAYS = 3;
export const RECENT_LIFE_PHOTOS_PER_DAY = 4;

// The newest photographed days, if they are recent by the same contract every "最近" obeys
// (lib/time-truth.ts). Walks months newest-first so an empty current month (2 September with no
// September photos yet) still answers with late August. Sticker-sized images never make the cover.
export function selectRecentLife(chapters: YearChapter[], reference: RecencyReference): RecentLife | undefined {
  for (const year of chapters) for (const month of year.months) {
    if (month.photoDays.length === 0) continue;
    if (!isRecent(month.photoDays[0].day, reference)) return undefined;
    const days = month.photoDays
      .map((day) => ({ ...day, photos: day.photos.filter((photo) => Math.min(photo.width, photo.height) >= THUMBNAIL_MIN_SIDE) }))
      .filter((day) => day.photos.length > 0)
      .slice(0, RECENT_LIFE_DAYS)
      // photoDays already order each day takenAt-ascending (groupPhotoDays); just take the first few.
      .map((day) => ({ ...day, photos: day.photos.slice(0, RECENT_LIFE_PHOTOS_PER_DAY) }));
    if (days.length === 0) return undefined;
    return { month, days, moreDayCount: Math.max(0, month.photoDays.length - days.length), monthHref: `/memory/${month.month.slice(0, 4)}/${month.month.slice(5, 7)}` };
  }
  return undefined;
}

export type HomeView = {
  lead?: HomeLead;
  // Present when recent photographed life should carry the cover: the newest days are recent and
  // no published memory is. The stale memory then moves below as "上一段记下来的生活" and the
  // apology note disappears — the newer life is on the page instead of being apologised for.
  recentLife?: RecentLife;
  // The masthead line above "最近怎么样，张年。"
  mark: string;
  leadHeading: string;
  // Present only when a stale lead is shown while newer life exists: says, from data, where the
  // newer life is (the month it last reached the archive) without inventing a story for it.
  laterLifeNote?: string;
  change?: GrowthNote;
  // The latest month with anything in it — by life time, not the calendar month, so an empty
  // September on 2 September still shows August rather than an empty page.
  thisMonth?: MonthChapter;
  summary?: string;
  monthHref: string;
};

export const RECENT_MARK = "最近";
export const RECENT_LEAD_HEADING = "最近的一段生活";
export const DATED_LEAD_HEADING = "上一段记下来的生活";

export function buildHomeView({ chapters, store, birthDay, snapshot, time }: FamilyArchive): HomeView {
  const lead = selectHomeLead(chapters, time);
  // Life carries the cover only when no memory can: a recent memory always wins (a story beats a
  // contact sheet), and absent recent photography the page keeps its dated-memory shape.
  const recentLife = lead?.recent ? undefined : selectRecentLife(chapters, time);
  const mark = recentLife
    ? `${recentLife.month.label} · ${RECENT_MARK}`
    : lead ? (lead.recent ? `${lead.month.label} · ${RECENT_MARK}` : `${lead.month.label} · 当时 ${lead.memory.signature.ageLabel ?? lead.month.ageLabel ?? ""}`.trimEnd()) : RECENT_MARK;
  const leadHeading = lead?.recent === false ? DATED_LEAD_HEADING : RECENT_LEAD_HEADING;
  // The apology for unorganized newer life is only written when that life is not already on the
  // page as the cover.
  const laterLifeNote = !recentLife && lead && !lead.recent && time.activityDay && monthsBetween(lead.memory.signature.day, time.activityDay) > 0
    ? `${formatMonth(time.activityDay.slice(0, 7))}还有新的生活留在档案里，只是还没有整理成一段记忆。`
    : undefined;
  const change = latestGrowthNote(store.growthRecords, birthDay, time);
  const thisMonth = chapters[0]?.months[0];
  // A month summary is quoted only for the month it was written about and only when memories stand
  // behind it (lib/family-archive.ts) — a snapshot is a chapter summary, never the newest story.
  const summary = thisMonth && snapshot?.month === thisMonth.month ? snapshot.summary : undefined;
  const monthHref = thisMonth ? `/memory/${thisMonth.month.slice(0, 4)}/${thisMonth.month.slice(5, 7)}` : "/memory";
  return { lead, recentLife, mark, leadHeading, laterLifeNote, change, thisMonth, summary, monthHref };
}
