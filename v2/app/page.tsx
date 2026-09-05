import Link from "next/link";
import { EditorialMemory } from "@/components/editorial-memory";
import { Photo } from "@/components/photo";
import { PhotoGallery } from "@/components/photo-viewer";
import { SnapshotSummary } from "@/components/snapshot-summary";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildHomeView } from "@/lib/home-view";
import { isPortraitOfZhangnian } from "@/lib/media/representative";
import type { EditorialMemory as EditorialMemoryType, MediaRef } from "@/lib/memory-chapters";

export const dynamic = "force-dynamic";

// The front page answers one question — 最近怎么样，张年 — with ONE expression, the strongest the
// archive can honestly make (lib/home-view.ts): a recent memory, a recent moment with real words,
// one recent photographed day with a visual center, or the newest dated memory presented as what
// it is. Nothing rotates, nothing counts at the reader, nothing asks them to upload.
export default async function HomePage() {
  const archive = await loadFamilyArchive();
  const { cover, mark, laterLifeNote, thisMonth, summary, changeLabel, changeHref, monthHref } = buildHomeView(archive);
  const alternates = cover.kind === "memory" ? cover.lead.month.memories.filter((memory) => memory.id !== cover.lead.memory.id).slice(0, 2) : [];
  // Don't show "本月入口" when it repeats the cover's own month.
  const coverMonth = cover.kind === "moment" ? cover.cover.month.month : undefined;
  const showThisMonth = thisMonth && coverMonth !== thisMonth.month;
  // B-14: 3 recent published memories with Quark-backed (trusted) lead photos, excluding cover.
  const coverPhotoId = cover.kind === "memory" ? cover.lead.memory.lead?.id :
    cover.kind === "moment" ? cover.cover.moment.hero?.id : undefined;
  const recentCluster: { memory: EditorialMemoryType; photo: MediaRef }[] = [];
  outer: for (const year of archive.chapters) {
    for (const month of year.months) {
      for (const memory of month.memories) {
        if (!memory.lead) continue;
        if (!isPortraitOfZhangnian(memory.lead)) continue;
        if (memory.lead.id === coverPhotoId) continue;
        recentCluster.push({ memory, photo: memory.lead });
        if (recentCluster.length >= 3) break outer;
      }
    }
  }

  // B-15: Only quark family-album photos go in any cover slot — wechat-media is evidence, not portrait.
  const momentHeroPhotos = cover.kind === "moment" ? [
    ...(cover.cover.moment.hero && isPortraitOfZhangnian(cover.cover.moment.hero) ? [cover.cover.moment.hero] : []),
    ...cover.cover.moment.supporting.filter(isPortraitOfZhangnian),
  ] : [];

  return <div className="home-page">
    <header className="home-masthead reading-wrap reveal">
      <span className="section-mark">{mark}</span>
      <h1 className="serif"><span className="home-title-line">最近怎么样，</span><span className="home-title-line"><em>张年。</em></span></h1>
    </header>

    {cover.kind === "moment" ? <section className="home-lead home-moment" aria-labelledby="moment-title">
      <h2 id="moment-title" className="section-mark reading-wrap">{cover.cover.moment.kind === "photo_led" ? "最近的一天" : "最近记下来的一天"}</h2>
      <div className="moment-layout photo-wrap">
        {momentHeroPhotos.length > 0 ? (
          <div className="moment-photo-col">
            <PhotoGallery
              photos={momentHeroPhotos}
              heroIndex={0}
              heroClassName="moment-hero"
              dateLabel={cover.cover.moment.dateLabel}
              ageLabel={cover.cover.moment.ageLabel}
              priority
            />
          </div>
        ) : null}
        <div className="moment-text-col">
          {/* memory_led carries its own TimeSignature/title inside EditorialMemory — text_led/photo_led
              show a date-badge here instead, matching MonthMoment's split (components/month-moment.tsx). */}
          {cover.cover.moment.kind === "memory_led" && cover.cover.moment.memory
            ? <EditorialMemory memory={cover.cover.moment.memory} size="lead" priority />
            : <span className="date-badge"><time dateTime={cover.cover.moment.day}>{cover.cover.moment.dateLabel}</time>{cover.cover.moment.ageLabel ? <span>{` · ${cover.cover.moment.ageLabel}`}</span> : null}</span>}
          {cover.cover.moment.text.length > 0 ? <div className="moment-text serif">{cover.cover.moment.text.map((entry, index) => <p key={index}>{entry}</p>)}</div> : null}
          {/* T20-A4: "还有 28 天" counted photographed days, not days with anything to read — a
              count-of-days sentence is exactly the 计数式描述 原则三 rules out. */}
          <p className="chapter-meta"><Link className="text-link" href={cover.cover.monthHref}>翻看整个月</Link></p>
        </div>
      </div>
    </section> : null}

    {cover.kind === "memory" || cover.kind === "dated" ? <section className="home-lead reading-wrap" aria-labelledby="lead-title">
      <h2 id="lead-title" className="section-mark">{cover.kind === "memory" ? "最近的一段生活" : "上一段记下来的生活"}</h2>
      <EditorialMemory memory={cover.lead.memory} size="lead" priority />
      {alternates.length > 0 ? <ul className="memory-lines home-alternates">{alternates.map((memory) => <EditorialMemory memory={memory} size="line" key={memory.id} />)}</ul> : null}
      {laterLifeNote ? <p className="chapter-meta">{laterLifeNote}</p> : null}
    </section> : null}

    {cover.kind === "empty" ? <section className="home-lead reading-wrap"><p className="serif archive-empty">{archive.chapters.length > 0 ? "还没有一段整理好的记忆可以放在这里。" : "档案还是空的。等时间再走一会儿。"}</p></section> : null}

    {/* 最近的新变化：直接复用 monthly_snapshot.summary，有就显示，没有就整块消失 */}
    {summary && changeLabel && changeHref ? <section className="home-change reading-wrap" aria-labelledby="change-title">
      <h2 id="change-title" className="section-mark">最近的新变化</h2>
      <SnapshotSummary text={summary} className="home-change-note serif" icons />
      <p className="chapter-meta"><Link className="text-link" href={changeHref}>{changeLabel}</Link></p>
    </section> : null}

    {/* B-14: 最近的一组 — 1 large + 2 small trusted photos, no text, no count */}
    {recentCluster.length >= 2 ? <section className="home-cluster reading-wrap" aria-label="最近的照片">
      <div className="home-cluster-grid">
        <Link href={`/events/${recentCluster[0].memory.id}`} className="cluster-item cluster-large">
          <Photo media={recentCluster[0].photo} sizes="(max-width: 720px) 65vw, 480px" />
        </Link>
        <div className="cluster-stack">
          {recentCluster.slice(1).map(({ memory, photo }) => (
            <Link key={memory.id} href={`/events/${memory.id}`} className="cluster-item">
              <Photo media={photo} sizes="(max-width: 720px) 30vw, 220px" />
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
