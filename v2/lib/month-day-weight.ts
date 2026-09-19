// 一个月里哪几天该被当作「值得停一下」的日子，以及把这个月按周分块。
//
// 原则五（Not Equal Weight）的检验句：重要的记忆和普通的一天能否**一眼**分辨。
// 2026-09-19 全站验收：出生那个月（2025-01，「他出生了」）和 2026 年 6 月「把土豆捏成了土豆泥」
// 用同一个模板、同一个字号、同一个盒子渲染，一个月 26 屏全是一样的块。
//
// ── 这里没有真正的「重要性」信号，先把这件事说清楚 ────────────────────────────────
// 我查过：
//   - 21 个月（2025-01 → 2026-09）**全部**是编辑过的内容文件，月页走的是文件，不读事件表，
//     所以事件表里那个全空的 memoryWeight（chapter=highlight=0）对月页根本不起作用；
//   - 内容文件里的 `kind` 也分辨不出来：story / visual-description / text-only 是「这一天怎么写成的」，
//     不是「这一天重不重要」——2026-05、2026-07 是 31/31 天全是 story，2025-01 是 28/28。
// 所以内容里**没有**「这天是里程碑」的标记，而我不能凭空造一个。
//
// ── 代理信号：家人写了多少、拍了多少 ──────────────────────────────────────────────
// 一天里家人写了很多字、又拍了很多照片，通常就是这一天发生了什么、被认真记下来了。这是**代理**，
// 不是判断：一个写得很长的普通日子会被误抬，一个只有一句话的里程碑会被漏掉。它比「所有天一样大」
// 诚实，但不该被当成真相。
//
// 所以留了一条真正的出口：内容文件里某一天可以手写 `emphasis: "lead"`（一定抬高）或
// `"quiet"`（一定不抬），它压过代理信号。现在没有任何文件写了它——等有人（Teddy 或家人）真的标出
// 哪些是里程碑，就由那个标记说了算，这里的代理信号只是没人标之前的兜底。
//
// 全程确定、无随机、不读任何库。

export type DayWeightInput = {
  day: string;
  paragraphs: readonly string[];
  /** 这一天最终能展示的照片/视频数（已过审核门）。 */
  photoCount: number;
  /** 这一天有没有被人审核过、绑定到故事上的照片。 */
  storyBound?: boolean;
  /** 内容文件里手写的强调，只认精确的 "lead" / "quiet"，别的值当没写。 */
  emphasis?: unknown;
  /**
   * 这一天有没有一张够清晰、配得上当领头大图的照片（pickLeadPhoto 有结果）。默认 true；
   * 明确为 false 时这一天不领头——不管代理分多高，也不管有没有手写 lead。
   */
  leadable?: boolean;
};

/**
 * 领头大图的原图宽度下限（像素）。大图在手机上约 358 CSS 像素宽、2x 屏要 700+ 设备像素，
 * 640 是「拉伸不超过约 1.1 倍」的底线。2026-09-19 私有站真数据：2026-06 里 6/25、6/26 的领头图
 * 原图只有 157×210（微信小缩略图），被拉到 358×479，放大 2.3 倍，明显糊。原图就这么小，
 * 怎么处理都糊，所以这样的日子干脆不领头。
 *
 * 用的是 MediaRef.width（**原图**宽度：实测 810 / 1282 / 3024……），不是页面上 <img> 的
 * naturalWidth（那是缩略图的 480，没有区分度）。宽度缺失按不合格处理：验不了就不当门面。
 */
export const LEAD_PHOTO_MIN_WIDTH = 640;

/** 一张照片够不够当领头大图：是静态照片（不是视频），且原图宽度达标。 */
export function isLeadPhoto(item: { type?: string; width?: number | null }): boolean {
  return item.type !== "video" && Number(item.width) >= LEAD_PHOTO_MIN_WIDTH;
}

/** 从一天的照片里挑领头大图：按原有顺序取第一张达标的静态照片；没有就是 undefined。 */
export function pickLeadPhoto<T extends { type?: string; width?: number | null }>(photos: readonly T[]): T | undefined {
  return photos.find(isLeadPhoto);
}

/** 一个月最多抬几天。再多，「一眼分辨」就没有意义了——什么都突出就等于什么都没突出。 */
export const LEAD_DAYS_MAX = 4;
/** 占这个月天数的比例上限：天数很少的月份（比如刚开始的九月）不该一半的天都是重点。 */
export const LEAD_DAYS_SHARE = 0.14;

