import type { MomReportHealthItem } from "@/lib/mom-report-content";

// Native <details>/<summary> per item — no client JS needed, matches the rest of the site's
// disclosure pattern (about-page health fold, month-page archive fold).
export function MomReportHealth({ intro, sourceNote, items }: { intro: string; sourceNote: string; items: MomReportHealthItem[] }) {
  if (items.length === 0) return null;
  return <section id="care" className="mr-section mr-care" aria-labelledby="care-title">
    <div className="mr-care-intro">
      <h2 id="care-title" className="mr-serif">健康与关注</h2>
      <p>{intro}</p>
      <p className="mr-source-note">{sourceNote}</p>
    </div>
    <div className="mr-care-list">
      {items.map((item) => <details className="mr-care-item" key={item.id}>
        <summary>
          <span className="mr-care-item-title">{item.title}<small>{item.subtitle}</small></span>
          <em className={`mr-pill mr-pill-${item.tone}`}>{item.status}</em>
          <b aria-hidden="true">＋</b>
        </summary>
        <div className="mr-care-detail">
          {item.details.map((detail) => <p key={detail.label}><strong>{detail.label}：</strong>{detail.text}</p>)}
        </div>
      </details>)}
    </div>
  </section>;
}
