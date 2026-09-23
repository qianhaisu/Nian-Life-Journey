// 首页第一部分：**几段各有主题的回忆**（2026-09-16，按 Teddy 线上验收的三轮反馈重做）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 主题有两种来源：日期事实，和逐张看过的视觉标注
// ─────────────────────────────────────────────────────────────────────────────
//
// Teddy 给了两张 iPhone 相册「回忆」的截图：「夏天 · 2026年」是一个季节，「周游世界 · 2019年旅程」
// 是一段旅程——**每段有各自的主题**。第一版我做成「每段 = 某一天」，六段全是同一种主题；
// 第二版补上了季节和年。第三版（Teddy 2026-09-16）：
//
//   「主题把年去掉，换成玩水，睡觉，笑等主题。选片也选和主题有关的。」
//   「玩水的意思就是游泳，有水就行。不要放弃这个主题。」
//   「之前保留的主题，选照片也用 deepseek 模型跑下，确认选的是最有价值的图片。」
//
// 所以现在是三种：
//
//   day    —— 有已发布记忆的那一天。标题是那天的标题原文，副标题是具体日期 + 当时年龄。
//   topic  —— 玩水 / 睡觉 / 笑 / 吃饭 / 户外 / 玩玩具 / 抱着。依据是**逐张看过的视觉标注**，
//             记在账本里（content_quality_reviews, target_kind='media_topic'），可逐条核对。
//   season —— 一个季节。标题「2026 年的夏天」，副标题「6 月 — 8 月」。
//
// **「年」去掉了**，因为它其实不是一个主题——「2025 年」只是一个更大的时间桶，
// 里面什么都有，正是 Teddy 说的「随机选的」那种感觉。
//
// **地点主题仍然做不了**：1036 条 life_event 的 `location_label` 全空（0 条）。
// 没有依据就不做，不拿「杭州市」去套一个其实不知道在哪拍的日子。
//
// 季节按人说话的方式跨年：「2025 年的冬天」= 2025-12 → 2026-02。
//
// ─────────────────────────────────────────────────────────────────────────────
// 选片：**去重看像素，挑好看的看价值分**——两件事，两把尺子
// ─────────────────────────────────────────────────────────────────────────────
//
// 这两步刻意分开，因为它们解决的是两个不同的毛病：
//
//   1. **连拍折叠取像素最大的那一张**（representatives）。同一次快门在库里常常同时存着原图和
//      微信压缩版（3120×4160 与 1280×1706，takenAt 相同）；实测 273 个多张连拍组里有 47 组（17%）
//      选中的不是最大那张，平均少 6.8MP，最差一例 960×1280 顶替 3120×4160。
//      这一步**绝不能改用价值分**：两张画面几乎一样的图，价值分也几乎一样，
//      一旦压缩版侥幸高 0.01 分，就又把原图顶掉了——那正是要修的毛病。
//
//   2. **最终取哪几张看价值分**（pickSlides / capPerDay）。到这一步剩下的都是彼此不同的画面，
//      问题变成「哪几张最值得给家人看」，那就该用逐张看过的价值分，而不是按时间均匀取。
//
// 没有价值分时（缓存缺失、这批还没标过）**退回沿时间均匀取**，不假装有依据。
//
// ─────────────────────────────────────────────────────────────────────────────
// 照片门槛
// ─────────────────────────────────────────────────────────────────────────────
//
// 每一张都要有 `media_subject_check` approved（有人开过这个文件、记下画面里是这个孩子）。
// 不用来源担保——来源说的是「这张图来自哪」，不说画面里是谁，所以菜单牌、单词表、微信截屏
// 都能混进来，那正是 Teddy 说的「照片有的质量不高」。
//
// 全部材料来自已经读好的 archive + 一份随仓库发布的标注缓存，**不新增任何数据库读取**
// （CLAUDE.md 渲染路径那条 $87 出站流量的规矩）。
import type { FamilyArchive } from "@/lib/family-archive";
import type { EditorialMemory, MediaRef, MonthChapter } from "@/lib/memory-chapters";
import { burstGroups, isSubjectChecked, type MediaPrivilege } from "@/lib/publication-moments";
import { thumbnailSized } from "@/lib/media/hero";
import { ageAtMonth, formatMonth } from "@/lib/time-signature";
import { moodFor, type MemoryMood } from "@/lib/home-memory-mood";
import { NO_TOPICS, type PhotoTopicLabel, type PhotoTopicLookup } from "@/lib/home-memory-topics";

export const MEMORY_MIN_SLIDES = 6;
/**
 * 一段回忆最多取几张。
 *
 * **20，不是 12**：Teddy 2026-09-17 线上看完八段回忆后说「笑起来的时候做的最好。
 * 每个故事总照片可以达到 20+，也可以用横屏分隔和竖屏分隔」——多图版式（buildScenes /
 * pairSomePortraits，见 components/home-memory.tsx）本来就是按张数动态分幕的，
 * 不需要因为张数变多而改版式逻辑，单纯把上限提高即可。
 */
export const MEMORY_MAX_SLIDES = 20;
/**
 * 首页一共准备几段可切换的回忆。
 *
 * **20，不是 9**：Teddy 2026-09-17 第 4 条「home memories max 不一定要限制成 9，
 * 如果质量好可以到 20」——这条上限本来就只是"轮不轮得到某个主题"的算术保险丝
 * （见下面 2026-09-16/09-17 那两次「6→8→9」的教训），不是有意要卡住数量；
 * 素材质量由更前面的门槛把关（主体核验 + 价值分 ≥ 0.7），这里只管"最多摆几段"，
 * 放宽到 20 不会放松那些门槛。
 *
 * 20 同时也彻底盖过了「多一个主题占一格」的挤占问题——不用再像 8→9 那样精算差一格。（week 主题已删除，见 MemoryThemeKind。）
 */
