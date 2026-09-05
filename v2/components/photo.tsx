"use client";

import Image from "next/image";
import { useState } from "react";
import type { MediaRef } from "@/lib/memory-chapters";
import { aspectRatioOf, orientationOf } from "@/lib/media/presentation";
import { mediaDeliveryUrl } from "@/lib/media/paths";

// A photo shown at its own proportions. The box takes the image's aspect ratio, so a portrait
// WeChat photo stands tall instead of being cropped into a landscape slot. Stored dimensions are
// a starting point: once the file loads, its real proportions win, so a wrong record never
// letterboxes a photo.
//
// Asking for a thumbnail gets a thumbnail. `media.thumbnailSrc` is null on every row the WeChat
// importer wrote, and reading `thumbnailSrc ?? src` quietly served the full web derivative
// instead — 191 KB where 25 KB was asked for, and the month archive opened 225 of them at once,
// ~43 MB, which is why it hung for over half a minute. The thumbnail derivative exists in storage
// (media_locations: 3,014 hot/thumbnail rows are ready), so the URL is derived from the id rather
// than trusted to a column nothing fills.
//
// Falling back is two steps, not one: a missing thumbnail derivative drops to the web variant, and
// only a photo that fails at full size removes itself. Disappearing on the first 404 would have
// hidden the ~185 pictures that have no thumbnail row.
//
// `fit` picks which of two shapes a photo takes, decided by the API rather than by CSS specificity
// (B-16: an inline `aspectRatio` on the figure once outranked a card's fixed-height rule and blew a
// 610px hole in the /memory index). "natural" (default) sizes the box to the photo's own ratio — a
// portrait WeChat photo stands tall, nothing is cropped. "crop" is for a caller-owned fixed-height
// slot (a month card cover, a home cluster tile): no aspect-ratio is written, the image fills the
// slot's own height via CSS `object-fit: cover`.
export function Photo({ media, sizes, priority = false, variant = "web", fit = "natural", className = "" }: { media: MediaRef; sizes: string; priority?: boolean; variant?: "web" | "thumbnail"; fit?: "natural" | "crop"; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  const [actual, setActual] = useState<{ width: number; height: number } | null>(null);
  const shape = actual ? { ...media, ...actual } : media;
  const figureClassName = `photo photo-${orientationOf(shape)}${fit === "crop" ? " photo-crop" : ""} ${className}`.trim();
  const figureStyle = fit === "crop" ? undefined : { aspectRatio: aspectRatioOf(shape) };
  // Final fallback: Next optimizer timed out or the derivative is missing — serve the thumbnail
  // directly (bypasses optimizer) so the slot never goes blank. Use stored metadata for shape since
  // no successful load occurred.
  if (failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <figure className={figureClassName} style={figureStyle}><img src={mediaDeliveryUrl(media.id, "thumbnail")} alt={media.alt} /></figure>;
  }
  const wantsThumbnail = variant === "thumbnail" && !fullSize;
  const src = wantsThumbnail ? media.thumbnailSrc ?? mediaDeliveryUrl(media.id, "thumbnail") : media.src;
  const width = media.width || 4;
  const height = media.height || 3;
  return <figure className={figureClassName} style={figureStyle}>
    <Image
      key={src}
      src={src} alt={media.alt} width={width} height={height} sizes={sizes} priority={priority}
      onError={() => (wantsThumbnail ? setFullSize(true) : setFailed(true))}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight && (naturalWidth !== width || naturalHeight !== height)) setActual({ width: naturalWidth, height: naturalHeight });
      }}
    />
  </figure>;
}
