import type { MediaRef } from "@/lib/memory-chapters";
import { Photo } from "@/components/photo";

// A few representative photos: each at its own proportions, in one row that wraps on narrow
// screens. Never a hero, never a grid of everything.
export function PhotoStrip({ photos, sizes = "(max-width: 700px) 46vw, 260px", priority = false }: { photos: MediaRef[]; sizes?: string; priority?: boolean }) {
  if (photos.length === 0) return null;
  return <div className={`photo-strip photo-strip-${Math.min(photos.length, 5)}`}>
    {photos.map((media, index) => <Photo media={media} variant="thumbnail" sizes={sizes} priority={priority && index === 0} key={media.id} />)}
  </div>;
}
