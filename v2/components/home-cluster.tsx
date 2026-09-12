import type { CSSProperties } from "react";
import Link from "next/link";
import { Photo } from "@/components/photo";
import type { MediaRef } from "@/lib/memory-chapters";

// The width lib/media/processing.ts resizes a thumbnail derivative to, `withoutEnlargement`.
const THUMBNAIL_WIDTH = 480;

// The photographs the front page can vouch for, set at the number the archive actually has.
//
// What this replaces (2026-09-12). The block was a fixed-height flex row: one tile at two thirds of
// the width, a column of the rest at one third, every tile `fit="crop"` so it filled that height by
// `object-fit: cover`. That shape assumes three pictures. The archive, after the association rule
// (lib/media/story-binding.ts), hands this block two — and a 480×270 frame forced into a third of
// the width at the full height is cropped to roughly 1:2, which on a phone is a strip of a face
// between two black bands. Measured on the running private site at 391px: 223×220 beside 111×220.
// It is the same failure the November review had one module over (416e38d): a row of equal heights
// cannot hold pictures of unequal proportions without cutting one of them.
//
// So: no shared height, no crop. Each picture keeps its own ratio (`fit="natural"`, which writes
// the image's real aspect-ratio onto the figure once it loads) and the number of columns follows
// the number of pictures.
//
// One picture is a case the old gate refused to draw — it required two, so a front page whose only
// other photograph had gone to the cover story showed no photograph at all below it. One is now
// drawn, and alone in a 760px column it needs a ceiling or it is simply enlarged into the space.
// The ceiling is the file's own width, not a design number: the thumbnail derivative these tiles
// request is `resize({ width: 480, withoutEnlargement: true })` (lib/media/processing.ts), so its
// width is `min(original, 480)` and that is the point past which the browser starts inventing
// pixels. A 240px-wide file therefore stops at 240 rather than being run up to 480.
//
// Nothing here reaches for a picture the archive did not vouch for. The caller passes only stories
// whose `lead` exists, and an empty list draws nothing at all — no heading, no frame, no 「暂无」.
export function HomeCluster({ items }: { items: { id: string; photo: MediaRef }[] }) {
  if (items.length === 0) return null;
  const single = items.length === 1;
  // Only meaningful for the single case, which is the only one whose column is wide enough to
  // enlarge a picture past the derivative it was served.
  const singleMax = single ? `${Math.min(items[0].photo.width || THUMBNAIL_WIDTH, THUMBNAIL_WIDTH)}px` : undefined;
  return <section className="home-cluster reading-wrap" aria-label={single ? "最近的一张照片" : "最近的照片"}>
    <div className="home-cluster-grid" data-count={items.length} style={singleMax ? { "--cluster-single-max": singleMax } as CSSProperties : undefined}>
      {items.map(({ id, photo }) => (
        <Link key={id} href={`/events/${id}`} className="cluster-item">
          <Photo media={photo} variant="thumbnail" sizes={single ? "(max-width: 720px) 100vw, 480px" : "(max-width: 720px) 50vw, 360px"} />
        </Link>
      ))}
    </div>
  </section>;
}
