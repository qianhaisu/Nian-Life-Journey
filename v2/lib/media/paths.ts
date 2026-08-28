import type { MediaVariant } from "@/lib/types";

const appBasePath = "/v2";

export function mediaDeliveryUrl(mediaId: string, variant: MediaVariant) {
  return `${appBasePath}/api/media/${mediaId}?variant=${variant}`;
}

export function normalizeMediaUrl(src: string) {
  return src.startsWith("/api/media/") ? `${appBasePath}${src}` : src;
}
