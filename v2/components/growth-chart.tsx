import type { GrowthRecord } from "@/lib/types";

export function GrowthChart({ records, kind, title }: { records: GrowthRecord[]; kind: "height" | "weight"; title: string }) {
  const points = records.filter((record) => record.kind === kind && record.value !== undefined).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const values = points.map((point) => point.value as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const paddedMin = min - span * 0.14;
  const paddedMax = max + span * 0.14;
  const chartWidth = 320;
  const chartHeight = 132;
  const left = 20;
  const right = 300;
  const top = 16;
  const bottom = 90;
  const plotted = points.map((point, index) => ({ ...point, x: points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left), y: bottom - (((point.value as number) - paddedMin) / (paddedMax - paddedMin)) * (bottom - top) }));
  const path = plotted.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <figure className={`growth-chart chart-${kind}`}>
    <figcaption><span>{title}</span><strong>{points.at(-1)?.value} {points.at(-1)?.unit}</strong></figcaption>
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${title}：${points.map((point) => `${point.observedAt.slice(0, 7)} ${point.value}${point.unit}`).join("，")}`} preserveAspectRatio="xMidYMid meet">
      <path className="chart-baseline" d={`M ${left} ${bottom} H ${right}`} />
      <path className="chart-line" d={path} />
      {plotted.map((point, index) => <g key={point.id}><circle className="chart-point" cx={point.x} cy={point.y} r={index === plotted.length - 1 ? 4 : 2.5} /><text className="chart-value" x={point.x} y={point.y - 9} textAnchor="middle">{point.value}</text><text className="chart-date" x={point.x} y="112" textAnchor="middle">{point.observedAt.slice(2, 7).replace("-", ".")}</text></g>)}
    </svg>
  </figure>;
}
