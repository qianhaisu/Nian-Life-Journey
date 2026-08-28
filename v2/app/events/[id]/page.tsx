import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { EvidenceList } from "@/components/evidence-list";
import { events, getCareForEvent, getEvent, getGrowthForEvent, getMediaForEvent, getSourcesForEvent } from "@/lib/mock-data";
export function generateStaticParams() { return events.map((event) => ({ id: event.id })); }
function weightLabel(weight: "feature" | "memory" | "daily_trace") { return weight === "feature" ? "重要记忆" : weight === "daily_trace" ? "日常留下" : "记忆"; }
export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const event = getEvent(id);
	if (!event) notFound();
	const eventMedia = getMediaForEvent(event);
	const heroMedia = eventMedia.find((item) => item.id === event.heroMediaId) ?? eventMedia[0];
	if (!heroMedia) notFound();
	const eventSources = getSourcesForEvent(event);
	const growth = getGrowthForEvent(event);
	const care = getCareForEvent(event);
	const photoCount = eventMedia.filter((item) => item.type === "photo").length;
	const videoCount = eventMedia.filter((item) => item.type === "video").length;
	const chatCount = eventSources.filter((source) => source.sourceType === "wechat").length;
	const noteCount = eventSources.filter((source) => source.sourceType === "parent_note" || source.sourceType === "daycare_note").length;
	return <article className="detail-page">
		<div className="wrap detail-top"><Link className="back-link" href="/timeline">← 回到时间线</Link><span className="eyebrow">{weightLabel(event.memoryWeight)} · {event.occurredAt.replaceAll("-", ".")}</span><h1 className="serif">{event.title}</h1><div className="detail-meta"><span>{event.occurredAt.replaceAll("-", ".")}</span><span>{event.locationLabel}</span></div></div>
		<div className="detail-lead wrap"><div className="detail-lead-image"><Image src={heroMedia.src} alt={heroMedia.alt} fill priority sizes="(max-width: 700px) 100vw, 75vw" style={{ objectFit: "cover" }} /></div></div>
		<section className="story-layer wrap" aria-labelledby="story-title">
			<div className="story-column"><span className="layer-label">故事</span><h2 id="story-title" className="serif">多年以后，我们会这样记住它。</h2><p className="story-lead">{event.story}</p>{event.storySections?.map((section) => <p key={section}>{section}</p>)}</div>
			<aside className="detail-aside"><section><h3 className="aside-label">同行的人</h3><p>{event.people.join(" · ")}</p></section><section><h3 className="aside-label">地点</h3><p>{event.locationLabel}</p></section><section><h3 className="aside-label">标签</h3><div className="detail-tags">{event.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>{growth.length > 0 && <section><h3 className="aside-label">相关成长</h3>{growth.map((record) => <div className="related-record" key={record.id}><strong>{record.kind === "social" ? "观察与专注" : record.kind === "motor" ? "大运动" : "语言表达"}</strong><p>{record.note}</p></div>)}</section>}{care.length > 0 && <section><h3 className="aside-label">照护记录</h3>{care.map((record) => <div className="related-record" key={record.id}><strong>{record.status}</strong><p>{record.note}</p></div>)}</section>}</aside>
		</section>
		<section className="evidence-layer" aria-labelledby="evidence-title"><div className="wrap evidence-inner"><div className="evidence-heading"><div><span className="layer-label">原始材料</span><h2 id="evidence-title" className="serif">那天留下的东西</h2></div><p>故事是多年以后我们怎么记住它。证据是当时真正落下来的东西。</p></div><div className="evidence-summary"><span><strong>{photoCount}</strong> 张照片</span><span><strong>{videoCount}</strong> 个视频</span><span><strong>{chatCount}</strong> 条聊天记录</span><span><strong>{noteCount}</strong> 条家庭备注</span></div><EvidenceList sources={eventSources} media={eventMedia} /></div></section>
		<div className="detail-footer wrap"><Link className="text-link" href="/timeline">继续翻看下一段生活 <b>↗</b></Link></div>
	</article>;
}
