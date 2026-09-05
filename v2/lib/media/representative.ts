import type { MediaRef } from "@/lib/memory-chapters";

// The canonical test for a photo that can stand for 张年 in any cover / card / portrait slot.
// Quark family-album photos (id prefix "media-quark-sha-") come from family members' phone
// albums and reliably have 张年 as the main subject. WeChat group-chat photos (乳儿班 etc.)
// may be vouched for evidence but the subject is often not him.
// This is the single authority for all "representative photo" slots; import it, never re-derive.
export function isPortraitOfZhangnian(media: MediaRef): boolean {
  return media.id.startsWith("media-quark-sha-");
}
