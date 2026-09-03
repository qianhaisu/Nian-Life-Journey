import type { MediaRef } from "@/lib/memory-chapters";
import type { SequenceLayout } from "@/lib/media/presentation";
import { Photo } from "@/components/photo";

// A month's representative photos: three to five, each at its own proportions, in one row that
// wraps on narrow screens. Never a hero, never a grid of everything.
export function PhotoStrip({ photos, sizes = "(max-width: 700px) 46vw, 260px", priority = false }: { photos: MediaRef[]; sizes?: string; priority?: boolean }) {
  if (photos.length === 0) return null;
  return <div className={`photo-strip photo-strip-${Math.min(photos.length, 5)}`}>
    {photos.map((media, index) => <Photo media={media} variant="thumbnail" sizes={sizes} priority={priority && index === 0} key={media.id} />)}
  </div>;
}

// The photos of one memory laid out by count: one stands alone, three sit together, up to eight
// spread across the page, more than that become a contact sheet. Anything past the layout's limit
// stays reachable through the evidence disclosure below the story.
export type SequenceView = { layout: SequenceLayout; shown: MediaRef[]; remaining: number };

export function MediaSequence({ sequence, title }: { sequence: SequenceView; title: string }) {
  if (sequence.shown.length === 0) return null;
  const [lead, ...rest] = sequence.shown;
  return <div className={`media-sequence media-sequence-${sequence.layout}`}>
    <Photo media={lead} priority sizes={sequence.layout === "single" ? "(max-width: 700px) 100vw, 1120px" : "(max-width: 700px) 100vw, 760px"} className="sequence-lead" />
    {rest.length > 0 ? <div className="sequence-rest">{rest.map((media) => <Photo media={media} variant={sequence.layout === "contact" ? "thumbnail" : "web"} sizes={sequence.layout === "contact" ? "(max-width: 700px) 30vw, 200px" : "(max-width: 700px) 100vw, 520px"} key={media.id} />)}</div> : null}
    {sequence.remaining > 0 ? <p className="sequence-more">{title}那天还有 {sequence.remaining} 张照片，收在下面的资料里。</p> : null}
  </div>;
}
