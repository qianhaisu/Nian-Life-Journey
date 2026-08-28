import Image from "next/image";
import type { Media } from "@/lib/types";
export function MediaGrid({ items }: { items: Media[] }) { return <div className="media-grid">{items.map((item, index) => <div className={`media-tile media-${index + 1}`} key={item.id}><Image src={item.thumbnailSrc ?? item.src} alt={item.alt} fill sizes="(max-width: 700px) 50vw, 220px" style={{ objectFit: "cover" }} /></div>)}</div>; }
