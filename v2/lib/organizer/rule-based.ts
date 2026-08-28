import { getStore, newId, persistOrganization } from "@/lib/db/repository";
import type { ContentType, LifeEvent, RawSource, SourceMemoryLink } from "@/lib/types";

export interface OrganizerResult { action: "create_memory" | "attach_to_existing_memory" | "daily_trace" | "care_episode"; confidence: number; eventId: string; sourceIds: string[]; reason: string; }
const dateOf = (value: string) => value.slice(0, 10);

export async function organizeSources(sourceIds: string[]): Promise<OrganizerResult> {
  const store = await getStore(); const sources = store.rawSources.filter((source) => sourceIds.includes(source.id)); if (!sources.length) throw new Error("没有找到可整理的资料");
  const date = dateOf(sources[0].capturedAt); const medical = sources.some((source) => source.sourceType === "medical_document" || source.sourceType === "checkup_document");
  const existing = store.events.find((event) => dateOf(event.occurredAt) === date && event.visibility !== "private" && !medical && event.contentTypes.some((type) => sources.flatMap((source) => source.contentTypes).includes(type)));
  const mediaIds = sources.flatMap((source) => source.mediaIds); const contentTypes = [...new Set(sources.flatMap((source) => source.contentTypes))] as ContentType[];
  const contributorNames = sources.map((source) => store.contributors.find((item) => item.id === source.contributorId)?.displayName).filter(Boolean);
  const hasNote = sources.some((source) => Boolean(source.text)); const hasVideo = sources.some((source) => source.sourceType === "family_video"); const confidence = medical ? 0.92 : existing ? 0.86 : Math.min(0.96, 0.62 + (mediaIds.length > 1 ? 0.12 : 0) + (hasNote ? 0.1 : 0) + (hasVideo ? 0.08 : 0));
  const title = medical ? `${date.slice(5).replace("-", ".")} 就医记录` : existing?.title ?? (sources.some((source) => source.sourceType.startsWith("daycare")) ? `${date.slice(5).replace("-", ".")} · 托班日常` : `${date.slice(5).replace("-", ".")} · 日常记录`);
  const text = sources.find((source) => source.text)?.text; const story = medical ? "保留日期、来源和原始文件；医疗资料只做事实整理。" : text || (hasVideo ? "这一天留下了照片和一段视频，原始资料已经放回同一条记忆。" : `${contributorNames[0] ?? "家里"}留下了这一天的记录。`);
  const eventId = existing?.id ?? newId("event"); const scopes = (medical ? ["family"] : ["family", ...(sources.some((source) => source.sourceType.startsWith("daycare")) ? ["daycare"] : [])]) as LifeEvent["scopes"]; const event: LifeEvent = existing ?? { id: eventId, profileId: store.profile.id, title, story, occurredAt: date, people: contributorNames as string[], tags: contentTypes, contentTypes, mediaIds, sourceIds: [], growthRecordIds: [], careRecordIds: [], eventType: medical ? "routine" : sources.some((source) => source.sourceType.startsWith("daycare")) ? "routine" : "moment", memoryWeight: medical ? "trace" : mediaIds.length > 5 || hasVideo ? "memory" : "trace", scopes, heroMediaId: mediaIds[0], visibility: medical ? "private" : "family", keptInYearbook: false, createdBy: "rule", organizerVersion: "rule-v1" };
  const links: SourceMemoryLink[] = sources.map((source, index) => ({ rawSourceId: source.id, lifeEventId: eventId, role: index === 0 ? "primary" : "supporting", createdAt: new Date().toISOString() })); await persistOrganization(sourceIds, event, links);
  return { action: medical ? "care_episode" : existing ? "attach_to_existing_memory" : confidence >= 0.8 ? "create_memory" : "daily_trace", confidence, eventId, sourceIds, reason: medical ? "医疗资料仅自动完成事实归档，默认 private。" : existing ? "同一天且内容类型相近，已关联已有记忆。" : "按日期、来源、媒体数量和原话进行可解释整理。" };
}
