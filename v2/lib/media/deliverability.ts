// Whether a Media row can actually be shown to the family right now.
//
// `visibility: "family"` says the household is allowed to see a picture. It does not say the
// picture can be delivered. Page images are served by app/api/media/[id], which is Hot Storage
// only: it resolves a location through selectLocation() and answers 404 ("Media derivative is not
// ready") when no `hot` derivative for the wanted variant is `ready`. The <Photo> component then
// removes itself on error — so an undeliverable row draws no broken frame, it silently vanishes.
//
// That silence is exactly why publication surfaces must filter on delivery rather than trust
// visibility: a month page would otherwise print "127 张照片" above 108 of them, and a strip of
// five would come out as three. A count the family can see must be a count of things they can see.
//
// Nothing here deletes, downgrades or rewrites a row. Media whose derivatives are still missing
// stay in the archive untouched and simply are not published yet — in production that is 164 of
// 1153 rows, including all 121 videos, whose poster derivative has never been generated.
import { selectLocation } from "@/lib/storage/hot-storage";
import type { Media, MediaAsset, MediaLocation } from "@/lib/types";

export type DeliverabilityInput = { media: Media[]; mediaAssets: MediaAsset[]; mediaLocations: MediaLocation[] };

// The variants a page can actually request for a given asset. Photos are shown through `web` or
// `thumbnail`; a video is only ever shown through its poster (there is no inline player on a
// family page). `original` is never a page URL — it is an authenticated connector workflow.
function isDeliverable(asset: MediaAsset, locations: MediaLocation[]): boolean {
  if (asset.mediaType === "video") return Boolean(selectLocation(locations, asset, "poster"));
  return Boolean(selectLocation(locations, asset, "web") ?? selectLocation(locations, asset, "thumbnail"));
}

// Ids of the media a family page may show and count. Built once per request from the store the
// page already loaded; the per-asset location lists are indexed rather than re-scanned, because
// production holds ~4000 locations against ~1150 media.
export function deliverableMediaIds({ media, mediaAssets, mediaLocations }: DeliverabilityInput): Set<string> {
  const assetById = new Map(mediaAssets.map((asset) => [asset.id, asset]));
  const locationsByAsset = new Map<string, MediaLocation[]>();
  for (const location of mediaLocations) {
    const bucket = locationsByAsset.get(location.mediaAssetId);
    if (bucket) bucket.push(location);
    else locationsByAsset.set(location.mediaAssetId, [location]);
  }
  const deliverable = new Set<string>();
  for (const item of media) {
    if (!item.mediaAssetId) continue;
    const asset = assetById.get(item.mediaAssetId);
    if (!asset) continue;
    if (isDeliverable(asset, locationsByAsset.get(asset.id) ?? [])) deliverable.add(item.id);
  }
  return deliverable;
}

// The media a family page may show: family-visible AND deliverable. This is the only list that
// should reach a chapter, a strip, a gallery or a count.
export function publishableMedia(input: DeliverabilityInput): Media[] {
  const deliverable = deliverableMediaIds(input);
  return input.media.filter((item) => item.visibility !== "private" && deliverable.has(item.id));
}
