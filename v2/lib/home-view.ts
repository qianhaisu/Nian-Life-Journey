// What the front page says, decided in one place so it can be tested against fixtures on both
// backends. The page only lays this out. Every "最近" here is earned from lib/time-truth.ts; when
// the newest memory worth the cover is older than the archive's recent life, the cover keeps the
// memory but drops the claim.
//
// The cover is ONE expression, the strongest the archive can honestly make right now:
//   1. a recent published memory — a story always beats everything;
//   2. a recent text-led moment — real published words about a recent day;
//   3. a recent strong photo moment — ONE day, one visual center, a few supporting frames;
//   4. the newest dated memory, presented as what it is (quiet fallback);
//   5. nothing pretending otherwise.
// Never again "no recent memory → three days × four photos": a contact sheet is not a cover.
import type { FamilyArchive } from "@/lib/family-archive";
import { latestGrowthNote, type GrowthNote } from "@/lib/growth-notes";
import type { MediaRef, MonthChapter, YearChapter } from "@/lib/memory-chapters";
import { buildMonthComposition, type MediaPrivilege, type PublicationMoment } from "@/lib/publication-moments";
import { formatMonth } from "@/lib/time-signature";
import { isRecent, monthsBetween, selectHomeLead, type HomeLead, type RecencyReference } from "@/lib/time-truth";

export type MomentCover = {
  moment: PublicationMoment;
  month: MonthChapter;
  monthHref: string;
  // Photographed days of the month besides the one on the cover.
  moreDayCount: number;
};

export type HomeCover =
  | { kind: "memory"; lead: HomeLead }
  | { kind: "moment"; cover: MomentCover }
  | { kind: "dated"; lead: HomeLead }
  | { kind: "empty" };

// The strongest recent moment the newest month can offer, under the same recency contract as every
// other "最近". Text with a picture beats text beats a strong photo day; among equals the newest
// day wins. A moment with neither hero nor supporting pictures nor text cannot carry a cover.
export function selectRecentMoment(chapters: YearChapter[], privilege: MediaPrivilege, reference: RecencyReference): MomentCover | undefined {
  for (const year of chapters) for (const month of year.months) {
    if (month.photoDays.length === 0 && month.traceDays.length === 0) continue;
    // Months are newest-first; once a month's newest day is no longer recent, none below it is.
    const newestDay = [month.photoDays[0]?.day, month.traceDays[0]?.day].filter(Boolean).sort().at(-1);
    if (!isRecent(newestDay, reference)) return undefined;
    const composition = buildMonthComposition(month, privilege);
    // A text moment can carry the cover on its words alone; a photo moment must have a real
    // visual center — a vouched hero — or the cover falls back to the dated memory instead of a
    // strip of small uncertain pictures.
    const candidates = [...composition.chapter.filter((moment) => moment.kind === "text_led"), ...composition.chronicle]
      .filter((moment) => isRecent(moment.day, reference))
      .filter((moment) => (moment.kind === "text_led" ? moment.text.length > 0 : Boolean(moment.hero)));
    if (candidates.length === 0) continue;
    const rank = (moment: PublicationMoment) =>
      (moment.kind === "text_led" ? 2 : 0) + (moment.hero ? 1 : 0);
    const best = [...candidates].sort((a, b) => rank(b) - rank(a) || b.day.localeCompare(a.day))[0];
    return {
      moment: best,
      month,
      monthHref: `/memory/${month.month.slice(0, 4)}/${month.month.slice(5, 7)}`,
      moreDayCount: Math.max(0, month.photoDays.length - 1),
    };
  }
  return undefined;
}

export type HomeView = {
  cover: HomeCover;
  // Under a moment cover, the newest real story keeps its place on the page — dated, not buried.
  pastLead?: HomeLead;
  // The masthead line above "最近怎么样，张年。"
  mark: string;
  // Present only when a stale lead is the cover while newer life exists: says, from data, where
  // the newer life is without inventing a story for it.
  laterLifeNote?: string;
  change?: GrowthNote;
  // The latest month with anything in it — by life time, not the calendar month.
  thisMonth?: MonthChapter;
  // The month block's pictures: the composition's vouched preview, never a raw slice.
  thisMonthPreview: MediaRef[];
  summary?: string;
  monthHref: string;
};

export const RECENT_MARK = "最近";
export const RECENT_LEAD_HEADING = "最近的一段生活";
export const DATED_LEAD_HEADING = "上一段记下来的生活";

export function buildHomeView({ chapters, store, birthDay, snapshot, privilege, time }: FamilyArchive): HomeView {
  const lead = selectHomeLead(chapters, time);
  const recentMoment = lead?.recent ? undefined : selectRecentMoment(chapters, privilege, time);
  const cover: HomeCover = lead?.recent
    ? { kind: "memory", lead }
    : recentMoment
      ? { kind: "moment", cover: recentMoment }
      : lead
        ? { kind: "dated", lead }
        : { kind: "empty" };
  const pastLead = cover.kind === "moment" && lead ? lead : undefined;
  const mark = cover.kind === "moment"
    ? `${cover.cover.month.label} · ${RECENT_MARK}`
    : lead ? (lead.recent ? `${lead.month.label} · ${RECENT_MARK}` : `${lead.month.label} · 当时 ${lead.memory.signature.ageLabel ?? lead.month.ageLabel ?? ""}`.trimEnd()) : RECENT_MARK;
  // The apology for unorganized newer life is only written when that life is not already on the
  // page as the cover.
  const laterLifeNote = cover.kind === "dated" && lead && time.activityDay && monthsBetween(lead.memory.signature.day, time.activityDay) > 0
    ? `${formatMonth(time.activityDay.slice(0, 7))}还有新的生活留在档案里，只是还没有整理成一段记忆。`
    : undefined;
  const change = latestGrowthNote(store.growthRecords, birthDay, time);
  const thisMonth = chapters[0]?.months[0];
  const thisMonthPreview = thisMonth ? buildMonthComposition(thisMonth, privilege).preview : [];
  // A month summary is quoted only for the month it was written about and only when memories stand
  // behind it (lib/family-archive.ts) — a snapshot is a chapter summary, never the newest story.
  const summary = thisMonth && snapshot?.month === thisMonth.month ? snapshot.summary : undefined;
  const monthHref = thisMonth ? `/memory/${thisMonth.month.slice(0, 4)}/${thisMonth.month.slice(5, 7)}` : "/memory";
  return { cover, pastLead, mark, laterLifeNote, change, thisMonth, thisMonthPreview, summary, monthHref };
}
