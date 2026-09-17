import type { MomReportContent } from "@/lib/mom-report-content";

// A rising curve toward the current stage, matching V1.3's sleep-trend chart exactly — the curve
// shape carries no numeric meaning (there is no "sleep score" here, only an ordered sequence of
// named stages); only the dots and their labels underneath are the actual claim. The card and
// heading live in app/mom-reports/page.tsx; this renders the stat row, curve and caption.
const STAGE_X = [20, 110, 188, 264, 368];
const STAGE_Y = [105, 84, 62, 47, 35];
const CURVE_PATH = "M20 105 C66 104,86 82,110 84 S154 56,188 62 S230 38,264 47 S318 27,368 35";

export function MomReportSleep({ sleep }: { sleep: MomReportContent["sleep"] }) {
  const stages = sleep.stages;
  return <>
    <div className="mr-sleep-key">
      <div><small>Night waking</small><strong>{sleep.nightWaking}</strong></div>
      <div><small>Falling asleep</small><strong>{sleep.fallingAsleep}</strong></div>
    </div>
    <svg className="mr-sleep-svg" viewBox="0 0 390 130" role="img" aria-label="睡眠阶段从频繁夜醒过渡到自主入睡建立">
      <path className="mr-sleep-baseline" d="M18 112H372" />
      <path className="mr-sleep-curve" d={CURVE_PATH} />
      {STAGE_X.map((cx, i) => <circle key={cx} className={i === STAGE_X.length - 1 ? "is-current" : ""} cx={cx} cy={STAGE_Y[i]} r={i === STAGE_X.length - 1 ? 7 : 6} />)}
    </svg>
    <ol className="mr-sleep-labels">
      {stages.map((stage) => <li key={stage.label} className={stage.current ? "is-current" : ""}>{stage.label}</li>)}
    </ol>
    <p className="mr-sleep-caption">{sleep.caption}</p>
    <p className="mr-source-note">{sleep.sourceNote}</p>
  </>;
}
