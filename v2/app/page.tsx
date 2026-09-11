import { cookies } from "next/headers";
import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { Photo } from "@/components/photo";
import { PhotoGallery } from "@/components/photo-viewer";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildHomeView } from "@/lib/home-view";
import { LAST_SHOWN_DAY_COOKIE, latestStory, pickRecentStory, recentStoryDays, RECENT_WINDOW_DAYS } from "@/lib/home-recent-pick";
import { RememberShownDay } from "@/components/remember-shown-day";
import { renderOnDemand } from "@/lib/render-on-demand";
import { resurface } from "@/lib/resurface";
import type { EditorialMemory as EditorialMemoryType, MediaRef } from "@/lib/memory-chapters";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).

// The front page answers one question — 最近怎么样，张年 — with one story from the last thirty
// days, drawn fresh on each visit (lib/home-recent-pick.ts). Before 2026-09-10 it answered with the
// newest story the archive had, which is a pure function of the archive and so never changed: the
// page had shown 8 月 28 日 for as long as that was the newest. An ordinary Tuesday now has the
// same claim on the front page as the most recent one.
//
// Everything else on the page still comes from lib/home-view.ts. Nothing counts at the reader and
// nothing asks them to upload.
export default async function HomePage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts.
  await renderOnDemand();
  const archive = await loadFamilyArchiveOnDemand();
  const { mark, thisMonth, summary, changeLabel, changeHref, monthHref } = buildHomeView(archive);
  // 最近的一段生活 — one of the last thirty days, drawn fresh on every request
  // (lib/home-recent-pick.ts). The archive read above is memoised for 300s; this draw is not, and
  // must not be: it is computed per request from that one cached read, so a refresh costs a new
  // random number rather than a new pass over the store. The route has no Next cache of its own
  // (lib/render-on-demand.ts), so nothing downstream can freeze one day in front of the family.
  const recentDays = recentStoryDays(archive.chapters, archive.time.today, RECENT_WINDOW_DAYS);
  const lastShownDay = (await cookies()).get(LAST_SHOWN_DAY_COOKIE)?.value;
  const pick = pickRecentStory(recentDays, Math.random, lastShownDay);
  const fallback = pick ? undefined : latestStory(archive.chapters);
  // The rest of the day the cover was drawn from. A day is what the family actually lived; showing
  // one of its stories and leaving the others behind a month link made the front page thinner than
  // the archive already is. Titles only, so the cover stays the thing being read.
  const sameDayOthers = pick ? (recentDays.find((day) => day.day === pick.day)?.memories ?? []).filter((memory) => memory.id !== pick.memory.id) : [];
  // Don't show "本月入口" when it repeats the month the cover story already sent them to.
  const showThisMonth = thisMonth && pick?.month.month !== thisMonth.month;
  // 忽然想起 (原则六). One relation, one story, drawn from published stories only — and absent from
  // the page entirely when the calendar has nothing真实 to say (lib/resurface.ts).
  const remembered = resurface(archive.chapters, archive.time.today, new Set([pick?.memory.id, fallback?.memory.id].filter((id): id is string => Boolean(id))));
  // B-14: 3 recent published memories with a lead photograph, excluding the cover.
  //
  // 2026-09-11: the extra `media-quark-sha-` test that used to sit here was both redundant and
  // wrong. Redundant, because `memory.lead` is already the association gate (lib/media/
  // story-binding.ts) — a lead exists only for a picture with a recorded reason to belong to those
  // words. Wrong, because it then threw away exactly the WeChat photographs that had earned their
  // place, on the strength of an id prefix that says where a file came from and not who is in it.
  const coverPhotoId = pick?.memory.lead?.id;
  const recentCluster: { memory: EditorialMemoryType; photo: MediaRef }[] = [];
  outer: for (const year of archive.chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        if (!memory.lead) continue;
        if (memory.lead.id === coverPhotoId) continue;
        recentCluster.push({ memory, photo: memory.lead });
        if (recentCluster.length >= 3) break outer;
      }
    }
  }

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{pick ? `${pick.month.label} · 最近` : mark}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {pick ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">最近的一段生活</h2>
      {/* No photo slot is reserved. EditorialMemory draws its picture only when the story has one
          it can stand behind (lib/media/story-binding.ts); with none, this is a dated title and a
          paragraph, which is a complete thing to look at rather than a gap where a photo failed. */}
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
      <p className="chapter-meta"><Link className="text-link" href={`/memory/${pick.day.slice(0, 4)}/${pick.day.slice(5, 7)}`}>翻看这个月</Link></p>
      <RememberShownDay day={pick.day} />
    </section> : null}

    {!pick && fallback ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">还没有最近的记录</h2>
      <p className="serif archive-empty">最近三十天还没有整理出来的记忆。</p>
      <EditorialMemory memory={fallback.memory} size="lead" />
      <p className="chapter-meta"><Link className="text-link" href="/memory">往回翻翻</Link></p>
    </section> : null}

    {!pick && !fallback ? <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section> : null}

    {/* 最近的新变化：直接复用 monthly_snapshot.summary，有就显示，没有就整块消失 */}
    {summary && changeLabel && changeHref ? <section className="home-change reading-wrap" aria-labelledby="change-title">
      <h2 id="change-title" className="section-mark">最近的新变化</h2>
      <SnapshotSummary text={summary} className="home-change-note serif" icons />
      <p className="chapter-meta"><Link className="text-link" href={changeHref}>{changeLabel}</Link></p>
    </section> : null}

    {/* 忽然想起 (原则六, 2026-09-11). Renders only when lib/resurface.ts found a relation the
        calendar really holds — a story from exactly a year ago today, or from that month a year
        ago, named as the month it is. No hit, no section: there is no placeholder here, no
        「暂无」, and no random old picture standing in for a relation. */}
    {remembered ? <section className="home-resurface reading-wrap" aria-labelledby="resurface-title">
      <h2 id="resurface-title" className="section-mark">忽然想起</h2>
      <p className="resurface-relation serif">{remembered.relation}</p>
      <EditorialMemory memory={remembered.memory} />
    </section> : null}

    {/* B-14: 最近的一组 — 1 large + 2 small trusted photos, no text, no count */}
    {recentCluster.length >= 2 ? <section className="home-cluster reading-wrap" aria-label="最近的照片">
      <div className="home-cluster-grid">
        <Link href={`/events/${recentCluster[0].memory.id}`} className="cluster-item cluster-large">
          <Photo media={recentCluster[0].photo} variant="thumbnail" fit="crop" sizes="(max-width: 720px) 65vw, 480px" />
        </Link>
        <div className="cluster-stack">
          {recentCluster.slice(1).map(({ memory, photo }) => (
            <Link key={memory.id} href={`/events/${memory.id}`} className="cluster-item">
              <Photo media={photo} variant="thumbnail" fit="crop" sizes="(max-width: 720px) 30vw, 220px" />
            </Link>
          ))}
        </div>
      </div>
    </section> : null}

    {/* 本月入口：整块可点的圆角卡片 */}
    {showThisMonth ? <section className="home-month reading-wrap">
      <Link className="home-month-card" href={monthHref} aria-label={`翻看${thisMonth.label}`}>
        <span className="month-card-badge">
          <span>{thisMonth.label}</span>
          {thisMonth.ageLabel ? <span>{` · 当时 ${thisMonth.ageLabel}`}</span> : null}
        </span>
        <p className="month-card-cta">翻看这个月 →</p>
      </Link>
    </section> : null}
  </div>;
}
