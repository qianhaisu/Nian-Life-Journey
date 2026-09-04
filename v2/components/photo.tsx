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
export function Photo({ media, sizes, priority = false, variant = "web", className = "" }: { media: MediaRef; sizes: string; priority?: boolean; variant?: "web" | "thumbnail"; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [fullSize, setFullSize] = useState(false);
  const [actual, setActual] = useState<{ width: number; height: number } | null>(null);
  if (failed) return null;
  const wantsThumbnail = variant === "thumbnail" && !fullSize;
  const src = wantsThumbnail ? media.thumbnailSrc ?? mediaDeliveryUrl(media.id, "thumbnail") : media.src;
  const width = media.width || 4;
  const height = media.height || 3;
  const shape = actual ? { ...media, ...actual } : media;
  return <figure className={`photo photo-${orientationOf(shape)} ${className}`.trim()} style={{ aspectRatio: aspectRatioOf(shape) }}>
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
