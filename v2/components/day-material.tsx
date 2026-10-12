import Image from "next/image";
import type { Media, RawSource, SourceType } from "@/lib/types";
import { presentableEvidenceText, presentableSourceLabel } from "@/lib/organizer/evidence-text";
import { isThumbnailEligible } from "@/lib/media/hero";
import { presentableAlt } from "@/lib/media/presentation";
import { shanghaiClock } from "@/lib/shanghai-time";

// 「当时留下的资料」 for an edited day: one disclosure, everything inside it, in time order.
//
// What changed and why. The older list (components/evidence-list.tsx) split itself into the
// story's own sources and a nested 「当天其余资料」, so a reader who opened the material still had
// a second, differently-named fold to find — and the split was drawn from source_memory_links
// roles, which say how the Organizer used a message, not anything a family would recognise. A day
// left behind one set of things; this shows that set, once.
//
// Long messages are NOT truncated behind another fold. The previous list cut at 120 characters and
// put the rest inside a nested <details>, which meant a third click to read one sentence. They wrap.

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

export function DayMaterial({ sources, media, speakerBySourceId, deliverableIds }: {
  sources: RawSource[];
  media: Media[];
  /** source id → what to call the person. Absent ids get no name rather than a wrong one. */
  speakerBySourceId?: Record<string, string>;
  deliverableIds?: ReadonlySet<string>;
}) {
  const mediaById = new Map(media.map((item) => [item.id, item]));
  // Time order, and de-duplicated on identity: the same message can be cited by more than one of a
  // day's merged stories, and the reader should meet it once.
  const seen = new Set<string>();
  const ordered = [...sources]
    .filter((source) => (seen.has(source.id) ? false : (seen.add(source.id), true)))
    .sort((first, second) => first.capturedAt.localeCompare(second.capturedAt));
  if (ordered.length === 0) return null;

  return (
    <details className="evidence-disclosure reading-wrap day-material">
      <summary><span className="serif">当时留下的资料</span></summary>
      <div className="evidence-list">
        {ordered.map((source) => {
          const sourceMedia = source.mediaIds.map((id) => mediaById.get(id)).filter((item): item is Media => Boolean(item));
          const withImages = sourceMedia.filter((item) => isThumbnailEligible(item) && (!deliverableIds || deliverableIds.has(item.id)));
          const withoutImages = sourceMedia.filter((item) => deliverableIds && !deliverableIds.has(item.id));
          const text = presentableEvidenceText(source.text);
          const label = presentableSourceLabel(source.sourceLabel);
          const speaker = speakerBySourceId?.[source.id];
          // capturedAt is a real instant (timestamptz). It is formatted in Asia/Shanghai, never by
          // adding eight hours to whatever the server thinks the time is — see lib/shanghai-time.ts.
          const clock = shanghaiClock(source.capturedAt);
          return (
            <article className="evidence-item" key={source.id}>
              <div className="evidence-time">
                <time dateTime={source.capturedAt}>{clock}</time>
                {speaker ? <span>{speaker}</span> : null}
              </div>
              <div className="evidence-content">
                <div className="evidence-source"><span>{sourceTypeLabel(source.sourceType)}</span>{label ? <span>{label}</span> : null}</div>
                {text ? <p className={source.sourceType === "wechat" ? "evidence-quote" : "evidence-note"}>{source.sourceType === "wechat" ? `"${text}"` : text}</p> : null}
                {withImages.length > 0 ? (
                  <div className="evidence-media">
                    {withImages.map((item) => (
                      <div className="evidence-media-item" key={item.id}>
                        <Image src={item.thumbnailSrc ?? item.src} alt={presentableAlt(item)} fill sizes="(max-width: 700px) 42vw, 220px" style={{ objectFit: "cover" }} unoptimized />
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
        })}
      </div>
    </details>
  );
}
