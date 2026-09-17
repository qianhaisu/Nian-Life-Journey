import type { MomReportMeasurementPoint } from "@/lib/mom-report-content";
import { formatMonth } from "@/lib/time-signature";

// V1.3's growth chart (root index.html, `.chart-card svg`) is not a generically-scaled chart — it's
// a hand-placed SVG for this exact five-point dataset (2025-11 → 2026-08). 苏静 asked for pixel-level
// fidelity to V1.3, and a generic scale/pad formula can only ever approximate that, never match it —
// which is why an earlier version of this component (computed scale, evenly-spaced x) kept looking
// "close but not the same". This version reproduces V1.3's own coordinates directly, keyed by month,
// so THIS dataset renders identically. A future month's report needs its own hand-placed row here,
// same as V1.3 itself would have needed one — there is no dataset-agnostic version of a hand-drawn chart.
const VIEW_WIDTH = 390;
const VIEW_HEIGHT = 235;
const GRID_LEFT = 45;
const GRID_RIGHT = 370;
const GRID_ROW_YS = [28, 76, 124, 172];
const AXIS_LABEL_Y = 205;

type PlotPoint = { x: number; y: number; labelY: number };
type MonthCoords = { axisLabelX: number; height?: PlotPoint; weight?: PlotPoint };

const CHART_COORDS: Record<string, MonthCoords> = {
  "2025-11": { axisLabelX: 34, height: { x: 55, y: 168, labelY: 157 }, weight: { x: 55, y: 215, labelY: 203 } },
  "2026-02": { axisLabelX: 108, weight: { x: 130, y: 132, labelY: 121 } },
  "2026-03": { axisLabelX: 182, height: { x: 205, y: 96, labelY: 85 }, weight: { x: 205, y: 129, labelY: 118 } },
  "2026-05": { axisLabelX: 252, height: { x: 275, y: 72, labelY: 61 }, weight: { x: 275, y: 150, labelY: 139 } },
  "2026-08": { axisLabelX: 326, height: { x: 350, y: 62, labelY: 51 }, weight: { x: 350, y: 96, labelY: 85 } },
};

function buildPath(points: PlotPoint[]) {
  return points.map((p, i) => `${i ? "L" : "M"}${p.x} ${p.y}`).join(" ");
}

export function MomReportGrowth({ points, chartNote, measurementDetailId }: { points: MomReportMeasurementPoint[]; chartNote: string; measurementDetailId: string }) {
  const rows = points.map((point) => ({ point, coords: CHART_COORDS[point.month] })).filter((row) => row.coords);
  const heightPoints = rows.filter((row) => row.coords.height).map((row) => row.coords.height as PlotPoint);
  const weightPoints = rows.filter((row) => row.coords.weight).map((row) => row.coords.weight as PlotPoint);
  const desc = points
    .map((p) => `${formatMonth(p.month)}：身高 ${p.height ?? "未记录"}${typeof p.height === "number" ? " cm" : ""}，体重 ${p.weight ?? "未记录"}${typeof p.weight === "number" ? " kg" : ""}`)
    .join("；");

  return <div className="mr-growth-chart">
    <svg className="mr-chart-svg" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={`张小年的身高与体重真实测量记录：${desc}`} preserveAspectRatio="xMidYMid meet">
      <g className="mr-chart-grid">{GRID_ROW_YS.map((y) => <line key={y} x1={GRID_LEFT} y1={y} x2={GRID_RIGHT} y2={y} />)}</g>
      <g className="mr-chart-months">{rows.map(({ point, coords }) => <text key={point.month} x={coords.axisLabelX} y={AXIS_LABEL_Y}>{formatMonth(point.month).replace(" 年 ", ".").replace(" 月", "").replace(/\.(\d)$/, ".0$1")}</text>)}</g>
      {heightPoints.length ? <g className="mr-chart-height">
        <path d={buildPath(heightPoints)} />
        {rows.map(({ point, coords }) => coords.height && <g key={point.month}><circle cx={coords.height.x} cy={coords.height.y} r={6} /><text x={coords.height.x} y={coords.height.labelY} textAnchor="middle">{(point.height as number).toFixed(1)}</text></g>)}
      </g> : null}
      {weightPoints.length ? <g className="mr-chart-weight">
        <path d={buildPath(weightPoints)} />
        {rows.map(({ point, coords }) => coords.weight && <g key={point.month}><circle cx={coords.weight.x} cy={coords.weight.y} r={6} /><text x={coords.weight.x} y={coords.weight.labelY} textAnchor="middle">{point.weight}</text></g>)}
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