export const HOME_MEMORIES_MAX = 20;
/** 跨天主题里，同一天最多贡献几张——防止「一整季」变成「某个下午」。 */
export const CROSS_DAY_PER_DAY_MAX = 2;
export const SLIDE_SECONDS = 5;
export const CROSSFADE_MS = 800;

/** 主题回忆只收价值分到这条线以上的照片。 */
export const TOPIC_MIN_VALUE = 0.7;
/** 主题判断的把握下限。**玩水不受这条约束**——water 是另一个问题，见 TOPIC_THEMES。 */
export const TOPIC_MIN_CONFIDENCE = 0.6;

/**
 * 三种主题。每一种的标题与副标题粒度都不同，这正是「每段有单独主题」的意思。
 *
 * 曾经有过第四种 `week`（最近一周，2026-09-17 Teddy「每周日更新」），2026-09-19 Teddy 桌面验收
 * 时明确要求「去掉最近一周的首页回忆」，整条已删除（窗口函数、副标题、组装都不在了）。
 */
export type MemoryThemeKind = "day" | "topic" | "season";

export type HomeMemorySlide = {
  key: string;
  media: MediaRef;
  /** 只可能是已发布记忆的标题原文，且只有 day 主题有——跨天主题没有逐张可依据的文字，就不写。 */
  caption?: string;
};

export type HomeMemory = {
  kind: MemoryThemeKind;
  /** React key 与切换用的稳定标识。 */
  key: string;
  /** 这段回忆的名字。 */
  title: string;
  /** 副标题，粒度跟着主题走。 */
  subtitle: string;
  /** `<time datetime>` 用；跨天主题没有单一日期，就没有。 */
  dateTime?: string;
  href?: string;
  /** 「读读这一天」/「翻到 2025 年」——标签必须跟着去处走，不能共用一句话（原则八那条教训）。 */
  linkLabel?: string;
  slides: HomeMemorySlide[];
  /** 封面是第几张：价值分最高的那一张，不一定是第一张。见 coverIndexOf。 */
  coverIndex: number;
  durationSeconds: number;
  mood: MemoryMood;
  moodReason: string;
  /** 为什么是这一段、依据是什么、折叠掉多少。供审计，不显示。 */
  reason: string;
};

export type HomeMemoryAbsence = { kind: "empty_archive" | "no_qualified_theme"; reason: string };

const pixels = (media: MediaRef) => (media.width ?? 0) * (media.height ?? 0);
const dayOf = (media: MediaRef) => (media.takenAt ?? "").slice(0, 10);
const monthOfMedia = (media: MediaRef) => (media.takenAt ?? "").slice(0, 7);
const hourOf = (media: MediaRef) => Number((media.takenAt ?? "").slice(11, 13));
const byTime = (a: MediaRef, b: MediaRef) =>
  (a.takenAt ?? "").localeCompare(b.takenAt ?? "") || a.id.localeCompare(b.id);

/** 能进幻灯片的照片：主体核验通过 + 画得出来。 */
function usable(photos: readonly MediaRef[], privilege: MediaPrivilege): MediaRef[] {
  return photos.filter((item) => isSubjectChecked(item, privilege) && thumbnailSized(item));
}

/**
 * 每组连拍取**像素最大**的那一张；同样大时按 id 取定，保证确定性。
 *
 * 这一步是**去重**，不是选美——不要改成按价值分排（见文件顶部第 1 条）。
 */
function representatives(photos: readonly MediaRef[]): MediaRef[] {
  return burstGroups([...photos]).map((group) =>
    [...group].sort((a, b) => pixels(b) - pixels(a) || a.id.localeCompare(b.id))[0]);
}

/**
 * 跨段去重（Teddy 2026-09-23：「同一张照片（以及同一次连拍里的近似照片）只能出现在一个段里」）。
 *
 * `ordered` 必须已按时间排好（调用方在这里之前已经排过）。**按连拍分组，整组一起判断**：
 * 只要组里有一张已经被更早的段用掉，这一组（包括组里其它没被选中的近似照片）全部让路，
 * 不只是把那一张精确 id 挡掉——这就是"近似照片"那半句的意思。
 *
 * 之所以在每一段自己过滤好的候选池上做（而不是先在全部照片上算一份全局连拍表），是因为
 * 不同段的候选本来就是从同一个话题标签或同一段日期里筛出来的，连拍分组只在"确实可能是
 * 同一次快门"的范围内做才有意义；跨段（比如"玩水"和"睡觉"）候选混在一起算连拍，只会因为
 * 两张不相关的照片凑巧同一秒拍下（原图+压缩版最常见，但那是同一段内部的事）而互相顶掉。
 */
function excludeUsedBursts(ordered: readonly MediaRef[], usedIds: ReadonlySet<string>): MediaRef[] {
  const kept: MediaRef[] = [];
  for (const group of burstGroups([...ordered])) {
    if (group.some((photo) => usedIds.has(photo.id))) continue;
    kept.push(...group);
  }
  return kept;
}

/** 场景分组替代规则的窗口。真实"同场景"标注字段到位后，这一段整体删掉，改成读那个字段。 */
const SCENE_GAP_MS = 10 * 60 * 1000;

/**
 * 同场景去重的**替代规则**（Teddy 2026-09-23）：数据 session 正在按"10 分钟内 + 画面相似度"
 * 做真正的同场景分组；字段就绪前，先用"同一天 + 拍摄时间连续相差 10 分钟以内"这一条链式规则代替。
 *
 * **严格小于，不是小于等于**：`moments()` 这类测试夹具、以及现有选片逻辑里大量"隔 10 分钟
 * 算不同瞬间"的假设，用的都是恰好 10 分钟的间隔。挑严格小于，10 分钟整的间隔仍然算不同场景，
 * 不会把这些既有的、故意隔开的瞬间收成一场。真正连续快门（几秒到几分钟）落在这条窗口内才会被合并。
 *
 * `ordered` 必须已按时间排好；跨天不合并（day 由调用方给的 dayOf 判定）。
 */
