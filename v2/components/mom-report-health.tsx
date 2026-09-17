import type { MomReportHealthItem } from "@/lib/mom-report-content";

// Flat cards, every detail always visible — matches V1.3 exactly (no accordion: 苏静's page never
// hid this behind a click). `settled` items (screen time, hair, jaundice history — V1.3's `.stable`
// class) get a quieter treatment, never a claim that the matter is closed. The section heading and
// intro live in app/mom-reports/page.tsx (shared `.mr-section-heading` pattern); this only renders
// the card list and its own source note.
export function MomReportHealth({ sourceNote, items }: { sourceNote: string; items: MomReportHealthItem[] }) {
  if (items.length === 0) return null;
  return <>
    <div className="mr-care-list">
      {items.map((item) => <article className={`mr-care-item mr-tone-${item.tone}${item.settled ? " is-settled" : ""}`} key={item.id}>
        <span className="mr-care-icon" aria-hidden="true">{item.icon}</span>
        <h3 className="mr-care-title">{item.title}</h3>
        <em className={`mr-pill mr-pill-${item.statusTone}`}>{item.status}</em>
        <dl className="mr-care-detail">
          {item.details.map((detail) => <div key={detail.label}><dt>{detail.label}</dt><dd>{detail.text}</dd></div>)}
        </dl>
      </article>)}
    </div>
    <p className="mr-source-note">{sourceNote}</p>
  </>;
}
