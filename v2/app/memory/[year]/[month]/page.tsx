import { Fragment } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArchiveExpander } from "@/components/archive-expander";
import { DayAlbumLink } from "@/components/day-album";
import { DayPhotos } from "@/components/day-photos";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { DayHead, MonthMoment } from "@/components/month-moment";
import { MonthlyFocusGoals } from "@/components/monthly-focus-goals";
import { MonthDayEntry } from "@/components/month-day-entry";
import { groupIntoWeeks, pickLeadDays, pickLeadPhoto } from "@/lib/month-day-weight";
import { loadMonthContent, resolveMonthContentMedia } from "@/lib/month-content";
import { loadFamilyArchiveForIsr } from "@/lib/family-archive";
import { listArchiveMonths } from "@/lib/db/repository";
import { buildTimeArchiveEnumerationAllowed } from "@/lib/db/config";
import { findMonth } from "@/lib/memory-chapters";
import { buildMonthComposition, chronicleAlbumDays, dayAlbumDays } from "@/lib/publication-moments";
import { focusGoalsForSnapshot } from "@/lib/monthly-focus";
import { formatMonth, monthAgeLine } from "@/lib/time-signature";
import { productToday } from "@/lib/time-truth";

export const revalidate = 300;

// Same reasoning as [year]/page.tsx's generateStaticParams: without params known at build time
// this segment renders fully dynamic on every request. A month absent here still works via
// on-demand ISR — new months don't need to be pre-listed.
//
// 2026-09-10 incident: this used to call listArchiveMonths() unconditionally. The Docker builder
// stage never has DATABASE_URL (by design — see v2/Dockerfile), so resolveRepositoryBackend()
// silently resolved to "json" during that build and listArchiveMonths() enumerated whichever
// months exist in the local mock fixture (lib/mock-data.ts happens to seed 2026-07 and 2026-08).
// Those two months got frozen into the image as static HTML built from mock content and served in
// place of the real archive until each page's own 300s ISR window elapsed on a live request — a
// production diagnostic container served fabricated August entries for roughly five minutes after
// every fresh deploy. buildTimeArchiveEnumerationAllowed() (lib/db/config.ts) keeps this list empty
// unless the build was actually given REPOSITORY_BACKEND=postgres — an empty list here still works,
// on-demand ISR renders every month correctly against the real database at runtime.
export async function generateStaticParams() {
  if (!buildTimeArchiveEnumerationAllowed()) return [];
  const months = await listArchiveMonths();
  return months.map((month) => ({ year: month.slice(0, 4), month: month.slice(5, 7) }));
}

export async function generateMetadata({ params }: { params: Promise<{ year: string; month: string }> }): Promise<Metadata> {
  const { year, month } = await params;
  return { title: formatMonth(`${year}-${month}`) };
}

