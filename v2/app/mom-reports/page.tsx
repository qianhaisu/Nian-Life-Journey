import type { Metadata } from "next";
import "../mom-reports.css";
import { Photo } from "@/components/photo";
import { MomReportGrowth } from "@/components/mom-report-growth";
import { MomReportHealth } from "@/components/mom-report-health";
import { MomReportSleep } from "@/components/mom-report-sleep";
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
  return { title: content ? `${content.title} · 妈妈月报` : "妈妈月报" };
}

// 妈妈月报 — replaces the retired 张年 page (see docs/mom-reports-implementation-handoff.md).
// Real 苏静月报 text (lib/mom-report-content.ts) laid out around one real, deliverable cover photo
// for the same month (lib/mom-report-view.ts). No organizer output, no generated summary — see the
// content module's own header comment for why those are a different, separate thing.
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
  const { content, cover, ageLabel, birthLabel, month, months } = view;

  return <div className="mr-page">
    <a className="skip-link" href="#mr-main">跳到月报正文</a>
    <section className="mr-hero">
      <div className="mr-hero-intro">
        <p className="mr-eyebrow">妈妈月报 · {formatMonth(month)}</p>
        <h1 className="mr-serif mr-hero-title">{content.title}</h1>
        <p className="mr-hero-subtitle">{content.tagline}</p>
        {ageLabel ? <p className="mr-hero-age">当时 {ageLabel}{birthLabel ? <span> · {birthLabel}出生</span> : null}</p> : null}
        <MomReportMonthPicker month={month} months={months} />
      </div>
      {cover ? <figure className="mr-hero-photo">
        <Photo media={cover.photo} priority sizes="(max-width: 700px) 100vw, 760px" />
        <figcaption>
          <span>{formatMonth(month)}的张年</span>
          {cover.dateLabel ? <time dateTime={cover.day}>{cover.dateLabel}{cover.ageLabel ? ` · 当时 ${cover.ageLabel}` : ""}</time> : null}
        </figcaption>
      </figure> : <p className="mr-hero-photo-empty">这个月还没有可以展示的照片。</p>}
    </section>

    <nav className="mr-chapter-nav" aria-label="月报目录">
      <a href="#mr-summary">本月的他</a>
      <a href="#growth">一点点长大</a>
      <a href="#sleep">睡眠旅程</a>
      <a href="#care">健康与关注</a>
      <a href="#next-month">下月继续看</a>
    </nav>

    <main id="mr-main">
      <section id="mr-summary" className="mr-section mr-summary" aria-labelledby="mr-summary-title">
        <div className="mr-section-heading"><h2 id="mr-summary-title" className="mr-serif">本月情况总结</h2><span>把细小的变化，慢慢记下来。</span></div>
        <div className="mr-summary-layout">
          <p className="mr-summary-lead">{content.summaryLead}<em>{content.summaryEmphasis}</em></p>
          <p className="mr-summary-copy">{content.summaryBody}</p>
        </div>
        <dl className="mr-aspects">
          {content.aspects.map((aspect) => <div key={aspect.key}>
            <dt>{aspect.label}</dt>
            <dd><strong>{aspect.lead}</strong><span>{aspect.detail}</span></dd>
          </div>)}
        </dl>
        <p className="mr-source-note">以上为 {formatMonth(month)}月报中的观察，保留当时的表达。</p>
      </section>

      <section id="growth" className="mr-section mr-growth" aria-labelledby="growth-title">
        <div className="mr-growth-layout">
          <div className="mr-growth-intro">
            <h2 id="growth-title" className="mr-serif">一点点长大</h2>
            <p>每一次测量，都是成长留下的刻度。</p>
          </div>
          <MomReportGrowth points={content.measurements} measurementDetailId="mr-measurement-detail" />
        </div>
      </section>

      <MomReportSleep sleep={content.sleep} />
      <MomReportHealth intro={content.health.intro} sourceNote={content.health.sourceNote} items={content.health.items} />

      <section id="next-month" className="mr-section mr-next-month" aria-labelledby="next-title">
        <div className="mr-section-heading"><h2 id="next-title" className="mr-serif">{formatMonth(month)}月报留下的下月关注</h2></div>
        <div className="mr-next-notes">
          {content.nextMonth.map((item) => <article key={item.title}><h3>{item.title}</h3><p>{item.note}</p></article>)}
        </div>
        <p className="mr-source-note">历史月报当时留下的观察线索，不代表现在的待办。</p>
      </section>

      <footer className="mr-footer">
        <p>这份月报，来自{content.source.author}的记录。</p>
        <p className="mr-footer-note">{content.source.note}</p>
        <p className="mr-source-note">{content.source.originLabel} · 整理呈现：{content.source.curator}</p>
      </footer>
    </main>
  </div>;
}
