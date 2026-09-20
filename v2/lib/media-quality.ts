import { THUMBNAIL_MIN_SIDE } from "@/lib/media/hero";

/**
 * 「这张照片的原生分辨率不够，不该再铺到阅读面上」——一条规则，一个地方。
 *
 * 起因（2026-09-20，Teddy）：/memory/2025/07/24 查看器第 3 张糊得没法看，要求这类照片统一从展示
 * 里去掉。只读盘点的结论是**原生分辨率不足**，不是「拍糊了」，也不是管线出错：
 *   · 那张的 media 行、media_assets 源尺寸、投递用的 web 派生图三层都是 90×120；
 *   · 全库 0 例派生图比源图大（没有放大），0 例源图 >=720 却只做出 <480 的派生图（没有做小）；
 *   · 同一资产下的每一条 media_locations —— 包括 `provider='wechat'` 的 original —— 尺寸一样小，
 *     库里没有更清楚的授权原图可换。
 * 查看器按屏幕宽度铺开一张 90×120，等于放大十几倍。这种「糊」是信息量本来就没有，救不回来。
 *
 * 为什么按**像素尺寸**判定，而不是按清晰度分数：
 *   · 清晰度分数在这件事上会指错人。把线上展示中短边 >=240 的 4,173 张归一化到同一短边后算
 *     sharp.stats()，分数最低的 100 张逐张看下来几乎全是新生儿睡觉的特写、白被子、素墙——低纹理
 *     场景，不是拍糊，而且正是最不该撤的那批。分数分布还是连续的，切在哪都是人为划线。
 *     （反向也成立：240×237 的小图算出来 2.23，比 1080×1254 的清楚大图 1.68 还「高」。）
 *   · 尺寸是「画面里还剩多少信息」的硬事实，而且实际分布是断开的：线上展示的照片里短边 <160 的
 *     有 1,312 张（微信缩略图固定规格 67×120、90×120、157×210…），160–239 之间只有 11 张，
 *     >=240 的有 4,173 张。门槛落在几乎没有样本的真空带里。
 *
 * 为什么门槛正好是 `THUMBNAIL_MIN_SIDE`（160）而不是另起一个数：这个下限是这个项目自己的既有
 * 标准——lib/media/hero.ts 写着「能填满一个网格格子而不明显放大的最小尺寸」，首页
 * （lib/home-memory.ts 的 `usable()`）早就在用它挑照片，所以首页从来没出现过这类小图。漏掉这条
 * 线的是日页、月页、月相册和来源材料：它们只过可投递性和 store_only，不过尺寸。这里不是发明新
 * 标准，是把首页已经在用的那条线补到其余阅读面上。
 *
 * 边界很窄，说清楚：
 *   · 这条规则**只决定要不要展示**。原件、media 行、media_assets、media_locations、故事、来源
 *     链接、任何审核决定都不动，一行都不写。
 *   · 它不碰主体账本。`media_subject_check` 说的是「画面里是不是他」，和分辨率是两件事；
 *     借那条通道表达画质会在主体/隐私账本里留下不是在谈主体的行（2026-09-20 总指挥复核结论）。
 *   · 回滚就是把这段代码改回去：没有账本行要撤，没有数据要还原。
 *   · 尺寸未知、非有限值、非正数一律判 `unknown`，**不撤**。缺数据不是撤下的理由。
 *   · 只管照片。视频、文档、海报不在射程内。
 */

/** 低于这个短边像素数的照片，点开就是放大的马赛克，不再进入阅读面。 */
export const READABLE_MIN_SHORT_SIDE = THUMBNAIL_MIN_SIDE;

/** 微信贴图/缩略图档的上限；Teddy 举报的 90×120 就在这一档。分档只用于报告和理由码。 */
export const THUMBNAIL_ONLY_MAX_SHORT_SIDE = 120;

