// 照片的**主题标注**缓存（2026-09-16，Teddy：「主题把年去掉，换成玩水，睡觉，笑等主题。
// 选片也选和主题有关的。」「确认选的是最有价值的图片。」）。
//
// ─────────────────────────────────────────────────────────────────────────────
// 为什么是缓存文件，不是渲染时查库
// ─────────────────────────────────────────────────────────────────────────────
//
// 标注由夜间有界批次生成，原始评分追加到私有 photo-reviews/home-carousel 历史。
// 人工逐张复核后导出精简 JSON 随仓库发布。首页只读缓存，不调用模型。
// 理由是 CLAUDE.md 里那条：**页面渲染路径不新增数据库读取**（loadFamilyArchive 误接
// getOrganizerStore 那次，一天多花了 $87 出站流量）。lib/home-photo-quality.ts 是同一个做法。
//
// ─────────────────────────────────────────────────────────────────────────────
// 读不到新版缓存：主题与季节都不展示
// ─────────────────────────────────────────────────────────────────────────────
//
// 缓存缺失时 `topicLookup` 对每一张都返回 undefined。后果是明确的、也是想要的：
//   · 「玩水 / 睡觉 / 笑」这类主题**一段都不出**——不知道画面里是什么，就不能说这是一段玩水的回忆；
//   · 季节也必须有可见的画面线索，日期正确不能代替视觉评分；
//   · 首页不使用未评分照片来补足八张。
// 也就是说：没有依据的时候，少说话，而不是猜。
//
// **`why` 不在这份缓存里。** 批次里模型会写一句「在泳池里笑」这样的画面描述，那是关于一个孩子的
// 照片内容；选片用不到它，所以它留在账本里可审计，不随代码分发（隐私红线：儿童照片按敏感数据处理）。

/** 批次用的主题词表。`其他` 是兜底，不拿来做一段回忆。 */
export type PhotoTopic = "玩水" | "睡觉" | "笑" | "吃饭" | "户外" | "玩玩具" | "抱着" | "其他";

/**
 * 哪一种水。第二轮单独问的（prompt_version='media-water-v1'）。
 *
 * 为什么要第二轮：第一轮只有 water 布尔，够把「玩水」这个主题救回来，但挑不出片——
 * 澡盆、泳池、河滩在那一层是同一个值。线上实测 218 张有水的照片里，
 * **109 张是湖边河边、19 张是洗澡**，所以「玩水的日子」看起来才不像在玩水。
 */
export type WaterKind = "泳池" | "海边" | "湖边河边" | "洗澡" | "婴儿澡盆" | "喷水戏水" | "说不准";

/** 一张照片的标注。前四项缺一不可——导出时就已经按这条筛过了。 */
export type PhotoTopicLabel = {
  /** Offline GLM review; missing/old scores cannot qualify a homepage slide. */
  carousel?: CarouselScore;
  topic: PhotoTopic;
  /** 画面里有没有水。**和 topic 互相独立**：在泳池里笑，topic 是「笑」，water 仍然是 true。 */
  water: boolean;
  /** 这张值不值得放进一段回忆给家人看，0–1。 */
  value: number;
  /** 对 topic 判断的把握，0–1。**不管 water**（water 是另一个问题）。 */
  confidence: number;
  /**
   * 哪一种水。**只有真的问过的照片才有这一项。**
   * undefined 表示「没问过」，和「问过、判为说不准」是两回事，所以不填默认值。
   */
  waterKind?: WaterKind;
  /** 是不是真的泡在水里游，而不是只站在旁边。同样只有问过才有。 */
  swimming?: boolean;
  /**
   * 画面里到底有没有出现这个孩子。
   *
   * 单独问这一项，是因为 2026-09-17 线上查出来：45 张判为泳池的照片里 **21 张根本没有孩子**
   * ——酒店空泳池、只有水面、只有泳圈玩具，而它们照样拿到了 value ≥ 0.7。
   * 一段「玩水的日子」放一屏空泳池，比放澡盆还糟。
   *
   * 只有 media-water-v2 问过；v1 那批没有这个字段（undefined = 没问过，不是"没有孩子"）。
   */
  childInFrame?: boolean;
};

export const CAROUSEL_THEMES = ["water", "sleep", "laugh", "eat", "outdoor", "toy", "hold", "spring", "summer", "autumn", "winter"] as const;
export type CarouselTheme = typeof CAROUSEL_THEMES[number];
export type CarouselScore = {
  promptVersion: "home-carousel-v4";
  takenAt: string;
  matches: Record<CarouselTheme, number>;
  clarity: number; expression: number;
  qualified: boolean; eyesOpen: boolean; sleeping: boolean; childMain: boolean;
  faceClear: boolean; faceUnblocked: boolean; motionBlur: boolean; sensitive: boolean;
  /** Reviewer exclusions stay distinct from the model's scores. */
  excludedThemes?: CarouselTheme[];
  approvedThemes?: CarouselTheme[];
  sceneKey?: string;
};

