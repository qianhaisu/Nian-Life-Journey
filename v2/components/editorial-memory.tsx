import Link from "next/link";
import type { EditorialMemory as Memory } from "@/lib/memory-chapters";
import { Photo } from "@/components/photo";
import { PhotoGallery } from "@/components/photo-viewer";
import { TimeSignature } from "@/components/time-signature";
import { orientationOf } from "@/lib/media/presentation";

// One memory as it appears in a chapter or on the front page. `lead` is the single most recent
// memory on the home page; `entry` is a chapter entry; `line` is a title-only index row.
//
// T20-A1 (Cowork, 2026-09-04): T16 V1 only suppressed DayHead's repeated age label — the bigger
// repeat was here. Inside a month page a memory sits directly under DayHead's own "7 月 1 日 · 1
// 岁 5 个月", so this component's own TimeSignature restated the exact same date+age a second time
// — that's where 184 of the month's repeats actually came from, not DayHead. `showSignature` lets
// the month page (components/month-moment.tsx) suppress it; the home page lead and the event
// detail page have no DayHead above them, so they keep it (the default stays true).
//
// `photos="story"` (图文衔接, 2026-09-13) is the month page's reading of a story: its words first,
// then EVERY photograph a person approved for it (memory.storyPhotos), sized by what each picture is
// rather than stamped into one cover slot — a single landscape runs the text measure, a single
// portrait stands narrow beside the words on a wide screen, two or more sit as a pair grid. Tapping
// opens the site's viewer. A story with no approved photograph is words only; nothing is borrowed.
export function EditorialMemory({ memory, size = "entry", priority = false, showSignature = true, photos = "lead" }: { memory: Memory; size?: "lead" | "entry" | "line"; priority?: boolean; showSignature?: boolean; photos?: "lead" | "story" }) {
  const href = `/events/${memory.id}`;
  if (size === "line") {
    return <li className="memory-line"><Link href={href}><time dateTime={memory.signature.day}>{memory.signature.dateLabel}</time><span className="serif">{memory.title}</span></Link></li>;
  }
  const copy = <div className="memory-copy">
    {showSignature ? <TimeSignature signature={memory.signature} /> : null}
    <h3 className="serif"><Link href={href}>{memory.title}</Link></h3>
    {memory.excerpt ? <p>{memory.excerpt}</p> : null}
  </div>;
  if (photos === "story") {
    const storyPhotos = memory.storyPhotos ?? (memory.lead ? [memory.lead] : []);
    const shape = storyPhotos.length === 1 ? ` memory-photo-${orientationOf(storyPhotos[0])}` : storyPhotos.length > 1 ? " memory-photo-set" : "";
    return <article className={`memory memory-${size} memory-weight-${memory.weight} memory-story${shape}`}>
      {copy}
      {storyPhotos.length > 0 ? <div className="memory-story-photos">
        <PhotoGallery
          photos={storyPhotos}
          heroIndex={storyPhotos.length === 1 ? 0 : undefined}
          heroClassName="memory-story-photo"
          dateLabel={memory.signature.dateLabel}
          ageLabel={memory.signature.ageLabel}
          priority={priority}
          heroSizes="(max-width: 700px) 100vw, 600px"
          stripSizes="(max-width: 700px) 50vw, 300px"
        />
      </div> : null}
    </article>;
  }
  // T20-C: a "memory"-weight entry (a real chapter, not just an ordinary day) reads its lead photo
  // at the same resolution as the page's single lead, not the smaller thumbnail every other entry
  // gets — the visual weight has to match the editorial weight, not just the headline size.
  const isChapterWeight = size === "lead" || memory.weight === "memory" || memory.weight === "chapter" || memory.weight === "highlight";
  return <article className={`memory memory-${size} memory-weight-${memory.weight}`}>
    {memory.lead ? <Link href={href} className="memory-photo" tabIndex={-1} aria-hidden="true"><Photo media={memory.lead} priority={priority} variant={isChapterWeight ? "web" : "thumbnail"} sizes={isChapterWeight ? "(max-width: 700px) 100vw, 760px" : "(max-width: 700px) 100vw, 520px"} /></Link> : null}
    {copy}
  </article>;
}
