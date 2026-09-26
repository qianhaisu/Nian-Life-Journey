// 一天展示哪些照片和视频（2026-09-23 第四轮，Teddy：重写时每天的媒体要从库里重新汇总，不能只沿用旧清单）。纯函数。
//
// 候选 = 这一天所有已入库、活着的媒体（包括补上传的图、有了封面和预览的视频、换成高清原图的照片）。
// 只收判定放行的（画面里有张年、或和他当天的生活直接相关；敏感信息规则照旧；拿不准的不收）——判定本身在
// 调用方（deepseek-flash 看图 → decidePhoto + decideSensitivePhoto），这里只排。
// 顺序：按拍摄时间；首屏 6 格，当天有视频时至少放一个视频进首屏。

export const FIRST_SCREEN_SLOTS = 6;
export const MAX_DAY_MEDIA = 60;

/** 首屏至少留几格给生活场景（吃饭、出游、居住环境、家人互动……）——Teddy 2026-09-27：生活照不能只藏在折叠区。 */
export const FIRST_SCREEN_LIFE_SLOTS = 2;

/**
 * @param {{id:string, type:"photo"|"video", takenAt:string, allowed:boolean, family?:boolean}[]} items
 *   family：由家庭生活分支放行的生活场景照（decideFamilyLifePhoto），首屏保证有；没有这个标记的照片行为不变。
 * @returns {{expandedMediaIds:string[], firstScreenMediaIds:string[]}}
 */
export function aggregateDayMedia(items, { firstScreen = FIRST_SCREEN_SLOTS, max = MAX_DAY_MEDIA, lifeSlots = FIRST_SCREEN_LIFE_SLOTS } = {}) {
  const seen = new Set();
  const ok = items.filter((m) => m.allowed && !seen.has(m.id) && seen.add(m.id))
    .sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id))
    .slice(0, max);
  const expanded = ok.map((m) => m.id);
  const byTime = (a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id);
  let first = ok.slice(0, firstScreen);
  const video = ok.find((m) => m.type === "video");
  if (video && !first.some((m) => m.type === "video")) {
    first = [...first.slice(0, Math.max(0, firstScreen - 1)), video].sort(byTime);
  }
  // 生活场景：首屏里不足 lifeSlots 张时，从后面按时间顺序补进来，顶掉首屏里最后几张非视频、非生活照的人像。
  const lifeWanted = Math.min(lifeSlots, ok.filter((m) => m.family === true).length);
  if (lifeWanted > first.filter((m) => m.family === true).length) {
    const missing = ok.filter((m) => m.family === true && !first.includes(m)).slice(0, lifeWanted - first.filter((m) => m.family === true).length);
    const replaceable = first.filter((m) => m.type !== "video" && m.family !== true);
    const dropped = new Set(replaceable.slice(Math.max(0, replaceable.length - missing.length)).map((m) => m.id));
    first = [...first.filter((m) => !dropped.has(m.id)), ...missing].slice(0, firstScreen).sort(byTime);
  }
  // 首屏必须是展开清单的子集；页面按展开清单的顺序排，首屏放在最前面。
  const firstIds = first.map((m) => m.id);
  return { expandedMediaIds: [...firstIds, ...expanded.filter((id) => !firstIds.includes(id))], firstScreenMediaIds: firstIds };
}