export function carouselQualified(label: PhotoTopicLabel | undefined, theme: CarouselTheme, takenAt?: string): boolean {
  const s = label?.carousel;
  return !!s && s.promptVersion === "home-carousel-v4" && !!takenAt
    && s.takenAt.slice(0, 10) === takenAt.slice(0, 10)
    && s.qualified && s.childMain && s.faceClear && s.faceUnblocked && !s.motionBlur && !s.sensitive
    && s.clarity >= 80 && s.expression >= 60 && s.matches[theme] >= 80
    && (s.eyesOpen || (theme === "sleep" && s.sleeping))
    && (theme !== "sleep" || s.sleeping) && !s.excludedThemes?.includes(theme)
    && !!s.approvedThemes?.includes(theme);
}

export function carouselValue(label: PhotoTopicLabel, theme: CarouselTheme): number {
  const s = label.carousel!;
  return (s.matches[theme] * 0.5 + s.clarity * 0.35 + s.expression * 0.15) / 100;
}

export type PhotoTopicCache = {
  model: string;
  promptVersion: string;
  assessedAt: string;
  scope: string;
  topics: Record<string, PhotoTopicLabel>;
};

/** mediaId → 标注；查不到返回 undefined（**不返回一个 0 分**，那是两句不同的话）。 */
export type PhotoTopicLookup = (mediaId: string) => PhotoTopicLabel | undefined;

/** 读不到缓存时用的空 lookup。 */
export const NO_TOPICS: PhotoTopicLookup = () => undefined;

const TOPICS: ReadonlySet<string> = new Set<PhotoTopic>([
  "玩水", "睡觉", "笑", "吃饭", "户外", "玩玩具", "抱着", "其他",
]);

const WATER_KINDS: ReadonlySet<string> = new Set<WaterKind>([
  "泳池", "海边", "湖边河边", "洗澡", "婴儿澡盆", "喷水戏水", "说不准",
]);

/**
 * 严格校验一条标注。**缺字段、类型不对、分数越界，一律当没有这条**，不用默认值补齐。
 *
 * 补默认值是最容易滑进去的伪造：一条只有 topic 的记录被补成 `value: 0` 之后，长得和一次
 * 真实评估一模一样，只是分低——没有任何字段说那一项其实没人评过。
 */
function validLabel(raw: unknown): PhotoTopicLabel | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const record = raw as Record<string, unknown>;
  const { topic, water, value, confidence } = record;
  if (typeof topic !== "string" || !TOPICS.has(topic)) return undefined;
  if (typeof water !== "boolean") return undefined;
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) return undefined;
  if (typeof confidence !== "number" || !Number.isFinite(confidence) || confidence < 0 || confidence > 1) return undefined;
  const label: PhotoTopicLabel = { topic: topic as PhotoTopic, water, value, confidence };
  const c = record.carousel as CarouselScore | undefined;
  const score = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 100;
  if (c?.promptVersion === "home-carousel-v4" && typeof c.takenAt === "string"
    && CAROUSEL_THEMES.every(k => score(c.matches?.[k])) && score(c.clarity) && score(c.expression)
    && [c.qualified, c.eyesOpen, c.sleeping, c.childMain, c.faceClear, c.faceUnblocked, c.motionBlur, c.sensitive].every(v => typeof v === "boolean")
    && (c.excludedThemes === undefined || (Array.isArray(c.excludedThemes) && c.excludedThemes.every(k => CAROUSEL_THEMES.includes(k))))
    && (c.approvedThemes === undefined || (Array.isArray(c.approvedThemes) && c.approvedThemes.every(k => CAROUSEL_THEMES.includes(k))))
    && (c.sceneKey === undefined || typeof c.sceneKey === "string")) label.carousel = c;
  // 这两项是可选的：没问过就没有。问过但值不合法，也当没问过，不猜。
  const { waterKind, swimming } = record;
  if (typeof waterKind === "string" && WATER_KINDS.has(waterKind)) {
    label.waterKind = waterKind as WaterKind;
    if (typeof swimming === "boolean") label.swimming = swimming;
    if (typeof record.childInFrame === "boolean") label.childInFrame = record.childInFrame;
  }
  return label;
}

/** 缓存 → lookup。缓存本身不合格（缺 model / promptVersion / topics）时返回空 lookup。 */
export function topicLookupFrom(cache: PhotoTopicCache | undefined): PhotoTopicLookup {
  if (!cache || !cache.topics || typeof cache.topics !== "object") return NO_TOPICS;
  if (!cache.model || !cache.promptVersion) return NO_TOPICS;
  const table = cache.topics;
  return (mediaId: string) => validLabel(table[mediaId]);
}

// ─────────────────────────────────────────────────────────────────────────────
// 读缓存的代码**不在这个文件里**，这是故意的
// ─────────────────────────────────────────────────────────────────────────────
//
// 见 lib/home-memory-topics-load.ts。这个文件必须保持**纯 TypeScript、零 node 依赖**，
// 因为它被 lib/home-memory.ts 引用，而后者又被 components/home-memory.tsx（"use client"）引用。
// 一旦这里出现 `node:fs/promises`，整条链就把它拖进客户端打包，构建直接失败：
//
//   Import trace: node:fs/promises -> ./lib/home-memory-topics.ts
//                 -> ./lib/home-memory.ts -> ./components/home-memory.tsx
//
// 那份 358KB 的 JSON 同理——它只能在服务端读，不能进客户端产物。
// 要加读文件、读环境变量、读数据库的代码，加到 -load 那个文件里，不要加回这里。
