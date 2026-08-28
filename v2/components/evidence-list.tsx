import Image from "next/image";
import type { Media, RawSource, SourceType } from "@/lib/types";

function formatTime(value: string) {
  return new Intl.DateTimeFormat("zh-CN", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDuration(seconds?: number) {
  if (!seconds) return "";
  return `00:${String(seconds).padStart(2, "0")}`;
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

export function EvidenceList({ sources, media }: { sources: RawSource[]; media: Media[] }) {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  const orderedSources = [...sources].sort((first, second) => first.capturedAt.localeCompare(second.capturedAt));

  return <div className="evidence-list">
    {orderedSources.map((source) => {
      const sourceMedia = source.mediaIds.map((id) => mediaById.get(id)).filter((item): item is Media => Boolean(item));
      return <article className="evidence-item" key={source.id}>
        <div className="evidence-time"><time dateTime={source.capturedAt}>{formatTime(source.capturedAt)}</time><span>{source.authorLabel}</span></div>
        <div className="evidence-content">
          <div className="evidence-source"><span>{sourceTypeLabel(source.sourceType)}</span><span>{source.sourceLabel}</span></div>
          {source.text ? <p className={source.sourceType === "wechat" ? "evidence-quote" : "evidence-note"}>{source.sourceType === "wechat" ? `“${source.text}”` : source.text}</p> : null}
          {sourceMedia.length > 0 ? <div className="evidence-media">
            {sourceMedia.map((item) => <div className="evidence-media-item" key={item.id}>
              <Image src={item.src} alt={item.alt} fill sizes="(max-width: 700px) 42vw, 220px" style={{ objectFit: "cover" }} />
              <span className="evidence-media-label">{item.type === "video" ? `Video · ${formatDuration(item.durationSeconds)}` : "Photo"}</span>
            </div>)}
          </div> : null}
        </div>
      </article>;
    })}
  </div>;
}
