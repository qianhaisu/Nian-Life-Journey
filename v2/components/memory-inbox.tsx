"use client";

import Image from "next/image";
import { useState } from "react";
import type { CandidateMemory, Media, RawSource } from "@/lib/types";

interface SourceGroup {
  key: string;
  label: string;
  authorLabel: string;
  capturedAt: string;
  sources: RawSource[];
  media: Media[];
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric" }).format(new Date(value));
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  return `00:${String(seconds).padStart(2, "0")}`;
}

function buildGroups(sources: RawSource[], media: Media[]) {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const groups = new Map<string, SourceGroup>();
  sources.forEach((source) => {
    const key = `${source.sourceLabel}-${source.capturedAt.slice(0, 10)}`;
    const existing = groups.get(key) ?? { key, label: source.sourceLabel, authorLabel: source.authorLabel, capturedAt: source.capturedAt, sources: [], media: [] };
    existing.sources.push(source);
    source.mediaIds.forEach((mediaId) => {
      const item = mediaById.get(mediaId);
      if (item) existing.media.push(item);
    });
    groups.set(key, existing);
  });
  return [...groups.values()].sort((first, second) => first.capturedAt.localeCompare(second.capturedAt));
}

function sourceSummary(group: SourceGroup) {
  const photos = group.media.filter((item) => item.type === "photo").length;
  const videos = group.media.filter((item) => item.type === "video").length;
  const notes = group.sources.filter((source) => source.sourceType === "daycare_note" || source.sourceType === "parent_note").length;
  const chats = group.sources.filter((source) => source.sourceType === "wechat").length;
  const summary: string[] = [];
  if (photos > 0) summary.push(`${photos} 张照片`);
  if (videos > 0) summary.push(`${videos} 段视频`);
  if (chats > 0) summary.push(`${chats} 条聊天`);
  if (notes > 0) summary.push(`${notes} 条记录`);
  return summary.join(" · ");
}

function candidateSummary(sources: RawSource[], media: Media[]) {
  const sourceIds = new Set(sources.flatMap((source) => source.mediaIds));
  const candidateMedia = media.filter((item) => sourceIds.has(item.id));
  const photos = candidateMedia.filter((item) => item.type === "photo").length;
  const videos = candidateMedia.filter((item) => item.type === "video").length;
  const chats = sources.filter((source) => source.sourceType === "wechat").length;
  const notes = sources.filter((source) => source.sourceType === "daycare_note" || source.sourceType === "parent_note").length;
  return [photos > 0 ? `${photos} 张照片` : "", videos > 0 ? `${videos} 段视频` : "", chats > 0 ? `${chats} 条家庭聊天` : "", notes > 0 ? `${notes} 条记录` : ""].filter(Boolean).join(" · ");
}

export function MemoryInbox({ sources, media, candidate }: { sources: RawSource[]; media: Media[]; candidate: CandidateMemory }) {
  const groups = buildGroups(sources, media);
  const candidateSources = candidate.sourceIds.map((id) => sources.find((source) => source.id === id)).filter((source): source is RawSource => Boolean(source));
  const [groupStates, setGroupStates] = useState<Record<string, string>>({});
  const [candidateState, setCandidateState] = useState("");

  function markGroup(key: string, message: string) {
    setGroupStates((current) => ({ ...current, [key]: message }));
  }

  return <div className="inbox-flow">
    <section className="candidate-memory" aria-labelledby="candidate-title">
      <div className="candidate-mark"><span>可能的记忆</span><span>还没有成为故事</span></div>
      <div className="candidate-copy">
        <p className="candidate-date">{candidate.occurredAt.replaceAll("-", ".")}</p>
        <h2 id="candidate-title" className="serif">发现一段可能值得留下的记忆</h2>
        <p>{candidate.description}</p>
        <div className="candidate-details"><span>{candidateSummary(candidateSources, media)}</span><span>来自 {candidateSources.length} 个来源</span></div>
        <div className="candidate-actions">
          <button className="ink-button" type="button" onClick={() => setCandidateState("已放入整理队列")}>整理成记忆</button>
          <button className="quiet-button" type="button" onClick={() => setCandidateState("已暂时收起")}>暂时不处理</button>
          {candidateState ? <span className="inline-confirmation" role="status">{candidateState}</span> : null}
        </div>
      </div>
    </section>

    <div className="inbox-date-heading"><span>今天 · 8 月 28 日</span><span>还在等待你决定去哪里</span></div>
    <div className="inbox-sources">
      {groups.map((group) => {
        const text = group.sources.map((source) => source.text).filter(Boolean).join(" ");
        const hasWechat = group.sources.some((source) => source.sourceType === "wechat");
        const state = groupStates[group.key];
        return <article className="inbox-source" key={group.key}>
          <div className="inbox-source-heading"><div><span className="source-overline">来自</span><h2 className="serif">{group.label}</h2></div><div className="source-author"><span>{group.authorLabel}</span><time dateTime={group.capturedAt}>{formatDate(group.capturedAt)}</time></div></div>
          {group.media.length > 0 ? <div className={`inbox-media inbox-media-${group.media.length > 1 ? "photos" : "single"}`}>
            {group.media.slice(0, 4).map((item, index) => <div className="inbox-media-item" key={item.id}>
              <Image src={item.src} alt={item.alt} fill sizes="(max-width: 700px) 25vw, 180px" style={{ objectFit: "cover" }} />
              {item.type === "video" ? <span className="media-chip">Video · {formatDuration(item.durationSeconds)}</span> : null}
              {index === 3 && group.media.length > 4 ? <span className="media-more">+{group.media.length - 4}</span> : null}
            </div>)}
          </div> : null}
          {text ? <p className={hasWechat ? "inbox-quote" : "inbox-note"}>{hasWechat ? `“${text}”` : text}</p> : null}
          <div className="inbox-source-footer"><span className="source-count">{sourceSummary(group)}</span><div className="inbox-actions">
            {hasWechat ? <>
              <button className="quiet-button" type="button" onClick={() => markGroup(group.key, "已标记为加入已有记忆")}>加入已有记忆</button>
              <button className="ink-button" type="button" onClick={() => markGroup(group.key, "已准备创建一条记忆")}>创建一条记忆</button>
            </> : <button className="ink-button" type="button" onClick={() => markGroup(group.key, "已放入整理队列")}>整理{group.media.some((item) => item.type === "video") ? "这段视频" : "成记忆"}</button>}
            {state ? <span className="inline-confirmation" role="status">{state}</span> : null}
          </div></div>
        </article>;
      })}
    </div>
    <p className="inbox-footnote">原材料默认只对家庭可见。整理完成前，它们不会自动出现在时间线里。</p>
  </div>;
}
