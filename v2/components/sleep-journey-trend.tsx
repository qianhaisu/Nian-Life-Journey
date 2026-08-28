import type { SleepPhase } from "@/lib/types";

export function SleepJourneyTrend({ phases }: { phases: SleepPhase[] }) {
  const width = 480;
  const height = 188;
  const left = 28;
  const right = 452;
  const top = 34;
  const bottom = 112;
  const plotted = phases.map((phase, index) => ({ ...phase, x: phases.length === 1 ? (left + right) / 2 : left + (index / (phases.length - 1)) * (right - left), y: top + (index / Math.max(phases.length - 1, 1)) * (bottom - top) }));
  const path = plotted.map((phase, index) => `${index ? "L" : "M"} ${phase.x} ${phase.y}`).join(" ");

  return <div className="sleep-trend" aria-label="睡眠变化阶段">
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`睡眠变化：${phases.map((phase) => phase.label).join("、")}`} preserveAspectRatio="xMidYMid meet">
      <path className="sleep-trend-rule" d={`M ${left} ${bottom + 16} H ${right}`} />
      <path className="sleep-trend-line" d={path} />
      {plotted.map((phase) => <g key={phase.id} className={phase.current ? "is-current" : undefined}><circle cx={phase.x} cy={phase.y} r={phase.current ? 7 : 4.5} /><text x={phase.x} y={bottom + 34} textAnchor="middle">{phase.startedAt.replace("-", ".")}</text>{phase.current ? <text className="sleep-current-label" x={phase.x} y={phase.y - 16} textAnchor="middle">现在</text> : null}</g>)}
    </svg>
    <ol>{phases.map((phase, index) => <li className={phase.current ? "is-current" : ""} key={phase.id}><span>{String(index + 1).padStart(2, "0")}</span><strong>{phase.label}</strong><small>{phase.note}</small></li>)}</ol>
  </div>;
}
