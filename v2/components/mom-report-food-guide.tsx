import Image from "next/image";
import type { MomReportFoodGuide } from "@/lib/mom-report-content";

// 给爷爷奶奶的外出小抄 — restored at 苏静's explicit request (2026-09-17); see
// docs/mom-reports-implementation-handoff.md. A real reference she wrote for real relatives, not a
// generic diet page: the point is a grandparent standing in a convenience store can read it in five
// seconds, which is why every scene keeps a photo, three-ish food words and one short tip.
export function MomReportFoodGuideEntry({ heading, entryNote }: Pick<MomReportFoodGuide, "heading" | "entryNote">) {
  return <a className="mr-card mr-food-entry" href="#food-guide">
    <span className="mr-food-entry-icon" aria-hidden="true">🥣</span>
    <span className="mr-food-entry-copy">
      <strong>{heading}</strong>
      <span>{entryNote}</span>
    </span>
    <span className="mr-food-entry-link">查看指南 →</span>
  </a>;
}

// Card, eyebrow and heading live in app/mom-reports/page.tsx; this renders the principle line, the
// scene grid and the fallback.
export function MomReportFoodGuideSection({ principle, scenes, fallbackQuestion, fallbackAnswer }: MomReportFoodGuide) {
  return <>
    <p className="mr-food-principle">{principle}</p>
    <div className="mr-food-grid">
      {scenes.map((scene) => <article className="mr-food-scene" key={scene.id}>
        <div className="mr-food-photo">
          <Image src={scene.image} alt={scene.alt} width={scene.width} height={scene.height} sizes="(max-width: 700px) 45vw, 220px" />
        </div>
        <div className="mr-food-copy">
          <h3>{scene.title}</h3>
          <p className="mr-food-items">{scene.items}</p>
          <span className="mr-food-tip">{scene.tip}</span>
        </div>
      </article>)}
    </div>
    <p className="mr-food-fallback">{fallbackQuestion}<strong>{fallbackAnswer}</strong></p>
  </>;
}
