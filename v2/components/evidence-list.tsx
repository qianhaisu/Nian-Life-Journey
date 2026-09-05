import Image from "next/image";
import type { Contributor, Media, RawSource, SourceType } from "@/lib/types";
import { presentableEvidenceText, presentableSourceLabel } from "@/lib/organizer/evidence-text";
import { isThumbnailEligible } from "@/lib/media/hero";
import { presentableAlt } from "@/lib/media/presentation";

const TEXT_PREVIEW_LIMIT = 120;

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function sourceTypeLabel(sourceType: SourceType) {
  if (sourceType === "family_photo" || sourceType === "daycare_photo") return "照片";
  if (sourceType === "family_video") return "视频";
  if (sourceType === "wechat") return "微信";
  if (sourceType === "daycare_note") return "托班老师";
  if (sourceType === "parent_note") return "家庭备注";
  if (sourceType === "growth_measurement") return "成长记录";
  return "资料";
}

function EvidenceText({ text, sourceType }: { text: string; sourceType: SourceType }) {
  const chars = Array.from(text);
  const isLong = chars.length > TEXT_PREVIEW_LIMIT;
  const className = sourceType === "wechat" ? "evidence-quote" : "evidence-note";
  if (!isLong) {
    return <p className={className}>{sourceType === "wechat" ? `"${text}"` : text}</p>;
  }
  const preview = chars.slice(0, TEXT_PREVIEW_LIMIT).join("") + "…";
  return (
    <details className="evidence-text-long">
      <summary className={className}>{sourceType === "wechat" ? `"${preview}"` : preview}</summary>
      <p className={className}>{sourceType === "wechat" ? `"${text}"` : text}</p>
    </details>
  );
}

function EvidenceItem({ source, mediaById, contributorById, deliverableIds }: {
  source: RawSource;
  mediaById: Map<string, Media>;
  contributorById: Map<string, Contributor>;
  deliverableIds?: ReadonlySet<string>;
}) {
  const sourceMedia = source.mediaIds.map((id) => mediaById.get(id)).filter((item): item is Media => Boolean(item));
  const withImages = sourceMedia.filter((item) => isThumbnailEligible(item) && (!deliverableIds || deliverableIds.has(item.id)));
  const withoutImages = sourceMedia.filter((item) => deliverableIds && !deliverableIds.has(item.id));
  const text = presentableEvidenceText(source.text);
  const label = presentableSourceLabel(source.sourceLabel);
  return (
    <article className="evidence-item" key={source.id}>
      <div className="evidence-time">
        <time dateTime={source.capturedAt}>{formatTime(source.capturedAt)}</time>
        <span>{contributorById.get(source.contributorId)?.displayName ?? "家庭"}</span>
      </div>
      <div className="evidence-content">
        <div className="evidence-source"><span>{sourceTypeLabel(source.sourceType)}</span>{label ? <span>{label}</span> : null}</div>
        {text ? <EvidenceText text={text} sourceType={source.sourceType} /> : null}
        {withImages.length > 0 ? (
          <div className="evidence-media">
            {withImages.map((item) => (
              <div className="evidence-media-item" key={item.id}>
                <Image src={item.thumbnailSrc ?? item.src} alt={presentableAlt(item)} fill sizes="(max-width: 700px) 42vw, 220px" style={{ objectFit: "cover" }} />
                <span className="evidence-media-label">{item.type === "video" ? `视频 ${formatDuration(item.durationSeconds)}`.trim() : "照片"}</span>
              </div>
            ))}
          </div>
        ) : null}
        {withoutImages.length > 0 ? (
          <p className="evidence-media-pending">
            {withoutImages.map((item) => item.type === "video" ? `一段视频${item.durationSeconds ? ` ${formatDuration(item.durationSeconds)}` : ""}` : "一张照片").join("、")}，还没整理成可以翻看的样子
          </p>
        ) : null}
      </div>
    </article>
  );
}

// `deliverableIds` absent means every item is treated as deliverable (existing callers/tests).
// `sourceRoles` maps rawSourceId → role from source_memory_links. When present, primary sources
// appear first; supporting/context sources collapse into a secondary disclosure. When absent or
// when no source has a primary role, all sources render as before (no regression for old callers).
export function EvidenceList({ sources, media, contributors, deliverableIds, sourceRoles }: {
  sources: RawSource[];
  media: Media[];
  contributors: Contributor[];
  deliverableIds?: ReadonlySet<string>;
  sourceRoles?: ReadonlyMap<string, "primary" | "supporting" | "context">;
}) {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const contributorById = new Map(contributors.map((item) => [item.id, item]));
  const orderedSources = [...sources].sort((first, second) => first.capturedAt.localeCompare(second.capturedAt));

  const hasPrimary = sourceRoles && orderedSources.some((s) => sourceRoles.get(s.id) === "primary");

  if (!hasPrimary) {
    return (
      <div className="evidence-list">
        {orderedSources.map((source) => (
          <EvidenceItem key={source.id} source={source} mediaById={mediaById} contributorById={contributorById} deliverableIds={deliverableIds} />
        ))}
      </div>
    );
  }

  const primarySources = orderedSources.filter((s) => sourceRoles!.get(s.id) === "primary");
  const secondarySources = orderedSources.filter((s) => sourceRoles!.get(s.id) !== "primary");

  return (
    <div className="evidence-list">
      {primarySources.map((source) => (
        <EvidenceItem key={source.id} source={source} mediaById={mediaById} contributorById={contributorById} deliverableIds={deliverableIds} />
      ))}
      {secondarySources.length > 0 ? (
        <details className="evidence-secondary">
          <summary className="evidence-secondary-label">当天其余资料（{secondarySources.length} 项）</summary>
          {secondarySources.map((source) => (
            <EvidenceItem key={source.id} source={source} mediaById={mediaById} contributorById={contributorById} deliverableIds={deliverableIds} />
          ))}
        </details>
      ) : null}
    </div>
  );
}
