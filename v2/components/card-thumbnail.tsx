"use client";

import Image from "next/image";
import { useState } from "react";
import type { ThumbnailChoice } from "@/lib/day-photo-layout";

export function CardThumbnail({
  thumbnail,
  className,
  sizes = "64px",
}: {
  thumbnail: ThumbnailChoice;
  className: string;
  sizes?: string;
}) {
  const [useFallback, setUseFallback] = useState(false);
  const src = useFallback && thumbnail.fallbackSrc ? thumbnail.fallbackSrc : thumbnail.src;

  return (
    <span className={className} aria-hidden="true">
      <Image
        key={src}
        src={src}
        alt=""
        fill
        sizes={sizes}
        unoptimized
        style={{ objectFit: "cover", objectPosition: "50% 25%" }}
        onError={() => {
          if (!useFallback && thumbnail.fallbackSrc) setUseFallback(true);
        }}
      />
    </span>
  );
}
