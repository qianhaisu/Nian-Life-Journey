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
//
// 2026-09-20 起这里还答第二个问题：**这张图够不够看**。可投递不等于值得投递——微信只留下
// 90×120 的那张，派生图管线一切正常，查看器也没请求错变体，但铺到全屏就是十几倍放大的马赛克
// （Teddy 在 /memory/2025/07/24 看到的那张）。规则本身在 lib/media-quality.ts，门槛用的是项目
// 既有的 THUMBNAIL_MIN_SIDE。放在这里是因为这是唯一一道所有阅读面都经过的闸门：家庭档案
// （lib/family-archive.ts，首页/月页/月相册/日页的照片与计数都从它来）、日页的来源材料
// （lib/day-reading.ts）、故事详情页（app/events/[id]）。闸门只有一道，就不会出现首页没有、
// 点进去却有的不一致，也不用在每个组件里各打一个补丁。
//
// 和上面那段一样，它只决定「现在给不给看」：原件、媒体行、故事、来源链接、任何审核决定都不动。
// 回滚 = 把这段代码改回去，没有账本行要撤。月份的章节仍由 familyMedia 决定，所以一个月的照片
// 即便全被挡下，这个月依然在（「withheld is not missing」对画质同样适用）。
import { isTooSmallToDisplay } from "@/lib/media-quality";
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

// 够不够看。三层证据一起交给规则：展示层这一行、资产的源尺寸、以及该资产下每一条派生图的尺寸。
// 取其中最大的短边，所以某一行写着缩略图尺寸、而资产或派生图其实是全尺寸的图不会被误撤——
// 一条陈旧的元数据不该决定一张能救的照片的去留。三处尺寸全不可用时判 unknown，留着不动。
function isBigEnoughToShow(item: Media, asset: MediaAsset, locations: MediaLocation[]): boolean {
  if (asset.mediaType === "video" || item.type !== "photo") return true;
  return !isTooSmallToDisplay({
    type: "photo",
    width: item.width, height: item.height,
    asset: { width: asset.width, height: asset.height },
    locations,
  });
}

// Ids of the media a family page may show and count — 能投递**并且**够大。Built once per request
// from the store the page already loaded; the per-asset location lists are indexed rather than
// re-scanned, because production holds ~4000 locations against ~1150 media.
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
    const locations = locationsByAsset.get(asset.id) ?? [];
    if (isDeliverable(asset, locations) && isBigEnoughToShow(item, asset, locations)) deliverable.add(item.id);
  }
  return deliverable;
}

// The media a family page may show: family-visible AND deliverable. This is the only list that
// should reach a chapter, a strip, a gallery or a count.
export function publishableMedia(input: DeliverabilityInput): Media[] {
  const deliverable = deliverableMediaIds(input);
  return input.media.filter((item) => item.visibility !== "private" && deliverable.has(item.id));
}