// The month chapter — the primary reading unit inside 记忆. It reads like a month, start to end,
// in three layers: the CHAPTER (what is worth reading: memories and days with real words), the
// CHRONICLE (the feel of the month's photographed time, weighted, not a wall), and the ARCHIVE
// (every deliverable photograph, folded shut until asked). Composition is lib/publication-moments.ts;
// this page only lays it out.
export default async function MonthPage({ params }: { params: Promise<{ year: string; month: string }> }) {
  const { year, month: monthSegment } = await params;
  if (!/^\d{4}$/.test(year) || !/^\d{2}$/.test(monthSegment)) notFound();
  const month = `${year}-${monthSegment}`;
  const { chapters, store, media, eventIdentities, snapshots, privilege, traceEvents, birthDay } = await loadFamilyArchiveForIsr();
  const chapter = findMonth(chapters, month);
  if (!chapter) notFound();

  const ageLine = monthAgeLine(month, productToday(), chapter.ageLabel);
  const composition = buildMonthComposition(chapter, privilege, traceEvents, birthDay);
  const content = await loadMonthContent(month);
  const summary = snapshots.find((item) => item.month === month);
  const focusGoals = summary ? focusGoalsForSnapshot(store.monthlyFocusGoals, month) : [];
  const yearChapter = chapters.find((item) => item.year === year);
  const siblings = yearChapter?.months.filter((item) => item.month !== month) ?? [];
  const archivePhotoCount = composition.archiveDays.reduce((sum, day) => sum + day.photos.length, 0);
  const dayGroups = new Map(composition.dayPhotoGroups.map((day) => [day.day, day]));
  const albumDays = dayAlbumDays(composition);
  const chronicleAlbum = chronicleAlbumDays(composition);
  // The section is named for what is actually in it. A month with a playable clip says so; a month
  // without one is not promised a video it does not have.
  const albumHasVideo = composition.archiveDays.some((day) => day.photos.some((item) => item.type === "video"));
  const albumLabel = albumHasVideo ? "这个月的照片与视频" : "这个月的照片";
  // Emptiness is about the whole month, not one section: a month whose photographs all sit in day
  // groups has plenty to read even when 「这个月的照片」 is empty.
  const empty = composition.chapter.length === 0 && composition.chronicle.length === 0 && composition.quietDays.length === 0 && composition.totalPhotoCount === 0;

  // An edited month reads as one column of days and nothing else: no story/chronicle split, no
  // month-wide album, no per-day album link. Everything that month has to show is in the timeline,
  // once. Months without edited content fall through to the original layout below, unchanged.
  if (content) {
    const available = new Map(media.map((item) => [item.id, item]));
    const eventIds = new Set(eventIdentities.map((item) => item.id));
    const entries = content.days
      .slice()
      .sort((a, b) => a.day.localeCompare(b.day))
      .map((entry) => {
        // The curated order is a proposal; these two gates decide. `available` is already
        // deliverable and family-visible, `privilege.excluded` is the latest store_only.
        const photos = resolveMonthContentMedia(entry.expandedMediaIds, available, privilege.excluded);
        const firstScreen = resolveMonthContentMedia(entry.firstScreenMediaIds, available, privilege.excluded);
        const eventId = (entry as { eventId?: string | null }).eventId ?? null;
        return {
          ...entry,
          photos,
          firstScreenCount: firstScreen.length,
          // Every edited day now has an address. A day that kept a single original event keeps
          // that URL (so an existing link stays the canonical one); a merged day and a day the
          // Organizer never wrote an event for both point at the day's own page. Nothing points
          // at a page that does not exist, and no day is left without a way in.
          eventHref: eventId && eventIds.has(eventId)
            ? `/events/${eventId}`
            : `/memory/${year}/${monthSegment}/${entry.day.slice(8, 10)}`,
        };
      })
      .filter((entry) => entry.title || entry.paragraphs.length > 0 || entry.photos.length > 0);

    // 原则五：哪几天领头、按周分块（lib/month-day-weight.ts）。领头靠的是「家人写了多少、拍了多少」这个
    // 代理信号，不是真正的重要性——内容文件里没有里程碑标记；某一天手写 emphasis 就压过它。
    const leadDays = pickLeadDays(entries.map((entry) => ({
      day: entry.day,
      paragraphs: entry.paragraphs,
      photoCount: entry.photos.length,
      storyBound: (entry.storyBoundMediaIds?.length ?? 0) > 0,
      emphasis: entry.emphasis,
      leadable: Boolean(pickLeadPhoto(entry.photos)),
    })));
    const weeks = groupIntoWeeks(entries);

    return <div className="month-page reading-wrap">
      <header className="chapter-masthead">
        <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
        <h1 className="serif">{chapter.label}</h1>
        {ageLine ? <p className="chapter-age">{ageLine}</p> : null}
        {content.intro ? <p className="chapter-summary serif">{content.intro}</p> : null}
      </header>

      {/* 一个月有二十多天、手机上是二十多屏，读到一半不知道自己在哪、也没法跳。这里给一排「跳到某一段」——
          只有真的分成了两块以上才出现，不为一个只有几天的月份摆一个没用的控件。 */}
      {weeks.length > 1 ? <nav className="month-jump" aria-label="跳到这个月的某一段">
        {weeks.map((week) => <a key={week.id} href={`#${week.id}`}>{week.label}</a>)}
      </nav> : null}

      <section className="month-days month-days--edited" aria-labelledby="days-title">
        <h2 id="days-title" className="section-mark">这个月的日子</h2>
        {weeks.map((week) => <div className="month-week" id={week.id} key={week.id}>
          {weeks.length > 1 ? <p className="week-mark">{week.label}</p> : null}
          <ol>
            {week.entries.map((entry) => <li className="month-day" key={entry.day}>
              <MonthDayEntry
                day={entry.day}
                dateLabel={`${Number(entry.day.slice(5, 7))} 月 ${Number(entry.day.slice(8, 10))} 日`}
                ageLabel={entry.ageLabel}
                monthAgeLabel={chapter.ageLabel}
                year={year}
                title={entry.title}
                paragraphs={entry.paragraphs}
                photos={entry.photos}
                firstScreenCount={entry.firstScreenCount}
                eventHref={entry.eventHref}
                lead={leadDays.has(entry.day)}
              />
            </li>)}
          </ol>
        </div>)}
      </section>

      {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
      {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`} prefetch={false}>{item.shortLabel}</Link>)}</p></footer> : null}
    </div>;
  }

  return <div className="month-page reading-wrap">
    <header className="chapter-masthead">
      <Link className="back-link" href={`/memory/${year}`}>← {year} 年</Link>
      {/* 「月份章节」同上：结构名，不是家人的话，而且下一行就是「2026 年 9 月」。 */}
      <h1 className="serif">{chapter.label}</h1>
      {/* B1：当前月读「现在」，翻回去的历史月份读「当时」（monthAgeQualifier，lib/time-signature.ts）。 */}
      {ageLine ? <p className="chapter-age">{ageLine}</p> : null}
      {summary?.summary ? <SnapshotSummary text={summary.summary} className="chapter-summary serif" /> : null}
      {!summary && composition.narration ? <p className="chapter-narration serif">{composition.narration}</p> : null}
      {/* No standfirst any more: 「这个月记下 N 天。」 was a count standing in for the month (原则三,
          2026-09-13 acceptance). A month without a summary opens with its own first day. */}
      {/* A jump to 「这个月的照片」, which now holds the days that told no story of their own —
          the rest travel with their day, above. Kept at the top because those remaining days are
          still the longest thing on the page on a phone. */}
      {archivePhotoCount > 0 ? <p className="chapter-meta"><a className="text-link" href="#month-photos">{albumLabel} →</a></p> : null}
    </header>

    {composition.chapter.length > 0 ? <section className="month-reading" aria-labelledby="reading-title">
      <h2 id="reading-title" className="section-mark">这个月记下来的</h2>
      {/* A day's photographs follow the last of that day's stories, as 「这一天的照片」 — outside the
          story cards, under the day's own heading. The reader finishes 8/19's words and 8/19's
          pictures are right there, instead of at the far end of the month inside a folded section.
          The group belongs to the date, not to any story above it: composition puts every one of a
          chapter day's photographs here and none of them in 「这个月的照片」 (lib/publication-moments.ts),
          so nothing is shown twice and nothing is stranded. */}
      {composition.chapter.map((moment, index) => {
        const dayEnds = composition.chapter[index + 1]?.day !== moment.day;
        const group = dayEnds ? dayGroups.get(moment.day) : undefined;
        // Once per day, after the day's last story and its reviewed group: a way into the month's
        // album at this date — only when the album really has photographs of this exact day
        // (dayAlbumFrom). Never a neighbouring day's, and never presented as a story's picture.
        const albumEntry = dayEnds && albumDays.has(moment.day);
        return <Fragment key={`${moment.day}-${moment.kind}-${moment.memory?.id ?? ""}`}>
          <MonthMoment moment={moment} year={year} monthAgeLabel={chapter.ageLabel} priority={index === 0} continued={composition.chapter[index - 1]?.day === moment.day} />
          {group ? <DayPhotos photos={group.photos} dateLabel={group.dateLabel} ageLabel={group.ageLabel} /> : null}
          {albumEntry ? <DayAlbumLink year={year} month={monthSegment} day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} afterDayPhotos={Boolean(group)} /> : null}
        </Fragment>;
      })}
    </section> : null}

    {composition.chronicle.length > 0 ? <section className="month-days" aria-labelledby="days-title">
      <h2 id="days-title" className="section-mark">{composition.chapter.length > 0 ? "这个月的日子" : "这个月"}</h2>
      <ol>
        {/* A day here that carries words gets the same way into the album at its date as a story day
            (chronicleAlbumDays) — after its words, once, only when the album has that exact day. */}
        {composition.chronicle.map((moment, index) => <li className="month-day" key={moment.day}>
          <MonthMoment moment={moment} year={year} monthAgeLabel={chapter.ageLabel} priority={index === 0 && composition.chapter.length === 0} />
          {chronicleAlbum.has(moment.day) ? <DayAlbumLink year={year} month={monthSegment} day={moment.day} dateLabel={moment.dateLabel} ageLabel={moment.ageLabel} /> : null}
        </li>)}
      </ol>
    </section> : null}

    {/* Folded by default: this section is deliverable photos with no story of their own, not
        something every reader needs pushed open. Addressable by id so the top-of-page link
        (chapter-meta, above) can still send a reader here — the browser opens a <details> its
        target anchor lives inside even when it starts closed. */}
    {archivePhotoCount > 0 ? <details className="month-archive" id="month-photos">
      <summary><span className="serif">{albumLabel}</span></summary>
      {/* B-3: ArchiveExpander owns the whole list, not just the folded tail. The first screen's days
          are a SELECTION (recency, and days that already carry words), so appending the rest after
          them ran the album 12 日, 15 日, 18 日, 21 日, 2 日 — expanding has to merge into one
          chronological list, and only the component holding both sides can do that. */}
      <ArchiveExpander
        year={year}
        month={monthSegment}
        foldedDayCount={composition.archiveFoldedDayCount}
        foldedPhotoCount={composition.archiveFoldedPhotoCount}
        visibleDays={composition.archiveDaysVisible}
        monthAgeLabel={chapter.ageLabel}
      />
    </details> : null}

    {empty ? <p className="serif archive-empty">这个月的生活还在档案里，等整理好就能翻看。</p> : null}
    {summary && focusGoals.length > 0 ? <MonthlyFocusGoals goals={focusGoals} snapshotMonth={month} variant="review" /> : null}
    {/* No 「·」 between the months: the separator is the space around each link now (.other-years in
        globals.css), which is also what keeps a wrapped second row from beginning with a stranded
        one. */}
    {siblings.length > 0 ? <footer className="other-years"><span className="section-mark">{year} 年的其他月份</span><p className="serif">{siblings.map((item) => <Link key={item.month} href={`/memory/${year}/${item.month.slice(5, 7)}`} prefetch={false}>{item.shortLabel}</Link>)}</p></footer> : null}
  </div>;
}
