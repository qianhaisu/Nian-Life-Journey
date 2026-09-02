import Image from "next/image";
import type { Contributor, Media, RawSource, SourceType } from "@/lib/types";
import { presentableEvidenceText, presentableSourceLabel } from "@/lib/organizer/evidence-text";
import { isThumbnailEligible } from "@/lib/media/hero";
import { presentableAlt } from "@/lib/media/presentation";

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

export function EvidenceList({ sources, media, contributors }: { sources: RawSource[]; media: Media[]; contributors: Contributor[] }) {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const contributorById = new Map(contributors.map((item) => [item.id, item]));
  const orderedSources = [...sources].sort((first, second) => first.capturedAt.localeCompare(second.capturedAt));

  return <div className="evidence-list">
    {orderedSources.map((source) => {
      // Display filter only, nothing is deleted: sticker/icon-sized media would be upscaled into a
      // grid cell and read as a broken fragment.
      const sourceMedia = source.mediaIds.map((id) => mediaById.get(id)).filter(isThumbnailEligible);
      // Display text only. The RawSource itself is never modified — see lib/organizer/evidence-text.ts.
      const text = presentableEvidenceText(source.text);
      const label = presentableSourceLabel(source.sourceLabel);
      return <article className="evidence-item" key={source.id}>
        <div className="evidence-time"><time dateTime={source.capturedAt}>{formatTime(source.capturedAt)}</time><span>{contributorById.get(source.contributorId)?.displayName ?? "家庭"}</span></div>
        <div className="evidence-content">
          <div className="evidence-source"><span>{sourceTypeLabel(source.sourceType)}</span>{label ? <span>{label}</span> : null}</div>
          {text ? <p className={source.sourceType === "wechat" ? "evidence-quote" : "evidence-note"}>{source.sourceType === "wechat" ? `“${text}”` : text}</p> : null}
          {sourceMedia.length > 0 ? <div className="evidence-media">
            {sourceMedia.map((item) => <div className="evidence-media-item" key={item.id}>
              <Image src={item.thumbnailSrc ?? item.src} alt={presentableAlt(item)} fill sizes="(max-width: 700px) 42vw, 220px" style={{ objectFit: "cover" }} />
              <span className="evidence-media-label">{item.type === "video" ? `视频 ${formatDuration(item.durationSeconds)}`.trim() : "照片"}</span>
            </div>)}
          </div> : null}
        </div>
      </article>;
    })}
  </div>;
}
