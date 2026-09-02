"use client";

import Image from "next/image";
import { useState } from "react";
import type { MediaRef } from "@/lib/memory-chapters";
import { aspectRatioOf, orientationOf } from "@/lib/media/presentation";

// A photo shown at its own proportions. The box takes the image's aspect ratio, so a portrait
// WeChat photo stands tall instead of being cropped into a landscape slot. Stored dimensions are
// a starting point: once the file loads, its real proportions win, so a wrong record never
// letterboxes a photo. A derivative that fails to load removes itself rather than leaving a frame.
export function Photo({ media, sizes, priority = false, variant = "web", className = "" }: { media: MediaRef; sizes: string; priority?: boolean; variant?: "web" | "thumbnail"; className?: string }) {
  const [failed, setFailed] = useState(false);
  const [actual, setActual] = useState<{ width: number; height: number } | null>(null);
  if (failed) return null;
  const src = variant === "thumbnail" ? media.thumbnailSrc ?? media.src : media.src;
  const width = media.width || 4;
  const height = media.height || 3;
  const shape = actual ? { ...media, ...actual } : media;
  return <figure className={`photo photo-${orientationOf(shape)} ${className}`.trim()} style={{ aspectRatio: aspectRatioOf(shape) }}>
    <Image
      src={src} alt={media.alt} width={width} height={height} sizes={sizes} priority={priority}
      onError={() => setFailed(true)}
      onLoad={(event) => {
        const { naturalWidth, naturalHeight } = event.currentTarget;
        if (naturalWidth && naturalHeight && (naturalWidth !== width || naturalHeight !== height)) setActual({ width: naturalWidth, height: naturalHeight });
      }}
    />
  </figure>;
}
