"use client";

import { useId, useRef, useState } from "react";
import type { MomReportMeasurementPoint } from "@/lib/mom-report-content";
import { formatMonth } from "@/lib/time-signature";

type Kind = "height" | "weight";

const KIND_LABEL: Record<Kind, string> = { height: "身高", weight: "体重" };
const KIND_UNIT: Record<Kind, string> = { height: "cm", weight: "kg" };

// Real calendar spacing, not evenly-spaced ticks: 2025-11 → 2026-02 is a 3-month gap, 2026-02 →
// 2026-03 is 1 month — collapsing both to "the next tick" would misrepresent how long the archive
// actually went without a measurement (原则二).
function monthIndex(month: string): number {
  const [y, m] = month.split("-").map(Number);
  return y * 12 + m;
}

const VIEW_WIDTH = 400;
const VIEW_HEIGHT = 260;
const PLOT_LEFT = 40;
const PLOT_RIGHT = VIEW_WIDTH - 16;
const PLOT_TOP = 24;
const PLOT_BOTTOM = VIEW_HEIGHT - 56;

function GrowthSvg({ kind, points }: { kind: Kind; points: MomReportMeasurementPoint[] }) {
  const values = points.map((point) => point[kind]).filter((value): value is number => typeof value === "number");
  if (values.length === 0) return <p className="mr-chart-empty">这条记录暂无数值。</p>;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const paddedMin = min - span * 0.18;
  const paddedMax = max + span * 0.18;
  const first = monthIndex(points[0].month);
  const last = Math.max(monthIndex(points[points.length - 1].month) - first, 1);
  const x = (month: string) => PLOT_LEFT + ((monthIndex(month) - first) / last) * (PLOT_RIGHT - PLOT_LEFT);
  const y = (value: number) => PLOT_BOTTOM - ((value - paddedMin) / (paddedMax - paddedMin)) * (PLOT_BOTTOM - PLOT_TOP);

  const segments: { x: number; y: number }[][] = [];
  let current: { x: number; y: number }[] = [];
  for (const point of points) {
    const value = point[kind];
    if (typeof value === "number") current.push({ x: x(point.month), y: y(value) });
    else if (current.length) { segments.push(current); current = []; }
  }
  if (current.length) segments.push(current);

  // A plain aria-label on the svg, not <title>/<desc> children: Next's App Router hoists any
  // <title> element for page <head> metadata during streaming SSR, which strips a same-named SVG
  // child's text server-side and hydration then reports a text mismatch against the client's
  // (correctly rendered) version. lib/growth-chart's own chart uses the same aria-label pattern.
  const label = `${KIND_LABEL[kind]}记录，单位${KIND_UNIT[kind]}：${points
    .map((point) => {
      const value = point[kind];
      return `${formatMonth(point.month)}：${typeof value === "number" ? `${value} ${KIND_UNIT[kind]}` : "未记录"}`;
    })
    .join("；")}`;

  return <svg className="mr-chart-svg" viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`} role="img" aria-label={label} preserveAspectRatio="xMidYMid meet">
    <line className="mr-chart-baseline" x1={PLOT_LEFT} y1={PLOT_BOTTOM} x2={PLOT_RIGHT} y2={PLOT_BOTTOM} />
    {segments.map((segment, index) => <polyline key={index} className="mr-chart-line" points={segment.map((p) => `${p.x},${p.y}`).join(" ")} />)}
    {points.map((point) => {
      const value = point[kind];
      if (typeof value !== "number") return null;
      const px = x(point.month);
      const py = y(value);
      return <g key={point.month}>
        <circle className="mr-chart-point" cx={px} cy={py} r={4.5} />
        <text className="mr-chart-value" x={px} y={py - 12} textAnchor="middle">{value}</text>
      </g>;
    })}
    {points.map((point) => <text key={`${point.month}-label`} className="mr-chart-month" x={x(point.month)} y={PLOT_BOTTOM + 26} textAnchor="middle">{formatMonth(point.month).replace(" 年 ", ".").replace(" 月", "")}</text>)}
  </svg>;
}

// 身高／体重两条独立量纲的曲线，用真实标签页切换 —— 键盘可达（ArrowLeft/ArrowRight/Home/End），
// 不共用坐标轴。原型（design.js）里同样的两条曲线，这里换成 React 状态而不是直接搬运那份脚本。
export function MomReportGrowth({ points, measurementDetailId }: { points: MomReportMeasurementPoint[]; measurementDetailId: string }) {
  const [active, setActive] = useState<Kind>("height");
  const tabRefs = useRef<Record<Kind, HTMLButtonElement | null>>({ height: null, weight: null });
  const baseId = useId();
  const kinds: Kind[] = ["height", "weight"];

  const onKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0 : event.key === "End" ? kinds.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + kinds.length) % kinds.length;
    const nextKind = kinds[nextIndex];
    setActive(nextKind);
    tabRefs.current[nextKind]?.focus();
  };

  const latest = [...points].reverse().find((point) => typeof point[active] === "number");

  return <div className="mr-growth-chart">
    <div className="mr-chart-toolbar">
      <div className="mr-tablist" role="tablist" aria-label="选择生长记录">
        {kinds.map((kind, index) => {
          const selected = active === kind;
          const tabId = `${baseId}-${kind}-tab`;
          const panelId = `${baseId}-${kind}-panel`;
          return <button
            key={kind}
            id={tabId}
            ref={(node) => { tabRefs.current[kind] = node; }}
            role="tab"
            type="button"
            aria-selected={selected}
            aria-controls={panelId}
            tabIndex={selected ? 0 : -1}
            className={selected ? "is-active" : ""}
            onClick={() => setActive(kind)}
            onKeyDown={(event) => onKeyDown(event, index)}
          >{KIND_LABEL[kind]}</button>;
        })}
      </div>
      {latest ? <span className="mr-chart-latest">最新 {latest[active]} {KIND_UNIT[active]} · {formatMonth(latest.month)}</span> : null}
    </div>
    {kinds.map((kind) => {
      const selected = active === kind;
      const tabId = `${baseId}-${kind}-tab`;
      const panelId = `${baseId}-${kind}-panel`;
      return <div key={kind} id={panelId} role="tabpanel" aria-labelledby={tabId} hidden={!selected} className="mr-chart-panel">
        <GrowthSvg kind={kind} points={points} />
      </div>;
    })}
    <p className="mr-chart-caption">按月份间隔真实排列；{points.some((p) => p.height === null || p.weight === null) ? "缺测的月份断开连线，" : ""}原月报未注明具体测量日。</p>
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
