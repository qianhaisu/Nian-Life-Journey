import type { MediaVariant } from "@/lib/types";

export function mediaDeliveryUrl(mediaId: string, variant: MediaVariant) {
  return `/api/media/${mediaId}?variant=${variant}`;
}

export function normalizeMediaUrl(src: string) {
  return src;
}
