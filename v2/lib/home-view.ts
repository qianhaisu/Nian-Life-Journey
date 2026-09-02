// What the front page says, decided in one place so it can be tested against fixtures on both
// backends. The page only lays this out. Every "最近" here is earned from lib/time-truth.ts; when
// the newest memory worth the cover is older than the archive's recent life, the cover keeps the
// memory but drops the claim.
import type { FamilyArchive } from "@/lib/family-archive";
import { latestGrowthNote, type GrowthNote } from "@/lib/growth-notes";
import type { MonthChapter } from "@/lib/memory-chapters";
import { formatMonth } from "@/lib/time-signature";
import { monthsBetween, selectHomeLead, type HomeLead } from "@/lib/time-truth";

export type HomeView = {
  lead?: HomeLead;
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
  const mark = lead ? (lead.recent ? `${lead.month.label} · ${RECENT_MARK}` : `${lead.month.label} · 当时 ${lead.memory.signature.ageLabel ?? lead.month.ageLabel ?? ""}`.trimEnd()) : RECENT_MARK;
  const leadHeading = lead?.recent === false ? DATED_LEAD_HEADING : RECENT_LEAD_HEADING;
  const laterLifeNote = lead && !lead.recent && time.activityDay && monthsBetween(lead.memory.signature.day, time.activityDay) > 0
    ? `${formatMonth(time.activityDay.slice(0, 7))}还有新的生活留在档案里，只是还没有整理成一段记忆。`
    : undefined;
  const change = latestGrowthNote(store.growthRecords, birthDay, time);
  const thisMonth = chapters[0]?.months[0];
  // A month summary is quoted only for the month it was written about and only when memories stand
  // behind it (lib/family-archive.ts) — a snapshot is a chapter summary, never the newest story.
  const summary = thisMonth && snapshot?.month === thisMonth.month ? snapshot.summary : undefined;
  const monthHref = thisMonth ? `/memory/${thisMonth.month.slice(0, 4)}/${thisMonth.month.slice(5, 7)}` : "/memory";
  return { lead, mark, leadHeading, laterLifeNote, change, thisMonth, summary, monthHref };
}
