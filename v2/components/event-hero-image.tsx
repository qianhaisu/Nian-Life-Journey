"use client";

import Image from "next/image";
import { useState } from "react";
import type { Media } from "@/lib/types";

// `candidates` is already dimension-filtered and preference-ordered by heroCandidates() — this
// component's only job is to fall through to the next one if a "should be fine" candidate still
// 404s at the image level (e.g. dimensions look right but the derivative was never stored).
export function EventHeroImage({ candidates }: { candidates: Media[] }) {
  const [failedIds, setFailedIds] = useState<Set<string>>(() => new Set());
  const hero = candidates.find((item) => !failedIds.has(item.id));
  if (!hero) return null;
  return <div className="wide-wrap detail-lead">
    <div className="detail-lead-image">
      <Image key={hero.id} src={hero.src} alt={hero.alt} fill priority sizes="(max-width: 700px) 100vw, 75vw" style={{ objectFit: "cover" }}
        onError={() => setFailedIds((current) => current.has(hero.id) ? current : new Set(current).add(hero.id))} />
    </div>
  </div>;
}
