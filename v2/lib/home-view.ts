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
import { formatDay, formatMonth } from "@/lib/time-signature";
import { isRecent, monthsBetween, RECENT_ACTIVITY_MONTH_GAP, selectHomeLead, type HomeLead, type RecencyReference } from "@/lib/time-truth";

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
// other "最近". A published memory beats a text day beats a strong photo day; among equals the
// newest day wins. A moment with neither hero nor supporting pictures nor text/memory cannot carry
// a cover.
//
// T18, 2026-09-04: memory_led moments used to be excluded here on the assumption that any real
// memory would already be caught by selectHomeLead — true only for chapter/highlight/memory
// weight. T7's everyday output is deliberately weight "trace" (so it never outranks a curated
// highlight there), but that meant a real, recently-published life_event fell into a gap neither
// function claimed: not a "lead" (wrong weight), not a "moment" (kind excluded here) — so the
// front page picked an untethered photo-only day instead of the child's newest actual words.
export function selectRecentMoment(chapters: YearChapter[], privilege: MediaPrivilege, reference: RecencyReference): MomentCover | undefined {
  for (const year of chapters) for (const month of year.months) {
    if (month.photoDays.length === 0 && month.traceDays.length === 0 && month.memories.length === 0) continue;
    // Months are newest-first; once a month's newest day is no longer recent, none below it is.
    const newestDay = [month.photoDays[0]?.day, month.traceDays[0]?.day, month.memories[0]?.signature.day].filter(Boolean).sort().at(-1);
    if (!isRecent(newestDay, reference)) return undefined;
    const composition = buildMonthComposition(month, privilege);
    const candidates = [...composition.chapter.filter((moment) => moment.kind === "text_led" || moment.kind === "memory_led"), ...composition.chronicle]
      .filter((moment) => isRecent(moment.day, reference))
      .filter((moment) => moment.kind === "memory_led" ? Boolean(moment.memory) : moment.kind === "text_led" ? moment.text.length > 0 : Boolean(moment.hero));
    if (candidates.length === 0) continue;
    const rank = (moment: PublicationMoment) =>
      (moment.kind === "memory_led" ? 3 : moment.kind === "text_led" ? 2 : 0) + (moment.hero ? 1 : 0);
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

// 近况概览 (2026-09-12). What the page says about how he is lately, ABOVE any single story.
//
// Until tonight the front page had no such thing. It opened with one story drawn from the last
// thirty days and put the month's overview below it — on a desktop screen, in a 320px rail beside
// it — so the first thing a family read was one ordinary Tuesday, and the summary of how the month
// actually went was the smallest text on the page. Worse, the three blocks each chose their own
// month independently: the drawn story's month became the masthead's date, the overview fell back
// to whichever month had a snapshot, and the month card pointed at the newest month. On 2026-09-12 that
// printed 「2026 年 8 月 · 最近」 over an 8 月 18 日 story with 「最近的新变化 · 2026 年 8 月」 under
// it, and September — which has three published stories and photographs — appeared only as a link
// at the very bottom. August was sitting on top of September.
//
// So the overview is one object, decided here, about ONE month, and it always states which period
// it covers. A month's own approved snapshot is quoted when it has one. When it does not, the
// month's published stories are listed as dated one-liners — approved text that is already
// readable elsewhere on the site, nothing generated here, and no claim about what changed.
// No age on a fact line on purpose: 原则二's two clocks are read once per block — the block's
// period line carries the age — and T20-A1 removed exactly this repeat from the month pages.
export type OverviewFact = { id: string; day: string; dateLabel: string; title: string };

export type HomeOverview = {
  month: string;
  monthLabel: string;
  monthHref: string;
  // This month's own snapshot, never another month's. `facts` is what stands in when it is absent.
  summary?: string;
  // The month's published stories, newest first. The page drops the one it is about to read in
  // full below and shows the rest, so no title is printed twice on one page.
  facts: OverviewFact[];
  // The period the lines above really come from: the month itself for a snapshot, and the first
  // and last day material exists for otherwise. Both clocks (原则二).
  spanLabel: string;
  // Whether that period may be called 近况 at all, under the same recency contract as every other
  // "最近" on the site (lib/time-truth.ts). False when the newest readable month is old enough that
  // the page has to say so instead — the overview is still shown, dated, never as news.
  recent: boolean;
};

// The month before the overview's, read as what it is — 「8 月回顾」 — and only when the overview's
// own month has no summary of its own. It is never relabelled as the current month: a snapshot is
// written about one month and says so.
export type PriorReview = { month: string; label: string; href: string; summary: string };

// How many dated one-liners the overview prints when a month has no snapshot. Four is what fits
// above the fold on a 390px phone beside the greeting; the month entry at the foot of the page
// carries the rest.
export const OVERVIEW_FACT_LIMIT = 4;

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
  // The month label and href for the snapshot quoted above — may differ from thisMonth when the
  // current month has no snapshot and we fall back to the latest available one. `summary` +
  // `changeLabel` + `changeHref` are the tested primitive (test/time-truth.test.mjs Case 6);
  // `overview` and `priorReview` below are composed from the same choice and are what the page
  // renders.
  changeLabel?: string;
  changeHref?: string;
  // 近况概览: one month, stated period. See HomeOverview.
  overview?: HomeOverview;
  priorReview?: PriorReview;
  monthHref: string;
};

export const RECENT_MARK = "最近";
export const RECENT_LEAD_HEADING = "最近的一段生活";
export const DATED_LEAD_HEADING = "上一段记下来的生活";

export function buildHomeView({ chapters, store, birthDay, snapshots, privilege, time }: FamilyArchive): HomeView {
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
  const months = chapters.flatMap((year) => year.months);
  const snapshotOf = (month: string) => snapshots.find((item) => item.month === month);
  const thisMonth = months[0];
  const thisMonthPreview = thisMonth ? buildMonthComposition(thisMonth, privilege).preview : [];
  // A month summary is quoted only for the month it was written about and only when memories stand
  // behind it (lib/family-archive.ts) — a snapshot is a chapter summary, never the newest story.
  // Snapshot for "最近的新变化": prefer thisMonth's snapshot, fall back to the latest available.
  let summary: string | undefined;
  let changeLabel: string | undefined;
  let changeHref: string | undefined;
  if (thisMonth) {
    const thisMonthSnapshot = snapshotOf(thisMonth.month);
    if (thisMonthSnapshot) {
      summary = thisMonthSnapshot.summary;
      changeLabel = thisMonth.label;
      changeHref = `/memory/${thisMonth.month.slice(0, 4)}/${thisMonth.month.slice(5, 7)}`;
    } else {
      // Current month has no snapshot (too few approved events) — show the latest month that does,
      // but only if it is still recent by the same policy as everywhere else on the page
      // (RECENT_ACTIVITY_MONTH_GAP). Without this bound, a single old seed snapshot sitting alone
      // in an otherwise-empty store would resurface as "最近的新变化" no matter how long ago it was
      // written — a full year, in the case this guards (time-truth.test.mjs Case 6).
      const latest = [...snapshots]
        .filter((item) => monthsBetween(item.month, thisMonth.month) <= RECENT_ACTIVITY_MONTH_GAP)
        .sort((a, b) => b.month.localeCompare(a.month))[0];
      if (latest) {
        summary = latest.summary;
        const fallbackChapter = chapters.flatMap((y) => y.months).find((m) => m.month === latest.month);
        changeLabel = fallbackChapter?.label ?? formatMonth(latest.month);
        changeHref = `/memory/${latest.month.slice(0, 4)}/${latest.month.slice(5, 7)}`;
      }
    }
  }
  const monthHref = thisMonth ? monthHrefOf(thisMonth.month) : "/memory";
  // 近况概览's own month. `thisMonth` is the newest month with ANYTHING in it — one photograph is
  // enough to give a month a chapter and a URL (lib/memory-chapters.ts) — and a month holding only
  // pictures has no lines for an overview to print. Walking on to the newest month that does have
  // lines is what keeps an empty heading, or a 「暂无」, off the front page; the month it lands on is
  // named in `spanLabel` either way, so stepping back can never read as a claim about this month.
  const overviewMonth = months.find((month) => Boolean(snapshotOf(month.month)?.summary?.trim()) || month.memories.length > 0);
  const overview = overviewMonth ? buildOverview(overviewMonth, snapshotOf(overviewMonth.month)?.summary?.trim(), time) : undefined;
  // The month before it, read as its own review — only when the overview's month has no summary of
  // its own, and only one month back (RECENT_ACTIVITY_MONTH_GAP, the same bound the legacy fallback
  // above uses). 「8 月回顾」 over August's snapshot is true; the same lines under a September
  // heading would not be.
  const priorSnapshot = overview && !overview.summary
    ? [...snapshots]
        .filter((item) => Boolean(item.summary?.trim()) && item.month < overview.month && monthsBetween(item.month, overview.month) <= RECENT_ACTIVITY_MONTH_GAP)
        .sort((a, b) => b.month.localeCompare(a.month))[0]
    : undefined;
  const priorReview: PriorReview | undefined = priorSnapshot
    ? { month: priorSnapshot.month, label: months.find((item) => item.month === priorSnapshot.month)?.label ?? formatMonth(priorSnapshot.month), href: monthHrefOf(priorSnapshot.month), summary: priorSnapshot.summary }
    : undefined;
  return { cover, pastLead, mark, laterLifeNote, change, thisMonth, thisMonthPreview, summary, changeLabel, changeHref, overview, priorReview, monthHref };
}

// 「2026 年 9 月 1 日 — 3 日」 rather than the same year and month printed twice. Both ends stay
// absolute dates; only the parts the first end already stated are dropped from the second.
function daySpan(from: string, to: string): string {
  const sameMonth = from.slice(0, 7) === to.slice(0, 7);
  if (sameMonth) return `${formatDay(from)} — ${Number(to.slice(8, 10))} 日`;
  const sameYear = from.slice(0, 4) === to.slice(0, 4);
  if (sameYear) return `${formatDay(from)} — ${Number(to.slice(5, 7))} 月 ${Number(to.slice(8, 10))} 日`;
  return `${formatDay(from)} — ${formatDay(to)}`;
}

export function monthHrefOf(month: string): string {
  return `/memory/${month.slice(0, 4)}/${month.slice(5, 7)}`;
}

// The overview for one month: its own summary when it has one, otherwise its published stories as
// dated one-liners, plus the period those lines actually cover.
function buildOverview(month: MonthChapter, summary: string | undefined, reference: RecencyReference): HomeOverview {
  const age = month.ageLabel ? ` · 当时 ${month.ageLabel}` : "";
  const days = month.memories.map((memory) => memory.signature.day).sort();
  const first = days[0];
  const last = days[days.length - 1];
  // A snapshot is written about a whole month, so the month is the period it covers. Stories cover
  // the days they happened on and nothing wider: 「9 月 1 日 — 9 月 3 日」 is the honest answer for a
  // September that is twelve days old and has three published days in it.
  const spanLabel = summary || !first
    ? `${month.label}${age}`
    : first === last ? `${formatDay(first)}${age}` : `${daySpan(first, last)}${age}`;
  // Recency is judged on the newest thing the month holds, however it arrived, not on the month
  // number: a September that has not been organised yet is not "最近" just because it is September.
  const newestDay = [month.memories[0]?.signature.day, month.photoDays[0]?.day, month.traceDays[0]?.day].filter(Boolean).sort().at(-1);
  return {
    month: month.month,
    monthLabel: month.label,
    monthHref: monthHrefOf(month.month),
    summary,
    facts: month.memories.map((memory) => ({ id: memory.id, day: memory.signature.day, dateLabel: memory.signature.dateLabel, title: memory.title })),
    spanLabel,
    recent: isRecent(newestDay, reference),
  };
}
