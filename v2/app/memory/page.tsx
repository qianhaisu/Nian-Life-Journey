import type { Metadata } from "next";
import { MonthCard } from "@/components/month-card";
import { loadFamilyArchive } from "@/lib/family-archive";
import { buildMemoryIndex } from "@/lib/memory-index";

export const revalidate = 300;
export const metadata: Metadata = { title: "记忆" };

// The archive read as a publication directory: year pill nav → month cards in a two-column grid.
// Each month is one card: cropped cover photo + month label + age + first snapshot sentence.
// No counts. Months without a cover photo still get a card (text-only). Newest year first.
export default async function MemoryPage() {
  const { chapters, privilege, snapshots } = await loadFamilyArchive();
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
        <span className="section-mark">记忆</span>
        <h1 className="serif">往回翻翻，<br /><em>张年。</em></h1>
        <p>那些已经过去、但还想再看一次的日子。</p>
      </header>

      {index.years.length === 0 ? (
        <section className="reading-wrap archive-empty">
          <p className="serif">档案还是空的。等时间再走一会儿。</p>
        </section>
      ) : (
        <>
          <nav className="memory-year-nav reading-wrap" aria-label="按年份导航">
            {index.years.map((y) => (
              <a
                key={y.year}
                href={`#year-${y.year}`}
                className={`year-pill${y.year === newestYear ? " year-pill--active" : ""}`}
              >
                {y.year}
              </a>
            ))}
          </nav>

          {index.years.map((year) => (
            <section key={year.year} id={`year-${year.year}`} className="memory-year-section">
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
