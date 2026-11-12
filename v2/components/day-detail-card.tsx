"use client";

import Image from "next/image";
import { useCallback, useMemo, useState, type CSSProperties } from "react";
import { PhotoGrid } from "@/components/photo-grid";
import { ViewerModal, videoFrameStyle, type GalleryPhoto } from "@/components/photo-viewer";
import { VideoPlayer } from "@/components/video-player";
import { partitionDayPhotos } from "@/lib/day-photo-layout";
import { mediaDeliveryUrl } from "@/lib/media/paths";
import { orientationOf } from "@/lib/media/presentation";
import type { MediaRef } from "@/lib/memory-chapters";
import type { MonthContentDay } from "@/lib/month-content";
import type { TimelineStory } from "@/lib/month-timeline";

function ratioStyleOf(photo: Pick<GalleryPhoto, "width" | "height">): CSSProperties {
  const ar = photo.width > 0 && photo.height > 0 ? photo.width / photo.height : 4 / 3;
  return { "--media-ar": ar } as CSSProperties;
}

function groupAspectOf(photos: readonly GalleryPhoto[]): "landscape" | "square" | "portrait" {
  const stills = photos.filter((item) => item.type !== "video");
  if (stills.length === 0) return "landscape";
  if (stills.every((item) => item.width > item.height * 1.08)) return "landscape";
  if (stills.every((item) => Math.abs(item.width - item.height) <= item.width * 0.08)) return "square";
  return "portrait";
}

function InlineStillFigure({
  photo,
  viewerNumber,
  onOpen,
  single,
  leadInTrio = false,
}: {
  photo: GalleryPhoto;
  viewerNumber: number;
  onOpen: (id: string) => void;
  single: boolean;
  leadInTrio?: boolean;
}) {
  const [useFull, setUseFull] = useState(single || leadInTrio);
  const thumbCandidate = photo.thumbnailSrc
    ?? (photo.src.startsWith("/api/media/") ? mediaDeliveryUrl(photo.id, "thumbnail") : photo.src);
  const src = useFull ? photo.src : thumbCandidate;
  const label = photo.caption
    ? `打开第 ${viewerNumber} 张照片：${photo.caption}`
    : `打开第 ${viewerNumber} 张照片`;

  if (single) {
    return (
      <figure className="day-inline-figure day-inline-figure--single" style={ratioStyleOf(photo)}>
        <div
          className="day-inline-frame day-inline-frame--natural"
          data-media-id={photo.id}
          role="button"
          tabIndex={0}
          aria-label={label}
          onClick={() => onOpen(photo.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(photo.id);
            }
          }}
        >
          <Image
            key={src}
            src={src}
            alt={photo.alt}
            width={photo.width || 1200}
            height={photo.height || 900}
            sizes="(max-width: 700px) calc(100vw - 64px), 744px"
            unoptimized
            className="day-inline-img-natural"
          />
        </div>
        {photo.caption ? <figcaption className="day-media-caption">{photo.caption}</figcaption> : null}
      </figure>
    );
  }

  return (
    <figure className={`day-inline-figure${leadInTrio ? " day-inline-figure--trio-lead" : ""}`} style={ratioStyleOf(photo)}>
      <div
        className="day-inline-frame"
        data-media-id={photo.id}
        role="button"
        tabIndex={0}
        aria-label={label}
        onClick={() => onOpen(photo.id)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onOpen(photo.id);
          }
        }}
      >
        <Image
          key={src}
          src={src}
          alt={photo.alt}
          fill
          sizes={leadInTrio ? "(max-width: 640px) calc(100vw - 64px), 248px" : "(max-width: 640px) 46vw, 360px"}
          unoptimized
          className="day-inline-img-cover"
          onError={() => {
            if (!useFull) setUseFull(true);
          }}
        />
      </div>
      {photo.caption ? <figcaption className="day-media-caption">{photo.caption}</figcaption> : null}
    </figure>
  );
}

function InlineMediaGroup({
  group,
  viewerIndexById,
  onOpenPhoto,
}: {
  group: readonly GalleryPhoto[];
  viewerIndexById: Readonly<Record<string, number>>;
  onOpenPhoto: (id: string) => void;
}) {
  if (group.length === 0) return null;

  if (group.length === 1) {
    const item = group[0];
    if (item.type === "video") {
      return (
        <div className="day-inline-media day-inline-media--1">
          <figure className="day-inline-figure day-inline-figure--single day-inline-video" data-media-id={item.id} style={videoFrameStyle(item)}>
            <VideoPlayer mediaId={item.id} alt={item.alt} durationSeconds={item.durationSeconds} />
            {item.caption ? <figcaption className="day-media-caption">{item.caption}</figcaption> : null}
          </figure>
        </div>
      );
    }
    return (
      <div className="day-inline-media day-inline-media--1">
        <InlineStillFigure
          photo={item}
          viewerNumber={(viewerIndexById[item.id] ?? 0) + 1}
          onOpen={onOpenPhoto}
          single
        />
      </div>
    );
  }

  const aspect = groupAspectOf(group);
  const countVariant = group.length === 2 ? "2" : group.length === 3 ? "3" : "many";

  return (
    <div
      className={`day-inline-media day-inline-grid day-inline-grid--${countVariant}`}
      data-aspect={aspect}
    >
      {group.map((item, idx) => {
        if (item.type === "video") {
          return (
            <figure
              key={item.id}
              className="day-inline-figure day-inline-figure--video-span"
              data-media-id={item.id}
              style={videoFrameStyle(item)}
            >
              <VideoPlayer mediaId={item.id} alt={item.alt} durationSeconds={item.durationSeconds} />
              {item.caption ? <figcaption className="day-media-caption">{item.caption}</figcaption> : null}
            </figure>
          );
        }
        return (
          <InlineStillFigure
            key={item.id}
            photo={item}
            viewerNumber={(viewerIndexById[item.id] ?? 0) + 1}
            onOpen={onOpenPhoto}
            single={false}
            leadInTrio={group.length === 3 && idx === 0}
          />
        );
      })}
    </div>
  );
}

