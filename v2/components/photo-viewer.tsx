"use client";

import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback, useState, type CSSProperties } from "react";
import { orientationOf, aspectRatioOf } from "@/lib/media/presentation";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import { VideoPlayer } from "@/components/video-player";

// Subset of MediaRef — pass MediaRef directly; all fields are present there.
export type GalleryPhoto = {
  id: string;
  src: string;
  thumbnailSrc?: string | null;
  alt: string;
  width: number;
  height: number;
  /** Optional scene caption displayed inline and at the bottom of the lightbox viewer. */
  caption?: string;
  // "video" gets a player instead of a picture. Optional so every existing caller that hands over a
  // list of photographs keeps working untouched.
  type?: string;
  durationSeconds?: number | null;
  posterSrc?: string | null;
};

// A video is not opened in the photo viewer: the viewer is a zoomable still reel, and a clip that
// stopped being playable the moment you tapped it would be a worse answer than the frame it
// replaced. It plays where it sits, with its own controls.
const isVideo = (item: GalleryPhoto) => item.type === "video";

// A clip's box keeps its own proportions, and also hands them to CSS as a number (--media-ar) so a
// layout that shows it large can narrow a tall one to fit the screen's height without cropping —
// aspect-ratio alone cannot be read back into a width. See .detail-supporting in app/globals.css.
export function videoFrameStyle(item: Pick<GalleryPhoto, "width" | "height">): CSSProperties {
  const ratio = aspectRatioOf(item);
  return ratio ? ({ aspectRatio: ratio, "--media-ar": ratio } as CSSProperties) : {};
}

// Full-screen viewer: scroll-snap reel + double-tap zoom + keyboard nav + back-button close.
//
// Exported (2026-09-13) so the front page's cover can open the SAME viewer rather than growing a
// second one of its own. The cover is a fixed, cropped frame with its own caption and 换张照片
// button, so it cannot use PhotoGallery's hero — but 「打开原比例」 has to mean exactly what it
// means everywhere else on the site: this reel, this zoom, this back-button behaviour.
export const ViewerModal = dynamic(
  () => import("./photo-viewer-modal").then((mod) => mod.ViewerModal),
  { ssr: false },
);

// Renders a set of photos with a click-to-view full-screen viewer.
// - heroIndex: which photo to show at full editorial width (others go in a strip below it).
// - heroClassName: CSS class(es) applied to the hero figure (e.g. "moment-hero").
// - dateLabel / ageLabel: shown in the viewer header (原则二: 两个时钟并存).
export function PhotoGallery({
  photos,
  heroIndex,
  heroClassName = "",
  dateLabel,
  ageLabel,
  priority = false,
  heroSizes = "(max-width: 700px) 100vw, 760px",
  stripSizes = "(max-width: 700px) 46vw, 260px",
}: {
  photos: GalleryPhoto[];
  heroIndex?: number;
  heroClassName?: string;
  dateLabel: string;
  ageLabel?: string;
  priority?: boolean;
  heroSizes?: string;
  stripSizes?: string;
}) {
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const openViewer = useCallback((idx: number) => setViewerIndex(idx), []);
  const closeViewer = useCallback(() => setViewerIndex(null), []);

  if (photos.length === 0) return null;

  const heroPhoto = heroIndex !== undefined ? photos[heroIndex] : undefined;
  const stripPhotos = heroPhoto ? photos.filter((_, i) => i !== heroIndex) : photos;
  // Viewer order: hero first (index 0), then strip order
  const viewerPhotos = (heroPhoto ? [heroPhoto, ...stripPhotos] : photos).filter((item) => !isVideo(item));

  // Straight lookup into the reel's own list rather than arithmetic over the original one: with
  // videos filtered out of the reel, any offset-based mapping would open the wrong picture as soon
  // as a clip sat before a photograph on the same day.
  function viewerIdxFor(originalIdx: number): number {
    return Math.max(0, viewerPhotos.indexOf(photos[originalIdx]));
  }

  // PAGE-0915-FULL-REMEDIATION-R1 B4：一个相册里好几张照片时，每张的可访问名称都是同一句「打开
  // 照片」——屏幕阅读器一个一个读过去分不清是哪张。`alt` 常常也是同一句通用描述（没有专门写的
  // alt 时落到「一张照片」，lib/media/presentation.ts 的 presentableAlt），不够用来区分。用打开
  // 后会看到的第几张（跟查看器自己的「1 / 6」计数一致）作为可靠的区分依据。
  function photoAriaLabel(originalIdx: number): string {
    return `打开第 ${viewerIdxFor(originalIdx) + 1} 张照片`;
  }

  return (
    <>
      {heroPhoto && isVideo(heroPhoto) ? (
        <figure className={`photo photo-video photo-${orientationOf(heroPhoto)} ${heroClassName}`.trim()} style={videoFrameStyle(heroPhoto)}>
          <VideoPlayer mediaId={heroPhoto.id} alt={heroPhoto.alt} durationSeconds={heroPhoto.durationSeconds} />
        </figure>
      ) : null}

      {heroPhoto && !isVideo(heroPhoto) ? (
        <figure
          className={`photo photo-${orientationOf(heroPhoto)} ${heroClassName}`.trim()}
          style={{ aspectRatio: aspectRatioOf(heroPhoto) }}
          role="button"
          tabIndex={0}
          aria-label={photoAriaLabel(heroIndex!)}
          onClick={() => openViewer(viewerIdxFor(heroIndex!))}
          onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(viewerIdxFor(heroIndex!)); } }}
        >
          <Image src={heroPhoto.src} alt={heroPhoto.alt} width={heroPhoto.width || 4} height={heroPhoto.height || 3} sizes={heroSizes} priority={priority} unoptimized />
        </figure>
      ) : null}

      {stripPhotos.length > 0 ? (
        <div className={`photo-strip photo-strip-${Math.min(stripPhotos.length, 5)}`}>
          {stripPhotos.map((photo, si) => {
            const origIdx = heroPhoto ? photos.indexOf(photo) : si;
            if (isVideo(photo)) {
              return (
                <figure key={photo.id} className={`photo photo-video photo-${orientationOf(photo)}`} style={videoFrameStyle(photo)}>
                  <VideoPlayer mediaId={photo.id} alt={photo.alt} durationSeconds={photo.durationSeconds} />
                </figure>
              );
            }
            return (
              <figure
                key={photo.id}
                className={`photo photo-${orientationOf(photo)}`}
                style={{ aspectRatio: aspectRatioOf(photo) }}
                role="button"
                tabIndex={0}
                aria-label={photoAriaLabel(origIdx)}
                onClick={() => openViewer(viewerIdxFor(origIdx))}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openViewer(viewerIdxFor(origIdx)); } }}
              >
                <Image
                  src={photo.thumbnailSrc ?? mediaDeliveryUrl(photo.id, "thumbnail")}
                  alt={photo.alt}
                  width={photo.width || 4}
                  height={photo.height || 3}
                  sizes={stripSizes}
                  priority={priority && si === 0 && !heroPhoto}
                  unoptimized
                />
              </figure>
            );
          })}
        </div>
      ) : null}

      {viewerIndex !== null ? (
        <ViewerModal
          photos={viewerPhotos}
          startIndex={viewerIndex}
          dateLabel={dateLabel}
          ageLabel={ageLabel}
          onClose={closeViewer}
        />
      ) : null}
    </>
  );
}
