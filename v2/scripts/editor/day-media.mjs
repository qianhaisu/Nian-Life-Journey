// 一天展示哪些照片和视频（2026-09-23 第四轮，Teddy：重写时每天的媒体要从库里重新汇总，不能只沿用旧清单）。纯函数。
//
// 候选 = 这一天所有已入库、活着的媒体（包括补上传的图、有了封面和预览的视频、换成高清原图的照片）。
// 只收判定放行的（画面里有张年、或和他当天的生活直接相关；敏感信息规则照旧；拿不准的不收）——判定本身在
// 调用方（deepseek-flash 看图 → decidePhoto + decideSensitivePhoto），这里只排。
// 顺序：按拍摄时间；首屏 6 格，当天有视频时至少放一个视频进首屏。

export const FIRST_SCREEN_SLOTS = 6;
export const MAX_DAY_MEDIA = 60;

/**
 * @param {{id:string, type:"photo"|"video", takenAt:string, allowed:boolean}[]} items
 * @returns {{expandedMediaIds:string[], firstScreenMediaIds:string[]}}
 */
export function aggregateDayMedia(items, { firstScreen = FIRST_SCREEN_SLOTS, max = MAX_DAY_MEDIA } = {}) {
  const seen = new Set();
  const ok = items.filter((m) => m.allowed && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id))
    .slice(0, max);
  const expanded = ok.map((m) => m.id);
  let first = ok.slice(0, firstScreen);
  const video = ok.find((m) => m.type === "video");
  if (video && !first.some((m) => m.type === "video")) {
    first = [...first.slice(0, Math.max(0, firstScreen - 1)), video].sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
  }
  // 首屏必须是展开清单的子集；页面按展开清单的顺序排，首屏放在最前面。
  const firstIds = first.map((m) => m.id);
  return { expandedMediaIds: [...firstIds, ...expanded.filter((id) => !firstIds.includes(id))], firstScreenMediaIds: firstIds };
}