export function DayDetailCard({
  day,
  dateLabel,
  ageLabel,
  ageText,
  title,
  paragraphs,
  photos,
  stories = [],
}: {
  day: MonthContentDay;
  dateLabel: string;
  ageLabel?: string;
  ageText?: string;
  title: string;
  paragraphs: string[];
  photos: MediaRef[];
  stories?: TimelineStory[];
}) {
  const {
    hero,
    paragraphGroups,
    remainingMedia,
    viewerPhotos,
    viewerIndexById,
  } = useMemo(
    () =>
      partitionDayPhotos({
        photos,
        firstScreenMediaIds: day.firstScreenMediaIds,
        paragraphMedia: day.paragraphMedia,
        paragraphCount: paragraphs.length,
        photoCaptions: day.photoCaptions,
      }),
    [photos, day.firstScreenMediaIds, day.paragraphMedia, paragraphs.length, day.photoCaptions],
  );

  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [detectedHeroOrientation, setDetectedHeroOrientation] = useState<"landscape" | "portrait" | "square" | null>(null);

  const openPhoto = useCallback(
    (id: string) => {
      const idx = viewerIndexById[id];
      if (idx !== undefined) setViewerIndex(idx);
    },
    [viewerIndexById],
  );

  const closeViewer = useCallback(() => setViewerIndex(null), []);

  const heroOrientation = hero ? (detectedHeroOrientation ?? orientationOf(hero)) : null;
  const mastheadClass = hero
    ? heroOrientation === "landscape"
      ? "day-detail-masthead day-detail-masthead--hero-stack"
      : "day-detail-masthead day-detail-masthead--hero-side"
    : "day-detail-masthead";

  const heroAriaLabel = hero
    ? hero.caption
      ? `打开第 1 张照片：${hero.caption}`
      : "打开第 1 张照片"
    : undefined;

  return (
    <div className="detail-card reading-wrap">
      <div className={mastheadClass}>
        {hero ? (
          <figure className={`day-hero day-hero--${heroOrientation}`} style={ratioStyleOf(hero)}>
            <div
              className="day-hero-frame"
              data-media-id={hero.id}
              role="button"
              tabIndex={0}
              aria-label={heroAriaLabel}
              onClick={() => openPhoto(hero.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openPhoto(hero.id);
                }
              }}
            >
              <Image
                src={hero.src}
                alt={hero.alt}
                width={hero.width || 1200}
                height={hero.height || 900}
                sizes={
                  heroOrientation === "landscape"
                    ? "(max-width: 760px) calc(100vw - 56px), 744px"
                    : "(max-width: 760px) calc(100vw - 56px), 340px"
                }
                priority
                fetchPriority="high"
                unoptimized
                className="day-hero-img"
                onLoad={(event) => {
                  const img = event.currentTarget;
                  if (img.naturalWidth > 0 && img.naturalHeight > 0) {
                    const actual = orientationOf({ width: img.naturalWidth, height: img.naturalHeight });
                    if (actual !== heroOrientation) setDetectedHeroOrientation(actual);
                  }
                }}
              />
            </div>
            {hero.caption ? <figcaption className="day-media-caption day-hero-caption">{hero.caption}</figcaption> : null}
          </figure>
        ) : null}

        <header className="detail-head">
          <p className="detail-signature day-detail-when">
            <time dateTime={day.day}>{dateLabel}</time>
            {ageText ? <span>{ageText}</span> : null}
          </p>
          <h1 className="serif day-detail-title">{title}</h1>
        </header>
      </div>

      {paragraphs.length > 0 ? (
        <section className="story-layer day-story-section">
          <div className="story-column day-story-flow">
            {paragraphs.map((text, index) => (
              <div className="day-story-block" key={index}>
                <p className="day-story-paragraph">{text}</p>
                {paragraphGroups[index]?.length ? (
                  <InlineMediaGroup
                    group={paragraphGroups[index]}
                    viewerIndexById={viewerIndexById}
                    onOpenPhoto={openPhoto}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {stories.length > 0 ? (
        <section className="story-layer">
          {stories.map((story) => (
            <div className="story-column" key={story.id}>
              {story.title ? <h2 className="serif">{story.title}</h2> : null}
              {story.paragraphs.map((text, index) => (
                <p key={index}>{text}</p>
              ))}
            </div>
          ))}
        </section>
      ) : null}

      {remainingMedia.length > 0 ? (
        <div className="detail-supporting day-detail-photos">
          {remainingMedia.length === 1 ? (
            <InlineMediaGroup
              group={remainingMedia}
              viewerIndexById={viewerIndexById}
              onOpenPhoto={openPhoto}
            />
          ) : (
            <PhotoGrid
              photos={remainingMedia}
              dateLabel={dateLabel}
              ageLabel={ageLabel}
              priority={!hero}
              onSelectPhoto={(photo) => openPhoto(photo.id)}
              photoNumberFor={(photo) => (viewerIndexById[photo.id] ?? 0) + 1}
            />
          )}
        </div>
      ) : null}

      {viewerIndex !== null && viewerPhotos.length > 0 ? (
        <ViewerModal
          photos={viewerPhotos}
          startIndex={viewerIndex}
          dateLabel={dateLabel}
          ageLabel={ageLabel}
          captions={day.photoCaptions}
          onClose={closeViewer}
        />
      ) : null}
    </div>
  );
}