const PHOTO_CAP = 12;
const TEXT_CAP = 10;
/** 大约每 80 个字折成 1 分，封顶 10 分——写得再长也不该压过「拍了很多」。 */
const CHARS_PER_POINT = 80;
const STORY_BOUND_BONUS = 3;

/** 代理分。只有带照片的日子才有资格被抬——「抬」的方式就是让一张大图领着这一天。 */
export function dayRichness(input: DayWeightInput): number {
  const chars = input.paragraphs.reduce((sum, text) => sum + [...text].length, 0);
  return Math.min(input.photoCount, PHOTO_CAP)
    + Math.min(chars / CHARS_PER_POINT, TEXT_CAP)
    + (input.storyBound ? STORY_BOUND_BONUS : 0);
}

/**
 * 哪几天被抬高。返回日期集合。
 *
 * 规则：
 *   1. 手写 `emphasis: "quiet"` 的天永远不抬；手写 `"lead"` 的天（且有可当大图的照片）一定抬；
 *   2. 其余天按代理分从高到低补满名额，名额 = clamp(round(天数 × 14%), 1, 4)；
 *   3. 没有照片、或没有一张够清晰的照片（LEAD_PHOTO_MIN_WIDTH）的天不会被抬——没有大图可以领，
 *      手写 lead 也一样；
 *   4. 代理信号选出的领头日之间至少隔一天（手写的不受限）。同分按日期先后，保证确定。
 */
export function pickLeadDays(days: readonly DayWeightInput[]): Set<string> {
  const lead = new Set<string>();
  // 有照片、且照片里有一张配得上当大图的，才有资格领头。
  const withPhoto = days.filter((day) => day.photoCount > 0 && day.leadable !== false);

  for (const day of withPhoto) if (day.emphasis === "lead") lead.add(day.day);

  const quota = Math.max(1, Math.min(LEAD_DAYS_MAX, Math.round(days.length * LEAD_DAYS_SHARE)));
  const ranked = withPhoto
    .filter((day) => day.emphasis !== "quiet" && day.emphasis !== "lead")
    .map((day) => ({ day: day.day, score: dayRichness(day) }))
    .sort((a, b) => b.score - a.score || a.day.localeCompare(b.day));

  for (const item of ranked) {
    // 手写 lead 已经占满或超过名额时直接停：手写的不被名额挤掉，也不再补代理信号的。
    if (lead.size >= quota) break;
    // 代理信号选出来的领头日之间至少隔一天：2026-06 第一版选出 6/23、6/25、6/26、6/29，三天挤在
    // 四天里，层级节奏没有散开。相邻的不选，取下一个分高的。手写 lead 不受这条限制——那是人的判断。
    if ([...lead].some((other) => daysApart(other, item.day) <= 1)) continue;
    lead.add(item.day);
  }
  return lead;
}

function daysApart(a: string, b: string): number {
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000;
}

// ── 按周分块 ──────────────────────────────────────────────────────────────────

export type WeekGroup<T> = {
  /** "week-1"…"week-4"，用作页内锚点。 */
  id: string;
  /** 「1 – 7 日」「22 – 30 日」 */
  label: string;
  entries: T[];
};

/**
 * 把一个月的日子按「第几个七天」分成最多四块：1–7、8–14、15–21、22–月底。
 *
 * 不用 ISO 周：家人翻的是「这个月的头几天/中旬/月底」，不是「第 37 周」，而且 ISO 周会把一个月
 * 切成 5–6 段、首尾各带几天别的月份的日子。固定四块最多，最短的一块（22–月底）也读得出范围。
 * 没有日子的那一块不出现。输入需要已经按日期升序。
 */
export function groupIntoWeeks<T extends { day: string }>(entries: readonly T[]): WeekGroup<T>[] {
  if (entries.length === 0) return [];
  const [year, month] = entries[0].day.split("-").map(Number);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const spans = [
    { id: "week-1", from: 1, to: 7 },
    { id: "week-2", from: 8, to: 14 },
    { id: "week-3", from: 15, to: 21 },
    { id: "week-4", from: 22, to: lastDay },
  ];
  const groups: WeekGroup<T>[] = [];
  for (const span of spans) {
    const inSpan = entries.filter((entry) => {
      const dom = Number(entry.day.slice(8, 10));
      return dom >= span.from && dom <= span.to;
    });
    if (inSpan.length === 0) continue;
    groups.push({ id: span.id, label: `${span.from} – ${span.to} 日`, entries: inSpan });
  }
  return groups;
}
