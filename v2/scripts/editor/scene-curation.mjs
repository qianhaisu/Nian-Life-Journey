// 同场景精选（Teddy 2026-09-23，第四轮补充）：一天里同一个场景/动作拍了一串，页面上不需要每张都挂。
//
// 分两半，边界照 CLAUDE.md 的长期分工：
//   1. groupScenes —— 纯本地、确定性：只看拍摄时间，相邻两张间隔 <= 10 分钟就串成候选场景。
//      这是「本地程序先处理…缩小候选范围」，不判断画面内容。
//   2. 是不是真的同一场景、留哪几张 —— 交给 deepseek-flash（见 curateScene，photo-classify.mjs 里也是同一个模型），
//      本文件不猜画面，只消费它的判定：applySceneCuration。
//   3. 全天再有一个硬上限（12 张，含视频），场景之间轮流留代表，不能因为场景数太多把后面的场景全挤掉。
//
// 都是纯函数，不读库、不联网。
export const SCENE_WINDOW_MINUTES = 10;
export const SCENE_MAX_KEEP = 3;
export const DAY_MEDIA_CAP = 12;

const toMs = (takenAt) => {
  const s = String(takenAt);
  return Date.parse(/[Zz]$|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
};

/** 场景的 key：组里第一张（按时间排序后）的 id，稳定且唯一。 */
export const sceneKeyOf = (group) => group[0]?.id;

/**
 * 按拍摄时间把候选串成场景：链式分组，相邻两张间隔 <= windowMinutes 就是同一场景；
 * 时间解析不出来（NaN）时当作超出窗口，不合并——拿不准就不合并，不是拿不准就合并。
 * @param {{id:string,type:"photo"|"video",takenAt:string}[]} items
 * @returns {Array<Array<object>>} 每个元素是一个场景（按时间排序），单张也算一个场景
 */
export function groupScenes(items, { windowMinutes = SCENE_WINDOW_MINUTES } = {}) {
  const sorted = [...items].sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id));
  const groups = [];
  let current = [];
  for (const it of sorted) {
    if (current.length) {
      const gap = toMs(it.takenAt) - toMs(current[current.length - 1].takenAt);
      if (!(gap >= 0 && gap <= windowMinutes * 60_000)) { groups.push(current); current = []; }
    }
    current.push(it);
  }
  if (current.length) groups.push(current);
  return groups;
}

/**
 * 把 deepseek 对每个多张场景的判定应用到候选清单上。
 * @param {Array<Array<object>>} groups  groupScenes 的输出
 * @param {Map<string, {sameScene:boolean, keep:string[]}>} decisions  key 是 sceneKeyOf(group)；
 *   只有 group.length > 1 的场景需要出现在这里；判不出来（没有对应 decision）时不合并，全部保留——
 *   拿不准的场景不精选，不是拿不准就乱删。
 * @returns {Array<object>} 精选后的候选（未排序、未做全天上限）
 */
export function applySceneCuration(groups, decisions) {
  const out = [];
  for (const group of groups) {
    if (group.length === 1) { out.push(group[0]); continue; }
    const d = decisions.get(sceneKeyOf(group));
    if (!d || !d.sameScene) { out.push(...group); continue; }
    const videos = group.filter((m) => m.type === "video");
    const photoCap = Math.max(0, SCENE_MAX_KEEP - videos.length);
    const keepIds = new Set((d.keep ?? []).slice(0, photoCap));
    const keptPhotos = group.filter((m) => m.type === "photo" && keepIds.has(m.id));
    out.push(...videos, ...keptPhotos);
  }
  return out;
}

/**
 * 全天上限：场景之间轮流留代表（每个场景先留 1 张，还有空位再轮第二张……），保证不会因为
 * 场景数量多就把靠后的场景整个挤没了。场景按最早一张的拍摄时间排优先级；上限内放不下的场景，
 * 本轮就轮不到（媒体本身不删，只是这一天页面上不挂）。
 * @param {Array<object>} curated  applySceneCuration 的输出
 * @param {Array<Array<object>>} groups  groupScenes 的输出，用来知道每张属于哪个场景
 * @returns {Array<object>} 按拍摄时间排好的最终候选
 */
export function applyDailyCap(curated, groups, { cap = DAY_MEDIA_CAP } = {}) {
  if (curated.length <= cap) return [...curated].sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id));
  const groupKeyOfId = new Map();
  for (const group of groups) { const key = sceneKeyOf(group); for (const it of group) groupKeyOfId.set(it.id, key); }
  const byGroup = new Map();
  for (const it of curated) {
    const key = groupKeyOfId.get(it.id) ?? it.id;
    if (!byGroup.has(key)) byGroup.set(key, []);
    byGroup.get(key).push(it);
  }
  const orderedKeys = [...byGroup.keys()].sort((a, b) => String(byGroup.get(a)[0]?.takenAt).localeCompare(String(byGroup.get(b)[0]?.takenAt)));
  for (const arr of byGroup.values()) arr.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)));
  const out = [];
  let round = 0;
  while (out.length < cap) {
    let addedThisRound = false;
    for (const key of orderedKeys) {
      if (out.length >= cap) break;
      const arr = byGroup.get(key);
      if (arr.length > round) { out.push(arr[round]); addedThisRound = true; }
    }
    if (!addedThisRound) break;
    round += 1;
  }
  return out.sort((a, b) => String(a.takenAt).localeCompare(String(b.takenAt)) || a.id.localeCompare(b.id));
}
