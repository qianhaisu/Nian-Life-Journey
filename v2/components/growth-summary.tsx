import Link from "next/link";
import type { GrowthRecord } from "@/lib/types";

function formatDate(date: string) { return date.slice(0, 7).replace("-", "."); }

function GrowthPath({ label, description, records }: { label: string; description: string; records: GrowthRecord[] }) {
	return <div className="growth-path">
		<div className="growth-path-heading"><span>{label}</span><strong className="serif">{description}</strong></div>
		<ol>{records.map((record) => <li key={record.id}>
			<time dateTime={record.observedAt}>{formatDate(record.observedAt)}</time>
			<div><p>{record.note}</p>{record.lifeEventId ? <Link href={`/events/${record.lifeEventId}`}>回到那一天 <b>↗</b></Link> : <span>{record.source}</span>}</div>
		</li>)}</ol>
	</div>;
}

export function GrowthSummary({ records }: { records: GrowthRecord[] }) {
	const language = records.filter((record) => record.kind === "language").sort((first, second) => first.observedAt.localeCompare(second.observedAt));
	const motor = records.filter((record) => record.kind === "motor").sort((first, second) => first.observedAt.localeCompare(second.observedAt));
	const height = records.find((record) => record.kind === "height");
	const weight = records.find((record) => record.kind === "weight");
	return <section className="growth-summary" id="growth">
		<div className="growth-summary-heading"><span className="eyebrow">最近的变化</span><h2 className="serif">把这些日子放在一起看</h2><p>数字和照片都留着，方便以后再翻回来。</p></div>
		<div className="growth-paths"><GrowthPath label="语言" description="从声音到回应" records={language} /><GrowthPath label="运动" description="从走到追球" records={motor} /></div>
		<p className="growth-measure-note">身体记录仍然在这里，作为时间里的一个小注脚：{height?.value}{height?.unit} · {weight?.value}{weight?.unit} · {height ? formatDate(height.observedAt) : ""}</p>
	</section>;
}