function sceneGroups(ordered: readonly MediaRef[]): MediaRef[][] {
  const groups: MediaRef[][] = [];
  let current: MediaRef[] = [];
  let lastTime: number | undefined;
  let lastDay: string | undefined;
  for (const photo of ordered) {
    const time = photo.takenAt ? Date.parse(photo.takenAt) : undefined;
    const day = dayOf(photo);
    const sameScene = time !== undefined && lastTime !== undefined && day === lastDay
      && time - lastTime < SCENE_GAP_MS;
    if (current.length > 0 && !sameScene) { groups.push(current); current = []; }
    current.push(photo);
    lastTime = time ?? lastTime;
    lastDay = day;
  }
  if (current.length > 0) groups.push(current);
  return groups;
}

/** 每个场景（见 sceneGroups）留一张最值得展示的：按价值分，没有价值分退回像素/时间顺序。 */
function sceneRepresentatives(reps: readonly MediaRef[], topics: PhotoTopicLookup): MediaRef[] {
  const better = byValue(topics);
  return sceneGroups(reps).map((group) => [...group].sort(better)[0]);
}

/** 沿序列均匀取 max 个，保住开头、中段与结尾。**没有价值分时的退路。** */
function spread<T>(items: readonly T[], max: number): T[] {
  if (items.length <= max) return [...items];
  const step = (items.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => items[Math.round(i * step)]);
}

/** 价值分越高越靠前；没有标注的排在有标注的后面（undefined 不等于 0 分）。 */
const byValue = (topics: PhotoTopicLookup) => (a: MediaRef, b: MediaRef) => {
  const va = topics(a.id)?.value;
  const vb = topics(b.id)?.value;
  if (va !== undefined && vb !== undefined && va !== vb) return vb - va;
  if (va !== undefined && vb === undefined) return -1;
  if (va === undefined && vb !== undefined) return 1;
  return pixels(b) - pixels(a) || a.id.localeCompare(b.id);
};

/**
 * 从候选里选 `count` 张。`diversify` 关闭时就是纯按价值分取前 `count` 张；打开时，
 * 每选一张都先看"这个话题目前选了几张"——选得少的话题优先，价值分只用来在同等
 * 次数里排前后。capPerDay（同一天挑几张）和 pickSlides（一整段挑几张）都是
 * "从一堆候选里选 N 张、要不要顾话题多样性"这同一个模式，抽成一个函数，不在两处各写一份。
 */
