import Link from "next/link";
import { notFound } from "next/navigation";
import { EventHeroImage } from "@/components/event-hero-image";
import { EvidenceList } from "@/components/evidence-list";
import { getAllEvents, getEventDetail } from "@/lib/db/repository";
import { heroCandidates } from "@/lib/media/hero";
export async function generateStaticParams() { return (await getAllEvents()).map((event) => ({ id: event.id })); }
function weightLabel(weight: "trace" | "memory" | "highlight" | "chapter") { return weight === "chapter" ? "人生章节" : weight === "highlight" ? "值得再看" : weight === "trace" ? "生活痕迹" : "一段记忆"; }
export default async function EventDetailPage({ params }: { params: Promise<{ id: string }> }) {
	const { id } = await params;
	const detail = await getEventDetail(id);
	if (!detail) notFound();
	const { event, media: eventMedia, sources: eventSources, contributors, growth, care } = detail;
	const heroCandidateList = heroCandidates(event.heroMediaId, eventMedia);
	const photoCount = eventMedia.filter((item) => item.type === "photo").length;
	const videoCount = eventMedia.filter((item) => item.type === "video").length;
	const chatCount = eventSources.filter((source) => source.sourceType === "wechat").length;
	const noteCount = eventSources.filter((source) => source.sourceType === "parent_note" || source.sourceType === "daycare_note").length;
	return <article className="detail-page">
		<div className="reading-wrap detail-top"><Link className="back-link" href="/memory">← 回到记忆</Link><span className="section-mark">{weightLabel(event.memoryWeight)} · {event.occurredAt.replaceAll("-", ".")}</span><h1 className="serif">{event.title}</h1><div className="detail-meta"><span>{event.occurredAt.replaceAll("-", ".")}</span><span>{event.locationLabel}</span></div></div>
		<EventHeroImage candidates={heroCandidateList} />
		<section className="story-layer reading-wrap" aria-labelledby="story-title">
			<div className="story-column"><span className="layer-label">故事</span><h2 id="story-title" className="serif">多年以后，我们会这样记住它。</h2><p className="story-lead">{event.story}</p>{event.storySections?.map((section) => <p key={section}>{section}</p>)}</div>
			<aside className="detail-aside"><section><h3 className="aside-label">同行的人</h3><p>{event.people.join(" · ")}</p></section><section><h3 className="aside-label">地点</h3><p>{event.locationLabel}</p></section><section><h3 className="aside-label">标签</h3><div className="detail-tags">{event.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>{growth.length > 0 && <section><h3 className="aside-label">相关成长</h3>{growth.map((record) => <div className="related-record" key={record.id}><strong>{record.kind === "social" ? "观察与专注" : record.kind === "motor" ? "大运动" : "语言表达"}</strong><p>{record.note}</p></div>)}</section>}{care.length > 0 && <section><h3 className="aside-label">照护记录</h3>{care.map((record) => <div className="related-record" key={record.id}><strong>{record.status}</strong><p>{record.note}</p></div>)}</section>}</aside>
		</section>
		<section className="evidence-layer" aria-labelledby="evidence-title"><div className="reading-wrap evidence-inner"><div className="evidence-heading"><div><span className="layer-label">原始材料</span><h2 id="evidence-title" className="serif">那天留下的东西</h2></div><p>故事可以修改；当时真正留下的东西永远保留。</p></div><div className="evidence-summary"><span><strong>{photoCount}</strong> 张照片</span><span><strong>{videoCount}</strong> 个视频</span><span><strong>{chatCount}</strong> 条聊天记录</span><span><strong>{noteCount}</strong> 条原话与备注</span></div><EvidenceList sources={eventSources} media={eventMedia} contributors={contributors} /></div></section>
		<div className="detail-footer reading-wrap"><Link className="text-link" href="/memory">继续翻看下一段生活 <b>↗</b></Link></div>
	</article>;
}
