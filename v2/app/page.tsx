import { cookies } from "next/headers";
import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { HomeCluster } from "@/components/home-cluster";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { UpcomingTasks } from "@/components/upcoming-tasks";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildHomeView, monthHrefOf, DATED_LEAD_HEADING, OVERVIEW_FACT_LIMIT, RECENT_LEAD_HEADING } from "@/lib/home-view";
import { LAST_SHOWN_DAY_COOKIE, latestStory, pickRecentStory, recentStoryDays, RECENT_WINDOW_DAYS } from "@/lib/home-recent-pick";
import { RememberShownDay } from "@/components/remember-shown-day";
import { renderOnDemand } from "@/lib/render-on-demand";
import { echoGroupsFrom, resurface } from "@/lib/resurface";
import { readHomeUpcoming, readHomeUpcomingSources } from "@/lib/upcoming";
import { ageOn, formatDay, formatMonth } from "@/lib/time-signature";
import type { EditorialMemory as EditorialMemoryType, MediaRef } from "@/lib/memory-chapters";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).

// The front page answers one question — 最近怎么样，张年 — and 2026-09-12 rebuilt the ORDER in which
// it answers: a greeting with his age today, then how he has been lately, then what is coming up,
// then one story read in full, then a real relation the calendar holds, and every way into the
// archive collected at the foot. The same order on a phone and on a desktop screen.
//
// What that replaced, and why (the three faults Teddy named):
//
// 1. THE PAGE'S OWN CLOCK FOLLOWED A DICE ROLL. The masthead printed the month of the story that
//    had just been drawn from the last thirty days (lib/home-recent-pick.ts), so on 2026-09-12 it
//    said 「2026 年 8 月 · 最近」 — and would have said 9 月 on the next refresh, for a page whose
//    today had not moved. Now it prints the archive's one real today (archive.time.today,
//    lib/time-truth.ts) and his age on that day; the drawn story carries its own date and age
//    underneath, where a date belongs to the thing it dates.
//
// 2. THREE BLOCKS, THREE DIFFERENT MONTHS. The drawn story, the summary and the month card each
//    chose a month independently, and the summary's fallback let AUGUST sit on top of a September
//    that has published stories and photographs of its own. The overview is now one object about
//    ONE month that always states the period it covers (lib/home-view.ts), and a month's snapshot
//    is quoted only for its own month — August's lines appear under 「2026 年 8 月回顾」 or not at
//    all. Where September has no snapshot yet, its own published stories are listed as dated
//    one-liners: approved text already readable elsewhere on the site, nothing generated here and
//    no claim about what changed.
//
// 3. THE KEY SUMMARY WAS THE SMALLEST TEXT ON A DESKTOP SCREEN. A 1200px grid moved it into a
//    320px rail, so the desktop reading order was not the phone's and the one block that answers
//    「他最近怎么样」 was set as a sidebar note. That grid is gone from globals.css; the page is one
//    column at every width.
//
// Nothing here counts at the reader and nothing asks them to upload (原则三, 原则四).
export default async function HomePage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts.
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  const { thisMonth, overview, priorReview, monthHref } = buildHomeView(archive);
  // The page's own clock: the family's calendar today and how old he is today — not the date of
  // whatever was drawn below (lib/time-truth.ts productToday).
  const today = archive.time.today;
  const ageToday = ageOn(archive.birthDay, today);
  // 最近的一段生活 — one of the last thirty days, drawn fresh on every request
  // (lib/home-recent-pick.ts). The archive read above is memoised for 300s; this draw is not, and
  // must not be: it is computed per request from that one cached read, so a refresh costs a new
  // random number rather than a new pass over the store. The route has no Next cache of its own
  // (lib/render-on-demand.ts), so nothing downstream can freeze one day in front of the family.
  const recentDays = recentStoryDays(archive.chapters, today, RECENT_WINDOW_DAYS);
  const lastShownDay = (await cookies()).get(LAST_SHOWN_DAY_COOKIE)?.value;
  const pick = pickRecentStory(recentDays, Math.random, lastShownDay);
  const fallback = pick ? undefined : latestStory(archive.chapters);
  const reading = pick ?? fallback;
  // The rest of the day the cover was drawn from. A day is what the family actually lived; showing
  // one of its stories and leaving the others behind a month link made the front page thinner than
  // the archive already is. Titles only, so the cover stays the thing being read.
  const sameDayOthers = pick ? (recentDays.find((day) => day.day === pick.day)?.memories ?? []).filter((memory) => memory.id !== pick.memory.id) : [];
  // 近况概览's lines. The story being read in full below is dropped from them: it is the same
  // title, and a family reading it twice on one screen reads two occasions rather than one. The
  // period in `spanLabel` is computed from the month's whole set upstream, so it does not move when
  // one line is dropped from the display.
  const shownIds = new Set([pick?.memory.id, fallback?.memory.id, ...sameDayOthers.map((memory) => memory.id)].filter((id): id is string => Boolean(id)));
  const overviewFacts = (overview?.facts ?? []).filter((fact) => !shownIds.has(fact.id)).slice(0, OVERVIEW_FACT_LIMIT);
  const hasOverview = Boolean(overview && (overview.summary || overviewFacts.length > 0));
  // 近期待办 (2026-09-13). readHomeUpcoming reads through the store's family gate
  // (lib/db/upcoming-store.ts readUpcomingFeedForFamily: approved rows only, and an unreviewed
  // queue is never reported as an empty week) and then applies the page's own: a strikethrough
  // needs evidence, and 「没有待办」 needs a run that covered its whole window. Everything else draws
  // nothing. That is the real state today — 18 rows are approved and readable, and 4 unreviewed
  // rows never reach this page.
  //
  // On adding a database read to a render path (CLAUDE.md): this reads three new, family-scale
  // tables (upcoming_extraction_runs, upcoming_items filtered by profile and review decision, and
  // the change rows for those items) — no raw_sources, no unbounded scan of a large table, and the
  // data track sized it for exactly this caller. It is NOT inside the memoised archive read, so it
  // costs three small queries per view of this page, and a second set of three only when there is
  // no approved row to show. With a missing table it costs one failed query and is caught
  // (42P01 → not_extracted), never an error page.
  const upcoming = await readHomeUpcoming();
  // 来源摘要 — 谁提的、后来怎么样了 (2026-09-13, migration 0015). The DEFAULT family read, with no
  // `curated` argument: the approved sentences live on `upcoming_items.provenance` and this page
  // neither supplies nor restates them. Read only when there is something to attach them to.
  //
  // Same CLAUDE.md question, same answer: two more small queries against the same two family-scale
  // tables (22 `upcoming_items` rows for this profile and their change rows, plus the one jsonb
  // column) — no raw_sources, no unbounded scan, and both are joined in memory by `itemId`. A read
  // that throws is caught one layer down and becomes `unreadable`, which the block states as
  // itself rather than as 「待审核」 or 「没有来源」.
  const upcomingSources = upcoming.status === "ready" ? await readHomeUpcomingSources() : undefined;
  // 忽然想起 (原则六). One relation, one story, drawn from published stories only — and absent from
  // the page entirely when the calendar holds no relation worth stating (lib/resurface.ts).
  const remembered = resurface(
    archive.chapters,
    today,
    shownIds,
    echoGroupsFrom(archive.store.qualityReviews ?? []),
  );
  // B-14: 3 recent published memories with a lead photograph, excluding the cover.
  //
  // 2026-09-11: the extra `media-quark-sha-` test that used to sit here was both redundant and
  // wrong. Redundant, because `memory.lead` is already the association gate (lib/media/
  // story-binding.ts) — a lead exists only for a picture with a recorded reason to belong to those
  // words. Wrong, because it then threw away exactly the WeChat photographs that had earned their
  // place, on the strength of an id prefix that says where a file came from and not who is in it.
  //
  // The strip also skips whatever 忽然想起 just showed. As more photographs earn a recorded reason
  // to belong to a story, the same picture would otherwise be drawn twice on one page — once as
  // something the archive remembered, once as a recent tile — and a picture shown twice reads as
  // two occasions rather than one.
  const rememberedPhotoIds = remembered ? (remembered.kind === "echo" ? remembered.stages.map((stage) => stage.lead?.id) : [remembered.memory.lead?.id]) : [];
  const alreadyShownPhotoIds = new Set([reading?.memory.lead?.id, ...rememberedPhotoIds].filter((id): id is string => Boolean(id)));
  const recentCluster: { memory: EditorialMemoryType; photo: MediaRef }[] = [];
  outer: for (const year of archive.chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        if (!memory.lead) continue;
        if (alreadyShownPhotoIds.has(memory.lead.id)) continue;
        recentCluster.push({ memory, photo: memory.lead });
        if (recentCluster.length >= 3) break outer;
      }
    }
  }
  // Every way into the archive, collected at the foot of the page instead of scattered through it —
  // and each one named for the month it actually opens. The old page had 「翻看这个月」 in two
  // places pointing at two different months, and a link that says 这个月 next to a story from
  // another month is a link that lies about where it goes. Deduplicated by href and ordered newest
  // month first; a month is listed only if it is in the archive.
  const entryMonths = [thisMonth?.month, overview?.month, priorReview?.month, reading?.day.slice(0, 7)]
    .filter((month): month is string => Boolean(month));
  const monthEntries = [...new Set(entryMonths)]
    .sort((a, b) => b.localeCompare(a))
    .map((month) => ({ month, href: monthHrefOf(month), label: `翻看 ${formatMonth(month)}` }));

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark"><time dateTime={today}>{formatDay(today)}</time></span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
      {/* 原则二's second clock for the one date that is not in the past: he is this old today. */}
      {ageToday ? <p className="home-age">现在 {ageToday}</p> : null}
    </header>

    {/* 近况概览 — read before any single day. The heading says 近况 only while the period it covers
        is recent under lib/time-truth.ts; when the newest readable month is older than that, the
        same lines are shown as what they are. Either way the period itself is on the page. */}
    {hasOverview && overview ? <section className="home-overview reading-wrap" aria-labelledby="overview-title">
      <h2 id="overview-title" className="section-mark">{overview.recent ? "近况" : "上一次记下来的"}</h2>
      <p className="home-overview-span">{overview.spanLabel}</p>
      {overview.summary
        ? <SnapshotSummary text={overview.summary} className="home-change-note serif" icons />
        : <ul className="home-facts">{overviewFacts.map((fact) => <li className="home-fact" key={fact.id}>
          <Link href={`/events/${fact.id}`}>
            {/* Date only: the age for this whole block is read once, in the span line above
                (T20-A1 — two clocks are read once per block, not once per line). */}
            <time dateTime={fact.day}>{fact.dateLabel}</time>
            <span className="serif home-fact-title">{fact.title}</span>
          </Link>
        </li>)}</ul>}
    </section> : null}

    {/* A month's snapshot under the name of its own month, never relabelled as this one. Shown only
        when the overview's month has no summary of its own (lib/home-view.ts). */}
    {priorReview ? <section className="home-prior-review reading-wrap" aria-labelledby="prior-title">
      {/* Inside its own tinted block: last month's summary is longer than a thin September's 近况,
          and without a boundary the two read as one list under two labels (原则五). */}
      <div>
        <h2 id="prior-title" className="section-mark">{priorReview.label}回顾</h2>
        <SnapshotSummary text={priorReview.summary} className="home-change-note serif" icons />
      </div>
    </section> : null}

    {/* 近期待办 — after 近况, before the day's story, in the one column every reader gets. */}
    <UpcomingTasks feed={upcoming} today={today} birthDay={archive.birthDay} sources={upcomingSources} />

    {pick ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{RECENT_LEAD_HEADING}</h2>
      {/* No photo slot is reserved. EditorialMemory draws its picture only when the story has one
          it can stand behind (lib/media/story-binding.ts); with none, this is a dated title and a
          paragraph, which is a complete thing to look at rather than a gap where a photo failed.
          Its own TimeSignature is what keeps this story's date its own: the page's clock is in the
          masthead and does not move with the draw. */}
      <EditorialMemory memory={pick.memory} size="lead" priority />
      {sameDayOthers.length > 0 ? <>
        <p className="section-mark home-same-day-mark">这一天还记下了</p>
        {/* Titles only, no date: the cover above just stated this day and its age once (原则二's
            two clocks are read once per day, not once per line — the same repeat T20-A1 removed
            from the month pages). */}
        <ul className="memory-lines home-same-day">{sameDayOthers.map((memory) => <li className="memory-line" key={memory.id}>
          <Link href={`/events/${memory.id}`}><span className="serif">{memory.title}</span></Link>
        </li>)}</ul>
      </> : null}
      <RememberShownDay day={pick.day} />
    </section> : null}

    {!pick && fallback ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{DATED_LEAD_HEADING}</h2>
      <EditorialMemory memory={fallback.memory} size="lead" />
    </section> : null}

    {!pick && !fallback && !hasOverview ? <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section> : null}

    {/* B-14: the recent photographs the archive can stand behind — no text, no count. How many
        there are, and how they are set, is components/home-cluster.tsx; it draws one, two or three
        at their own proportions rather than forcing them into a fixed-height row. */}
    <HomeCluster items={recentCluster.map(({ memory, photo }) => ({ id: memory.id, photo }))} />

    {/* 忽然想起 (原则六, 2026-09-11). Renders only when lib/resurface.ts found a relation the
        calendar really holds — a story from exactly a year ago today, or from that month a year
        ago, named as the month it is. No hit, no section: there is no placeholder here, no
        「暂无」, and no random old picture standing in for a relation.

        It sits BELOW 最近的一组 and not above it. Set above, the photo strip landed directly under
        this story's last line with nothing between them, and a pair of pictures under a story reads
        as that story's pictures — which they are not: they are recent photographs, and the story
        this module shows is a year old and usually has no picture of its own. That misreading is
        the exact one lib/media/story-binding.ts exists to stop, and layout can commit it just as
        easily as a data binding can. */}
    {remembered ? <section className="home-resurface reading-wrap" aria-labelledby="resurface-title">
      <h2 id="resurface-title" className="section-mark">忽然想起</h2>
      <p className="resurface-relation serif">{remembered.relation}</p>
      {/* A group is read as the change it is: its stages in the order they happened, each with both
          clocks, so the distance between them — ten months, or two years — is on the page as itself
          rather than as a sentence about it (原则二). A single-story relation keeps the ordinary
          chapter entry it always had. */}
      {remembered.kind === "echo"
        ? <ol className="echo-stages">{remembered.stages.map((stage) => <li key={stage.id}>
          <Link href={`/events/${stage.id}`}>
            <time dateTime={stage.signature.day}>{stage.signature.dateLabel}</time>
            {stage.signature.ageLabel ? <span className="echo-age">当时 {stage.signature.ageLabel}</span> : null}
            <span className="serif echo-title">{stage.title}</span>
          </Link>
        </li>)}</ol>
        : <EditorialMemory memory={remembered.memory} />}
    </section> : null}

    {/* 月份与全部记忆的入口，集中在这里收尾。The first month — the newest one the archive has — keeps
        the card it had; the others are plain links under it. Every label is built from the same
        month string as its own href, so a label cannot drift from where it goes. */}
    {monthEntries.length > 0 ? <nav className="home-entries reading-wrap" aria-label="进入档案">
      <Link className="home-month-card" href={monthEntries[0].href} aria-label={monthEntries[0].label}>
        <span className="month-card-badge">
          <span>{formatMonth(monthEntries[0].month)}</span>
          {thisMonth?.month === monthEntries[0].month && thisMonth.ageLabel ? <span>{` · 当时 ${thisMonth.ageLabel}`}</span> : null}
        </span>
        <p className="month-card-cta">{monthEntries[0].label} →</p>
      </Link>
      <ul className="home-entry-links">
        {monthEntries.slice(1).map((entry) => <li key={entry.href}><Link className="text-link" href={entry.href}>{entry.label}</Link></li>)}
        <li><Link className="text-link" href="/memory">全部记忆</Link></li>
      </ul>
    </nav> : <nav className="home-entries reading-wrap" aria-label="进入档案">
      <ul className="home-entry-links"><li><Link className="text-link" href={monthHref}>全部记忆</Link></li></ul>
    </nav>}
  </div>;
}
