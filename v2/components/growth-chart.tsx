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
// 横轴读的是**生命时间**，不是日历。2026-09-16 视觉验收：原来这里写的是
// `point.signature.day.slice(2, 7).replace("-", ".")`，线上渲染成「25.03  25.06」——一段被切过的
// ISO 串，既读不出「什么时候」，也读不出「当时几岁」。原则二的检验句直接问「是否有任何位置只暴露了
// 数据库时间」，这是全站唯一一处 yes，而且正好在唯一一页讲「现在」的页面上。
// 「1 岁 7 个月」比「26.02」更能说明一次测量意味着什么，本来就该是这条轴。
// 拆成两行是因为 viewBox 只有 320 宽，点多的时候一行放不下。
function ageLines(label: string | undefined): string[] {
  if (!label) return [];
  const compact = label.replace(/\s+/gu, "");
  const split = compact.match(/^(.*?岁)(.+)$/u);
  return split ? [split[1], split[2]] : [compact];
}

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
    <svg viewBox={`0 0 ${chartWidth} ${chartHeight}`} role="img" aria-label={`${title}：${points.map((point) => `${point.signature.ageLabel ? `${point.signature.ageLabel}（${point.signature.dateLabel}）` : point.signature.dateLabel} ${point.value}${point.unit}`).join("，")}`} preserveAspectRatio="xMidYMid meet">
      <path className="chart-baseline" d={`M ${left} ${bottom} H ${right}`} />
      <path className="chart-line" d={path} />
      {plotted.map((point, index) => <g key={point.id}>
        <circle className="chart-point" cx={point.x} cy={point.y} r={index === plotted.length - 1 ? 4 : 2.5} />
        <text className="chart-value" x={point.x} y={point.y - 9} textAnchor="middle">{point.value}</text>
        <text className="chart-date" x={point.x} y="106" textAnchor="middle">{ageLines(point.signature.ageLabel).map((line, lineIndex) => <tspan key={line} x={point.x} dy={lineIndex === 0 ? 0 : 11}>{line}</tspan>)}</text>
      </g>)}
    </svg>
  </figure>;
}
