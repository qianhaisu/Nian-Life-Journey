import type { Metadata } from "next";
import { MonthCard } from "@/components/month-card";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildMemoryIndex } from "@/lib/memory-index";
import { renderOnDemand } from "@/lib/render-on-demand";
import { loadMonthContent } from "@/lib/month-content";
import { pinnedCoverAllowed } from "@/lib/publication-moments";
import { YearNavHighlight } from "@/components/year-nav-highlight";

// No `export const revalidate` here on purpose: this page is rendered on demand
// (lib/render-on-demand.ts), so there is no Next route cache for a revalidate window to
// govern — leaving the export would state a caching promise the route no longer makes. The
// same 300s lives one layer down, on the archive read itself
// (ON_DEMAND_ARCHIVE_TTL_MS in lib/family-archive.ts).
export const metadata: Metadata = { title: "记忆" };

// The archive read as a publication directory: year pill nav → month cards in a two-column grid.
// Each month is one card: cropped cover photo + month label + age + first snapshot sentence.
// No counts. Months without a cover photo still get a card (text-only). Newest year first.
export default async function MemoryPage() {
  // Never prerender this page from the build's mock store — see lib/render-on-demand.ts.
  await renderOnDemand();
  const { chapters, media, privilege, snapshots, birthDay } = await loadFamilyArchiveOnDemand();
  const birthYear = birthDay ? Number(birthDay.slice(0, 4)) : 2025;
  const index = buildMemoryIndex(chapters, undefined, privilege);

  // First readable line from each month's snapshot summary.
  const snapshotBlurb = new Map<string, string>();
  for (const s of snapshots) {
    if (!s.summary?.trim()) continue;
    const firstLine = s.summary.split("\n")
      .map((l) => l.replace(/^-\s*/, "").trim())
      .find((l) => l.length > 0);
    if (firstLine) snapshotBlurb.set(s.month, firstLine);
  }

  // An edited month puts its own sentence and its own chosen face on the card. Both still pass the
  // gates the card already applied: the cover must be one of the pictures `preview` holds (i.e.
  // subject-checked and deliverable), and an unknown id simply leaves the card as it was.
  const editedCards = new Map<string, {
    line?: string; cover?: (typeof media)[number]; coverFocal?: { mobilePercent: number; desktopPercent: number }; coverFrame?: "square" | "full";
  }>();
  const mediaById = new Map(media.map((item) => [item.id, item]));
  for (const year of index.years) {
    for (const month of year.months) {
      const content = await loadMonthContent(month.chapter.month);
      if (!content) continue;
      // The chosen cover has to clear the same bar `preview` is built behind, stated once in
      // pinnedCoverAllowed rather than borrowed: deliverable and family-visible (it is in `media` at
      // all), somebody opened the file and recorded what is in it (`checked`), no later review took it
      // back (`excluded`), and it was taken in this month (`mediaById` spans the whole archive, so the
      // month match is checked here, not assumed). A cover that fails is dropped and the card keeps
      // its own. Pre-birth months are no exception: their pregnancy review writes the same `checked`.
      const candidate = content.coverMediaId ? mediaById.get(content.coverMediaId) : undefined;
      const allowed = candidate && pinnedCoverAllowed(candidate, privilege, month.chapter.month);
      // The focal point belongs to the chosen photograph: it travels with the cover and is dropped with it.
      editedCards.set(month.chapter.month, {
        line: content.cardLine,
        cover: allowed ? candidate : undefined,
        coverFocal: allowed ? content.coverFocal : undefined,
        coverFrame: allowed ? content.coverFrame : undefined,
      });
    }
  }

  const newestYear = index.years[0]?.year;
  const firstPrebirthYear = index.years.find((year) => Number(year.year) < birthYear)?.year;
  const firstPostbirthYear = index.years.find((year) => Number(year.year) >= birthYear)?.year;
  const birthDateLabel = birthDay
    ? `${Number(birthDay.slice(0, 4))} 年 ${Number(birthDay.slice(5, 7))} 月 ${Number(birthDay.slice(8, 10))} 日`
    : undefined;

  return (
    <div className="memory-page">
      <header className="page-masthead reading-wrap">
        {/* 2026-09-16 视觉验收：标题上方原本还有一行「记忆」——顶栏已经写着「记忆」，
            标题自己也说了「往回翻翻」，这行只是重复一次结构名。 */}
        <h1 className="serif">往回翻翻，<br /><em>张年。</em></h1>
        <p>那些已经过去、但还想再看一次的日子。</p>
      </header>

      {index.years.length === 0 ? (
        <section className="reading-wrap archive-empty">
          <p className="serif">档案还是空的。等时间再走一会儿。</p>
        </section>
      ) : (
        <>
          {/* The newest year is only the opening state: YearNavHighlight moves the mark to
              whichever year is actually being read. */}
          <nav className="memory-year-nav reading-wrap" aria-label="按年份导航">
            {[{ label: "出生后", prebirth: false }, { label: "出生前", prebirth: true }]
              .filter((group) => index.years.some((y) => (Number(y.year) < birthYear) === group.prebirth))
              .map((group) => (
              <div className="memory-year-nav-group" key={group.label}>
                <span className="memory-year-nav-label">{group.label}</span>
                <div className="memory-year-nav-links">
            {index.years.filter((y) => (Number(y.year) < birthYear) === group.prebirth).map((y) => {
              const isPrebirth = Number(y.year) < birthYear;
              return (
                <a
                  key={y.year}
                  href={`#year-${y.year}`}
                  className={[
                    "year-pill",
                    isPrebirth ? "year-pill--prebirth" : "",
                    y.year === newestYear ? "year-pill--active" : "",
                  ].filter(Boolean).join(" ")}
                  aria-current={y.year === newestYear ? "true" : undefined}
                >
                  {y.year}
                </a>
              );
            })}
                </div>
              </div>
            ))}
          </nav>
          <YearNavHighlight />

          {index.years.map((year) => {
            const isPrebirth = Number(year.year) < birthYear;
            return (
            <section key={year.year} id={`year-${year.year}`} className={`memory-year-section${isPrebirth ? " memory-year-section--prebirth" : ""}`} aria-labelledby={`year-heading-${year.year}`}>
              {year.year === firstPostbirthYear && (
                <header className="memory-life-chapter reading-wrap">
                  <p className="memory-life-label">出生后</p>
                  <p className="serif memory-life-title">一起长大的日子</p>
                </header>
              )}
              {year.year === firstPrebirthYear && (
                <header className="memory-birth-boundary reading-wrap">
                  <p className="memory-birth-milestone">
                    {birthDateLabel && <time dateTime={birthDay}>{birthDateLabel} · </time>}张年出生
                  </p>
                  <p className="memory-birth-note">出生月里，也留着见面前的最后几天。</p>
                  <div className="memory-prenatal-chapter">
                    <p className="memory-life-label">出生前</p>
                    <p className="serif memory-life-title">等待你的日子</p>
                  </div>
                </header>
              )}
              {/* 2026-09-16 视觉验收：这个 section 原来只有 id、没有可见标题。两年的卡片在同一条
                  瀑布流里，滚过 2026 年 1 月就静默进入 2025 年，读的人不知道自己换了年份——
                  上面那排年份按钮又长得像筛选器（其实是锚点），会让人以为筛选失效了。 */}
              <h2 className="section-mark memory-year-heading" id={`year-heading-${year.year}`}>
                {year.year} 年
              </h2>
              <div className="memory-month-grid reading-wrap">
                {year.months.map((month) => (
                  <MonthCard
                    key={month.chapter.month}
                    entry={month}
                    blurb={editedCards.get(month.chapter.month)?.line ?? snapshotBlurb.get(month.chapter.month)}
                    cover={editedCards.get(month.chapter.month)?.cover}
                    coverFocal={editedCards.get(month.chapter.month)?.coverFocal}
                    coverFrame={editedCards.get(month.chapter.month)?.coverFrame}
                  />
                ))}
              </div>
            </section>
            );
          })}
        </>
      )}
    </div>
  );
}
