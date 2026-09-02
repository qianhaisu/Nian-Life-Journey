import Link from "next/link";
import type { EditorialMemory as Memory } from "@/lib/memory-chapters";
import { Photo } from "@/components/photo";
import { TimeSignature } from "@/components/time-signature";

// One memory as it appears in a chapter or on the front page. `lead` is the single most recent
// memory on the home page; `entry` is a chapter entry; `line` is a title-only index row.
export function EditorialMemory({ memory, size = "entry", priority = false }: { memory: Memory; size?: "lead" | "entry" | "line"; priority?: boolean }) {
  const href = `/events/${memory.id}`;
  if (size === "line") {
    return <li className="memory-line"><Link href={href}><time dateTime={memory.signature.day}>{memory.signature.dateLabel}</time><span className="serif">{memory.title}</span></Link></li>;
  }
  return <article className={`memory memory-${size} memory-weight-${memory.weight}`}>
    {memory.lead ? <Link href={href} className="memory-photo" tabIndex={-1} aria-hidden="true"><Photo media={memory.lead} priority={priority} variant={size === "lead" ? "web" : "thumbnail"} sizes={size === "lead" ? "(max-width: 700px) 100vw, 760px" : "(max-width: 700px) 100vw, 520px"} /></Link> : null}
    <div className="memory-copy">
      <TimeSignature signature={memory.signature} />
      <h3 className="serif"><Link href={href}>{memory.title}</Link></h3>
      {memory.excerpt ? <p>{memory.excerpt}</p> : null}
    </div>
  </article>;
}
