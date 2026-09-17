import type { MomReportMeasurementPoint } from "@/lib/mom-report-content";
import { formatMonth } from "@/lib/time-signature";

// One combined chart, both curves always visible — matches 苏静's V1.3 exactly (docs/
// mom-reports-implementation-handoff.md): a single drawing area, height in blue and weight in
// green, each on its OWN scale (a real dual-axis overlay, not one shared axis — the two units are
// never comparable, only shown together for compactness). Months sit at even x-positions, the same
// choice V1.3 made; the axis labels below still say the real month, so a reader can see 2026-02's
// height gap without the spacing itself claiming to be a real time axis.
const VIEW_WIDTH = 390;
const VIEW_HEIGHT = 235;
const PLOT_LEFT = 45;
const PLOT_RIGHT = 370;
const PLOT_TOP = 28;
const PLOT_BOTTOM = 205;
const GRID_ROWS = 4;

// V1.3's own chart (index.html, hand-authored SVG for this exact dataset) gives the lowest point on
// each line very little headroom below it and more room above — matched here with an asymmetric
// pad so the two curves keep the same visual weight as the original instead of centering each
// series in its own box.
function scaleFor(values: number[]) {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const paddedMin = min - span * 0.05;
  const paddedMax = max + span * 0.28;
  return (value: number) => PLOT_BOTTOM - ((value - paddedMin) / (paddedMax - paddedMin)) * (PLOT_BOTTOM - PLOT_TOP);
}

function buildLine(points: MomReportMeasurementPoint[], kind: "height" | "weight", x: (index: number) => number) {
  const values = points.map((p) => p[kind]).filter((v): v is number => typeof v === "number");
  if (values.length === 0) return null;
  const y = scaleFor(values);
  const plotted = points.map((p, i) => (typeof p[kind] === "number" ? { x: x(i), y: y(p[kind] as number), value: p[kind] as number } : null));
  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of plotted) {
    if (point) current.push(point);
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);
  return { plotted, segments };
}

// Both series' value labels sit above their point by default (matching V1.3). When the two lines
// pass close together at the same month, the default -11 offset makes the two numbers overlap —
// real for this dataset's August point, where height and weight both near the top of their own
// range at once. When that happens, the visually-higher point's label is pushed further up so the
// two never share the same text baseline.
const LABEL_OFFSET = 11;
const COLLISION_THRESHOLD = 20;

export function MomReportGrowth({ points, chartNote, measurementDetailId }: { points: MomReportMeasurementPoint[]; chartNote: string; measurementDetailId: string }) {
  const x = (index: number) => PLOT_LEFT + (index / Math.max(points.length - 1, 1)) * (PLOT_RIGHT - PLOT_LEFT);
  const height = buildLine(points, "height", x);
  const weight = buildLine(points, "weight", x);
  const gridYs = Array.from({ length: GRID_ROWS }, (_, i) => PLOT_TOP + (i * (PLOT_BOTTOM - PLOT_TOP)) / (GRID_ROWS - 1));
  const desc = points
    .map((p) => `${formatMonth(p.month)}：身高 ${p.height ?? "未记录"}${typeof p.height === "number" ? " cm" : ""}，体重 ${p.weight ?? "未记录"}${typeof p.weight === "number" ? " kg" : ""}`)
    .join("；");
  const labelOffset = (index: number, y: number) => {
    const otherY = height?.plotted[index]?.y === y ? weight?.plotted[index]?.y : height?.plotted[index]?.y;
    if (otherY !== undefined && Math.abs(otherY - y) < COLLISION_THRESHOLD) {
      return y <= otherY ? LABEL_OFFSET + 7 : LABEL_OFFSET - 3;
    }
    return LABEL_OFFSET;
  };

  return <div className="mr-growth-chart">
    <svg className="mr-chart-svg" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={`张小年的身高与体重真实测量记录：${desc}`} preserveAspectRatio="xMidYMid meet">
      <g className="mr-chart-grid">{gridYs.map((y) => <line key={y} x1={PLOT_LEFT} y1={y} x2={PLOT_RIGHT} y2={y} />)}</g>
      <g className="mr-chart-months">{points.map((p, i) => <text key={p.month} x={x(i)} y={PLOT_BOTTOM + 22} textAnchor="middle">{formatMonth(p.month).replace(" 年 ", ".").replace(" 月", "")}</text>)}</g>
      {height ? <g className="mr-chart-height">
        {height.segments.map((seg, i) => <path key={i} d={seg.map((p, j) => `${j ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} />)}
        {height.plotted.map((p, i) => p && <g key={i}><circle cx={p.x} cy={p.y} r={6} /><text x={p.x} y={p.y - labelOffset(i, p.y)} textAnchor="middle">{p.value}</text></g>)}
      </g> : null}
      {weight ? <g className="mr-chart-weight">
        {weight.segments.map((seg, i) => <path key={i} d={seg.map((p, j) => `${j ? "L" : "M"} ${p.x} ${p.y}`).join(" ")} />)}
        {weight.plotted.map((p, i) => p && <g key={i}><circle cx={p.x} cy={p.y} r={6} /><text x={p.x} y={p.y - labelOffset(i, p.y)} textAnchor="middle">{p.value}</text></g>)}
      </g> : null}
    </svg>
    <div className="mr-chart-legend"><span className="mr-legend-height">蓝：身高 cm</span><span className="mr-legend-weight">绿：体重 kg</span></div>
    <p className="mr-chart-note">{chartNote}</p>
    <details className="mr-measurement-detail" id={measurementDetailId}>
      <summary>查看原月报测量记录 <span aria-hidden="true">＋</span></summary>
      <div className="mr-table-scroll">
        <table>
          <caption className="mr-sr-only">{formatMonth(points[0]?.month ?? "")} 至 {formatMonth(points[points.length - 1]?.month ?? "")}原月报测量记录</caption>
          <thead><tr><th scope="col">月份</th><th scope="col">身高 cm</th><th scope="col">体重 kg</th></tr></thead>
          <tbody>{points.map((point) => <tr key={point.month}>
            <th scope="row">{formatMonth(point.month)}</th>
            <td>{point.height ?? "未记录"}</td>
            <td>{point.weight ?? "未记录"}</td>
          </tr>)}</tbody>
        </table>
      </div>
    </details>
  </div>;
}
