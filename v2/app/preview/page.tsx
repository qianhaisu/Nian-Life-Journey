import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { previewReadingEnabled } from "@/lib/preview-access";
import { monthlyReviewDraftsFrom, previewEventIdsFrom } from "@/lib/preview-reading";
import { renderOnDemand } from "@/lib/render-on-demand";

// The private reading entry. Deliberately not in the site navigation (components/site-header.tsx):
// a surface that can show unpublished drafts must not be one tap from the pages the family reads,
// and robots.ts already disallows the whole site. Reachable by typing the address, which is how the
// people who review this archive reach it.
export const metadata: Metadata = { title: "试读", robots: { index: false, follow: false } };

const YEARS = ["2026", "2025"] as const;

export default async function PreviewIndexPage() {
  // renderOnDemand() FIRST, then the gate. Reversing these two lines silently breaks the switch:
  // without connection() the build prerenders this route, the gate runs at build time where the
  // flag is unset, and Next freezes a 404 into static HTML that no runtime environment variable can
  // reopen. Caught in the build output — `/preview` turned from ƒ into ○ — not by any test.
  await renderOnDemand();
  // Closed unless this deployment opened it. 404, not a redirect or an explanation: a surface that
  // may hold unreviewed drafts should not announce that it exists. See lib/preview-access.ts.
  if (!previewReadingEnabled()) notFound();
  const archive = await loadFamilyArchiveOnDemand();
  const reviews = archive.store.qualityReviews ?? [];
  const previewIds = previewEventIdsFrom(reviews);
  const drafts = monthlyReviewDraftsFrom(reviews);

  return <div className="preview-page reading-wrap">
    <header className="chapter-masthead">
      <span className="section-mark">私下试读 · 未公开发布</span>
      <h1 className="serif">从头读一年</h1>
      <p className="chapter-standfirst serif">这里把一年从一月读到十二月。还没有发布的段落会标出来，家人的页面上看不到它们。</p>
    </header>
    <ul className="preview-years">
      {YEARS.map((year) => {
        const months = archive.chapters.find((item) => item.year === year)?.months ?? [];
        const review = [...drafts.keys()].some((month) => month.slice(0, 4) === year);
        return <li key={year}>
          <Link className="preview-year-link" href={`/preview/${year}`}>
            <span className="serif">{year} 年</span>
            {months.length > 1 ? <span className="chapter-meta">{months[months.length - 1].shortLabel} 到 {months[0].shortLabel}</span> : null}
            {months.length === 1 ? <span className="chapter-meta">{months[0].shortLabel}</span> : null}
            {review ? <span className="chapter-meta">含这一年的回顾初稿</span> : null}
          </Link>
        </li>;
      })}
    </ul>
    {previewIds.size === 0 && drafts.size === 0
      ? <p className="serif archive-empty">还没有标记出来的试读内容。这两年里已经发布的部分照样可以从头读。</p>
      : null}
    <p className="chapter-meta"><Link className="text-link" href="/">回到首页</Link></p>
  </div>;
}
