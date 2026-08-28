import type { GrowthRecord } from "@/lib/types";

export function GrowthChart({ records, kind, title }: { records: GrowthRecord[]; kind: "height" | "weight"; title: string }) {
  const points = records.filter((record) => record.kind === kind && record.value !== undefined).sort((a, b) => a.observedAt.localeCompare(b.observedAt));
  const values = points.map((point) => point.value as number);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(max - min, 1);
  const plotted = points.map((point, index) => ({ ...point, x: points.length === 1 ? 50 : 7 + (index / (points.length - 1)) * 86, y: 82 - (((point.value as number) - min) / span) * 60 }));
  const path = plotted.map((point, index) => `${index ? "L" : "M"} ${point.x} ${point.y}`).join(" ");
  return <figure className={`growth-chart chart-${kind}`}>
    <figcaption><span>{title}</span><strong>{points.at(-1)?.value} {points.at(-1)?.unit}</strong></figcaption>
    <svg viewBox="0 0 100 100" role="img" aria-label={`${title}：${points.map((point) => `${point.observedAt.slice(0, 7)} ${point.value}${point.unit}`).join("，")}`} preserveAspectRatio="none">
      <path className="chart-grid" d="M 7 22 H 93 M 7 52 H 93 M 7 82 H 93" />
      <path className="chart-line" d={path} />
      {plotted.map((point) => <circle key={point.id} className="chart-point" cx={point.x} cy={point.y} r="1.8" />)}
    </svg>
    <ol>{plotted.map((point) => <li key={point.id}><time dateTime={point.observedAt}>{point.observedAt.slice(0, 7).replace("-", ".")}</time><span>{point.value}{point.unit}</span></li>)}</ol>
  </figure>;
}
