import type { Metadata } from "next";
import Image from "next/image";
import "../mom-reports.css";
import { MomReportGrowth } from "@/components/mom-report-growth";
import { MomReportHealth } from "@/components/mom-report-health";
import { MomReportSleep } from "@/components/mom-report-sleep";
import { MomReportMoments } from "@/components/mom-report-moments";
import { MomReportFoodGuideEntry, MomReportFoodGuideSection } from "@/components/mom-report-food-guide";
import { MomReportMonthPicker } from "@/components/mom-report-month-picker";
import { loadFamilyArchiveOnDemand } from "@/lib/family-archive";
import { buildMomReportView, resolveMomReportMonth } from "@/lib/mom-report-view";
import { MOM_REPORTS } from "@/lib/mom-report-content";
import { renderOnDemand } from "@/lib/render-on-demand";
import { formatMonth } from "@/lib/time-signature";

type SearchParams = Promise<{ month?: string | string[] }>;

function firstParam(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export async function generateMetadata({ searchParams }: { searchParams: SearchParams }): Promise<Metadata> {
  const { month: requested } = await searchParams;
  const month = resolveMomReportMonth(firstParam(requested));
  const content = month ? MOM_REPORTS[month] : undefined;
  return { title: content ? `${formatMonth(month!)} · 妈妈月报` : "妈妈月报" };
}

// 妈妈月报 — replaces the retired 张年 page (see docs/mom-reports-implementation-handoff.md).
// 2026-09-17 §12: 苏静 asked for full V1.3 fidelity, both content AND visual language — every
// section V1.3 had (闪光时刻, Outside Food Guide included), the same card/shadow/hero composition,
// the same narrow single-column layout at every width. Only the base palette and heading font are
// the site's own; V1.3's own five-tone system stays because it IS the content's organisation.
export default async function MomReportsPage({ searchParams }: { searchParams: SearchParams }) {
  await renderOnDemand();
  const { month: requested } = await searchParams;
  const archive = await loadFamilyArchiveOnDemand();
  const view = buildMomReportView(archive, firstParam(requested));
  if (!view) {
    // No real monthly report exists yet at all. Honest empty state, not a fabricated placeholder.
    return <div className="mr-page reading-wrap">
      <h1 className="serif">妈妈月报</h1>
      <p>这里还没有一份可以展示的月报。</p>
    </div>;
  }
  const { content, ageLabel, birthCompact, month, months } = view;

  return <div className="mr-page">
    <a className="skip-link" href="#mr-main">跳到月报正文</a>
    <div className="mr-app">
      <div className="mr-topbar">
        <span className="mr-release">{content.release}</span>
      </div>

      <div className="mr-hero-wrap">
        <figure className="mr-hero-photo">
          <Image src={content.heroImage.src} alt={content.heroImage.alt} width={content.heroImage.width} height={content.heroImage.height} priority sizes="(max-width: 860px) 100vw, 860px" />
          <figcaption className="mr-hero-badge">{content.heroBadge}</figcaption>
        </figure>
        <div className="mr-hero-panel">
          <h1 className="mr-serif mr-hero-title">{content.title}</h1>
          <p className="mr-hero-subtitle">{birthCompact ? `${birthCompact} 出生｜` : ""}{formatMonth(month)}{ageLabel ? `约 ${ageLabel}` : ""}</p>
          <div className="mr-hero-stats">
            <div><strong>{content.heroStats.heightLabel}</strong><small>身高 · {month}</small></div>
            <div><strong>{content.heroStats.weightLabel}</strong><small>体重 · {month}</small></div>
            <div><strong>{ageLabel ?? content.heroStats.ageLabel}</strong><small>当时年龄 · {month}</small></div>
          </div>
          <MomReportMonthPicker month={month} months={months} />
        </div>
      </div>

      <main id="mr-main">
        <section id="mr-summary" className="mr-section mr-card mr-summary" aria-labelledby="mr-summary-title">
          <h2 id="mr-summary-title" className="mr-serif">本月情况总结</h2>
          <p className="mr-summary-copy">{content.summaryBody}</p>
          <ul className="mr-tags">{content.tags.map((tag) => <li key={tag.label} className={`mr-tone-${tag.tone}`}>{tag.label}</li>)}</ul>
        </section>

        <section id="basics" className="mr-section" aria-labelledby="aspects-title">
          <div className="mr-section-heading"><h2 id="aspects-title">基本概况</h2><span>Basic Facts · 六个成长维度</span></div>
          <div className="mr-card mr-aspects-card">
            {content.aspects.map((aspect) => <div className={`mr-aspect mr-tone-${aspect.tone}`} key={aspect.key}>
              <div className="mr-aspect-top"><span className="mr-aspect-icon" aria-hidden="true">{aspect.icon}</span><h3>{aspect.label}</h3></div>
              <p className="mr-aspect-lead">{aspect.lead}</p>
              <p className="mr-aspect-detail">{aspect.detail}</p>
            </div>)}
          </div>
        </section>

        <section id="growth" className="mr-section mr-card mr-growth-card" aria-labelledby="growth-title">
          <h2 id="growth-title">📈 生长发育曲线</h2>
          <MomReportGrowth points={content.measurements} chartNote={content.chartNote} measurementDetailId="mr-measurement-detail" />
        </section>

        <div className="mr-section">
          <MomReportFoodGuideEntry heading={content.foodGuide.heading} entryNote={content.foodGuide.entryNote} />
        </div>

        <section id="care" className="mr-section" aria-labelledby="care-title">
          <div className="mr-section-heading"><h2 id="care-title">健康与关注</h2><span>Health &amp; Focus</span></div>
          <p className="mr-section-note">{content.health.intro}</p>
          <MomReportHealth sourceNote={content.health.sourceNote} items={content.health.items} />
        </section>

        <section id="sleep" className="mr-section mr-card mr-sleep-card" aria-labelledby="sleep-title">
          <span className="mr-eyebrow">Sleep Journey</span>
          <h2 id="sleep-title" className="mr-serif">{content.sleep.heading}</h2>
          <MomReportSleep sleep={content.sleep} />
        </section>

        <section id="moments" className="mr-section" aria-labelledby="moments-title">
          <div className="mr-section-heading"><h2 id="moments-title">闪光时刻</h2><span>Joy &amp; Love Moments</span></div>
          <p className="mr-section-note">{content.moments.intro}</p>
          <MomReportMoments items={content.moments.items} />
        </section>

        <section id="food-guide" className="mr-section mr-card mr-food-guide-card" aria-labelledby="food-guide-title">
          <span className="mr-eyebrow">Outside Food Guide</span>
          <h2 id="food-guide-title" className="mr-serif">{content.foodGuide.heading}</h2>
          <MomReportFoodGuideSection {...content.foodGuide} />
        </section>

        <section id="next-month" className="mr-section" aria-labelledby="next-title">
          <div className="mr-section-heading"><h2 id="next-title">下月重点关注</h2><span>Looking Ahead</span></div>
          <div className="mr-next-notes">
            {content.nextMonth.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.note}</p></article>)}
          </div>
        </section>

        <footer className="mr-footer">
          <p>{content.footerNote}</p>
        </footer>
      </main>
    </div>
  </div>;
}