function pickDiverse(candidates: readonly MediaRef[], count: number, topics: PhotoTopicLookup, diversify: boolean): MediaRef[] {
  const pool = [...candidates];
  const picked: MediaRef[] = [];
  const topicCount = new Map<string, number>();
  const rank = (a: MediaRef, b: MediaRef) => {
    if (diversify) {
      const ca = topicCount.get(topics(a.id)?.topic ?? "") ?? 0;
      const cb = topicCount.get(topics(b.id)?.topic ?? "") ?? 0;
      if (ca !== cb) return ca - cb;
    }
    return byValue(topics)(a, b);
  };
  for (let i = 0; i < count && pool.length > 0; i += 1) {
    pool.sort(rank);
    const best = pool.shift()!;
    picked.push(best);
    if (diversify) {
      const t = topics(best.id)?.topic ?? "";
      topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  }
  return picked;
}

/**
 * 跨天主题：同一天最多留 perDay 张，避免某一天吃掉整段。
 * 留下的是那一天里**价值分最高**的几张，不是最早的几张——除非 `diversify` 打开
 * （Teddy 2026-09-17：「首页专题选片，同质化比较严重」）：那样的话，一天里如果拍了
 * 好几种不同的事，这一天的名额会优先分给不同的话题，而不是把 perDay 个名额都给
 * 同一件事里价值分最高的那几张（比如同一顿饭拍了两张，两张都很清楚，但那还是同一件事）。
 *
 * **只在跨天的"一段日子"主题（season）打开**；topic 主题（玩水/睡觉/笑……）
 * 传 false——那里的候选本来就只有一个话题，diversify 无从谈起。
 */
function capPerDay(photos: readonly MediaRef[], perDay: number, topics: PhotoTopicLookup, diversify = false): MediaRef[] {
  const byDay = new Map<string, MediaRef[]>();
  for (const photo of photos) {
    const day = dayOf(photo);
    const bucket = byDay.get(day) ?? [];
    bucket.push(photo);
    byDay.set(day, bucket);
  }
  const kept: MediaRef[] = [];
  for (const list of byDay.values()) kept.push(...pickDiverse(list, perDay, topics, diversify));
  return kept.sort(byTime);
}

/**
 * 最终取哪几张：**先按价值分砍掉差的一半，再在剩下的里沿时间分段，每段取最好的一张。**
 *
 * 为什么不是单纯「取价值分最高的 max 张」——那是上一版，Teddy 2026-09-17 第 4 条当场看出来了：
 *
 *   「睡着的样子都是特别小的时候拍的，没有近期的」
 *
 * 原因不是后来不睡了，而是那一阵的照片恰好分高，于是 12 张全从同一段时间里挑走。
 * 家人该看到的是"这件事一直在发生"，所以时间覆盖本身就是质量的一部分。
 *
 * 但也不能倒过来只按时间均匀取——那正是更早那一版被说「随机选的」的原因。
 * 所以两条一起用：**价值分决定谁有资格，时间决定从哪几段里各挑一个**。
 *
 * 价值分不够用时（缓存缺失、这一批还没标过）退回 `spread` 沿时间均匀取——
 * 少一个依据就少说一句话，不拿「按时间取」冒充「挑了最好的」。
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * `diversify`：同一段回忆里不能被一个话题占满
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * Teddy 2026-09-17：「首页专题选片，同质化比较严重，比如最近一周，吃的和喝奶的有好多。」
 * 查过账本：那一周价值分最高的 30 张里，「吃饭」占 11 张、「笑」占 12 张——不是巧合，
 * 是这个家庭那几天恰好拍了很多顿饭，而吃饭照片本身也容易拍得清楚（孩子坐定、脸朝前），
 * 价值分天然就高。纯按价值分取，选出来的自然是同一个话题反复出现。
 *
 * 只对**跨话题的主题**（day / season）打开这个开关——它们代表的是"一天"或"一段
 * 日子"，本来就该看见不同的事在发生。**topic 主题（玩水/睡觉/笑……）绝不能打开**：
 * 那一段回忆的全部素材本来就是同一个 topic 标签（match 函数筛出来的），"多样化"在这里
 * 无从谈起，也不该谈——玩水的日子就该全是玩水。
 *
 * 做法：跟第一步一样先分时间段，但段内候选按「这个话题在已选的里出现过几次」升序排、
 * 出现次数相同再比价值分——多次出现同一个话题的候选会被排到后面，等其他话题选完了才轮到它。
 */
function pickSlides(reps: readonly MediaRef[], max: number, topics: PhotoTopicLookup, diversify = false): MediaRef[] {
  if (reps.length <= max) return [...reps];
  const scored = reps.filter((media) => topics(media.id)?.value !== undefined);
  if (scored.length < max) return spread(reps, max);

  // 一、按价值分留下前一半（至少留够 max 张，否则下一步没得挑）。
  // **diversify 打开时不砍这一刀**——「前一半」在 Teddy 举的例子里几乎全是「吃饭」和「笑」，
  // 少数话题的照片在这一步就被切没了，第二步再怎么按话题次数排也没东西可选。
  // 保留全部有价值分的候选，交给第二步的按话题去重来筛，而不是先按价值分筛一遍再去重。
  const keep = diversify ? scored.length : Math.max(max, Math.ceil(scored.length / 2));
  const good = [...scored].sort(byValue(topics)).slice(0, keep).sort(byTime);

  // 二、把这些按时间切成 max 段，每段取分最高的那一张——除非 diversify 打开，
  //    这时优先取一个"目前选得还不够多"的话题，价值分只用来在同等话题次数里排前后。
  const picked: MediaRef[] = [];
  const taken = new Set<string>();
  const topicCount = new Map<string, number>();
  const rankWithinBucket = (a: MediaRef, b: MediaRef) => {
    if (diversify) {
      const ca = topicCount.get(topics(a.id)?.topic ?? "") ?? 0;
      const cb = topicCount.get(topics(b.id)?.topic ?? "") ?? 0;
      if (ca !== cb) return ca - cb;
    }
    return byValue(topics)(a, b);
  };
  for (let i = 0; i < max; i += 1) {
    const from = Math.floor((i * good.length) / max);
    const to = Math.max(from + 1, Math.floor(((i + 1) * good.length) / max));
    const best = good.slice(from, to).sort(rankWithinBucket).find((media) => !taken.has(media.id));
    if (!best) continue;
    taken.add(best.id); picked.push(best);
    if (diversify) {
      const t = topics(best.id)?.topic ?? "";
      topicCount.set(t, (topicCount.get(t) ?? 0) + 1);
    }
  }
  return picked.sort(byTime);
}

/**
 * 封面取**价值分最高**的那一张，不是时间上最早的那一张。
 *
 * 为什么要单独挑：预览不动的时候、家人第一眼看到的就是第 0 张，而幻灯片是按时间排的，
 * 所以跨时间的主题封面永远是最老的一张。2026-09-17 线上「睡着的样子」的封面因此是
 * **出生当天医院小床里的新生儿**——副标题写着 2025 年 1 月 — 2026 年 9 月，
 * 时间是铺开了，可那一眼看到的还是最小的时候，正是 Teddy 抱怨的那件事。
 *
 * 播放顺序仍然是时间顺序（那是一段回忆该有的样子），只有**起点**挪到最好的一张。
 */
function coverIndexOf(
  picked: readonly MediaRef[],
  topics: PhotoTopicLookup,
  preferRecent = false,
): number {
  const better = byValue(topics);
  // 跨时间的主题只在**靠后那一段**里挑封面。
  //
  // 为什么不能单纯取价值分最高的：2026-09-17 改成"取最高分"之后，「睡着的样子」的封面
  // 从出生当天的新生儿换成了……另一张新生儿。原因在价值分自己的口径里——
  // 它奖励「孩子是主体且脸看得清、构图完整、光线正常」，而新生儿特写恰好满分：
  // 脸占满画面、睡着不动所以不糊。一岁半的孩子睡在小床另一头，永远比不过。
  // 于是一个跨越一生的主题，封面必然落在最早那几周，Teddy 说的
  // 「都是特别小的时候拍的，没有近期的」就一直修不掉。
  //
  // 所以跨时间主题把候选限制在后 40%，再在里面取分最高的——**仍然是挑最好的一张，
  // 只是先把"必须是近期的"这条当作硬条件**。播放顺序不受影响，还是从头按时间走。
  // `ceil` 不是 `floor`：12 张时 floor(7.2)=7，窗口是后 5 张（41.7%），而第 7 张在一个
  // 跨越一生的主题里往往还是最早那一段的照片，它的价值分又最高，于是封面照样落回新生儿。
  // ceil(7.2)=8 才是真的"后 40%"。差一个下标，这条规则就整个不生效。
  const from = preferRecent ? Math.min(picked.length - 1, Math.ceil(picked.length * 0.6)) : 0;
  let best = from;
  for (let i = from + 1; i < picked.length; i += 1) {
    if (better(picked[i], picked[best]) < 0) best = i;
  }
  return best;
}

/** 至多两句配文，放在约三分之一与三分之二处；开头与结尾那张不压字。 */
function captionAt(slideCount: number, titles: readonly string[]): Map<number, string> {
  const spots = new Map<number, string>();
  if (slideCount < 3 || titles.length === 0) return spots;
  const positions = [Math.floor(slideCount / 3), Math.floor((slideCount * 2) / 3)];
  titles.slice(0, 2).forEach((title, index) => {
    const at = positions[index];
    if (at !== undefined && at > 0 && at < slideCount - 1 && !spots.has(at)) spots.set(at, title);
  });
  return spots;
}

function moodOf(slides: readonly MediaRef[], pool: readonly MediaRef[], titles: readonly string[]) {
  const hours = pool.map(hourOf).filter((hour) => Number.isFinite(hour));
  return moodFor({
    slides: slides.length,
    photos: pool.length,
    firstHour: hours.length > 0 ? Math.min(...hours) : 12,
    lastHour: hours.length > 0 ? Math.max(...hours) : 12,
    titles,
  });
}

// ── 主题一：某一天 ────────────────────────────────────────────────────────────

export function buildDayMemory(input: {
  day: string; dateLabel: string; ageLabel?: string;
  photos: readonly MediaRef[]; published: readonly EditorialMemory[]; privilege: MediaPrivilege;
  topics?: PhotoTopicLookup;
  /** 跨段去重用（见 excludeUsedBursts）；这个主题目前不接入 selectHomeMemories，默认空集不影响任何调用方。 */
  usedIds?: ReadonlySet<string>;
}): HomeMemory | undefined {
  const { day, dateLabel, ageLabel, photos, published, privilege } = input;
  const topics = input.topics ?? NO_TOPICS;
  const usedIds = input.usedIds ?? new Set<string>();
  // 没有已发布记忆的一天不做 day 主题：它得有真名字和能点进去的去处（原则八）。
  if (published.length === 0) return undefined;
  const pool = excludeUsedBursts([...usable(photos, privilege)].sort(byTime), usedIds);
  const reps = sceneRepresentatives(representatives(pool), topics);
  if (reps.length < MEMORY_MIN_SLIDES) return undefined;

  // diversify: true——一天里发生的事不止一种，不该被价值分最高的那一件事占满整段。
  const picked = pickSlides(reps, MEMORY_MAX_SLIDES, topics, true);
  const titles = published.map((memory) => memory.title);
  const captions = captionAt(picked.length, titles);
  const lead = published[0];
  const mood = moodOf(picked, pool, titles);
  const age = ageLabel ?? lead.signature.ageLabel;
  const scored = picked.filter((media) => topics(media.id)?.value !== undefined).length;
  return {
    kind: "day",
    key: `day:${day}`,
    title: lead.title,
    subtitle: age ? `${dateLabel} · 当时 ${age}` : dateLabel,
    dateTime: day,
    href: `/events/${lead.id}`,
    linkLabel: "读读这一天",
    slides: picked.map((media, index) => ({ key: `${day}|${media.id}`, media, caption: captions.get(index) })),
    coverIndex: coverIndexOf(picked, topics),
    durationSeconds: picked.length * SLIDE_SECONDS,
    mood: mood.mood,
    moodReason: mood.reason,
    reason: `一天：${photos.length} 张里主体核验通过 ${pool.length} 张，折叠成 ${reps.length} 个瞬间`
      + `（每组取像素最大的），取 ${picked.length} 张`
      + `（其中 ${scored} 张按视觉价值分挑选，其余按时间均匀取）`
      + `；标题取自当天已发布记忆「${lead.title}」`,
  };
}

// ── 主题二：玩水 / 睡觉 / 笑 …… ───────────────────────────────────────────────

/**
 * 主题词表。**顺序就是首页「换一段」翻到的顺序**，Teddy 点名的三个排在前面。
 *
 * 标题刻意写成一句短的白话，不是分类名：家人读到的是「玩水的日子」，不是「topic=玩水」。
 * 每一条的依据都是逐张标注，可以回账本核对（provider='claude-code-vision'）。
 */
/** 「玩水」退一步也能接受的水。**洗澡和湖边河边两种口径下都不要**（Teddy 2026-09-17 第 2 条）。 */
const WATER_OK: ReadonlySet<string> = new Set(["泳池", "海边", "喷水戏水"]);

const TOPIC_THEMES: ReadonlyArray<{
  key: string; title: string; basis: string;
  match: (label: PhotoTopicLabel) => boolean;
  /** 先按这个更窄的口径试；够得出一段就用它，不够再退回 `match`。 */
  preferred?: (label: PhotoTopicLabel) => boolean;
}> = [
  // 这一条改过两次，两次都是看了线上之后改的：
  //   2026-09-16 Teddy：「玩水的意思就是游泳，有水就行」-> 只看 water 布尔。
  //   2026-09-17 Teddy：「尽量多换成泳池游泳 不要洗澡的 湖边河边的」。
  // 为什么第一版看起来不像玩水：226 张有水的照片里 **109 张是湖边河边、19 张是洗澡**，
  // 它们在 water 布尔那一层和泳池是同一个值，于是一段「玩水」里大半是在河边站着和在澡盆里。
  // 现在先只用泳池和真的泡在水里游的（22 张，17 张高价值，够做一段）；
  // 万一以后不够了才退回海边与喷水戏水。两种口径都不含洗澡和湖边河边。
  {
    key: "water",
    title: "玩水的日子",
    basis: "泳池，且这个孩子真的泡在水里（洗澡、婴儿澡盆、湖边河边、岸上抱着的都已排除）",
    // **不要再用 `swimming === true` 把 kind 绕过去。** 2026-09-17 线上「玩水的日子」
    // 第一张就是澡盆：室内瓷砖墙、戴洗头帽、坐在充气盆里。查账本，模型自己判的是
    // kind=洗澡、why=「浴室浴缸，小孩泡在水中」——它说对了，是这条规则用 swimming 把它捞了回来。
    // 审计里 10 张可疑的有 6 张都是 `kind=洗澡 swim=true` 这个形状。
    // 洗澡和湖边河边现在是**无条件否决**，模型说它在游泳也不行。
    // 还要求画面里真的有这个孩子：2026-09-17 查账本，45 张判为泳池的有 21 张没有孩子
    // （酒店空泳池、只有水面、只有泳圈），而它们的 value 照样 ≥ 0.7——价值分没兜住这一条。
    // 还要求 swimming：**「画面里有这个孩子」不等于「这个孩子在玩水」。**
    // 2026-09-17 线上那一张是大人抱着 5 个月的张年站在湖边，背后是水面和远山——
    // 模型判成 泳池 + child=true + swimming=false，前两项都对，人却根本没沾水。
    // 账本里 泳池+有孩子 共 24 张，其中 18 张（8 天）是真的泡在水里的，
    // 剩下 6 张全是这种"站在水边"。8 天高于 6 个瞬间的下限，所以这一条收得起。
    preferred: (l) => l.water && l.waterKind === "泳池"
      && l.childInFrame === true && l.swimming === true,
    match: (l) => l.water && l.waterKind !== undefined && WATER_OK.has(l.waterKind)
      && l.childInFrame === true && l.swimming === true,
  },
  { key: "sleep", title: "睡着的样子", basis: "主题判为「睡觉」", match: (l) => l.topic === "睡觉" && l.confidence >= TOPIC_MIN_CONFIDENCE },
  { key: "laugh", title: "笑起来的时候", basis: "主题判为「笑」", match: (l) => l.topic === "笑" && l.confidence >= TOPIC_MIN_CONFIDENCE },
  { key: "eat", title: "吃饭这件事", basis: "主题判为「吃饭」", match: (l) => l.topic === "吃饭" && l.confidence >= TOPIC_MIN_CONFIDENCE },
  { key: "outdoor", title: "在外面的时候", basis: "主题判为「户外」", match: (l) => l.topic === "户外" && l.confidence >= TOPIC_MIN_CONFIDENCE },
  { key: "toy", title: "和玩具在一起", basis: "主题判为「玩玩具」", match: (l) => l.topic === "玩玩具" && l.confidence >= TOPIC_MIN_CONFIDENCE },
  { key: "hold", title: "被抱着的时候", basis: "主题判为「抱着」", match: (l) => l.topic === "抱着" && l.confidence >= TOPIC_MIN_CONFIDENCE },
];

function buildTopicMemory(input: {
  theme: (typeof TOPIC_THEMES)[number];
  photos: readonly MediaRef[]; privilege: MediaPrivilege; topics: PhotoTopicLookup; birthDay?: string;
  /** 已经被更早的段用掉的照片（跨段去重，见 excludeUsedBursts）。 */
  usedIds?: ReadonlySet<string>;
}): HomeMemory | undefined {
  const { theme, photos, privilege, topics, birthDay } = input;
  const usedIds = input.usedIds ?? new Set<string>();

  const attempt = (
    match: (label: PhotoTopicLabel) => boolean,
    scope: string,
  ): HomeMemory | undefined => {
    const pool = usable(photos, privilege).filter((media) => {
      const label = topics(media.id);
      return Boolean(label) && label!.value >= TOPIC_MIN_VALUE && match(label!);
    });
    if (pool.length === 0) return undefined;

    const ordered = excludeUsedBursts([...pool].sort(byTime), usedIds);
    const reps = capPerDay(sceneRepresentatives(representatives(ordered), topics), CROSS_DAY_PER_DAY_MAX, topics);
    if (reps.length < MEMORY_MIN_SLIDES) return undefined;

    // 不传 diversify：这里的 pool 本来就只有同一个 topic 标签（match 筛出来的），
    // "多样化" 在这里无从谈起——玩水的日子就该全是玩水，不需要也不该往里掺别的话题。
    const picked = pickSlides(reps, MEMORY_MAX_SLIDES, topics);
    // 跨天主题没有逐张可依据的文字，所以**一句配文都不写**。
    const mood = moodOf(picked, pool, []);
    const days = new Set(picked.map(dayOf)).size;
    return {
      kind: "topic",
      key: `topic:${theme.key}`,
      title: theme.title,
      subtitle: spanSubtitle(pool, birthDay),
      // 一个主题横跨很多个月，没有单一的去处——与其给一个「翻到 2026 年」这种对不上的链接，
      // 不如不给（原则八：标签必须跟着去处走）。
      slides: picked.map((media) => ({ key: `topic:${theme.key}|${media.id}`, media })),
      coverIndex: coverIndexOf(picked, topics, true), // 跨时间主题：封面必须是近期的
      durationSeconds: picked.length * SLIDE_SECONDS,
      mood: mood.mood,
      moodReason: mood.reason,
      reason: `主题「${theme.title}」（${scope}）：依据是${theme.basis}，价值分 ≥ ${TOPIC_MIN_VALUE}；`
        + `符合的照片 ${pool.length} 张，每天最多取 ${CROSS_DAY_PER_DAY_MAX} 张得到 ${reps.length} 张，`
        + `先按价值分筛再沿时间铺开取 ${picked.length} 张，来自 ${days} 个不同的日子`,
    };
  };

  // 先试最窄的口径（「玩水」= 只要泳池和真在游泳的）。它凑得出一段就用它——
  // **宁可这一段更小众、更准，也不要为了凑数把河边和澡盆掺进来。**
  // 只有窄口径连 6 个瞬间都凑不出时，才退回宽一点的口径；再不行这段主题就不出现。
  return (theme.preferred ? attempt(theme.preferred, "严格口径") : undefined)
    ?? attempt(theme.match, "放宽口径");
}

/**
 * 「当时 6 个月 — 1 岁 7 个月」。跨很多个月的主题用两个时钟（原则二）。
 *
 * 以前后面还跟一句「· 12 个日子」。2026-09-19 Teddy 桌面验收删掉「最近一周」之后，第一段回忆变成
 * 「玩水的日子」，图上赫然出现「5 个日子」——一个计数式描述，原则三明确禁止（检验句：随机截一个
 * 普通浏览页面，是否出现计数式描述），而且这个数字对家人没有意义：「5 个日子」是什么？它以前只是
 * 没露出来：首位一直是没有这个后缀的「最近一周」。
 */
function spanSubtitle(photos: readonly MediaRef[], birthDay: string | undefined): string {
  const months = [...new Set(photos.map(monthOfMedia))].filter(Boolean).sort();
  if (months.length === 0) return "";
  const first = months[0];
  const last = months[months.length - 1];
  return ageSpan(birthDay, first, last) ?? `${formatMonth(first)} — ${formatMonth(last)}`;
}

/**
 * 「当时 6 个月 — 1 岁 7 个月」。
 *
 * `ageAtMonth` 对出生当月返回的是「出生的那个月」，接在「当时」后面会读成
 * 「当时 出生的那个月 — 11 个月」——句子不通。这种时候返回 undefined，让调用方退回月份跨度。
 */
function ageSpan(birthDay: string | undefined, first: string, last: string): string | undefined {
  const from = ageAtMonth(birthDay, first);
  const to = ageAtMonth(birthDay, last);
  if (!from || !to) return undefined;
  if (from.startsWith("出生") || to.startsWith("出生")) return undefined;
  return from === to ? `当时 ${from}` : `当时 ${from} — ${to}`;
}

// ── 主题三：季节 ──────────────────────────────────────────────────────────────

const SEASONS = [
  { key: "spring", label: "春天", months: [3, 4, 5] },
  { key: "summer", label: "夏天", months: [6, 7, 8] },
  { key: "autumn", label: "秋天", months: [9, 10, 11] },
  // 冬天跨年：2025 年的冬天 = 2025-12 → 2026-02，这是人说话的方式。
  { key: "winter", label: "冬天", months: [12, 1, 2] },
] as const;

/** 这个月属于哪个季节的哪一年（冬天的 1、2 月归上一年）。 */
function seasonOf(month: string): { key: string; label: string; year: number } | undefined {
  const year = Number(month.slice(0, 4));
  const m = Number(month.slice(5, 7));
  const season = SEASONS.find((item) => (item.months as readonly number[]).includes(m));
  if (!season) return undefined;
  const anchorYear = season.key === "winter" && m <= 2 ? year - 1 : year;
  return { key: season.key, label: season.label, year: anchorYear };
}

/**
 * 跨天主题的通用构造：季节和「最近一周」都是它——都是「一段日期事实 + 均匀铺开的照片」，
 * 唯一的差别是窗口有多宽和叫什么名字。2026-09-17 加过 week 主题（已于 2026-09-19 删除）时从 buildSeasonMemory
 * 改名成这个通用版本，逻辑一行没变，只是把 `kind` 从写死的 "season" 变成了参数。
 */
function buildSpanMemory(input: {
  kind: "season";
  key: string; title: string; subtitle: string;
  href?: string; linkLabel?: string;
  photos: readonly MediaRef[]; privilege: MediaPrivilege; topics: PhotoTopicLookup;
  /** 已经被更早的段用掉的照片（跨段去重，见 excludeUsedBursts）。 */
  usedIds?: ReadonlySet<string>;
}): HomeMemory | undefined {
  const { kind, key, title, subtitle, href, linkLabel, photos, privilege, topics } = input;
  const usedIds = input.usedIds ?? new Set<string>();
  const pool = usable(photos, privilege);
  const ordered = excludeUsedBursts([...pool].sort(byTime), usedIds);
  // 两处都要 diversify: true——不只是最后"挑哪几张"要顾话题多样性，
  // 更前面"每天先留哪 2 张"要是已经把某一天拍得最清楚的两张饭都留下来了，
  // 后面 pickSlides 面对的候选池里那一天就只剩吃饭这一个话题可选，diversify 也救不回来。
  const reps = capPerDay(sceneRepresentatives(representatives(ordered), topics), CROSS_DAY_PER_DAY_MAX, topics, true);
  if (reps.length < MEMORY_MIN_SLIDES) return undefined;

  const picked = pickSlides(reps, MEMORY_MAX_SLIDES, topics, true);
  const mood = moodOf(picked, pool, []);
  const days = new Set(picked.map(dayOf)).size;
  const scored = picked.filter((media) => topics(media.id)?.value !== undefined).length;
  return {
    kind,
    key,
    title,
    subtitle,
    href,
    linkLabel,
    slides: picked.map((media) => ({ key: `${key}|${media.id}`, media })),
    coverIndex: coverIndexOf(picked, topics, true), // 跨天主题：封面必须是近期的
    durationSeconds: picked.length * SLIDE_SECONDS,
    mood: mood.mood,
    moodReason: mood.reason,
    reason: `${kind === "season" ? "一个季节" : "最近一周"}：主体核验通过 ${pool.length} 张，折叠后每天最多取`
      + ` ${CROSS_DAY_PER_DAY_MAX} 张得到 ${reps.length} 张，取 ${picked.length} 张（其中 ${scored} 张有视觉价值分），`
      + `来自 ${days} 个不同的日子`,
  };
}

// ── 组装 ──────────────────────────────────────────────────────────────────────

/**
 * 选出首页可以切换的那几段回忆，**三种主题混在一起**。
 *
 * 顺序：按 topic / season 轮流取（interleave），所以「换一段」按下去换到的多半是
 * 另一种主题，而不是同一种主题的另一个日期。全程确定，无随机。
 *
 * `topics` 读不到时（缓存缺失）**主题回忆一段都不出**——不知道画面里是什么，就不能说
 * 这是一段玩水的回忆；周与季节照常，因为它们的依据是日期事实。
 */
export function selectHomeMemories(
  archive: FamilyArchive,
  topics: PhotoTopicLookup = NO_TOPICS,
): { memories: HomeMemory[]; absence?: HomeMemoryAbsence } {
  const { chapters, privilege, birthDay } = archive;
  const today = archive.time.today;

  const byMonth = new Map<string, MediaRef[]>();
  const allPhotos: MediaRef[] = [];
  let scannedDays = 0;

  for (const year of chapters) {
    for (const month of year.months) {
      for (const photoDay of month.photoDays) {
        if (photoDay.day > today) continue;
        scannedDays += 1;
        const bucket = byMonth.get(month.month) ?? [];
        bucket.push(...photoDay.photos);
        byMonth.set(month.month, bucket);
        allPhotos.push(...photoDay.photos);
      }
    }
  }
  if (scannedDays === 0) {
    return { memories: [], absence: { kind: "empty_archive", reason: "档案里还没有一天带照片的记录" } };
  }

  // 首页只展示跨日回忆，以最终展示照片的日期为准。
  const spansMultipleDays = (memory: HomeMemory) =>
    new Set(memory.slides.map((slide) => dayOf(slide.media)).filter(Boolean)).size > 1;

  // 跨段去重（Teddy 2026-09-23：「同一张照片……只能出现在一个段里」）：按段依次建段，
  // 选中的照片从下一段的候选池里排除（见 excludeUsedBursts）。**只有真的会展示的段才占用
  // 这个名额**——被 spansMultipleDays 过滤掉的段（凑出来的照片全挤在一天里）没有上页面，
  // 不该白白挡住后面的段。
  const usedIds = new Set<string>();
  const keep = (memory: HomeMemory | undefined): memory is HomeMemory => {
    if (!memory || !spansMultipleDays(memory)) return false;
    for (const slide of memory.slides) usedIds.add(slide.media.id);
    return true;
  };

  // 主题回忆：玩水 / 睡觉 / 笑 …… 从**全部照片**里找，不限于某一天或某一季。
  // 顺序就是 TOPIC_THEMES 的顺序（Teddy 点名的三个排在前面）——先建的段先挑照片。
  const topicMemories: HomeMemory[] = [];
  for (const theme of TOPIC_THEMES) {
    const memory = buildTopicMemory({ theme, photos: allPhotos, privilege, topics, birthDay, usedIds });
    if (keep(memory)) topicMemories.push(memory);
  }

  // 季节主题
  const seasonPhotos = new Map<string, { label: string; year: number; photos: MediaRef[] }>();
  for (const [month, photos] of byMonth) {
    const season = seasonOf(month);
    if (!season) continue;
    const key = `${season.year}-${season.key}`;
    const bucket = seasonPhotos.get(key) ?? { label: season.label, year: season.year, photos: [] };
    bucket.photos.push(...photos);
    seasonPhotos.set(key, bucket);
  }
  const seasonMemories: HomeMemory[] = [];
  for (const [key, bucket] of [...seasonPhotos.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
    const memory = buildSpanMemory({
      kind: "season",
      key: `season:${key}`,
      title: `${bucket.year} 年的${bucket.label}`,
      subtitle: seasonSubtitle(bucket.label, bucket.year, birthDay),
      href: `/memory/${bucket.year}`,
      linkLabel: `翻到 ${bucket.year} 年`,
      photos: bucket.photos,
      privilege,
      topics,
      usedIds,
    });
    if (keep(memory)) seasonMemories.push(memory);
  }

  const memories = interleaveKinds([topicMemories, seasonMemories], HOME_MEMORIES_MAX);
  if (memories.length === 0) {
    return {
      memories: [],
      absence: {
        kind: "no_qualified_theme",
        reason: `往回看了 ${scannedDays} 天，没有一种主题凑得出 ${MEMORY_MIN_SLIDES} 个主体核验过的不同瞬间`,
      },
    };
  }
  return { memories };
}

/** 「6 月 — 8 月」；冬天跨年，所以写成「12 月 — 次年 2 月」。 */
function seasonSubtitle(label: string, year: number, birthDay: string | undefined): string {
  const season = SEASONS.find((item) => item.label === label);
  if (!season) return `${year} 年`;
  const months = season.months;
  const span = season.key === "winter"
    ? `${year} 年 12 月 — 次年 2 月`
    : `${year} 年 ${months[0]} 月 — ${months[months.length - 1]} 月`;
  // 一个季节跨的是整月，所以这里用月龄（ageSpan）而不是按天算——
  // 季节两端本来就不是具体的某一天，按天算会凭空精确到一个并不存在的日期。
  const first = `${year}-${String(months[0]).padStart(2, "0")}`;
  const last = season.key === "winter"
    ? `${year + 1}-02`
    : `${year}-${String(months[months.length - 1]).padStart(2, "0")}`;
  const age = ageSpan(birthDay, first, last);
  return age ? `${span} · ${age}` : span;
}

/** 三种主题轮流取，所以「换一段」换到的多半是另一种主题。 */
function interleaveKinds(groups: HomeMemory[][], max: number): HomeMemory[] {
  const picked: HomeMemory[] = [];
  for (let round = 0; picked.length < max; round += 1) {
    let tookAny = false;
    for (const group of groups) {
      const item = group[round];
      if (!item) continue;
      picked.push(item);
      tookAny = true;
      if (picked.length >= max) break;
    }
    if (!tookAny) break;
  }
  return picked;
}

export const MEMORY_TIMING = { slideSeconds: SLIDE_SECONDS, crossfadeMs: CROSSFADE_MS } as const;
