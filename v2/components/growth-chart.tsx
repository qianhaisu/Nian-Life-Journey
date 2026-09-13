import type { Measurement } from "@/lib/growth-notes";

// 身高体重的曲线。它画的是**已经通过测量筛选的点**（lib/growth-notes.ts measurements()：
// 数字、非私密、按测量日排序），不是 growth_records 原始行。
//
// 为什么改成这样（2026-09-13）：这个组件原来自己过滤 `record.value !== undefined`。
// 数据轨在 09-13 加了 `precision` 列并把四条约数（「快到 14 斤」「接近 23 斤」「5.3 左右」
// 「10 斤多」）的 `value` 置空之后，这些行从数据库读回来是 **null 而不是 undefined**，
// 于是它们通过了那道过滤：横轴上多出 25.02 / 25.03 / 25.04 / 25.12 四个没有数值的刻度，
// 而且 `Math.min(...values)` 把 null 当成 0，整条曲线的纵向刻度都被压歪了。
// 现在点集由调用方给出，与「最新身高 / 最新体重」用的是同一份数据，两者不可能再各说各话。
export function GrowthChart({ points, title }: { points: Measurement[]; title: string }) {
  if (points.length === 0) return null;
  const values = points.map((point) => point.value);
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
  const plotted = points.map((point, index) => ({
    ...point,
    x: points.length === 1 ? (left + right) / 2 : left + (index / (points.length - 1)) * (right - left),
    y: bottom - ((point.value - paddedMin) / (paddedMax - paddedMin)) * (bottom - top),
  }));
  const path = plotted.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <figure className={`growth-chart chart-${points[0].kind}`}>
    <figcaption><span>{title}</span><strong>{points.at(-1)?.value} {points.at(-1)?.unit}</strong></figcaption>
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${title}：${points.map((point) => `${point.signature.dateLabel} ${point.value}${point.unit}`).join("，")}`} preserveAspectRatio="xMidYMid meet">
      <path className="chart-baseline" d={`M ${left} ${bottom} H ${right}`} />
      <path className="chart-line" d={path} />
      {plotted.map((point, index) => <g key={point.id}>
        <circle className="chart-point" cx={point.x} cy={point.y} r={index === plotted.length - 1 ? 4 : 2.5} />
        <text className="chart-value" x={point.x} y={point.y - 9} textAnchor="middle">{point.value}</text>
        <text className="chart-date" x={point.x} y="112" textAnchor="middle">{point.signature.day.slice(2, 7).replace("-", ".")}</text>
      </g>)}
    </svg>
  </figure>;
}
