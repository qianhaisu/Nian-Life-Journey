import Image from "next/image";
import type { MomReportMoment } from "@/lib/mom-report-content";

// 闪光时刻 — restored at 苏静's explicit request (2026-09-17) after being cut from the original
// redesign brief; see docs/mom-reports-implementation-handoff.md §12. All six cards are illustrated
// (V1.3's own "正式插画版" label, and every source alt text ends in "插画") — this page adds no photo
// claim any of them didn't already carry. The media box behind every item uses V1.3's own fixed
// warm/cool gradient (not the item's own tag colour) — the gradient frames the picture, the tag
// colour marks the moment. Section heading lives in page.tsx.
export function MomReportMoments({ items }: { items: MomReportMoment[] }) {
  if (items.length === 0) return null;
  return <div className="mr-moments-list">
    {items.map((item) => <article className="mr-moment" key={item.id}>
      <div className="mr-moment-media">
        <Image src={item.image} alt={item.alt} width={item.width} height={item.height} sizes="(max-width: 700px) 90vw, 420px" />
      </div>
      <div className="mr-moment-copy">
        <h3 className="mr-serif">{item.title}</h3>
        <p>{item.note}</p>
        <div className="mr-moment-meta">
          <span className={`mr-moment-tag mr-tone-${item.tone}`}>{item.tag}</span>
          <span className="mr-moment-credit">插画版</span>
        </div>
      </div>
    </article>)}
  </div>;
}
