import type { MediaRef } from "@/lib/memory-chapters";

// WHAT THIS TESTS: where a picture came from. Nothing else.
//
// A `media-quark-sha-` id means the row was imported from the family's own Quark photo album —
// somebody's phone camera roll — rather than from a WeChat conversation. That is a useful weak
// preference for a cover slot, because a group chat carries other people's children, screenshots,
// receipts and forwarded articles, and a camera roll mostly does not.
//
// WHAT IT DOES NOT TEST: whether 张年 is in the picture.
//
// It was called `isPortraitOfZhangnian` and documented as "the canonical test for a photo that can
// stand for 张年", which read as a claim about the subject and was acted on as one. It is not. On
// 2026-09-11 the 11 月 1 日 entry was led, full width, by a photograph of a white cat on a bench —
// a real family-album photograph, correctly imported, with no child in it, promoted because the
// name of this function said it was a portrait of him.
//
// Renamed to what it actually answers. The call sites keep it as the source preference it has
// always been; none of them may present its answer as "he is in this picture". Deciding that needs
// something this archive does not have and is not building here.
export function isFromFamilyAlbum(media: MediaRef): boolean {
  return media.id.startsWith("media-quark-sha-");
}
