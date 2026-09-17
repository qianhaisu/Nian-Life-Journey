import type { MomReportContent } from "@/lib/mom-report-content";

export function MomReportSleep({ sleep }: { sleep: MomReportContent["sleep"] }) {
  return <section id="sleep" className="mr-section mr-sleep" aria-labelledby="sleep-title">
    <div className="mr-section-heading">
      <h2 id="sleep-title" className="mr-serif">{sleep.heading}</h2>
      <span>睡眠旅程</span>
    </div>
    <div className="mr-sleep-copy">
      <p>{sleep.caption}</p>
      <div className="mr-sleep-key">
        <span>8 月月报记录</span>
        <strong>夜醒 {sleep.nightWaking}<i aria-hidden="true">／</i>入睡 {sleep.fallingAsleep}</strong>
      </div>
    </div>
    <ol className="mr-sleep-path">
      {sleep.stages.map((stage) => <li key={stage.label} className={stage.current ? "is-current" : ""}>
        <span className="mr-stage-dot" aria-hidden="true" />
        {stage.current ? <>
          <strong>{stage.label}</strong>
          <small>8 月走到这里</small>
        </> : <span>{stage.label}</span>}
      </li>)}
    </ol>
    <p className="mr-source-note">{sleep.sourceNote}</p>
  </section>;
}
