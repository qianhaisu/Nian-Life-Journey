import type { Metadata } from "next";
import { MonthCard } from "@/components/month-card";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildMemoryIndex } from "@/lib/memory-index";
import { renderOnDemand } from "@/lib/render-on-demand";
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
  const { chapters, privilege, snapshots } = await loadFamilyArchiveOnDemand();
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

  const newestYear = index.years[0]?.year;

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
            {index.years.map((y) => (
              <a
                key={y.year}
                href={`#year-${y.year}`}
                className={`year-pill${y.year === newestYear ? " year-pill--active" : ""}`}
                aria-current={y.year === newestYear ? "true" : undefined}
              >
                {y.year}
              </a>
            ))}
          </nav>
          <YearNavHighlight />

          {index.years.map((year) => (
            <section key={year.year} id={`year-${year.year}`} className="memory-year-section" aria-labelledby={`year-heading-${year.year}`}>
              {/* 2026-09-16 视觉验收：这个 section 原来只有 id、没有可见标题。两年的卡片在同一条
                  瀑布流里，滚过 2026 年 1 月就静默进入 2025 年，读的人不知道自己换了年份——
                  上面那排年份按钮又长得像筛选器（其实是锚点），会让人以为筛选失效了。 */}
              <h2 className="section-mark memory-year-heading" id={`year-heading-${year.year}`}>{year.year} 年</h2>
              <div className="memory-month-grid reading-wrap">
                {year.months.map((month) => (
                  <MonthCard
                    key={month.chapter.month}
                    entry={month}
                    blurb={snapshotBlurb.get(month.chapter.month)}
                  />
                ))}
              </div>
            </section>
          ))}
        </>
      )}
    </div>
  );
}