export type PhotoQualityTier =
  /** 短边 <=120：微信贴图/缩略图级。 */
  | "thumbnail_only"
  /** 短边 121-159：多为 157×210 的托班转发图，仍在既有网格下限之下。 */
  | "below_grid_floor"
  /** 达到或超过既有下限，按画质不撤。 */
  | "readable"
  /** 尺寸不明或不可信，**不撤**。 */
  | "unknown";

export type SizedRecord = { width?: number | null; height?: number | null };

/**
 * 判断一张照片时可以采信的全部尺寸证据。
 *
 * 为什么不只看 media 行：展示层那一行的 width/height 是导入时写下的，可能过时或写错。如果某张图
 * 的 media 行记着缩略图尺寸、而资产或派生图其实有全尺寸，那它是**能救的**，不该因为一行陈旧
 * 元数据被撤下。所以判定取所有已知证据里**最大**的那个短边——只要有任何一处证明这张图够大，
 * 就按够大处理。反过来，一条 thumbnail 派生图的小尺寸永远不会把结论拉低。
 */
export type PhotoQualityEvidence = SizedRecord & {
  type?: string | null;
  /** media_assets 的源尺寸。 */
  asset?: SizedRecord | null;
  /** 该资产下已知的派生图尺寸（web / thumbnail / original 等），逐条。 */
  locations?: ReadonlyArray<SizedRecord | null | undefined> | null;
};

/** 一条记录的短边；宽高缺失、非有限值、非正数一律返回 null（= 证据不可用，不是「很小」）。 */
export function shortSideOf(item: SizedRecord | null | undefined): number | null {
  if (!item) return null;
  const { width, height } = item;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
  if (width <= 0 || height <= 0) return null;
  return Math.min(width, height);
}

/** 所有证据里最大的那个短边；一条都不可用时返回 null。 */
export function bestKnownShortSide(evidence: PhotoQualityEvidence): number | null {
  let best: number | null = null;
  const consider = (record: SizedRecord | null | undefined) => {
    const side = shortSideOf(record);
    if (side !== null && (best === null || side > best)) best = side;
  };
  consider(evidence);
  consider(evidence.asset);
  for (const location of evidence.locations ?? []) consider(location);
  return best;
}

/**
 * 一张照片的画质档位。
 *
 * 非照片（视频、文档、海报）一律 `readable`：本规则只回答「这张照片的分辨率够不够看」，不替别的
 * 类型做判断，也不能成为撤下一段视频的依据。`type` 没给时按照片处理（调用方给的就是照片）。
 */
export function photoQualityTier(evidence: PhotoQualityEvidence): PhotoQualityTier {
  const { type } = evidence;
  if (type !== undefined && type !== null && type !== "photo") return "readable";
  const shortSide = bestKnownShortSide(evidence);
  if (shortSide === null) return "unknown";
  if (shortSide <= THUMBNAIL_ONLY_MAX_SHORT_SIDE) return "thumbnail_only";
  if (shortSide < READABLE_MIN_SHORT_SIDE) return "below_grid_floor";
  return "readable";
}

/** 这张照片是不是「原生分辨率不足，不该展示」。尺寸不明时返回 false。 */
export function isTooSmallToDisplay(evidence: PhotoQualityEvidence): boolean {
  const tier = photoQualityTier(evidence);
  return tier === "thumbnail_only" || tier === "below_grid_floor";
}

/** 报告和清单里用的理由码，写明是按哪一档判的，便于日后追溯。不写进任何账本。 */
export const PHOTO_QUALITY_REASON_CODES: Record<Exclude<PhotoQualityTier, "readable" | "unknown">, readonly string[]> = {
  thumbnail_only: ["quality:thumbnail-only-source", `quality:short-side-le-${THUMBNAIL_ONLY_MAX_SHORT_SIDE}`],
  below_grid_floor: ["quality:below-grid-floor", `quality:short-side-lt-${READABLE_MIN_SHORT_SIDE}`],
};

export function photoQualityReasonCodes(evidence: PhotoQualityEvidence): readonly string[] {
  const tier = photoQualityTier(evidence);
  if (tier === "readable" || tier === "unknown") return [];
  return PHOTO_QUALITY_REASON_CODES[tier];
}
